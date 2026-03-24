import { insertFallbackLog } from '../db/queries'
import { getBackupBrainBaseUrl, getBackupBrainToken, requireDb } from '../env'
import { callAnthropicChat } from '../providers/anthropic'
import { callGeminiChat } from '../providers/gemini'
import { callOpenAIChat } from '../providers/openai'
import type { Env, NormalizedProviderTextResponse, RouteOption, SkyChatRequest } from '../types'
import { KaixuError } from '../utils/errors'

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

async function callBackupBrainChat(alias: string, request: SkyChatRequest, env: Env): Promise<NormalizedProviderTextResponse> {
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
    raw: payload,
  }
}

async function invokeChatRoute(route: RouteOption, request: SkyChatRequest, env: Env): Promise<NormalizedProviderTextResponse> {
  switch (route.provider) {
    case 'openai':
      return await callOpenAIChat(route.model, request, env)
    case 'gemini':
      return await callGeminiChat(route.model, request, env)
    case 'anthropic':
      return await callAnthropicChat(route.model, request, env)
    case 'backup-brain':
      return await callBackupBrainChat(route.alias, request, env)
  }
}

export async function executeChatWithFallback(params: {
  traceId: string
  primary: RouteOption
  fallbacks: RouteOption[]
  allowFallback: boolean
  request: SkyChatRequest
  env: Env
}): Promise<{ route: RouteOption; result: NormalizedProviderTextResponse }> {
  const { traceId, primary, fallbacks, allowFallback, request, env } = params

  try {
    const result = await invokeChatRoute(primary, request, env)
    return { route: primary, result }
  } catch (primaryError) {
    if (!allowFallback || fallbacks.length === 0) {
      throw primaryError
    }

    let previous = primary
    let lastError: unknown = primaryError

    for (const fallback of fallbacks) {
      try {
        const result = await invokeChatRoute(fallback, request, env)
        await insertFallbackLog(requireDb(env), {
          traceId,
          fromProvider: previous.provider,
          fromModel: previous.model,
          toProvider: fallback.provider,
          toModel: fallback.model,
          reason: lastError instanceof Error ? lastError.message : 'Primary route failed.',
        })
        return { route: fallback, result }
      } catch (fallbackError) {
        await insertFallbackLog(requireDb(env), {
          traceId,
          fromProvider: previous.provider,
          fromModel: previous.model,
          toProvider: fallback.provider,
          toModel: fallback.model,
          reason: fallbackError instanceof Error ? fallbackError.message : 'Fallback route failed.',
        })
        previous = fallback
        lastError = fallbackError
      }
    }

    if (getBackupBrainBaseUrl(env) && getBackupBrainToken(env)) {
      const backupRoute: RouteOption = {
        alias: primary.alias,
        provider: 'backup-brain',
        model: primary.alias,
        priority: Number.MAX_SAFE_INTEGER,
        enabled: true,
      }

      try {
        const result = await invokeChatRoute(backupRoute, request, env)
        await insertFallbackLog(requireDb(env), {
          traceId,
          fromProvider: previous.provider,
          fromModel: previous.model,
          toProvider: backupRoute.provider,
          toModel: backupRoute.model,
          reason: lastError instanceof Error ? lastError.message : 'Primary and provider fallbacks failed.',
        })
        return { route: backupRoute, result }
      } catch (backupError) {
        await insertFallbackLog(requireDb(env), {
          traceId,
          fromProvider: previous.provider,
          fromModel: previous.model,
          toProvider: backupRoute.provider,
          toModel: backupRoute.model,
          reason: backupError instanceof Error ? backupError.message : 'Backup brain fallback failed.',
        })
        lastError = backupError
      }
    }

    throw lastError
  }
}
