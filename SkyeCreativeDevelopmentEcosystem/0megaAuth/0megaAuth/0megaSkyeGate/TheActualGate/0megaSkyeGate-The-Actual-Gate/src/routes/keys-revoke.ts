import type { Env } from '../types'
import { findActiveAuthContextByAppId, findOsKeyById, revokeAllGateSessionsForApp, revokeMirroredOsKey } from '../db/queries'
import { json } from '../utils/json'
import { verifyAdminToken } from '../auth/verifyAdminToken'
import { hasNeonDatabase } from '../env'

export async function handleKeysRevoke(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  let body: { token_id?: string; os_key_id?: string; app_id?: string }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } }, 400)
  }

  const keyId = body.os_key_id || body.token_id

  if (!keyId && !body.app_id) {
    return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Provide os_key_id or app_id.' } }, 400)
  }

  let appId = body.app_id || null
  let mirroredOnlyMatch = false

  if (keyId && !appId) {
    const row = await findOsKeyById(env.DB, keyId, env)
    appId = row?.app_id ? String(row.app_id) : null
    mirroredOnlyMatch = Boolean(row && row.storage === 'neon')
  }

  if (!keyId && appId) {
    const authContext = await findActiveAuthContextByAppId(env.DB, appId, env)
    mirroredOnlyMatch = Boolean(authContext)
  }

  let deleted = 0
  try {
    const result = keyId
      ? await env.DB.prepare(`DELETE FROM app_tokens WHERE id=?`).bind(keyId).run()
      : await env.DB.prepare(`DELETE FROM app_tokens WHERE app_id=?`).bind(body.app_id).run()
    deleted = Number(result.meta?.changes ?? 0)
  } catch (error) {
    if (!hasNeonDatabase(env)) throw error
    console.warn('D1 0sKey shadow delete failed:', error)
  }

  if (deleted === 0 && !mirroredOnlyMatch) {
    return json({ ok: false, error: { code: 'NOT_FOUND', message: 'No matching 0sKey found.' } }, 404)
  }

  await revokeMirroredOsKey(env, { tokenId: keyId || null, appId })
  if (appId) {
    await revokeAllGateSessionsForApp(env.DB, appId, env)
  }

  return json({ ok: true, deleted, mirrored_only: deleted === 0, os_key_id: keyId || null, token_id: keyId || null, app_id: appId })
}
