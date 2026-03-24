import { assertAliasAllowed } from '../auth/policyGuard'
import { verifyAppToken } from '../auth/verifyAppToken'
import { callOpenAIStream } from '../adapters/openaiStream'
import { insertKaixuTrace, insertUsageEvent } from '../db/queries'
import { getBackupBrainBaseUrl, getBackupBrainToken, isLaneEnabled } from '../env'
import { normalizeAlias, resolveUpstreamTarget } from '../routing/kaixu-engines'
import { calculateBillingLedger, publicUsageWithBilledCost } from '../routing/pricing'
import type { Env, ProviderName, SkyChatRequest } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError, toHttpError } from '../utils/errors'
import { json, readJson, sse } from '../utils/json'
import { estimateSize } from '../utils/openai-response'
import { parseSse, encodeSse } from '../utils/sse'
import { createTraceId } from '../utils/trace'

function normalizeBaseUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '')
}

function summarizePrompt(request: SkyChatRequest): string {
  return request.messages
    .map((message) => {
      if (Array.isArray(message.content)) {
        const text = message.content
          .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n')
          .trim()
        return `${message.role}: ${text}`.trim()
      }
      return `${message.role}: ${String(message.content || '')}`.trim()
    })
    .filter(Boolean)
    .join('\n\n')
}

function extractDelta(payload: any): string {
  if (typeof payload?.delta === 'string') return payload.delta
  if (typeof payload?.text === 'string') return payload.text
  if (typeof payload?.output_text === 'string') return payload.output_text
  return ''
}

function extractBackupText(payload: any): string {
  return String(
    payload?.text
      || payload?.output?.text
      || payload?.output
      || payload?.choices?.[0]?.message?.content
      || '',
  ).trim()
}

function toProviderName(value: string | null): ProviderName | undefined {
  if (value === 'openai' || value === 'gemini' || value === 'anthropic' || value === 'backup-brain') {
    return value
  }
  return undefined
}

