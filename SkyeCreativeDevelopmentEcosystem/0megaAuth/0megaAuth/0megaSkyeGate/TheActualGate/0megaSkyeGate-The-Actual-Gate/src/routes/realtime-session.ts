import { assertAliasAllowed } from '../auth/policyGuard'
import { verifyAppToken } from '../auth/verifyAppToken'
import { callOpenAIRealtimeSession } from '../adapters/openaiRealtime'
import { insertKaixuTrace } from '../db/queries'
import { isLaneEnabled } from '../env'
import { normalizeAlias, resolveUpstreamTarget } from '../routing/kaixu-engines'
import type { Env, SkyRealtimeSessionRequest } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError, toHttpError } from '../utils/errors'
import { json, readJson } from '../utils/json'
import { estimateSize } from '../utils/openai-response'
import { createTraceId } from '../utils/trace'

export async function handleRealtimeSession(request: Request, env: Env): Promise<Response> {
  const traceId = createTraceId()
  const started = Date.now()
  const auth = await verifyAppToken(request, env)
  const body = await readJson<SkyRealtimeSessionRequest>(request)
  const alias = normalizeAlias(body.engine || body.alias, 'realtime')
  assertAliasAllowed(auth, alias)
  if (!isLaneEnabled(env, 'realtime')) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  const upstream = await resolveUpstreamTarget(alias, env)

  try {
    const result = await callOpenAIRealtimeSession(upstream.model, { ...body, alias }, env, alias)
    const payload = {
      ok: true,
      trace_id: traceId,
      engine: publicEngineName(alias),
      session: {
        id: result.session_id,
        client_secret: result.client_secret,
        expires_at: result.expires_at ?? result.client_secret.expires_at,
      },
    }
    await insertKaixuTrace(env.DB, {
      traceId,
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'realtime',
      engineAlias: alias,
      publicStatus: 'success',
      upstreamVendor: upstream.provider,
      upstreamModel: upstream.model,
      inputSizeEstimate: estimateSize(body),
      outputSizeEstimate: estimateSize(payload.session),
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
      appId: auth.appId,
      userId: body.metadata?.user_id,
      orgId: auth.orgId,
      lane: 'realtime',
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
    return json({ ok: false, trace_id: traceId, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
}
