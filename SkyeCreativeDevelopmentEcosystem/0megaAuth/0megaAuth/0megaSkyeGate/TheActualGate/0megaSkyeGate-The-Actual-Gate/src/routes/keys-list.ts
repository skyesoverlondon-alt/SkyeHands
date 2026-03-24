import type { Env } from '../types'
import { listOsKeysWithMirror } from '../db/queries'
import { json } from '../utils/json'
import { verifyAdminToken } from '../auth/verifyAdminToken'

export async function handleKeysList(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  const url = new URL(request.url)
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))
  const appId = url.searchParams.get('app_id') || null

  const rows = await listOsKeysWithMirror(env.DB, { appId, limit, offset }, env)

  return json({ ok: true, key_type: '0sKey', os_keys: rows, keys: rows, limit, offset })
}
