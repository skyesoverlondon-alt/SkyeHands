export type ProviderName = 'openai' | 'gemini' | 'anthropic' | 'backup-brain'
export type KaixuLane =
  | 'health'
  | 'models'
  | 'chat'
  | 'stream'
  | 'image'
  | 'video'
  | 'speech'
  | 'transcribe'
  | 'realtime'
  | 'usage'
  | 'job'
  | 'admin'

export type KaixuEngineAlias =
  | 'kaixu/flash'
  | 'kaixu/deep'
  | 'kaixu/code'
  | 'kaixu/vision'
  | 'kaixu/image'
  | 'kaixu/video'
  | 'kaixu/speech'
  | 'kaixu/transcribe'
  | 'kaixu/realtime'
  | 'kaixu/embed'

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

export type SkyMessage = {
  role: MessageRole
  content: string | MessageContentPart[]
}

export type RequestMetadata = {
  app_id?: string
  user_id?: string
  org_id?: string
  workspace_id?: string
  session_id?: string
}

export type SkyChatRequest = {
  alias?: string
  engine?: KaixuEngineAlias | string
  messages: SkyMessage[]
  stream?: boolean
  temperature?: number
  max_output_tokens?: number
  metadata?: RequestMetadata
}

export type SkyEmbeddingsRequest = {
  alias: string
  input: string[]
  metadata?: RequestMetadata
}

export type SkyImageRequest = {
  alias?: string
  engine?: KaixuEngineAlias | string
  prompt: string
  size?: string
  quality?: string
  background?: 'transparent' | 'opaque' | 'auto'
  moderation?: string
  input_image_base64?: string
  input_image_mime_type?: string
  metadata?: RequestMetadata
}

export type SkyVideoRequest = {
  alias?: string
  engine?: KaixuEngineAlias | string
  prompt: string
  size?: string
  seconds?: number
  fps?: number
  reference_image_base64?: string
  reference_image_mime_type?: string
  metadata?: RequestMetadata
}

export type SkySpeechRequest = {
  alias?: string
  engine?: KaixuEngineAlias | string
  input: string
  voice?: string
  format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm'
  speed?: number
  metadata?: RequestMetadata
}

export type SkyTranscriptionRequest = {
  alias?: string
  engine?: KaixuEngineAlias | string
  file_base64: string
  file_name?: string
  mime_type?: string
  language?: string
  prompt?: string
  include_segments?: boolean
  metadata?: RequestMetadata
}

export type SkyRealtimeSessionRequest = {
  alias?: string
  engine?: KaixuEngineAlias | string
  model?: string
  voice?: string
  modalities?: Array<'text' | 'audio'>
  input_audio_transcription?: {
    model?: string
    language?: string
    prompt?: string
  } | null
  turn_detection?: Record<string, unknown> | null
  metadata?: RequestMetadata
}

export type NormalizedUsage = {
  estimated_cost_usd: number
  input_tokens?: number
  output_tokens?: number
  duration_seconds?: number
}

export type InternalAssetRef = {
  asset_id: string
  kind: 'image' | 'video' | 'audio' | 'file'
  mime_type?: string
  size_bytes?: number
  duration_seconds?: number
  data_url?: string
  url?: string
}

export type NormalizedProviderTextResponse = {
  output: { text: string }
  usage: NormalizedUsage
  raw?: unknown
}

export type NormalizedProviderEmbeddingsResponse = {
  vectors: number[][]
  usage: NormalizedUsage
}

export type NormalizedImageResult = {
  status: 'queued' | 'processing' | 'completed' | 'failed'
  usage: NormalizedUsage
  assets: InternalAssetRef[]
  raw?: unknown
}

export type NormalizedVideoCreateResult = {
  status: 'queued' | 'processing' | 'completed'
  upstream_job_id: string
  raw?: unknown
}

export type NormalizedVideoStatusResult = {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  progress?: number
  assets: InternalAssetRef[]
  raw?: unknown
}

export type NormalizedSpeechResult = {
  asset: InternalAssetRef
  usage: NormalizedUsage
  raw?: unknown
}

export type NormalizedTranscriptionResult = {
  text: string
  segments?: Array<Record<string, unknown>>
  usage: NormalizedUsage
  raw?: unknown
}

export type NormalizedRealtimeSessionResult = {
  session_id?: string
  client_secret: {
    value: string
    expires_at: number
  }
  expires_at?: number
  raw?: unknown
}

export type RouteOption = {
  alias: string
  provider: ProviderName
  model: string
  priority: number
  enabled: boolean
}

export type PricingRule = {
  alias: string
  base_burn: number
  input_token_rate: number
  output_token_rate: number
  image_rate: number
  enabled: boolean
}

