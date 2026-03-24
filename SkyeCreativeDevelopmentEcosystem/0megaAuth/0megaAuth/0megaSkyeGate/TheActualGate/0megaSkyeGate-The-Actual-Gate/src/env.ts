import type { Env, KaixuEngineAlias, KaixuLane } from './types'

export function requireDb(env: Env): D1Database {
  if (!env.DB) throw new Error('DB binding is missing.')
  return env.DB
}

export function getEnvString(env: Env, key: keyof Env, fallback = ''): string {
  const value = env[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function getEnvBoolean(env: Env, key: keyof Env, fallback = false): boolean {
  const value = getEnvString(env, key)
  if (!value) return fallback
  return value.toLowerCase() === 'true'
}

export function getEnvNumber(env: Env, key: keyof Env, fallback: number): number {
  const value = getEnvString(env, key)
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getBrandName(env: Env): string {
  return getEnvString(env, 'KAIXU_PUBLIC_BRAND', 'Skyes Over London')
}

export function getGateName(env: Env): string {
  return getEnvString(env, 'KAIXU_GATE_NAME', 'Kaixu')
}

export function getAdminToken(env: Env): string {
  return getEnvString(env, 'KAIXU_ADMIN_TOKEN', getEnvString(env, 'ADMIN_MASTER_TOKEN'))
}

export function getFounderGatewayKey(env: Env): string {
  return getEnvString(env, 'Founders_GateWay_Key', getEnvString(env, 'FOUNDERS_GATEWAY_KEY'))
}

export function getSessionJwtSecret(env: Env): string {
  return getEnvString(env, 'SESSION_JWT_SECRET')
}

export function getNetlifyIdentityUrl(env: Env): string {
  return getEnvString(env, 'NETLIFY_IDENTITY_URL')
}

export function getNetlifyIdentityToken(env: Env): string {
  return getEnvString(env, 'NETLIFY_IDENTITY_TOKEN')
}

export function getNetlifyFormsEndpoint(env: Env): string {
  return getEnvString(env, 'NETLIFY_FORMS_ENDPOINT')
}

export function getNetlifyFormsToken(env: Env): string {
  return getEnvString(env, 'NETLIFY_FORMS_TOKEN')
}

export function getNetlifyBlobsEndpoint(env: Env): string {
  return getEnvString(env, 'NETLIFY_BLOBS_ENDPOINT')
}

export function getNetlifyBlobsToken(env: Env): string {
  return getEnvString(env, 'NETLIFY_BLOBS_TOKEN')
}

export function getNeonDatabaseUrl(env: Env): string {
  return getEnvString(env, 'NEON_DATABASE_URL')
}

export function hasNeonDatabase(env: Env): boolean {
  return getNeonDatabaseUrl(env).trim().length > 0
}

export function getBackupBrainBaseUrl(env: Env): string {
  return getEnvString(env, 'KAIXU_BRAIN_BASE_BACKUP')
}

export function getBackupBrainToken(env: Env): string {
  return getEnvString(env, 'KAIXU_BACKUP_TOKEN', getEnvString(env, 'KAIXU_APP_TOKEN'))
}

export function isLaneEnabled(env: Env, lane: KaixuLane): boolean {
  switch (lane) {
    case 'chat':
      return getEnvBoolean(env, 'ENABLE_CHAT', true)
    case 'stream':
      return getEnvBoolean(env, 'ENABLE_STREAM', true)
    case 'image':
      return getEnvBoolean(env, 'ENABLE_IMAGES', true)
    case 'video':
      return getEnvBoolean(env, 'ENABLE_VIDEOS', true)
    case 'speech':
      return getEnvBoolean(env, 'ENABLE_AUDIO_SPEECH', true)
    case 'transcribe':
      return getEnvBoolean(env, 'ENABLE_AUDIO_TRANSCRIPTIONS', true)
    case 'realtime':
      return getEnvBoolean(env, 'ENABLE_REALTIME', true)
    default:
      return true
  }
}

export function getLaneKey(env: Env, lane: KaixuLane): string {
  const generic = getEnvString(env, 'OPENAI_API_KEY')
  switch (lane) {
    case 'chat':
    case 'stream':
      return getEnvString(env, 'OPENAI_TEXT_KEY', generic)
    case 'image':
      return getEnvString(env, 'OPENAI_IMAGES_KEY', generic)
    case 'video':
      return getEnvString(env, 'OPENAI_VIDEOS_KEY', generic)
    case 'speech':
    case 'transcribe':
      return getEnvString(env, 'OPENAI_AUDIO_KEY', generic)
    case 'realtime':
      return getEnvString(env, 'OPENAI_REALTIME_KEY', generic)
    default:
      return generic
  }
}

const ALIAS_MODEL_ENV: Record<KaixuEngineAlias, keyof Env> = {
  'kaixu/flash': 'OPENAI_TEXT_MODEL',
  'kaixu/deep': 'OPENAI_DEEP_MODEL',
  'kaixu/code': 'OPENAI_CODE_MODEL',
  'kaixu/vision': 'OPENAI_VISION_MODEL',
  'kaixu/image': 'OPENAI_IMAGE_MODEL',
  'kaixu/video': 'OPENAI_VIDEO_MODEL',
  'kaixu/speech': 'OPENAI_SPEECH_MODEL',
  'kaixu/transcribe': 'OPENAI_TRANSCRIBE_MODEL',
  'kaixu/realtime': 'OPENAI_REALTIME_MODEL',
  'kaixu/embed': 'OPENAI_TEXT_MODEL',
}

const DEFAULT_MODELS: Record<KaixuEngineAlias, string> = {
  'kaixu/flash': 'gpt-5.4-mini',
  'kaixu/deep': 'gpt-5.4',
  'kaixu/code': 'gpt-5.4',
  'kaixu/vision': 'gpt-5.4',
  'kaixu/image': 'gpt-image-1',
  'kaixu/video': 'sora-2',
  'kaixu/speech': 'gpt-4o-mini-tts',
  'kaixu/transcribe': 'gpt-4o-transcribe',
  'kaixu/realtime': 'gpt-realtime',
  'kaixu/embed': 'text-embedding-3-large',
}

export function getDefaultUpstreamModel(env: Env, alias: KaixuEngineAlias): string {
  const envKey = ALIAS_MODEL_ENV[alias]
  if (envKey) {
    const configured = getEnvString(env, envKey)
    if (configured) return configured
  }
  return DEFAULT_MODELS[alias]
}

export function getOpenAIHeaders(apiKey: string, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
  }
  const projectId = getEnvString(env, 'OPENAI_PROJECT_ID')
  if (projectId) headers['OpenAI-Project'] = projectId
  return headers
}
