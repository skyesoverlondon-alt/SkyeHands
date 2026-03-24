import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, KaixuEngineAlias, NormalizedRealtimeSessionResult, SkyRealtimeSessionRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'

export async function callOpenAIRealtimeSession(model: string, request: SkyRealtimeSessionRequest, env: Env, alias: KaixuEngineAlias): Promise<NormalizedRealtimeSessionResult> {
  const apiKey = getLaneKey(env, 'realtime')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getOpenAIHeaders(apiKey, env),
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model,
        audio: {
          input: {
            transcription: request.input_audio_transcription ?? undefined,
            turn_detection: request.turn_detection ?? undefined,
          },
        },
        voice: request.voice,
        modalities: request.modalities,
        metadata: {
          kaixu_engine_alias: alias,
          ...(request.metadata ?? {}),
        },
      },
    }),
  })
  if (!response.ok) throw await fromUpstreamResponse(response)
  const payload: any = await response.json()
  const clientSecret = payload?.client_secret
  if (!clientSecret?.value) {
    throw new KaixuError(502, 'KAIXU_ENGINE_UNAVAILABLE', 'The requested Kaixu engine is unavailable right now.', { adminDetail: 'Realtime response missing client_secret', raw: payload })
  }
  return {
    session_id: payload?.id,
    client_secret: {
      value: String(clientSecret.value),
      expires_at: Number(clientSecret.expires_at ?? payload?.expires_at ?? 0),
    },
    expires_at: Number(payload?.expires_at ?? clientSecret.expires_at ?? 0),
    raw: payload,
  }
}
