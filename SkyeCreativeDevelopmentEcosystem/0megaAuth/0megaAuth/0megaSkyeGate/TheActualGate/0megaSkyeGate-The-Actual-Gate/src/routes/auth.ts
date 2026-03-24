import type { Env } from '../types'
import { json } from '../utils/json'
import { KaixuError } from '../utils/errors'
import { getFounderGatewayKey, getSessionJwtSecret, requireDb } from '../env'
import { findAppTokenByHash } from '../db/queries'
import { insertGateSession, findGateSessionByHash, revokeGateSession } from '../db/queries'
import { signJwt, verifyJwt } from '../utils/jwt'
import { sha256Hex } from '../utils/hashing'
import { nowIso } from '../utils/clock'
import { createId } from '../utils/ids'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

// ── Helpers ─────────────────────────────────────────────────────────────────

function readAuthorizationToken(request: Request): string {
  const header = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim()
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim()
  return ''
}

function timingSafeEqual(a: string, b: string): boolean {
  const na = String(a || '')
  const nb = String(b || '')
  if (!na || !nb || na.length !== nb.length) return false
  let mismatch = 0
  for (let i = 0; i < na.length; i++) mismatch |= na.charCodeAt(i) ^ nb.charCodeAt(i)
  return mismatch === 0
}

// ── POST /v1/auth/login ──────────────────────────────────────────────────────
// Body: { token?: string, os_key?: string, 0sKey?: string } — a 0sKey OR the founder gateway key
// Returns: { ok: true, session_token: string, expires_at: string }

export async function handleAuthLogin(request: Request, env: Env): Promise<Response> {
  const secret = getSessionJwtSecret(env)
  if (!secret) {
    throw new KaixuError(503, 'SESSION_NOT_CONFIGURED', 'Session signing is not configured on this gateway.')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    throw new KaixuError(400, 'AUTH_BAD_REQUEST', 'Request body must be valid JSON with a "token" or "os_key" field.')
  }

  const rawToken = String(body.os_key || body['0sKey'] || body.token || '').trim()
  if (!rawToken) {
    throw new KaixuError(400, 'AUTH_BAD_REQUEST', 'Missing "token" or "os_key" in request body.')
  }

  const db = requireDb(env)
  let appId: string
  let orgId: string
  let authMode: '0skey' | 'founder-gateway'

  // Check founder key first (timing-safe)
  const founderKey = getFounderGatewayKey(env)
  if (founderKey && timingSafeEqual(rawToken, founderKey)) {
    appId = 'founder-gateway'
    orgId = 'founder-gateway'
    authMode = 'founder-gateway'
  } else {
    // Try 0sKey lookup
    const tokenHash = await sha256Hex(rawToken)
    const appToken = await findAppTokenByHash(db, tokenHash, env)
    if (!appToken) {
      throw new KaixuError(401, 'AUTH_INVALID_TOKEN', 'The provided 0sKey was not recognized.')
    }
    appId = appToken.appId
    orgId = appToken.orgId
    authMode = '0skey'
  }

  const sessionId = createId('sid')
  const now = Math.floor(Date.now() / 1000)
  const exp = now + SESSION_TTL_SECONDS
  const expiresAt = new Date(exp * 1000).toISOString()

  const jwt = await signJwt(
    {
      iss: '0megaskyegate',
      sub: appId,
      iat: now,
      exp,
      sid: sessionId,
      app_id: appId,
      org_id: orgId,
      auth_mode: authMode,
    },
    secret,
  )

  const tokenHash = await sha256Hex(jwt)

  await insertGateSession(db, {
    id: sessionId,
    token_hash: tokenHash,
    app_id: appId,
    org_id: orgId,
    auth_mode: authMode,
    created_at: nowIso(),
    expires_at: expiresAt,
  }, env)

  return json({ ok: true, auth_mode: authMode, session_token: jwt, expires_at: expiresAt })
}

// ── POST /v1/auth/logout ─────────────────────────────────────────────────────
// Revokes the current session token.  Bearer token required.

export async function handleAuthLogout(request: Request, env: Env): Promise<Response> {
  const secret = getSessionJwtSecret(env)
  if (!secret) return json({ ok: true }) // nothing to revoke if not configured

  const rawToken = readAuthorizationToken(request)
  if (!rawToken) return json({ ok: true })

  try {
    const payload = await verifyJwt(rawToken, secret)
    await revokeGateSession(requireDb(env), payload.sid, env)
  } catch {
    // Revoke by hash even if JWT is malformed/expired
    try {
      const tokenHash = await sha256Hex(rawToken)
      const session = await findGateSessionByHash(requireDb(env), tokenHash, env)
      if (session) {
        await revokeGateSession(requireDb(env), session.id, env)
      }
    } catch {
      // best-effort
    }
  }

  return json({ ok: true })
}

// ── GET /v1/auth/me ──────────────────────────────────────────────────────────
// Validates the session and returns the caller's identity context.

export async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  const secret = getSessionJwtSecret(env)
  if (!secret) {
    throw new KaixuError(503, 'SESSION_NOT_CONFIGURED', 'Session signing is not configured on this gateway.')
  }

  const rawToken = readAuthorizationToken(request)
  if (!rawToken) {
    throw new KaixuError(401, 'SESSION_UNAUTHORIZED', 'Missing Bearer token.')
  }

  let payload
  try {
    payload = await verifyJwt(rawToken, secret)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg === 'JWT_EXPIRED') {
      throw new KaixuError(401, 'SESSION_EXPIRED', 'Session has expired.')
    }
    throw new KaixuError(401, 'SESSION_INVALID', 'Session token is invalid.')
  }

  const tokenHash = await sha256Hex(rawToken)
  const session = await findGateSessionByHash(requireDb(env), tokenHash, env)
  if (!session || session.revoked) {
    throw new KaixuError(401, 'SESSION_REVOKED', 'Session has been revoked or not found.')
  }

  return json({
    ok: true,
    session: {
      id: payload.sid,
      app_id: payload.app_id,
      org_id: payload.org_id,
      auth_mode: payload.auth_mode,
      expires_at: session.expires_at,
    },
  })
}
