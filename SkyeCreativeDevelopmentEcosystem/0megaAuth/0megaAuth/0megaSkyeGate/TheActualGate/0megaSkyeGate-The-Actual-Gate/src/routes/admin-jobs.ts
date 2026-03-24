import { verifyAdminToken } from '../auth/verifyAdminToken'
import { getKaixuJobById } from '../db/queries'
import type { Env } from '../types'
import { KaixuError } from '../utils/errors'
import { json } from '../utils/json'

export async function handleAdminJob(request: Request, env: Env, jobId: string): Promise<Response> {
  verifyAdminToken(request, env)
  const job = await getKaixuJobById(env.DB, jobId)
  if (!job) throw new KaixuError(404, 'KAIXU_ASSET_UNAVAILABLE', 'The requested Kaixu asset is unavailable.')
  return json({ ok: true, job })
}
