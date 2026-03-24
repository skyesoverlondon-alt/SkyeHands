import type { AuthContext, PricingRule, RouteOption, TraceUsageRecord } from '../types'
import type { Env } from '../types'
import {
  findNeonOsKeyByAppId,
  findNeonOsKeyById,
  getNeonGateSessionStateByHash,
  getNeonOsKeyStateByHash,
  listNeonOsKeys,
  listNeonUsageEventsForApp,
  mirrorGateSessionRecord,
  mirrorGateSessionRevocation,
  mirrorOsKeyRecord,
  mirrorUsageEventRecord,
  revokeNeonOsKeyRecord,
} from '../neon'
import { hasNeonDatabase } from '../env'
import { nowIso } from '../utils/clock'
import { createId } from '../utils/ids'

function parseAliases(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function mapAuthContext(row: Record<string, unknown>): AuthContext {
  return {
    tokenId: String(row.id),
    appId: String(row.app_id),
    orgId: String(row.org_id ?? ''),
    walletId: String(row.wallet_id ?? ''),
    allowedAliases: parseAliases(row.allowed_aliases),
    rateLimitRpm: row.rate_limit_rpm == null ? null : Number(row.rate_limit_rpm),
  }
}

function mergeRowsByKey(rows: Record<string, unknown>[], fallbackRows: Record<string, unknown>[], key: string): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>()

  for (const row of fallbackRows) {
    const rowKey = String(row[key] ?? '')
    if (rowKey) merged.set(rowKey, row)
  }

  for (const row of rows) {
    const rowKey = String(row[key] ?? '')
    if (!rowKey) continue
    const existing = merged.get(rowKey)
    merged.set(rowKey, existing ? { ...existing, ...row } : row)
  }

  return [...merged.values()].sort((left, right) => String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')))
}

function isNeonPrimary(env?: Env): env is Env {
  return Boolean(env && hasNeonDatabase(env))
}

export async function findAppTokenByHash(db: D1Database, tokenHash: string, env?: Env): Promise<AuthContext | null> {
  if (isNeonPrimary(env)) {
    const neonState = await getNeonOsKeyStateByHash(env, tokenHash)
    if (neonState.revoked) return null
    if (neonState.auth) return neonState.auth
  }

  const row = await db
    .prepare(`
      SELECT id, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm
      FROM app_tokens
      WHERE token_hash = ? AND enabled = 1
      LIMIT 1
    `)
    .bind(tokenHash)
    .first<Record<string, unknown>>()

  if (row) return mapAuthContext(row)
  return null
}

export async function getWalletById(db: D1Database, walletId: string): Promise<Record<string, unknown> | null> {
  return await db
    .prepare('SELECT * FROM wallets WHERE id = ? LIMIT 1')
    .bind(walletId)
    .first<Record<string, unknown>>()
}

export async function listAliasesForApp(db: D1Database, appId: string): Promise<RouteOption[]> {
  const authRow = await db
    .prepare('SELECT allowed_aliases FROM app_tokens WHERE app_id = ? AND enabled = 1 LIMIT 1')
    .bind(appId)
    .first<Record<string, unknown>>()

  const allowedAliases = parseAliases(authRow?.allowed_aliases)
  if (allowedAliases.length === 0) return []

  const placeholders = allowedAliases.map(() => '?').join(',')
  const result = await db
    .prepare(`
      SELECT ma.alias, p.name AS provider, ma.provider_model AS model, ma.priority, ma.enabled
      FROM model_aliases ma
      JOIN providers p ON p.id = ma.provider_id
      WHERE ma.enabled = 1 AND p.enabled = 1 AND ma.alias IN (${placeholders})
      ORDER BY ma.alias ASC, ma.priority ASC
    `)
    .bind(...allowedAliases)
    .all<Record<string, unknown>>()

  return (result.results ?? []).map((row) => ({
    alias: String(row.alias),
    provider: String(row.provider) as RouteOption['provider'],
    model: String(row.model),
    priority: Number(row.priority),
    enabled: Number(row.enabled) === 1,
  }))
}

export async function listRoutesForAlias(db: D1Database, alias: string): Promise<RouteOption[]> {
  const result = await db
    .prepare(`
      SELECT ma.alias, p.name AS provider, ma.provider_model AS model, ma.priority, ma.enabled
      FROM model_aliases ma
      JOIN providers p ON p.id = ma.provider_id
      WHERE ma.alias = ? AND ma.enabled = 1 AND p.enabled = 1
      ORDER BY ma.priority ASC
    `)
    .bind(alias)
    .all<Record<string, unknown>>()

  return (result.results ?? []).map((row) => ({
    alias: String(row.alias),
    provider: String(row.provider) as RouteOption['provider'],
    model: String(row.model),
    priority: Number(row.priority),
    enabled: Number(row.enabled) === 1,
  }))
}

export async function getPricingRule(db: D1Database, alias: string): Promise<PricingRule | null> {
  const row = await db
    .prepare('SELECT alias, base_burn, input_token_rate, output_token_rate, image_rate, enabled FROM alias_pricing WHERE alias = ? AND enabled = 1 LIMIT 1')
    .bind(alias)
    .first<Record<string, unknown>>()

  if (!row) return null

  return {
    alias: String(row.alias),
    base_burn: Number(row.base_burn),
    input_token_rate: Number(row.input_token_rate),
    output_token_rate: Number(row.output_token_rate),
    image_rate: Number(row.image_rate),
    enabled: Number(row.enabled) === 1,
  }
}

export async function getRoutingPolicy(db: D1Database, alias: string, appId: string, orgId: string): Promise<Record<string, unknown> | null> {
  const exact = await db
    .prepare(`
      SELECT *
      FROM routing_rules
      WHERE alias = ? AND app_id = ? AND org_id = ? AND enabled = 1
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .bind(alias, appId, orgId)
    .first<Record<string, unknown>>()

  if (exact) return exact

  return await db
    .prepare(`
      SELECT *
      FROM routing_rules
      WHERE alias = ? AND (app_id IS NULL OR app_id = '') AND (org_id IS NULL OR org_id = '') AND enabled = 1
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .bind(alias)
    .first<Record<string, unknown>>()
}

export async function updateWalletBalance(db: D1Database, walletId: string, nextBalance: number): Promise<void> {
  await db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').bind(nextBalance, walletId).run()
}

export async function insertWalletTransaction(
  db: D1Database,
  params: {
    walletId: string
    txType: string
    amount: number
    balanceAfter: number
    traceId?: string
    note?: string
  },
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO wallet_transactions (id, wallet_id, tx_type, amount, balance_after, trace_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      createId('wtx'),
      params.walletId,
      params.txType,
      params.amount,
      params.balanceAfter,
      params.traceId ?? null,
      params.note ?? null,
      nowIso(),
    )
    .run()
}

export async function insertUsageEvent(db: D1Database, record: TraceUsageRecord, env?: Env): Promise<void> {
  if (env) {
    await mirrorUsageEventRecord(env, {
      traceId: record.traceId,
      orgId: record.orgId,
      appId: record.appId,
      userId: record.userId,
      walletId: record.walletId,
      alias: record.alias,
      provider: record.provider,
      resolvedModel: record.resolvedModel,
      requestType: record.requestType,
      skyfuelBurned: record.skyfuelBurned,
      estimatedCostUsd: record.estimatedCostUsd,
      upstreamCostUsd: record.upstreamCostUsd ?? record.estimatedCostUsd,
      billedCostUsd: record.billedCostUsd ?? record.estimatedCostUsd,
      markupMultiplier: record.markupMultiplier ?? 1,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
      status: record.status,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
    })
  }

  try {
    await db
      .prepare(`
        INSERT INTO usage_events (
          id, trace_id, org_id, app_id, user_id, wallet_id, alias, provider, resolved_model,
          request_type, input_tokens, output_tokens, skyfuel_burned, estimated_cost_usd,
          upstream_cost_usd, billed_cost_usd, markup_multiplier,
          status, latency_ms, error_code, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        createId('usage'),
        record.traceId,
        record.orgId ?? null,
        record.appId ?? null,
        record.userId ?? null,
        record.walletId ?? null,
        record.alias,
        record.provider ?? null,
        record.resolvedModel ?? null,
        record.requestType,
        record.inputTokens ?? null,
        record.outputTokens ?? null,
        record.skyfuelBurned,
        record.estimatedCostUsd,
        record.upstreamCostUsd ?? record.estimatedCostUsd,
        record.billedCostUsd ?? record.estimatedCostUsd,
        record.markupMultiplier ?? 1,
        record.status,
        record.latencyMs ?? null,
        record.errorCode ?? null,
        record.errorMessage ?? null,
        nowIso(),
      )
      .run()
  } catch (error) {
    if (!isNeonPrimary(env)) throw error
    console.warn('D1 usage event shadow write failed:', error)
  }
}

export async function insertFallbackLog(
  db: D1Database,
  params: {
    traceId: string
    fromProvider?: string
    fromModel?: string
    toProvider?: string
    toModel?: string
    reason: string
  },
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO fallback_logs (id, trace_id, from_provider, from_model, to_provider, to_model, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      createId('fallback'),
      params.traceId,
      params.fromProvider ?? null,
      params.fromModel ?? null,
      params.toProvider ?? null,
      params.toModel ?? null,
      params.reason,
      nowIso(),
    )
    .run()
}

export async function listUsageEventsForApp(db: D1Database, appId: string, limit = 25): Promise<Record<string, unknown>[]> {
  const result = await db
    .prepare(`
      SELECT trace_id, app_id, alias, provider, resolved_model, skyfuel_burned, estimated_cost_usd, status, created_at
      FROM usage_events
      WHERE app_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(appId, limit)
    .all<Record<string, unknown>>()

  return result.results ?? []
}

export async function findActiveAuthContextByAppId(db: D1Database, appId: string, env?: Env): Promise<AuthContext | null> {
  if (isNeonPrimary(env)) {
    const neonAuth = await findNeonOsKeyByAppId(env, appId)
    if (neonAuth) return neonAuth
  }

  const row = await db
    .prepare(`
      SELECT id, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm
      FROM app_tokens
      WHERE app_id = ? AND enabled = 1
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .bind(appId)
    .first<Record<string, unknown>>()

  if (row) return mapAuthContext(row)
  return null
}

export async function listProviders(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare('SELECT * FROM providers ORDER BY name ASC').all<Record<string, unknown>>()
  return result.results ?? []
}

export async function listAliases(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db
    .prepare(`
      SELECT ma.alias, ma.task_type, p.name AS provider, ma.provider_model, ma.priority, ma.enabled
      FROM model_aliases ma
      JOIN providers p ON p.id = ma.provider_id
      ORDER BY ma.alias ASC, ma.priority ASC
    `)
    .all<Record<string, unknown>>()
  return result.results ?? []
}

export async function listRoutingRules(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare('SELECT * FROM routing_rules ORDER BY alias ASC, created_at DESC').all<Record<string, unknown>>()
  return result.results ?? []
}

export async function creditWalletById(db: D1Database, walletId: string, amount: number, note?: string): Promise<Record<string, unknown>> {
  const wallet = await getWalletById(db, walletId)
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletId}`)
  }

  const currentBalance = Number(wallet.balance ?? 0)
  const nextBalance = currentBalance + amount
  await updateWalletBalance(db, walletId, nextBalance)
  await insertWalletTransaction(db, {
    walletId,
    txType: 'credit',
    amount,
    balanceAfter: nextBalance,
    note,
  })

  return {
    wallet_id: walletId,
    previous_balance: currentBalance,
    credited: amount,
    balance: nextBalance,
  }
}


function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toJson(value: unknown): string | null {
  if (value == null) return null
  return JSON.stringify(value)
}

export async function insertKaixuTrace(db: D1Database, record: {
  traceId: string
  jobId?: string | null
  appId?: string | null
  userId?: string | null
  orgId?: string | null
  lane: string
  engineAlias: string
  publicStatus: string
  upstreamVendor?: string | null
  upstreamModel?: string | null
  inputSizeEstimate?: number | null
  outputSizeEstimate?: number | null
  usageJson?: unknown
  latencyMs?: number | null
  publicResponseJson?: unknown
  publicErrorCode?: string | null
  publicErrorMessage?: string | null
  requestMethod?: string | null
  requestPath?: string | null
  internalResponseJson?: unknown
  internalErrorJson?: unknown
}): Promise<void> {
  const now = nowIso()
  await db.prepare(`
    INSERT INTO kaixu_traces (
      trace_id, job_id, app_id, user_id, org_id, lane, engine_alias, public_status,
      upstream_vendor, upstream_model, input_size_estimate, output_size_estimate,
      usage_json, latency_ms, public_response_json, public_error_code, public_error_message,
      request_method, request_path, internal_response_json, internal_error_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    record.traceId,
    record.jobId ?? null,
    record.appId ?? null,
    record.userId ?? null,
    record.orgId ?? null,
    record.lane,
    record.engineAlias,
    record.publicStatus,
    record.upstreamVendor ?? null,
    record.upstreamModel ?? null,
    record.inputSizeEstimate ?? null,
    record.outputSizeEstimate ?? null,
    toJson(record.usageJson),
    record.latencyMs ?? null,
    toJson(record.publicResponseJson),
    record.publicErrorCode ?? null,
    record.publicErrorMessage ?? null,
    record.requestMethod ?? null,
    record.requestPath ?? null,
    toJson(record.internalResponseJson),
    toJson(record.internalErrorJson),
    now,
    now,
  ).run()
}

export async function createKaixuJob(db: D1Database, record: {
  jobId: string
  traceId: string
  appId?: string | null
  userId?: string | null
  orgId?: string | null
  lane: string
  engineAlias: string
  status: string
  upstreamVendor?: string | null
  upstreamModel?: string | null
  upstreamJobId?: string | null
  requestJson?: unknown
  resultJson?: unknown
  assetRefs?: unknown
  errorCode?: string | null
  errorMessage?: string | null
  adminErrorRaw?: unknown
  completedAt?: string | null
}): Promise<void> {
  const now = nowIso()
  await db.prepare(`
    INSERT INTO kaixu_jobs (
      job_id, trace_id, app_id, user_id, org_id, lane, engine_alias, status,
      upstream_vendor, upstream_model, upstream_job_id, request_json, result_json,
      asset_refs, error_code, error_message, admin_error_raw, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    record.jobId,
    record.traceId,
    record.appId ?? null,
    record.userId ?? null,
    record.orgId ?? null,
    record.lane,
    record.engineAlias,
    record.status,
    record.upstreamVendor ?? null,
    record.upstreamModel ?? null,
    record.upstreamJobId ?? null,
    toJson(record.requestJson),
    toJson(record.resultJson),
    toJson(record.assetRefs),
    record.errorCode ?? null,
    record.errorMessage ?? null,
    toJson(record.adminErrorRaw),
    now,
    now,
    record.completedAt ?? null,
  ).run()
}

export async function updateKaixuJob(db: D1Database, jobId: string, patch: {
  status?: string
  upstreamJobId?: string | null
  resultJson?: unknown
  assetRefs?: unknown
  errorCode?: string | null
  errorMessage?: string | null
  adminErrorRaw?: unknown
  completedAt?: string | null
}): Promise<void> {
  await db.prepare(`
    UPDATE kaixu_jobs
    SET status = COALESCE(?, status),
        upstream_job_id = COALESCE(?, upstream_job_id),
        result_json = COALESCE(?, result_json),
        asset_refs = COALESCE(?, asset_refs),
        error_code = COALESCE(?, error_code),
        error_message = COALESCE(?, error_message),
        admin_error_raw = COALESCE(?, admin_error_raw),
        completed_at = COALESCE(?, completed_at),
        updated_at = ?
    WHERE job_id = ?
  `).bind(
    patch.status ?? null,
    patch.upstreamJobId ?? null,
    toJson(patch.resultJson),
    toJson(patch.assetRefs),
    patch.errorCode ?? null,
    patch.errorMessage ?? null,
    toJson(patch.adminErrorRaw),
    patch.completedAt ?? null,
    nowIso(),
    jobId,
  ).run()
}

export async function getKaixuJobById(db: D1Database, jobId: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare('SELECT * FROM kaixu_jobs WHERE job_id = ? LIMIT 1').bind(jobId).first<Record<string, unknown>>()
  if (!row) return null
  return {
    ...row,
    request_json: parseJsonField(row.request_json, null),
    result_json: parseJsonField(row.result_json, null),
    asset_refs: parseJsonField(row.asset_refs, []),
    admin_error_raw: parseJsonField(row.admin_error_raw, null),
  }
}

export async function getKaixuTraceById(db: D1Database, traceId: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare('SELECT * FROM kaixu_traces WHERE trace_id = ? LIMIT 1').bind(traceId).first<Record<string, unknown>>()
  if (!row) return null
  return {
    ...row,
    usage_json: parseJsonField(row.usage_json, null),
    public_response_json: parseJsonField(row.public_response_json, null),
    internal_response_json: parseJsonField(row.internal_response_json, null),
    internal_error_json: parseJsonField(row.internal_error_json, null),
  }
}

// ── Gate sessions ────────────────────────────────────────────────────────────

export interface GateSession {
  id: string
  token_hash: string
  app_id: string
  org_id: string
  auth_mode: string
  created_at: string
  expires_at: string
  revoked: number
}

export async function insertGateSession(
  db: D1Database,
  session: Omit<GateSession, 'revoked'>,
  env?: Env,
): Promise<void> {
  if (env) {
    await mirrorGateSessionRecord(env, session)
  }

  try {
    await db
      .prepare(`
        INSERT INTO gate_sessions (id, token_hash, app_id, org_id, auth_mode, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        session.id,
        session.token_hash,
        session.app_id,
        session.org_id,
        session.auth_mode,
        session.created_at,
        session.expires_at,
      )
      .run()
  } catch (error) {
    if (!isNeonPrimary(env)) throw error
    console.warn('D1 gate session shadow write failed:', error)
  }
}

export async function findGateSessionByHash(
  db: D1Database,
  tokenHash: string,
  env?: Env,
): Promise<GateSession | null> {
  if (isNeonPrimary(env)) {
    const neonState = await getNeonGateSessionStateByHash(env, tokenHash)
    if (neonState.revoked) {
      const source = neonState.session
      if (!source) return null
      return {
        id: source.id,
        token_hash: source.token_hash,
        app_id: source.app_id,
        org_id: source.org_id,
        auth_mode: source.auth_mode,
        created_at: source.created_at,
        expires_at: source.expires_at,
        revoked: 1,
      }
    }

    if (neonState.session) {
      return {
        ...neonState.session,
        revoked: neonState.session.revoked ? 1 : 0,
      }
    }
  }

  const row = await db
    .prepare(`
      SELECT id, token_hash, app_id, org_id, auth_mode, created_at, expires_at, revoked
      FROM gate_sessions
      WHERE token_hash = ? AND expires_at > ? LIMIT 1
    `)
    .bind(tokenHash, new Date().toISOString())
    .first<GateSession>()

  if (row) return row
  return null
}

export async function revokeGateSession(db: D1Database, sessionId: string, env?: Env): Promise<void> {
  if (env) {
    await mirrorGateSessionRevocation(env, sessionId)
  }

  try {
    await db
      .prepare('UPDATE gate_sessions SET revoked = 1 WHERE id = ?')
      .bind(sessionId)
      .run()
  } catch (error) {
    if (!isNeonPrimary(env)) throw error
    console.warn('D1 gate session shadow revoke failed:', error)
  }
}

export async function revokeAllGateSessionsForApp(db: D1Database, appId: string, env?: Env): Promise<void> {
  if (env) {
    await mirrorGateSessionRevocation(env, null, appId)
  }

  try {
    await db
      .prepare('UPDATE gate_sessions SET revoked = 1 WHERE app_id = ? AND revoked = 0')
      .bind(appId)
      .run()
  } catch (error) {
    if (!isNeonPrimary(env)) throw error
    console.warn('D1 gate session shadow revoke-all failed:', error)
  }
}

export async function revokeMirroredGateSession(env: Env, sessionId: string): Promise<void> {
  await mirrorGateSessionRevocation(env, sessionId)
}

export async function mirrorIssuedOsKey(env: Env, params: {
  tokenId: string
  tokenHash: string
  appId: string
  orgId?: string | null
  walletId?: string | null
  allowedAliases: string[]
  rateLimitRpm?: number | null
  createdAt: string
}): Promise<void> {
  await mirrorOsKeyRecord(env, params)
}

export async function listKaixuTracesForApp(db: D1Database, appId: string, limit = 50): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`
    SELECT trace_id, job_id, app_id, lane, engine_alias, public_status, usage_json, created_at
    FROM kaixu_traces
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(appId, limit).all<Record<string, unknown>>()
  const rows = (result.results ?? []).map((row) => ({
    ...row,
    usage_json: row.usage_json,
  }))
  return rows
}

export async function listKaixuTracesForAppWithMirror(db: D1Database, appId: string, limit = 50, env?: Env): Promise<Record<string, unknown>[]> {
  const neonRows = env ? await listNeonUsageEventsForApp(env, appId, limit) : []

  if (isNeonPrimary(env) && neonRows.length > 0) {
    return neonRows.slice(0, limit)
  }

  const result = await db.prepare(`
    SELECT trace_id, job_id, app_id, lane, engine_alias, public_status, usage_json, created_at
    FROM kaixu_traces
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(appId, limit).all<Record<string, unknown>>()

  const d1Rows = (result.results ?? []).map((row) => ({
    ...row,
    usage_json: row.usage_json,
    storage: 'd1',
  }))

  return mergeRowsByKey(neonRows, d1Rows, 'trace_id').slice(0, limit)
}

export async function listOsKeysWithMirror(
  db: D1Database,
  params: { appId?: string | null; limit?: number; offset?: number } = {},
  env?: Env,
): Promise<Record<string, unknown>[]> {
  const limit = Math.max(1, params.limit ?? 50)
  const offset = Math.max(0, params.offset ?? 0)
  const fetchSize = limit + offset

  const neonRows = env ? await listNeonOsKeys(env, { appId: params.appId, limit: fetchSize, offset: 0 }) : []
  if (isNeonPrimary(env) && neonRows.length > 0) {
    return neonRows.slice(offset, offset + limit)
  }

  const d1Rows = params.appId
    ? await db.prepare(
        `SELECT id, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, created_at,
                substr(token_hash, 1, 8) AS token_prefix,
                'd1' AS storage
         FROM app_tokens WHERE app_id=? ORDER BY created_at DESC LIMIT ? OFFSET 0`
      ).bind(params.appId, fetchSize).all<Record<string, unknown>>()
    : await db.prepare(
        `SELECT id, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, created_at,
                substr(token_hash, 1, 8) AS token_prefix,
                'd1' AS storage
         FROM app_tokens ORDER BY created_at DESC LIMIT ? OFFSET 0`
      ).bind(fetchSize).all<Record<string, unknown>>()

  return mergeRowsByKey(neonRows, d1Rows.results ?? [], 'id').slice(offset, offset + limit)
}

export async function findOsKeyById(db: D1Database, tokenId: string, env?: Env): Promise<Record<string, unknown> | null> {
  if (isNeonPrimary(env)) {
    const neonRow = await findNeonOsKeyById(env, tokenId)
    if (neonRow) return neonRow
  }

  const row = await db.prepare(
    `SELECT id, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, created_at,
            substr(token_hash, 1, 8) AS token_prefix,
            'd1' AS storage
     FROM app_tokens WHERE id = ? LIMIT 1`
  ).bind(tokenId).first<Record<string, unknown>>()

  if (row) return row
  return null
}

export async function revokeMirroredOsKey(env: Env, params: { tokenId?: string | null; appId?: string | null }): Promise<void> {
  await revokeNeonOsKeyRecord(env, params)
}
