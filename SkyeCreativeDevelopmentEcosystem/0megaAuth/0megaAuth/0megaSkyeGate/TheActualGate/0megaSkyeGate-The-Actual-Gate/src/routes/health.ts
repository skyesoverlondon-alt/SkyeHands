import { getBrandName, getGateName, getLaneKey, isLaneEnabled } from '../env'
import type { Env } from '../types'
import { json } from '../utils/json'

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  const lanes = {
    chat: { enabled: isLaneEnabled(env, 'chat'), key_configured: Boolean(getLaneKey(env, 'chat')) },
    stream: { enabled: isLaneEnabled(env, 'stream'), key_configured: Boolean(getLaneKey(env, 'stream')) },
    images: { enabled: isLaneEnabled(env, 'image'), key_configured: Boolean(getLaneKey(env, 'image')) },
    videos: { enabled: isLaneEnabled(env, 'video'), key_configured: Boolean(getLaneKey(env, 'video')) },
    speech: { enabled: isLaneEnabled(env, 'speech'), key_configured: Boolean(getLaneKey(env, 'speech')) },
    transcriptions: { enabled: isLaneEnabled(env, 'transcribe'), key_configured: Boolean(getLaneKey(env, 'transcribe')) },
    realtime: { enabled: isLaneEnabled(env, 'realtime'), key_configured: Boolean(getLaneKey(env, 'realtime')) },
  }

  return json({
    ok: true,
    brand: getBrandName(env),
    gate: getGateName(env),
    runtime: 'cloudflare-workers',
    lanes,
  })
}
