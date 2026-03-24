import type { Env, KaixuEngineAlias, RouteOption } from '../types'
import { getBrandName, getGateName } from '../env'
import type { KaixuError } from './errors'

const PUBLIC_MODEL_ID = 'kAIxU-6.7'
const PUBLIC_MODEL_NAME = 'kAIxU 6.7'

const ENGINE_LABELS: Record<string, string> = {
  'kaixu/flash': 'Kaixu Flash',
  'kaixu/deep': 'Kaixu Deep',
  'kaixu/code': 'Kaixu Code',
  'kaixu/vision': 'Kaixu Vision',
  'kaixu/image': 'Kaixu Image',
  'kaixu/video': 'Kaixu Video',
  'kaixu/speech': 'Kaixu Speech',
  'kaixu/transcribe': 'Kaixu Transcribe',
  'kaixu/realtime': 'Kaixu Realtime',
  'kaixu/embed': 'Kaixu Embed',
}

const ENGINE_TIERS: Record<string, string> = {
  'kaixu/flash': 'fast',
  'kaixu/deep': 'reasoning',
  'kaixu/code': 'code',
  'kaixu/vision': 'multimodal',
  'kaixu/image': 'image',
  'kaixu/video': 'video',
  'kaixu/speech': 'speech',
  'kaixu/transcribe': 'audio',
  'kaixu/realtime': 'realtime',
  'kaixu/embed': 'embeddings',
}

export const PUBLIC_ALIASES: KaixuEngineAlias[] = [
  'kaixu/flash',
  'kaixu/deep',
  'kaixu/code',
  'kaixu/vision',
  'kaixu/image',
  'kaixu/video',
  'kaixu/speech',
  'kaixu/transcribe',
  'kaixu/realtime',
]

export function publicServiceName(appName?: string, env?: Env): string {
  return appName?.trim() || `${getBrandName(env as Env)} • ${getGateName(env as Env)} Sovereign Gateway`
}

export function publicProviderName(env?: Env): string {
  return getBrandName(env as Env)
}

export function publicModelId(): string {
  return PUBLIC_MODEL_ID
}

export function publicModelName(): string {
  return PUBLIC_MODEL_NAME
}

export function publicEngineName(alias: string): string {
  return ENGINE_LABELS[alias] ? `${PUBLIC_MODEL_NAME} • ${ENGINE_LABELS[alias]}` : PUBLIC_MODEL_NAME
}

export function publicEngineTier(alias: string): string {
  return ENGINE_TIERS[alias] || 'custom'
}

export function publicModelDescriptors(routes: Array<RouteOption | { alias: string }>): Array<{ alias: string; model_id: string; engine: string; tier: string; provider: string }> {
  const seen = new Set<string>()
  const output: Array<{ alias: string; model_id: string; engine: string; tier: string; provider: string }> = []
  for (const route of routes) {
    if (seen.has(route.alias)) continue
    seen.add(route.alias)
    output.push({
      alias: PUBLIC_MODEL_ID,
      model_id: PUBLIC_MODEL_ID,
      engine: publicEngineName(route.alias),
      tier: publicEngineTier(route.alias),
      provider: getBrandName(undefined as unknown as Env),
    })
  }
  return output
}

export function publicUsageEvents(events: Record<string, unknown>[]): Record<string, unknown>[] {
  return events.map((event) => ({
    trace_id: event.trace_id,
    job_id: event.job_id ?? null,
    lane: event.lane,
    model: PUBLIC_MODEL_NAME,
    engine: publicEngineName(String(event.engine_alias ?? event.alias ?? 'kaixu/flash')),
    status: event.public_status ?? event.status,
    usage: safeJson(event.usage_json),
    created_at: event.created_at,
  }))
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function publicError(error: KaixuError): { code: string; message: string } {
  return { code: error.code, message: error.message }
}
