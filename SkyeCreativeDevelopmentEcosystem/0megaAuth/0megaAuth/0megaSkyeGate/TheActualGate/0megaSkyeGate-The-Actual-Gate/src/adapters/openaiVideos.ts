import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, InternalAssetRef, KaixuEngineAlias, NormalizedVideoCreateResult, NormalizedVideoStatusResult, SkyVideoRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'
import { stripDataUrlPrefix, base64ToBytes } from '../utils/base64'

function parseVideoStatus(raw: any): NormalizedVideoStatusResult {
  const upstreamStatus = String(raw?.status ?? 'processing').toLowerCase()
  const status = upstreamStatus === 'succeeded' ? 'completed' : upstreamStatus === 'cancelled' ? 'canceled' : upstreamStatus === 'failed' ? 'failed' : upstreamStatus === 'completed' ? 'completed' : upstreamStatus === 'queued' ? 'queued' : 'processing'
  const assets: InternalAssetRef[] = []
  if (status === 'completed' && raw?.id) {
    assets.push({
      asset_id: 'video_main',
      kind: 'video',
      mime_type: 'video/mp4',
      url: `/v1/videos/${raw.id}?download=1`,
    })
  }
  return {
    status,
    progress: typeof raw?.progress === 'number' ? raw.progress : undefined,
    assets,
    raw,
  }
}

export async function callOpenAIVideoCreate(model: string, request: SkyVideoRequest, env: Env, alias: KaixuEngineAlias): Promise<NormalizedVideoCreateResult> {
  const apiKey = getLaneKey(env, 'video')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')

  const headers = getOpenAIHeaders(apiKey, env)
  let response: Response

  if (request.reference_image_base64) {
    const { base64, mimeType } = stripDataUrlPrefix(request.reference_image_base64)
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', request.prompt)
    if (request.size) form.set('size', request.size)
    if (request.seconds != null) form.set('seconds', String(request.seconds))
    if (request.fps != null) form.set('fps', String(request.fps))
    form.set('image', new File([base64ToBytes(base64)], 'reference.png', { type: request.reference_image_mime_type || mimeType || 'image/png' }))
    response = await fetch('https://api.openai.com/v1/videos', { method: 'POST', headers, body: form })
  } else {
    response = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        size: request.size,
        seconds: request.seconds,
        fps: request.fps,
        metadata: { kaixu_engine_alias: alias, ...(request.metadata ?? {}) },
      }),
    })
  }

  if (!response.ok) throw await fromUpstreamResponse(response)
  const payload: any = await response.json()
  const upstreamId = String(payload?.id ?? payload?.video_id ?? '')
  if (!upstreamId) throw new KaixuError(502, 'KAIXU_JOB_FAILED', 'The Kaixu job failed before completion.', { adminDetail: 'Missing upstream video job id', raw: payload })
  const status = String(payload?.status ?? 'queued').toLowerCase() === 'completed' ? 'completed' : String(payload?.status ?? 'queued').toLowerCase() === 'processing' ? 'processing' : 'queued'
  return { upstream_job_id: upstreamId, status, raw: payload }
}

export async function callOpenAIVideoStatus(upstreamJobId: string, env: Env): Promise<NormalizedVideoStatusResult> {
  const apiKey = getLaneKey(env, 'video')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(upstreamJobId)}`, {
    headers: getOpenAIHeaders(apiKey, env),
  })
  if (!response.ok) throw await fromUpstreamResponse(response)
  const payload: any = await response.json()
  return parseVideoStatus(payload)
}

export async function callOpenAIVideoCancel(upstreamJobId: string, env: Env): Promise<void> {
  const apiKey = getLaneKey(env, 'video')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(upstreamJobId)}`, {
    method: 'DELETE',
    headers: getOpenAIHeaders(apiKey, env),
  })
  if (!response.ok && response.status !== 404) throw await fromUpstreamResponse(response)
}

export async function downloadOpenAIVideoContent(upstreamJobId: string, env: Env, variant?: 'video' | 'thumbnail' | 'spritesheet'): Promise<Response> {
  const apiKey = getLaneKey(env, 'video')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const url = new URL(`https://api.openai.com/v1/videos/${encodeURIComponent(upstreamJobId)}/content`)
  if (variant) url.searchParams.set('variant', variant)
  const response = await fetch(url.toString(), { headers: getOpenAIHeaders(apiKey, env) })
  if (!response.ok) throw await fromUpstreamResponse(response)
  return response
}
