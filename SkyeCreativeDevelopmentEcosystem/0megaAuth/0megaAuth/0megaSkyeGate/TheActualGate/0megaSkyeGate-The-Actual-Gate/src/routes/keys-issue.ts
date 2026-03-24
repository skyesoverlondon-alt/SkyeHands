import type { Env } from '../types'
import { mirrorIssuedOsKey } from '../db/queries'
import { json } from '../utils/json'
import { verifyAdminToken } from '../auth/verifyAdminToken'
import { createId } from '../utils/ids'
import { nowIso } from '../utils/clock'
import { sha256Hex } from '../utils/hashing'
import { hasNeonDatabase } from '../env'

export async function handleKeysIssue(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  let body: { label?: string; app_id?: string; org_id?: string; wallet_id?: string; allowed_aliases?: string[]; rate_limit_rpm?: number }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } }, 400)
  }

  const appId = body.app_id || createId('app')
  const rawToken = '0sk_' + createId('tok').replace(/_/g, '') + createId('tok').replace(/_/g, '')
  const tokenHash = await sha256Hex(rawToken)
  const tokenId = createId('tkid')
  const now = nowIso()
  const allowedAliasesList = body.allowed_aliases ?? [
    'kaixu/flash', 'kaixu/deep', 'kaixu/code', 'kaixu/vision',
    'kaixu/image', 'kaixu/video', 'kaixu/speech', 'kaixu/transcribe',
    'kaixu/realtime', 'kaixu/embed',
  ]
  const allowedAliases = JSON.stringify(allowedAliasesList)

  await mirrorIssuedOsKey(env, {
    tokenId,
    tokenHash,
    appId,
    orgId: body.org_id || null,
    walletId: body.wallet_id || null,
    allowedAliases: allowedAliasesList,
    rateLimitRpm: body.rate_limit_rpm || null,
    createdAt: now,
  })

  try {
    await env.DB.prepare(
      `INSERT INTO app_tokens (id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      tokenId, tokenHash, appId,
      body.org_id || null,
      body.wallet_id || null,
      allowedAliases,
      body.rate_limit_rpm || null,
      now
    ).run()
  } catch (error) {
    if (!hasNeonDatabase(env)) throw error
    console.warn('D1 0sKey shadow write failed:', error)
  }

  return json({
    ok: true,
    message: '0sKey issued. Save it now because it is shown once only.',
    key_type: '0sKey',
    os_key: rawToken,
    os_key_id: tokenId,
    token: rawToken,
    token_id: tokenId,
    app_id: appId,
    org_id: body.org_id || null,
    label: body.label || null,
    allowed_aliases: allowedAliasesList,
    created_at: now,
  }, 201)
}
