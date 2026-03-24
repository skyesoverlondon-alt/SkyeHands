import { verifyAdminToken } from '../auth/verifyAdminToken'
import { getKaixuTraceById } from '../db/queries'
import type { Env } from '../types'
import { KaixuError } from '../utils/errors'
import { json } from '../utils/json'

export async function handleAdminTrace(request: Request, env: Env, traceId: string): Promise<Response> {
  verifyAdminToken(request, env)
  const trace = await getKaixuTraceById(env.DB, traceId)
  if (!trace) throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
  return json({ ok: true, trace })
}
