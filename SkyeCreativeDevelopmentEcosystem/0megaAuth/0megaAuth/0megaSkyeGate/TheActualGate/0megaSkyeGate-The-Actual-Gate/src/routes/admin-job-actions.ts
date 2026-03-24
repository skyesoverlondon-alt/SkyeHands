import { verifyAdminToken } from '../auth/verifyAdminToken'
import { callOpenAIVideoCreate } from '../adapters/openaiVideos'
import { createKaixuJob, getKaixuJobById, insertKaixuTrace } from '../db/queries'
import { normalizeAlias, resolveUpstreamTarget } from '../routing/kaixu-engines'
import type { Env, SkyVideoRequest } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError, toHttpError } from '../utils/errors'
import { json } from '../utils/json'
import { estimateSize } from '../utils/openai-response'
import { createJobId, createTraceId } from '../utils/trace'
import { handleCancelVideoJob } from './videos'

export async function handleAdminRetryJob(request: Request, env: Env, jobId: string): Promise<Response> {
  verifyAdminToken(request, env)
  const job = await getKaixuJobById(env.DB, jobId)
  if (!job) throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
  if (job.lane !== 'video') {
    throw new KaixuError(400, 'KAIXU_INVALID_INPUT', 'The request payload is invalid for this Kaixu route.', { adminDetail: 'Retry currently implemented for video lane only.' })
  }

  const traceId = createTraceId()
  const newJobId = createJobId()
  const body = (job.request_json || {}) as SkyVideoRequest
  const alias = normalizeAlias(String(job.engine_alias || body.engine || body.alias || 'kaixu/video'), 'video')
  const upstream = await resolveUpstreamTarget(alias, env)

  try {
    const created = await callOpenAIVideoCreate(upstream.model, { ...body, alias }, env, alias)
    await createKaixuJob(env.DB, {
      jobId: newJobId,
      traceId,
      appId: typeof job.app_id === 'string' ? job.app_id : null,
      userId: typeof job.user_id === 'string' ? job.user_id : null,
      orgId: typeof job.org_id === 'string' ? job.org_id : null,
      lane: 'video',
      engineAlias: alias,
      status: created.status,
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      upstreamJobId: created.upstream_job_id,
      requestJson: body,
      resultJson: created.raw,
    })

    const payload = {
      ok: true,
      job_id: newJobId,
      trace_id: traceId,
      engine: publicEngineName(alias),
      status: created.status,
      progress: 0,
      assets: [],
    }

    await insertKaixuTrace(env.DB, {
      traceId,
      jobId: newJobId,
      appId: typeof job.app_id === 'string' ? job.app_id : null,
      userId: typeof job.user_id === 'string' ? job.user_id : null,
      orgId: typeof job.org_id === 'string' ? job.org_id : null,
      lane: 'video',
      engineAlias: alias,
      publicStatus: 'accepted',
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      inputSizeEstimate: estimateSize(body),
      publicResponseJson: payload,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      internalResponseJson: created.raw,
    })

    return json(payload, 202)
  } catch (error) {
    const httpError = toHttpError(error)
    return json({ ok: false, job_id: newJobId, trace_id: traceId, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
}

export async function handleAdminCancelJob(request: Request, env: Env, jobId: string): Promise<Response> {
  verifyAdminToken(request, env)
  try {
    await handleCancelVideoJob(request, env, jobId)
    return json({ ok: true, job_id: jobId, status: 'canceled' })
  } catch (error) {
    const httpError = toHttpError(error)
    return json({ ok: false, job_id: jobId, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
}