export type AuthContext = {
  tokenId: string
  appId: string
  orgId: string
  walletId: string
  allowedAliases: string[]
  rateLimitRpm?: number | null
  authMode?: '0skey' | 'founder-gateway'
  founderGateway?: boolean
}

export type TraceUsageRecord = {
  traceId: string
  orgId?: string
  appId?: string
  userId?: string
  walletId?: string
  alias: string
  provider?: ProviderName
  resolvedModel?: string
  requestType: 'chat' | 'stream' | 'embeddings'
  status: 'success' | 'error'
  skyfuelBurned: number
  estimatedCostUsd: number
  upstreamCostUsd?: number
  billedCostUsd?: number
  markupMultiplier?: number
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  errorCode?: string
  errorMessage?: string
}

export type KaixuTraceRecord = {
  trace_id: string
  job_id?: string | null
  app_id?: string | null
  user_id?: string | null
  org_id?: string | null
  lane: KaixuLane
  engine_alias: string
  public_status: string
  upstream_vendor?: string | null
  upstream_model?: string | null
  input_size_estimate?: number | null
  output_size_estimate?: number | null
  usage_json?: string | null
  latency_ms?: number | null
  public_response_json?: string | null
  public_error_code?: string | null
  public_error_message?: string | null
  request_method?: string | null
  request_path?: string | null
  internal_response_json?: string | null
  internal_error_json?: string | null
  created_at: string
  updated_at: string
}

export type KaixuJobRecord = {
  job_id: string
  trace_id: string
  app_id?: string | null
  user_id?: string | null
  org_id?: string | null
  lane: KaixuLane
  engine_alias: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  upstream_vendor?: string | null
  upstream_model?: string | null
  upstream_job_id?: string | null
  request_json?: string | null
  result_json?: string | null
  asset_refs?: string | null
  error_code?: string | null
  error_message?: string | null
  admin_error_raw?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
}

export type Env = {
  DB: D1Database
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  OPENAI_TEXT_KEY?: string
  OPENAI_IMAGES_KEY?: string
  OPENAI_VIDEOS_KEY?: string
  OPENAI_AUDIO_KEY?: string
  OPENAI_REALTIME_KEY?: string
  OPENAI_PROJECT_ID?: string
  OPENAI_TEXT_MODEL?: string
  OPENAI_DEEP_MODEL?: string
  OPENAI_CODE_MODEL?: string
  OPENAI_VISION_MODEL?: string
  OPENAI_IMAGE_MODEL?: string
  OPENAI_VIDEO_MODEL?: string
  OPENAI_SPEECH_MODEL?: string
  OPENAI_TRANSCRIBE_MODEL?: string
  OPENAI_REALTIME_MODEL?: string
  KAIXU_ADMIN_TOKEN?: string
  ADMIN_MASTER_TOKEN?: string
  KAIXU_PUBLIC_BRAND?: string
  KAIXU_GATE_NAME?: string
  APP_NAME?: string
  APP_ENV?: string
  DEFAULT_CURRENCY?: string
  ENABLE_FALLBACKS?: string
  DEFAULT_MAX_SKYFUEL_PER_CALL?: string
  ENABLE_CHAT?: string
  ENABLE_STREAM?: string
  ENABLE_IMAGES?: string
  ENABLE_VIDEOS?: string
  ENABLE_AUDIO_SPEECH?: string
  ENABLE_AUDIO_TRANSCRIPTIONS?: string
  ENABLE_REALTIME?: string
  // New bindings for 0megaSkyeGate unified gate
  SKYE_ERRORS_DB?: D1Database
  KAIXU_SMOKE_KV?: KVNamespace
  SKYE_ERRORS_RAW?: R2Bucket
  OMEGA_GATE_URL?: string
  KAIXU_BILLING_MARKUP_PERCENT?: string
  KAIXU_BRAIN_BASE_FLOW32?: string
  KAIXU_BRAIN_BASE_BACKUP?: string
  KAIXU_APP_TOKEN?: string
  KAIXU_BACKUP_TOKEN?: string
  NEON_DATABASE_URL?: string
  NETLIFY_IDENTITY_URL?: string
  NETLIFY_IDENTITY_TOKEN?: string
  NETLIFY_FORMS_ENDPOINT?: string
  NETLIFY_FORMS_TOKEN?: string
  NETLIFY_BLOBS_ENDPOINT?: string
  NETLIFY_BLOBS_TOKEN?: string
  Founders_GateWay_Key?: string
  FOUNDERS_GATEWAY_KEY?: string
  SESSION_JWT_SECRET?: string
  SKYE_ERRORS_ADMIN_SECRET?: string
  SKYE_ERRORS_ENABLED?: string
  SKYE_ERRORS_RETENTION_DAYS?: string
  SKYE_ERRORS_MAX_BODY_BYTES?: string
}
