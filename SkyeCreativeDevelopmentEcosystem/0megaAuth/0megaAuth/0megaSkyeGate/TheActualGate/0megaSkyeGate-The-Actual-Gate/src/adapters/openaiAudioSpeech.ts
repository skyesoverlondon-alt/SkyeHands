import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, KaixuEngineAlias, NormalizedSpeechResult, SkySpeechRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export async function callOpenAIAudioSpeech(model: string, request: SkySpeechRequest, env: Env, alias: KaixuEngineAlias): Promise<NormalizedSpeechResult> {
  const apiKey = getLaneKey(env, 'speech')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const format = request.format ?? 'mp3'
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getOpenAIHeaders(apiKey, env),
    },
    body: JSON.stringify({
      model,
      input: request.input,
      voice: request.voice ?? 'alloy',
      response_format: format,
      speed: request.speed,
      metadata: { kaixu_engine_alias: alias, ...(request.metadata ?? {}) },
    }),
  })
  if (!response.ok) throw await fromUpstreamResponse(response)
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const mimeType = format === 'wav' ? 'audio/wav' : format === 'aac' ? 'audio/aac' : format === 'flac' ? 'audio/flac' : format === 'opus' ? 'audio/ogg' : format === 'pcm' ? 'audio/L16' : 'audio/mpeg'
  return {
    asset: {
      asset_id: 'speech_1',
      kind: 'audio',
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      data_url: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    },
    usage: { estimated_cost_usd: 0 },
    raw: { bytes: bytes.byteLength },
  }
}