async function callBackupBrainText(alias: string, request: SkyChatRequest, env: Env): Promise<{
  text: string
  usage: Record<string, unknown>
  route: string
  model: string | null
}> {
  const baseUrl = normalizeBaseUrl(getBackupBrainBaseUrl(env))
  if (!baseUrl) {
    throw new KaixuError(503, 'BACKUP_BRAIN_UNAVAILABLE', 'The backup brain is not configured for this gate runtime.')
  }

  const serviceToken = getBackupBrainToken(env)
  if (!serviceToken) {
    throw new KaixuError(503, 'BACKUP_BRAIN_TOKEN_MISSING', 'The backup brain token is not configured for this gate runtime.')
  }

  const response = await fetch(`${baseUrl}/v1/brain/backup/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      alias,
      engine: alias,
      model: alias,
      prompt: summarizePrompt(request),
      messages: request.messages,
      metadata: request.metadata,
      brain_policy: {
        allow_backup: false,
        allow_user_direct: false,
      },
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new KaixuError(
      response.status,
      'BACKUP_BRAIN_ERROR',
      String(payload?.error || payload?.message || 'The backup brain request failed.').trim() || 'The backup brain request failed.',
      { raw: payload },
    )
  }

  const text = extractBackupText(payload)
  if (!text) {
    throw new KaixuError(502, 'BACKUP_BRAIN_INVALID_RESPONSE', 'The backup brain returned an empty response.', { raw: payload })
  }

  return {
    text,
    usage: {
      estimated_cost_usd: Number(payload?.usage?.estimated_cost_usd ?? 0),
      input_tokens: Number(payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens ?? 0),
      output_tokens: Number(payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens ?? 0),
    },
    route: String(payload?.brain?.route || 'backup'),
    model: payload?.brain?.model ? String(payload.brain.model) : null,
  }
}

async function callBackupBrainStream(alias: string, request: SkyChatRequest, env: Env): Promise<
  | { mode: 'stream'; response: Response; route: string; model: string | null }
  | { mode: 'text'; text: string; usage: Record<string, unknown>; route: string; model: string | null }
> {
  const baseUrl = normalizeBaseUrl(getBackupBrainBaseUrl(env))
  if (!baseUrl) {
    throw new KaixuError(503, 'BACKUP_BRAIN_UNAVAILABLE', 'The backup brain is not configured for this gate runtime.')
  }

  const serviceToken = getBackupBrainToken(env)
  if (!serviceToken) {
    throw new KaixuError(503, 'BACKUP_BRAIN_TOKEN_MISSING', 'The backup brain token is not configured for this gate runtime.')
  }

  try {
    const response = await fetch(`${baseUrl}/v1/brain/backup/generate-stream`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${serviceToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        alias,
        engine: alias,
        model: alias,
        prompt: summarizePrompt(request),
        messages: request.messages,
        metadata: request.metadata,
        stream: true,
        brain_policy: {
          allow_backup: false,
          allow_user_direct: false,
        },
      }),
    })

    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (response.ok && contentType.includes('text/event-stream') && response.body) {
      return {
        mode: 'stream',
        response,
        route: 'backup',
        model: alias,
      }
    }
  } catch {
    // Fall back to the non-stream backup route below.
  }

  const fallback = await callBackupBrainText(alias, request, env)
  return {
    mode: 'text',
    text: fallback.text,
    usage: fallback.usage,
    route: fallback.route,
    model: fallback.model,
  }
}

export async function handleStream(request: Request, env: Env): Promise<Response> {
  const traceId = createTraceId()
  const started = Date.now()
  const auth = await verifyAppToken(request, env)
  const body = await readJson<SkyChatRequest>(request)
  const alias = normalizeAlias(body.engine || body.alias, 'chat')
  assertAliasAllowed(auth, alias)

  if (!isLaneEnabled(env, 'stream')) {
    const err = new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
    return json({ ok: false, trace_id: traceId, error: { code: err.code, message: err.message } }, err.status)
  }

  let upstreamVendor: ProviderName | null = null
  let upstreamModel: string | null = null

  try {
    const normalizedRequest = { ...body, alias, stream: true }
    let upstreamResponse: Response | null = null
    let backupTextResponse: { text: string; usage: Record<string, unknown> } | null = null

    if (auth.founderGateway) {
      const backup = await callBackupBrainStream(alias, normalizedRequest, env)
      upstreamVendor = 'backup-brain'
      upstreamModel = backup.model ?? alias
      if (backup.mode === 'stream') {
        upstreamResponse = backup.response
      } else {
        backupTextResponse = { text: backup.text, usage: backup.usage }
      }
    } else {
      const upstream = await resolveUpstreamTarget(alias, env)
      upstreamVendor = toProviderName(upstream.provider) ?? null
      upstreamModel = upstream.model
      try {
        upstreamResponse = await callOpenAIStream(upstream.model, normalizedRequest, env, alias)
      } catch {
        const backup = await callBackupBrainStream(alias, normalizedRequest, env)
        upstreamVendor = 'backup-brain'
        upstreamModel = backup.model ?? alias
        if (backup.mode === 'stream') {
          upstreamResponse = backup.response
        } else {
          backupTextResponse = { text: backup.text, usage: backup.usage }
        }
      }
    }

    let outputChars = 0
    let usage: Record<string, unknown> = {}
    let finished = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encodeSse('meta', { trace_id: traceId, engine: publicEngineName(alias), ok: true }))
        try {
          if (backupTextResponse) {
            outputChars += backupTextResponse.text.length
            controller.enqueue(encodeSse('delta', { text: backupTextResponse.text }))
            usage = backupTextResponse.usage
          } else if (upstreamResponse?.body) {
            for await (const event of parseSse(upstreamResponse.body)) {
              if (event.data === '[DONE]') break
              let payload: any = null
              try {
                payload = event.data ? JSON.parse(event.data) : null
              } catch {
                payload = { raw: event.data }
              }

              const eventType = String(payload?.type || event.event)
              if (eventType.includes('error')) {
                controller.enqueue(encodeSse('error', { code: 'KAIXU_ENGINE_UNAVAILABLE', message: 'The requested Kaixu engine is unavailable right now.' }))
                continue
              }

              if (eventType.includes('delta')) {
                const delta = extractDelta(payload)
                if (delta) {
                  outputChars += delta.length
                  controller.enqueue(encodeSse('delta', { text: delta }))
                }
                continue
              }

              if (eventType.includes('completed') || eventType.includes('done')) {
                usage = payload?.response?.usage || payload?.usage || {}
                controller.enqueue(encodeSse('done', { usage: publicUsageWithBilledCost(usage, env) }))
                finished = true
              }
            }
          } else {
            throw new KaixuError(502, 'KAIXU_ENGINE_UNAVAILABLE', 'The requested Kaixu engine is unavailable right now.')
          }

          const billing = calculateBillingLedger(Number(usage.estimated_cost_usd ?? 0), env)
          const publicUsage = publicUsageWithBilledCost(usage, env)
          if (!finished) controller.enqueue(encodeSse('done', { usage: publicUsage }))
          await insertKaixuTrace(env.DB, {
            traceId,
            appId: auth.appId,
            userId: body.metadata?.user_id,
            orgId: auth.orgId,
            lane: 'stream',
            engineAlias: alias,
            publicStatus: 'success',
            upstreamVendor,
            upstreamModel,
            inputSizeEstimate: estimateSize(body),
            outputSizeEstimate: outputChars,
            usageJson: publicUsage,
            latencyMs: Date.now() - started,
            publicResponseJson: { ok: true, trace_id: traceId, engine: publicEngineName(alias) },
            requestMethod: request.method,
            requestPath: new URL(request.url).pathname,
          })
          await insertUsageEvent(env.DB, {
            traceId,
            orgId: auth.orgId,
            appId: auth.appId,
            userId: body.metadata?.user_id,
            walletId: auth.walletId,
            alias,
            provider: toProviderName(upstreamVendor),
            resolvedModel: upstreamModel ?? undefined,
            requestType: 'stream',
            status: 'success',
            skyfuelBurned: 0,
            estimatedCostUsd: billing.billedCostUsd,
            upstreamCostUsd: billing.upstreamCostUsd,
            billedCostUsd: billing.billedCostUsd,
            markupMultiplier: billing.markupMultiplier,
            inputTokens: Number(usage.input_tokens ?? 0),
            outputTokens: Number(usage.output_tokens ?? 0),
            latencyMs: Date.now() - started,
          }, env)
        } catch (error) {
          const httpError = toHttpError(error)
          controller.enqueue(encodeSse('error', { code: httpError.code, message: httpError.message }))
          await insertKaixuTrace(env.DB, {
            traceId,
            appId: auth.appId,
            userId: body.metadata?.user_id,
            orgId: auth.orgId,
            lane: 'stream',
            engineAlias: alias,
            publicStatus: 'error',
            upstreamVendor,
            upstreamModel,
            inputSizeEstimate: estimateSize(body),
            latencyMs: Date.now() - started,
            publicErrorCode: httpError.code,
            publicErrorMessage: httpError.message,
            requestMethod: request.method,
            requestPath: new URL(request.url).pathname,
            internalErrorJson: { adminDetail: httpError.adminDetail, raw: httpError.raw },
          })
        } finally {
          controller.close()
        }
      },
    })

    return sse(stream)
  } catch (error) {
    const httpError = toHttpError(error)
    await insertKaixuTrace(env.DB, {
      traceId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'stream',
      engineAlias: alias,
      publicStatus: 'error',
      upstreamVendor,
      upstreamModel,
      inputSizeEstimate: estimateSize(body),
      latencyMs: Date.now() - started,
      publicErrorCode: httpError.code,
      publicErrorMessage: httpError.message,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      internalErrorJson: { adminDetail: httpError.adminDetail, raw: httpError.raw },
    })
    return json({ ok: false, trace_id: traceId, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
}
