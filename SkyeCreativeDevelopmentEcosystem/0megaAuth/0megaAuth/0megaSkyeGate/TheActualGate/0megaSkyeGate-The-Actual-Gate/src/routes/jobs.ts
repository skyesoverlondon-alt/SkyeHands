import { verifyAppToken } from '../auth/verifyAppToken'
import { getKaixuJobById } from '../db/queries'
import type { Env } from '../types'
import { publicEngineName } from '../utils/branding'
import { KaixuError } from '../utils/errors'
import { json } from '../utils/json'

export async function handleGetJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const auth = await verifyAppToken(request, env)
  const job = await getKaixuJobById(env.DB, jobId)
  if (!job || job.app_id !== auth.appId) throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')

  return json({
    ok: true,
    job_id: job.job_id,
    trace_id: job.trace_id,
    engine: publicEngineName(String(job.engine_alias)),
    lane: job.lane,
    status: job.status,
    assets: Array.isArray(job.asset_refs) ? job.asset_refs : [],
    error: job.error_code ? { code: job.error_code, message: job.error_message } : undefined,
  })
}
