import type { Env } from '../types'
import { json } from '../utils/json'
import { verifyAppToken } from '../auth/verifyAppToken'
import { createId } from '../utils/ids'
import { nowIso } from '../utils/clock'
import { toHttpError } from '../utils/errors'

export async function handleErrorsIngest(request: Request, env: Env): Promise<Response> {
  let auth
  try {
    auth = await verifyAppToken(request, env)
  } catch (error) {
    const httpError = toHttpError(error)
    return json({ ok: false, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }

  if (!env.SKYE_ERRORS_DB) return json({ ok: false, error: { code: 'MISCONFIGURED', message: 'SKYE_ERRORS_DB not bound.' } }, 500)

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } }, 400)
  }

  const eventId = createId('err')
  const tsMs = Date.now()
  const tenantKey = auth.appId
  const r2Key = `errors/${tenantKey}/${eventId}.json`

  const row = {
    event_id: eventId,
    tenant_key: tenantKey,
    tenant_label: auth.appId,
    ts_ms: tsMs,
    level: String(body.level || 'error'),
    name: String(body.name || ''),
    message: String(body.message || ''),
    fingerprint: String(body.fingerprint || ''),
    request_method: String(body.request_method || ''),
    request_url: String(body.request_url || ''),
    cf_ray: String(body.cf_ray || request.headers.get('cf-ray') || ''),
    release: String(body.release || ''),
    environment: String(body.environment || env.APP_ENV || 'production'),
    app: String(body.app || ''),
    raw_r2_key: r2Key,
  }

  // Store full payload in R2
  if (env.SKYE_ERRORS_RAW) {
    await env.SKYE_ERRORS_RAW.put(r2Key, JSON.stringify({ ...row, raw: body }), {
      httpMetadata: { contentType: 'application/json' },
    })
  }

  // Store metadata in D1
  await env.SKYE_ERRORS_DB.prepare(
    `INSERT INTO skye_errors_events
      (event_id,tenant_key,tenant_label,ts_ms,level,name,message,fingerprint,
       request_method,request_url,cf_ray,release,environment,app,raw_r2_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.event_id, row.tenant_key, row.tenant_label, row.ts_ms,
    row.level, row.name, row.message, row.fingerprint,
    row.request_method, row.request_url, row.cf_ray,
    row.release, row.environment, row.app, row.raw_r2_key
  ).run()

  return json({ ok: true, event_id: eventId, ts: nowIso() }, 201)
}

export async function handleErrorsList(request: Request, env: Env): Promise<Response> {
  let auth
  try {
    auth = await verifyAppToken(request, env)
  } catch (error) {
    const httpError = toHttpError(error)
    return json({ ok: false, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
  if (!env.SKYE_ERRORS_DB) return json({ ok: false, error: { code: 'MISCONFIGURED', message: 'SKYE_ERRORS_DB not bound.' } }, 500)

  const url = new URL(request.url)
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))

  const rows = await env.SKYE_ERRORS_DB.prepare(
    `SELECT event_id,ts_ms,level,name,message,fingerprint,cf_ray,release,environment,app
     FROM skye_errors_events WHERE tenant_key=? ORDER BY ts_ms DESC LIMIT ? OFFSET ?`
  ).bind(auth.appId, limit, offset).all()

  return json({ ok: true, events: rows.results, limit, offset })
}

export async function handleErrorsGet(request: Request, env: Env, eventId: string): Promise<Response> {
  let auth
  try {
    auth = await verifyAppToken(request, env)
  } catch (error) {
    const httpError = toHttpError(error)
    return json({ ok: false, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
  if (!env.SKYE_ERRORS_DB) return json({ ok: false, error: { code: 'MISCONFIGURED', message: 'SKYE_ERRORS_DB not bound.' } }, 500)

  const row = await env.SKYE_ERRORS_DB.prepare(
    `SELECT * FROM skye_errors_events WHERE event_id=? AND tenant_key=?`
  ).bind(eventId, auth.appId).first()

  if (!row) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Event not found.' } }, 404)

  let raw: unknown = null
  if (env.SKYE_ERRORS_RAW && row.raw_r2_key) {
    const obj = await env.SKYE_ERRORS_RAW.get(row.raw_r2_key as string)
    if (obj) raw = await obj.json()
  }

  return json({ ok: true, event: row, raw })
}
