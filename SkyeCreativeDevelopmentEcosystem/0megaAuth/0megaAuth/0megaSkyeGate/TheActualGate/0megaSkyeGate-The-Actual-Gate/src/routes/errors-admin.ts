import type { Env } from '../types'
import { json } from '../utils/json'
import { verifyAdminToken } from '../auth/verifyAdminToken'
import { getEnvNumber } from '../env'

export async function handleErrorsAdminList(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  if (!env.SKYE_ERRORS_DB) return json({ ok: false, error: { code: 'MISCONFIGURED', message: 'SKYE_ERRORS_DB not bound.' } }, 500)

  const url = new URL(request.url)
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))
  const tenantKey = url.searchParams.get('tenant') || null

  const rows = tenantKey
    ? await env.SKYE_ERRORS_DB.prepare(
        `SELECT * FROM skye_errors_events WHERE tenant_key=? ORDER BY ts_ms DESC LIMIT ? OFFSET ?`
      ).bind(tenantKey, limit, offset).all()
    : await env.SKYE_ERRORS_DB.prepare(
        `SELECT * FROM skye_errors_events ORDER BY ts_ms DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all()

  return json({ ok: true, events: rows.results, limit, offset })
}

export async function handleErrorsAdminCleanup(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  if (!env.SKYE_ERRORS_DB) return json({ ok: false, error: { code: 'MISCONFIGURED', message: 'SKYE_ERRORS_DB not bound.' } }, 500)

  const retentionDays = getEnvNumber(env, 'SKYE_ERRORS_RETENTION_DAYS', 30)
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  const result = await env.SKYE_ERRORS_DB.prepare(
    `DELETE FROM skye_errors_events WHERE ts_ms < ?`
  ).bind(cutoffMs).run()

  return json({ ok: true, deleted: result.meta?.changes ?? 0, cutoff_ms: cutoffMs, retention_days: retentionDays })
}
