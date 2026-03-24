import { verifyAdminToken } from '../auth/verifyAdminToken'
import { listRoutingRules } from '../db/queries'
import type { Env } from '../types'
import { json } from '../utils/json'

export async function handleAdminRouting(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  const routing = await listRoutingRules(env.DB)
  return json({ ok: true, routing })
}
