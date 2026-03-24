import { getDefaultUpstreamModel, requireDb } from '../env'
import { listRoutesForAlias } from '../db/queries'
import type { Env, KaixuEngineAlias, KaixuLane } from '../types'

const LANE_BY_ALIAS: Record<KaixuEngineAlias, KaixuLane> = {
  'kaixu/flash': 'chat',
  'kaixu/deep': 'chat',
  'kaixu/code': 'chat',
  'kaixu/vision': 'chat',
  'kaixu/image': 'image',
  'kaixu/video': 'video',
  'kaixu/speech': 'speech',
  'kaixu/transcribe': 'transcribe',
  'kaixu/realtime': 'realtime',
  'kaixu/embed': 'chat',
}

export function normalizeAlias(value?: string, lane?: KaixuLane): KaixuEngineAlias {
  if (value && value in LANE_BY_ALIAS) return value as KaixuEngineAlias
  switch (lane) {
    case 'image':
      return 'kaixu/image'
    case 'video':
      return 'kaixu/video'
    case 'speech':
      return 'kaixu/speech'
    case 'transcribe':
      return 'kaixu/transcribe'
    case 'realtime':
      return 'kaixu/realtime'
    default:
      return 'kaixu/flash'
  }
}

export function laneForAlias(alias: KaixuEngineAlias): KaixuLane {
  return LANE_BY_ALIAS[alias]
}

export async function resolveUpstreamTarget(alias: KaixuEngineAlias, env: Env): Promise<{ provider: 'openai'; model: string }> {
  const routes = await listRoutesForAlias(requireDb(env), alias).catch(() => [])
  const preferred = routes.find((route) => route.provider === 'openai') || routes[0]
  if (preferred) return { provider: 'openai', model: preferred.model }
  return { provider: 'openai', model: getDefaultUpstreamModel(env, alias) }
}
