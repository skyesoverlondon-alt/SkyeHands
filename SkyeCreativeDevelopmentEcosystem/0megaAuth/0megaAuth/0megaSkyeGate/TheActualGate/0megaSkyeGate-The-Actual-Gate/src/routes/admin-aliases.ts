import { verifyAdminToken } from '../auth/verifyAdminToken'
import { listAliases } from '../db/queries'
import type { Env } from '../types'
import { json } from '../utils/json'

export async function handleAdminAliases(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  const aliases = await listAliases(env.DB)
  return json({ ok: true, aliases })
}
