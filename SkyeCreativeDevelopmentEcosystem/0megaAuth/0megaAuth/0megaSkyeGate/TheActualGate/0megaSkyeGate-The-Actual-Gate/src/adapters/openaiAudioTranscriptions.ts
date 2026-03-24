import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, KaixuEngineAlias, NormalizedTranscriptionResult, SkyTranscriptionRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'
import { stripDataUrlPrefix, base64ToBytes } from '../utils/base64'

export async function callOpenAIAudioTranscriptions(model: string, request: SkyTranscriptionRequest, env: Env, alias: KaixuEngineAlias): Promise<NormalizedTranscriptionResult> {
  const apiKey = getLaneKey(env, 'transcribe')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const { base64, mimeType } = stripDataUrlPrefix(request.file_base64)
  const form = new FormData()
  form.set('model', model)
  form.set('file', new File([base64ToBytes(base64)], request.file_name || 'audio.webm', { type: request.mime_type || mimeType || 'audio/webm' }))
  if (request.language) form.set('language', request.language)
  if (request.prompt) form.set('prompt', request.prompt)
  if (request.include_segments) form.set('response_format', 'verbose_json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: getOpenAIHeaders(apiKey, env),
    body: form,
  })

  if (!response.ok) throw await fromUpstreamResponse(response)
  const payload: any = await response.json()
  return {
    text: typeof payload?.text === 'string' ? payload.text : '',
    segments: Array.isArray(payload?.segments) ? payload.segments : undefined,
    usage: { estimated_cost_usd: 0 },
    raw: { alias, payload },
  }
}
