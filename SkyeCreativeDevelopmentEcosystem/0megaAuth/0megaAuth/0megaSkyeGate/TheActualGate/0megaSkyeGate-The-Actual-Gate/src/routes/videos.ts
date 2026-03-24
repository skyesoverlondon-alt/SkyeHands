import { assertAliasAllowed } from '../auth/policyGuard'
import { verifyAppToken } from '../auth/verifyAppToken'
import { callOpenAIVideoCancel, callOpenAIVideoCreate, callOpenAIVideoStatus, downloadOpenAIVideoContent } from '../adapters/openaiVideos'
import { createKaixuJob, getKaixuJobById, insertKaixuTrace, updateKaixuJob } from '../db/queries'
import { isLaneEnabled } from '../env'
import { normalizeAlias, resolveUpstreamTarget } from '../routing/kaixu-engines'
import type { Env, SkyVideoRequest } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError, toHttpError } from '../utils/errors'
import { json, readJson } from '../utils/json'
import { estimateSize } from '../utils/openai-response'
import { createJobId, createTraceId } from '../utils/trace'

export async function handleCreateVideo(request: Request, env: Env): Promise<Response> {
  const traceId = createTraceId()
  const jobId = createJobId()
  const started = Date.now()
  const auth = await verifyAppToken(request, env)
  const body = await readJson<SkyVideoRequest>(request)
  const alias = normalizeAlias(body.engine || body.alias, 'video')
  assertAliasAllowed(auth, alias)

  if (!isLaneEnabled(env, 'video')) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const upstream = await resolveUpstreamTarget(alias, env)

  try {
    const created = await callOpenAIVideoCreate(upstream.model, { ...body, alias }, env, alias)
    await createKaixuJob(env.DB, {
      jobId,
      traceId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
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
      job_id: jobId,
      trace_id: traceId,
      engine: publicEngineName(alias),
      status: created.status,
      progress: 0,
      assets: [],
    }

    await insertKaixuTrace(env.DB, {
      traceId,
      jobId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'video',
      engineAlias: alias,
      publicStatus: 'accepted',
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      inputSizeEstimate: estimateSize(body),
      latencyMs: Date.now() - started,
      publicResponseJson: payload,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      internalResponseJson: created.raw,
    })

    return json(payload, 202)
  } catch (error) {
    const httpError = toHttpError(error)
    await insertKaixuTrace(env.DB, {
      traceId,
      jobId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'video',
      engineAlias: alias,
      publicStatus: 'error',
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      inputSizeEstimate: estimateSize(body),
      latencyMs: Date.now() - started,
      publicErrorCode: httpError.code,
      publicErrorMessage: httpError.message,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      internalErrorJson: { adminDetail: httpError.adminDetail, raw: httpError.raw },
    })
    return json({ ok: false, job_id: jobId, trace_id: traceId, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
}

export async function handleGetVideoJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const auth = await verifyAppToken(request, env)
  const job = await getKaixuJobById(env.DB, jobId)
  if (!job || job.app_id !== auth.appId || job.lane !== 'video') {
    throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
  }

  const url = new URL(request.url)
  if (url.searchParams.get('download') === '1') {
    if (!job.upstream_job_id || job.status !== 'completed') {
      throw new KaixuError(409, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
    }
    const variant = (url.searchParams.get('variant') || 'video') as 'video' | 'thumbnail' | 'spritesheet'
    const upstream = await downloadOpenAIVideoContent(String(job.upstream_job_id), env, variant)
    return new Response(upstream.body, { status: 200, headers: { 'content-type': upstream.headers.get('content-type') || 'video/mp4' } })
  }

  if (job.upstream_job_id && job.status !== 'completed' && job.status !== 'failed' && job.status !== 'canceled') {
    const polled = await callOpenAIVideoStatus(String(job.upstream_job_id), env)
    await updateKaixuJob(env.DB, jobId, {
      status: polled.status,
      resultJson: polled.raw,
      assetRefs: polled.assets,
      completedAt: polled.status === 'completed' ? new Date().toISOString() : null,
    })
    Object.assign(job, { status: polled.status, result_json: polled.raw, asset_refs: polled.assets })
  }

  return json({
    ok: true,
    job_id: job.job_id,
    trace_id: job.trace_id,
    engine: publicEngineName(String(job.engine_alias)),
    status: job.status,
    progress: (job.result_json as any)?.progress ?? null,
    assets: Array.isArray(job.asset_refs) ? job.asset_refs : [],
    error: job.error_code ? { code: job.error_code, message: job.error_message } : undefined,
  })
}

export async function handleCancelVideoJob(_request: Request, env: Env, jobId: string): Promise<void> {
  const job = await getKaixuJobById(env.DB, jobId)
  if (!job || job.lane !== 'video') {
    throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
  }
  if (job.upstream_job_id) await callOpenAIVideoCancel(String(job.upstream_job_id), env)
  await updateKaixuJob(env.DB, jobId, { status: 'canceled', completedAt: new Date().toISOString() })
}
