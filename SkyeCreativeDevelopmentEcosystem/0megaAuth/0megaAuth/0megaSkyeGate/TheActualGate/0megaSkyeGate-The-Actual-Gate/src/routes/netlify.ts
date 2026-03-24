import { verifyAppToken } from '../auth/verifyAppToken'
import { verifySessionToken } from '../auth/verifySessionToken'
import { findActiveAuthContextByAppId } from '../db/queries'
import type { Env } from '../types'
import {
  getNetlifyBlobsEndpoint,
  getNetlifyBlobsToken,
  getNetlifyFormsEndpoint,
  getNetlifyFormsToken,
  getNetlifyIdentityToken,
  getNetlifyIdentityUrl,
} from '../env'
import { KaixuError } from '../utils/errors'
import { json } from '../utils/json'

type NetlifyCaller = {
  appId: string
  orgId: string
  walletId?: string | null
  authMode: string
  sessionId?: string
}

function buildEndpoint(base: string, suffix = ''): string {
  const url = new URL(base)
  const cleanSuffix = suffix.replace(/^\//, '')
  if (!cleanSuffix) return url.toString()
  const basePath = url.pathname.replace(/\/$/, '')
  const suffixPath = cleanSuffix.replace(/^\//, '')
  if (basePath.endsWith(`/${suffixPath}`) || basePath === `/${suffixPath}`) {
    return url.toString()
  }
  url.pathname = `${basePath}/${suffixPath}`.replace(/\/+/g, '/')
  return url.toString()
}

function requireConfigured(value: string, code: string, message: string): string {
  if (!value.trim()) {
    throw new KaixuError(503, code, message)
  }
  return value
}

function copyResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}

async function proxyJsonRequest(request: Request, url: string, extraHeaders?: HeadersInit): Promise<Response> {
  const bodyText = await request.text()
  const headers = new Headers(extraHeaders)
  headers.set('content-type', request.headers.get('content-type') || 'application/json; charset=utf-8')
  const response = await fetch(url, {
    method: request.method,
    headers,
    body: bodyText,
  })
  return copyResponse(response)
}

async function resolveNetlifyCaller(request: Request, env: Env): Promise<NetlifyCaller> {
  try {
    const session = await verifySessionToken(request, env)
    const auth = await findActiveAuthContextByAppId(env.DB, session.appId, env)
    return {
      appId: session.appId,
      orgId: session.orgId,
      walletId: auth?.walletId ?? null,
      authMode: session.authMode,
      sessionId: session.sessionId,
    }
  } catch {
    const auth = await verifyAppToken(request, env)
    return {
      appId: auth.appId,
      orgId: auth.orgId,
      walletId: auth.walletId,
      authMode: auth.authMode ?? '0skey',
    }
  }
}

function applyGateIdentityHeaders(headers: Headers, caller: NetlifyCaller): void {
  headers.set('x-skye-app-id', caller.appId)
  headers.set('x-skye-org-id', caller.orgId)
  headers.set('x-skye-auth-mode', caller.authMode)
  if (caller.walletId) headers.set('x-skye-wallet-id', caller.walletId)
  if (caller.sessionId) headers.set('x-skye-session-id', caller.sessionId)
}

export async function handleNetlifyIdentityLogin(request: Request, env: Env): Promise<Response> {
  const caller = await resolveNetlifyCaller(request, env)
  const baseUrl = requireConfigured(
    getNetlifyIdentityUrl(env),
    'NETLIFY_IDENTITY_NOT_CONFIGURED',
    'Netlify Identity is not configured on this gateway.',
  )
  const token = getNetlifyIdentityToken(env)
  const headers = new Headers()
  applyGateIdentityHeaders(headers, caller)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return await proxyJsonRequest(request, buildEndpoint(baseUrl, 'token'), headers)
}

export async function handleNetlifyIdentityUser(request: Request, env: Env): Promise<Response> {
  const caller = await resolveNetlifyCaller(request, env)
  const baseUrl = requireConfigured(
    getNetlifyIdentityUrl(env),
    'NETLIFY_IDENTITY_NOT_CONFIGURED',
    'Netlify Identity is not configured on this gateway.',
  )
  const headers = new Headers()
  applyGateIdentityHeaders(headers, caller)
  const incomingAuth = request.headers.get('authorization') || request.headers.get('Authorization')
  const serviceToken = getNetlifyIdentityToken(env)
  if (incomingAuth) {
    headers.set('authorization', incomingAuth)
  } else if (serviceToken) {
    headers.set('authorization', `Bearer ${serviceToken}`)
  }
  const response = await fetch(buildEndpoint(baseUrl, 'user'), { method: 'GET', headers })
  return copyResponse(response)
}

export async function handleNetlifyFormsSubmit(request: Request, env: Env, formName: string): Promise<Response> {
  const caller = await resolveNetlifyCaller(request, env)
  const endpoint = requireConfigured(
    getNetlifyFormsEndpoint(env),
    'NETLIFY_FORMS_NOT_CONFIGURED',
    'Netlify Forms is not configured on this gateway.',
  )
  const token = getNetlifyFormsToken(env)
  const payloadText = await request.text()
  const headers = new Headers()
  headers.set('content-type', request.headers.get('content-type') || 'application/json; charset=utf-8')
  applyGateIdentityHeaders(headers, caller)
  if (token) headers.set('authorization', `Bearer ${token}`)

  const response = await fetch(buildEndpoint(endpoint, formName), {
    method: 'POST',
    headers,
    body: payloadText,
  })

  return copyResponse(response)
}

export async function handleNetlifyBlobRequest(request: Request, env: Env, blobKey: string): Promise<Response> {
  const caller = await resolveNetlifyCaller(request, env)
  const endpoint = requireConfigured(
    getNetlifyBlobsEndpoint(env),
    'NETLIFY_BLOBS_NOT_CONFIGURED',
    'Netlify Blobs is not configured on this gateway.',
  )
  const token = getNetlifyBlobsToken(env)
  const url = new URL(buildEndpoint(endpoint, blobKey))
  const requestUrl = new URL(request.url)
  url.search = requestUrl.search

  const headers = new Headers()
  applyGateIdentityHeaders(headers, caller)
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  if (token) headers.set('authorization', `Bearer ${token}`)

  const method = request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()
  const response = await fetch(url.toString(), {
    method,
    headers,
    body,
  })
  return copyResponse(response)
}

export async function handleNetlifyConfigStatus(request: Request, env: Env): Promise<Response> {
  const caller = await resolveNetlifyCaller(request, env)
  return json({
    ok: true,
    identity: Boolean(getNetlifyIdentityUrl(env)),
    identity_service_token: Boolean(getNetlifyIdentityToken(env)),
    forms: Boolean(getNetlifyFormsEndpoint(env)),
    forms_service_token: Boolean(getNetlifyFormsToken(env)),
    blobs: Boolean(getNetlifyBlobsEndpoint(env)),
    blobs_service_token: Boolean(getNetlifyBlobsToken(env)),
    unified_gate_auth: true,
    caller: {
      app_id: caller.appId,
      org_id: caller.orgId,
      auth_mode: caller.authMode,
      session_id: caller.sessionId ?? null,
    },
  })
}