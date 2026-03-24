import { verifyAdminToken } from '../auth/verifyAdminToken'
import { listProviders } from '../db/queries'
import type { Env } from '../types'
import { json } from '../utils/json'

export async function handleAdminProviders(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  const providers = await listProviders(env.DB)
  return json({ ok: true, providers })
}
