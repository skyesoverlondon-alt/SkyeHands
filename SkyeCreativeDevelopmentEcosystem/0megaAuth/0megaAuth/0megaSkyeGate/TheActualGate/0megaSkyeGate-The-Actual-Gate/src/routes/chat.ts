import { assertAliasAllowed } from '../auth/policyGuard'
import { verifyAppToken } from '../auth/verifyAppToken'
import { insertKaixuTrace, insertUsageEvent } from '../db/queries'
import { getBackupBrainBaseUrl, getBackupBrainToken, isLaneEnabled } from '../env'
import { executeChatWithFallback } from '../routing/applyFallback'
import { normalizeAlias } from '../routing/kaixu-engines'
import { calculateBillingLedger, publicUsageWithBilledCost } from '../routing/pricing'
import { chooseProvider } from '../routing/chooseProvider'
import { resolveAlias } from '../routing/resolveAlias'
import type { Env, ProviderName, SkyChatRequest } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError, toHttpError } from '../utils/errors'
import { json, readJson } from '../utils/json'
import { estimateSize } from '../utils/openai-response'
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

async function callBackupBrainChat(alias: string, request: SkyChatRequest, env: Env) {
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
    output: { text },
    usage: {
      estimated_cost_usd: Number(payload?.usage?.estimated_cost_usd ?? 0),
      input_tokens: Number(payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens ?? 0),
      output_tokens: Number(payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens ?? 0),
    },
    route: String(payload?.brain?.route || 'backup'),
    model: payload?.brain?.model ? String(payload.brain.model) : null,
    raw: payload,
  }
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const traceId = createTraceId()
  const started = Date.now()
  const auth = await verifyAppToken(request, env)
  const body = await readJson<SkyChatRequest>(request)
  const alias = normalizeAlias(body.engine || body.alias, 'chat')
  assertAliasAllowed(auth, alias)

  if (!isLaneEnabled(env, 'chat')) {
    throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  }

  try {
    const normalizedRequest = { ...body, alias }
    let result
    let upstreamVendor: ProviderName | null = null
    let upstreamModel: string | null = null

    if (auth.founderGateway) {
      result = await callBackupBrainChat(alias, normalizedRequest, env)
      upstreamVendor = 'backup-brain'
      upstreamModel = result.model ?? alias
    } else {
      const routes = await resolveAlias(alias, env)
      const routing = await chooseProvider({ alias, appId: auth.appId, orgId: auth.orgId, routes, env })
      const executed = await executeChatWithFallback({
        traceId,
        primary: routing.primary,
        fallbacks: routing.fallbacks,
        allowFallback: routing.allowFallback,
        request: normalizedRequest,
        env,
      })
      result = executed.result
      upstreamVendor = toProviderName(executed.route.provider) ?? null
      upstreamModel = executed.route.model
    }

    const billing = calculateBillingLedger(result.usage.estimated_cost_usd, env)
    const publicUsage = publicUsageWithBilledCost(result.usage, env)

    const payload = {
      ok: true,
      trace_id: traceId,
      engine: publicEngineName(alias),
      output: result.output,
      usage: publicUsage,
    }
    await insertKaixuTrace(env.DB, {
      traceId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'chat',
      engineAlias: alias,
      publicStatus: 'success',
      upstreamVendor,
      upstreamModel,
      inputSizeEstimate: estimateSize(body),
      outputSizeEstimate: estimateSize(result.output),
      usageJson: publicUsage,
      latencyMs: Date.now() - started,
      publicResponseJson: payload,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      internalResponseJson: result.raw,
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
      requestType: 'chat',
      status: 'success',
      skyfuelBurned: 0,
      estimatedCostUsd: billing.billedCostUsd,
      upstreamCostUsd: billing.upstreamCostUsd,
      billedCostUsd: billing.billedCostUsd,
      markupMultiplier: billing.markupMultiplier,
      inputTokens: Number(result.usage.input_tokens ?? 0),
      outputTokens: Number(result.usage.output_tokens ?? 0),
      latencyMs: Date.now() - started,
    }, env)
    return json(payload)
  } catch (error) {
    const httpError = toHttpError(error)
    await insertKaixuTrace(env.DB, {
      traceId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'chat',
      engineAlias: alias,
      publicStatus: 'error',
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
