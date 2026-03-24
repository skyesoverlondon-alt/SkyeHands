import type { Env } from '../types'
import { getSessionJwtSecret, requireDb } from '../env'
import { verifyJwt } from '../utils/jwt'
import { sha256Hex } from '../utils/hashing'
import { findGateSessionByHash } from '../db/queries'
import { KaixuError } from '../utils/errors'

export interface SessionContext {
  sessionId: string
  appId: string
  orgId: string
  authMode: string
}

export async function verifySessionToken(request: Request, env: Env): Promise<SessionContext> {
  const header = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  if (!header.startsWith('Bearer ')) {
    throw new KaixuError(401, 'SESSION_UNAUTHORIZED', 'Missing or invalid session token.')
  }

  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    throw new KaixuError(401, 'SESSION_UNAUTHORIZED', 'Empty session token.')
  }

  const secret = getSessionJwtSecret(env)
  if (!secret) {
    throw new KaixuError(500, 'SESSION_NOT_CONFIGURED', 'Session signing is not configured on this gateway.')
  }

  let payload
  try {
    payload = await verifyJwt(token, secret)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg === 'JWT_EXPIRED') {
      throw new KaixuError(401, 'SESSION_EXPIRED', 'Session has expired. Please log in again.')
    }
    throw new KaixuError(401, 'SESSION_INVALID', 'Session token is invalid.')
  }

  // Check the session record has not been revoked
  const tokenHash = await sha256Hex(token)
  const session = await findGateSessionByHash(requireDb(env), tokenHash, env)
  if (!session) {
    throw new KaixuError(401, 'SESSION_NOT_FOUND', 'Session not found or has been revoked.')
  }
  if (session.revoked) {
    throw new KaixuError(401, 'SESSION_REVOKED', 'Session has been revoked. Please log in again.')
  }

  return {
    sessionId: payload.sid,
    appId: payload.app_id,
    orgId: payload.org_id,
    authMode: payload.auth_mode,
  }
}
