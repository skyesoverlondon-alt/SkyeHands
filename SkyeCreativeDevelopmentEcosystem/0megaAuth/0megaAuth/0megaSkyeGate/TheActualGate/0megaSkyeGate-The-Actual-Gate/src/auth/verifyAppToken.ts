import { getFounderGatewayKey, requireDb } from '../env'
import { findAppTokenByHash } from '../db/queries'
import type { AuthContext, Env } from '../types'
import { KaixuError } from '../utils/errors'
import { sha256Hex } from '../utils/hashing'

const FOUNDER_ALLOWED_ALIASES = [
  'kaixu/flash',
  'kaixu/deep',
  'kaixu/code',
  'kaixu/vision',
  'kaixu/image',
  'kaixu/video',
  'kaixu/speech',
  'kaixu/transcribe',
  'kaixu/realtime',
  'kaixu/embed',
]

function readFounderGatewayKey(request: Request): string {
  return String(
    request.headers.get('x-founders-gateway-key')
      || request.headers.get('X-Founders-Gateway-Key')
      || request.headers.get('x-founder-gateway-key')
      || request.headers.get('X-Founder-Gateway-Key')
      || request.headers.get('x-founders-code')
      || request.headers.get('X-Founders-Code')
      || '',
  ).trim()
}

function timingSafeEqual(left: string, right: string): boolean {
  const normalizedLeft = String(left || '')
  const normalizedRight = String(right || '')
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    mismatch |= normalizedLeft.charCodeAt(index) ^ normalizedRight.charCodeAt(index)
  }
  return mismatch === 0
}

function hasValidFounderGatewayKey(request: Request, env: Env): boolean {
  const provided = readFounderGatewayKey(request)
  const expected = getFounderGatewayKey(env)
  return timingSafeEqual(provided, expected)
}

function createFounderGatewayAuth(): AuthContext {
  return {
    tokenId: 'founder-gateway',
    appId: 'founder-gateway',
    orgId: 'founder-gateway',
    walletId: 'founder-gateway',
    allowedAliases: FOUNDER_ALLOWED_ALIASES,
    rateLimitRpm: null,
    authMode: 'founder-gateway',
    founderGateway: true,
  }
}

function readBearerToken(request: Request): string {
  const header = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new KaixuError(401, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: 'Missing Bearer token.' })
  }
  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    throw new KaixuError(401, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: 'Empty Bearer token.' })
  }
  return token
}

export async function verifyAppToken(request: Request, env: Env): Promise<AuthContext> {
  let token = ''
  try {
    token = readBearerToken(request)
  } catch (error) {
    if (hasValidFounderGatewayKey(request, env)) {
      return createFounderGatewayAuth()
    }
    throw error
  }

  const tokenHash = await sha256Hex(token)
  const auth = await findAppTokenByHash(requireDb(env), tokenHash, env)

  if (!auth) {
    if (hasValidFounderGatewayKey(request, env)) {
      return createFounderGatewayAuth()
    }
    throw new KaixuError(401, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: '0sKey not recognized.' })
  }

  return {
    ...auth,
    authMode: '0skey',
    founderGateway: false,
  }
}
