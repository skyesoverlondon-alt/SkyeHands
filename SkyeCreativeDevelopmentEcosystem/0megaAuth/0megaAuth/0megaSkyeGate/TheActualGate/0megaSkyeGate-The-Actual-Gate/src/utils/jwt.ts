/**
 * Minimal JWT implementation using the Web Crypto API (crypto.subtle).
 * All operations are async and run inside the Cloudflare Workers runtime.
 *
 * Algorithm: HS256 (HMAC-SHA-256)
 */

const ALG = { name: 'HMAC', hash: 'SHA-256' } as const

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey('raw', enc.encode(secret), ALG, false, ['sign', 'verify'])
}

function b64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface JwtPayload {
  iss: string
  sub: string
  iat: number
  exp: number
  sid: string
  app_id: string
  org_id: string
  auth_mode: string
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${header}.${body}`
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64urlEncode(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('JWT_MALFORMED')

  const [header, body, sig] = parts
  const signingInput = `${header}.${body}`
  const key = await importKey(secret)
  const valid = await crypto.subtle.verify(ALG, key, b64urlDecode(sig), new TextEncoder().encode(signingInput))
  if (!valid) throw new Error('JWT_INVALID_SIGNATURE')

  let payload: JwtPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as JwtPayload
  } catch {
    throw new Error('JWT_MALFORMED')
  }

  if (typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) {
    throw new Error('JWT_EXPIRED')
  }

  return payload
}
