import { assertAliasAllowed } from '../auth/policyGuard'
import { verifyAppToken } from '../auth/verifyAppToken'
import { callOpenAIImages } from '../adapters/openaiImages'
import { createKaixuJob, getKaixuJobById, insertKaixuTrace } from '../db/queries'
import { isLaneEnabled } from '../env'
import { normalizeAlias, resolveUpstreamTarget } from '../routing/kaixu-engines'
import type { Env, SkyImageRequest } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError, toHttpError } from '../utils/errors'
import { json, readJson } from '../utils/json'
import { estimateSize } from '../utils/openai-response'
import { createJobId, createTraceId } from '../utils/trace'

export async function handleCreateImage(request: Request, env: Env): Promise<Response> {
  const traceId = createTraceId()
  const jobId = createJobId()
  const started = Date.now()
  const auth = await verifyAppToken(request, env)
  const body = await readJson<SkyImageRequest>(request)
  const alias = normalizeAlias(body.engine || body.alias, 'image')
  assertAliasAllowed(auth, alias)

  if (!isLaneEnabled(env, 'image')) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const upstream = await resolveUpstreamTarget(alias, env)

  try {
    const result = await callOpenAIImages(upstream.model, { ...body, alias }, env, alias)
    const payload = {
      ok: true,
      job_id: jobId,
      trace_id: traceId,
      engine: publicEngineName(alias),
      status: result.status,
      assets: result.assets,
      usage: result.usage,
    }
    await createKaixuJob(env.DB, {
      jobId,
      traceId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'image',
      engineAlias: alias,
      status: result.status,
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      requestJson: body,
      resultJson: result.raw,
      assetRefs: result.assets,
      completedAt: result.status === 'completed' ? new Date().toISOString() : null,
    })
    await insertKaixuTrace(env.DB, {
      traceId,
      jobId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'image',
      engineAlias: alias,
      publicStatus: 'success',
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      inputSizeEstimate: estimateSize(body),
      outputSizeEstimate: estimateSize(result.assets),
      usageJson: result.usage,
      latencyMs: Date.now() - started,
      publicResponseJson: payload,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      internalResponseJson: result.raw,
    })
    return json(payload)
  } catch (error) {
    const httpError = toHttpError(error)
    await insertKaixuTrace(env.DB, {
      traceId,
      jobId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'image',
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

export async function handleGetImageJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const auth = await verifyAppToken(request, env)
  const job = await getKaixuJobById(env.DB, jobId)
  if (!job || job.app_id !== auth.appId || job.lane !== 'image') {
    throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
  }
  return json({
    ok: true,
    job_id: job.job_id,
    trace_id: job.trace_id,
    engine: publicEngineName(String(job.engine_alias)),
    status: job.status,
    assets: Array.isArray(job.asset_refs) ? job.asset_refs : [],
    usage: null,
  })
}
