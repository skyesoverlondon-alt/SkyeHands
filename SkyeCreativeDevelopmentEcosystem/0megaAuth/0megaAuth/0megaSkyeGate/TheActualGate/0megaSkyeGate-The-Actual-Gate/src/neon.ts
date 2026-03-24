import { neon, neonConfig } from '@neondatabase/serverless'
import type { AuthContext, Env } from './types'

type MirrorSession = {
  id: string
  token_hash: string
  app_id: string
  org_id: string
  auth_mode: string
  created_at: string
  expires_at: string
}

type MirrorUsage = {
  traceId: string
  orgId?: string
  appId?: string
  userId?: string
  walletId?: string
  alias: string
  provider?: string
  resolvedModel?: string
  requestType: string
  skyfuelBurned: number
  estimatedCostUsd: number
  upstreamCostUsd: number
  billedCostUsd: number
  markupMultiplier: number
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  status: string
  errorCode?: string
  errorMessage?: string
}

type MirrorOsKey = {
  tokenId: string
  tokenHash: string
  appId: string
  orgId?: string | null
  walletId?: string | null
  allowedAliases: string[]
  rateLimitRpm?: number | null
  createdAt: string
}

type NeonOsKeyRow = {
  token_id: string
  token_hash: string | null
  app_id: string
  org_id: string | null
  wallet_id: string | null
  allowed_aliases: unknown
  rate_limit_rpm: number | null
  status: string
  created_at: string
  revoked_at: string | null
}

export type NeonGateSession = {
  id: string
  token_hash: string
  app_id: string
  org_id: string
  auth_mode: string
  created_at: string
  expires_at: string
  revoked: boolean
}

export type NeonOsKeyState = {
  found: boolean
  revoked: boolean
  auth: AuthContext | null
}

export type NeonGateSessionState = {
  found: boolean
  revoked: boolean
  session: NeonGateSession | null
}

declare global {
  var __kaixuNeonSchemaReady__: boolean | undefined
}

neonConfig.fetchConnectionCache = true

function getSql(env: Env) {
  const databaseUrl = String(env.NEON_DATABASE_URL || '').trim()
  if (!databaseUrl) return null
  return neon(databaseUrl)
}

type NeonSql = NonNullable<ReturnType<typeof getSql>>

async function ensureSchema(sql: NeonSql): Promise<void> {
  if (globalThis.__kaixuNeonSchemaReady__) return

  await sql`
    CREATE TABLE IF NOT EXISTS gate_oskeys (
      token_id TEXT PRIMARY KEY,
      token_hash TEXT,
      app_id TEXT NOT NULL,
      org_id TEXT,
      wallet_id TEXT,
      allowed_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
      rate_limit_rpm INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    )
  `
  await sql`ALTER TABLE gate_oskeys ADD COLUMN IF NOT EXISTS token_hash TEXT`
  await sql`ALTER TABLE gate_oskeys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`
  await sql`ALTER TABLE gate_oskeys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS gate_oskeys_token_hash_idx ON gate_oskeys (token_hash)`
  await sql`
    CREATE TABLE IF NOT EXISTS gate_usage_events (
      trace_id TEXT PRIMARY KEY,
      org_id TEXT,
      app_id TEXT,
      user_id TEXT,
      wallet_id TEXT,
      alias TEXT NOT NULL,
      provider TEXT,
      resolved_model TEXT,
      request_type TEXT NOT NULL,
      skyfuel_burned INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      upstream_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      billed_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      markup_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS gate_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      app_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      auth_mode TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      revoked_at TIMESTAMPTZ
    )
  `

  globalThis.__kaixuNeonSchemaReady__ = true
}

async function withNeon<T>(
  env: Env,
  operation: (sql: NeonSql) => Promise<T>,
  options: { throwOnError?: boolean } = {},
): Promise<T | null> {
  const sql = getSql(env)
  if (!sql) return null

  try {
    await ensureSchema(sql)
    return await operation(sql)
  } catch (error) {
    console.error('Neon operation failed:', error)
    if (options.throwOnError) {
      throw error
    }
    return null
  }
}

function parseAllowedAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string')
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function mapNeonAuth(row: NeonOsKeyRow): AuthContext {
  return {
    tokenId: row.token_id,
    appId: row.app_id,
    orgId: row.org_id ?? '',
    walletId: row.wallet_id ?? '',
    allowedAliases: parseAllowedAliases(row.allowed_aliases),
    rateLimitRpm: row.rate_limit_rpm,
  }
}

export async function mirrorOsKeyRecord(env: Env, record: MirrorOsKey): Promise<void> {
  await withNeon(env, async (sql) => {
    await sql`
      INSERT INTO gate_oskeys (token_id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, created_at)
      VALUES (${record.tokenId}, ${record.tokenHash}, ${record.appId}, ${record.orgId ?? null}, ${record.walletId ?? null}, ${JSON.stringify(record.allowedAliases)}::jsonb, ${record.rateLimitRpm ?? null}, ${record.createdAt})
      ON CONFLICT (token_id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        app_id = EXCLUDED.app_id,
        org_id = EXCLUDED.org_id,
        wallet_id = EXCLUDED.wallet_id,
        allowed_aliases = EXCLUDED.allowed_aliases,
        rate_limit_rpm = EXCLUDED.rate_limit_rpm,
        status = 'active',
        revoked_at = NULL
    `
  }, { throwOnError: true })
}

export async function mirrorUsageEventRecord(env: Env, record: MirrorUsage): Promise<void> {
  await withNeon(env, async (sql) => {
    await sql`
      INSERT INTO gate_usage_events (
        trace_id, org_id, app_id, user_id, wallet_id, alias, provider, resolved_model,
        request_type, skyfuel_burned, estimated_cost_usd, upstream_cost_usd, billed_cost_usd,
        markup_multiplier, input_tokens, output_tokens, latency_ms, status, error_code, error_message
      )
      VALUES (
        ${record.traceId}, ${record.orgId ?? null}, ${record.appId ?? null}, ${record.userId ?? null}, ${record.walletId ?? null},
        ${record.alias}, ${record.provider ?? null}, ${record.resolvedModel ?? null}, ${record.requestType}, ${record.skyfuelBurned},
        ${record.estimatedCostUsd}, ${record.upstreamCostUsd}, ${record.billedCostUsd}, ${record.markupMultiplier},
        ${record.inputTokens ?? null}, ${record.outputTokens ?? null}, ${record.latencyMs ?? null}, ${record.status},
        ${record.errorCode ?? null}, ${record.errorMessage ?? null}
      )
      ON CONFLICT (trace_id) DO UPDATE SET
        status = EXCLUDED.status,
        estimated_cost_usd = EXCLUDED.estimated_cost_usd,
        upstream_cost_usd = EXCLUDED.upstream_cost_usd,
        billed_cost_usd = EXCLUDED.billed_cost_usd,
        markup_multiplier = EXCLUDED.markup_multiplier,
        latency_ms = EXCLUDED.latency_ms,
        error_code = EXCLUDED.error_code,
        error_message = EXCLUDED.error_message
    `
  }, { throwOnError: true })
}

export async function mirrorGateSessionRecord(env: Env, record: MirrorSession): Promise<void> {
  await withNeon(env, async (sql) => {
    await sql`
      INSERT INTO gate_sessions (id, token_hash, app_id, org_id, auth_mode, created_at, expires_at)
      VALUES (${record.id}, ${record.token_hash}, ${record.app_id}, ${record.org_id}, ${record.auth_mode}, ${record.created_at}, ${record.expires_at})
      ON CONFLICT (id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        app_id = EXCLUDED.app_id,
        org_id = EXCLUDED.org_id,
        auth_mode = EXCLUDED.auth_mode,
        expires_at = EXCLUDED.expires_at
    `
  }, { throwOnError: true })
}

export async function mirrorGateSessionRevocation(env: Env, sessionId: string | null, appId?: string | null): Promise<void> {
  await withNeon(env, async (sql) => {
    if (sessionId) {
      await sql`UPDATE gate_sessions SET revoked = TRUE, revoked_at = NOW() WHERE id = ${sessionId}`
      return
    }
    if (appId) {
      await sql`UPDATE gate_sessions SET revoked = TRUE, revoked_at = NOW() WHERE app_id = ${appId} AND revoked = FALSE`
    }
  }, { throwOnError: true })
}

export async function revokeNeonOsKeyRecord(env: Env, params: { tokenId?: string | null; appId?: string | null }): Promise<void> {
  await withNeon(env, async (sql) => {
    if (params.tokenId) {
      await sql`UPDATE gate_oskeys SET status = 'revoked', revoked_at = NOW() WHERE token_id = ${params.tokenId}`
      return
    }
    if (params.appId) {
      await sql`UPDATE gate_oskeys SET status = 'revoked', revoked_at = NOW() WHERE app_id = ${params.appId} AND status <> 'revoked'`
    }
  }, { throwOnError: true })
}

export async function getNeonOsKeyStateByHash(env: Env, tokenHash: string): Promise<NeonOsKeyState> {
  const rows = await withNeon(env, async (sql) => {
    return await sql`
      SELECT token_id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, status, created_at, revoked_at
      FROM gate_oskeys
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `
  }) as NeonOsKeyRow[] | null

  const row = rows?.[0]
  if (!row) {
    return { found: false, revoked: false, auth: null }
  }

  const revoked = row.status !== 'active' || Boolean(row.revoked_at)
  return {
    found: true,
    revoked,
    auth: revoked ? null : mapNeonAuth(row),
  }
}

export async function findNeonOsKeyByHash(env: Env, tokenHash: string): Promise<AuthContext | null> {
  const state = await getNeonOsKeyStateByHash(env, tokenHash)
  return state.auth
}

export async function findNeonOsKeyById(env: Env, tokenId: string): Promise<Record<string, unknown> | null> {
  const rows = await withNeon(env, async (sql) => {
    return await sql`
      SELECT token_id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, status, created_at, revoked_at
      FROM gate_oskeys
      WHERE token_id = ${tokenId}
      LIMIT 1
    `
  }) as NeonOsKeyRow[] | null

  const row = rows?.[0]
  if (!row || row.status !== 'active' || row.revoked_at) return null

  return {
    id: row.token_id,
    app_id: row.app_id,
    org_id: row.org_id,
    wallet_id: row.wallet_id,
    allowed_aliases: JSON.stringify(parseAllowedAliases(row.allowed_aliases)),
    rate_limit_rpm: row.rate_limit_rpm,
    created_at: row.created_at,
    token_prefix: row.token_hash?.slice(0, 8) ?? null,
    storage: 'neon',
  }
}

export async function findNeonOsKeyByAppId(env: Env, appId: string): Promise<AuthContext | null> {
  const rows = await withNeon(env, async (sql) => {
    return await sql`
      SELECT token_id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, status, created_at, revoked_at
      FROM gate_oskeys
      WHERE app_id = ${appId} AND status = 'active' AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `
  }) as NeonOsKeyRow[] | null

  const row = rows?.[0]
  return row ? mapNeonAuth(row) : null
}

export async function listNeonOsKeys(
  env: Env,
  params: { appId?: string | null; limit?: number; offset?: number } = {},
): Promise<Record<string, unknown>[]> {
  const limit = Math.max(1, params.limit ?? 50)
  const offset = Math.max(0, params.offset ?? 0)
  const rows = await withNeon(env, async (sql) => {
    if (params.appId) {
      return await sql`
        SELECT token_id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, status, created_at, revoked_at
        FROM gate_oskeys
        WHERE app_id = ${params.appId} AND status = 'active' AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
    }

    return await sql`
      SELECT token_id, token_hash, app_id, org_id, wallet_id, allowed_aliases, rate_limit_rpm, status, created_at, revoked_at
      FROM gate_oskeys
      WHERE status = 'active' AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `
  }) as NeonOsKeyRow[] | null

  return (rows ?? []).map((row) => ({
    id: row.token_id,
    app_id: row.app_id,
    org_id: row.org_id,
    wallet_id: row.wallet_id,
    allowed_aliases: JSON.stringify(parseAllowedAliases(row.allowed_aliases)),
    rate_limit_rpm: row.rate_limit_rpm,
    created_at: row.created_at,
    token_prefix: row.token_hash?.slice(0, 8) ?? null,
    storage: 'neon',
  }))
}

export async function getNeonGateSessionStateByHash(env: Env, tokenHash: string): Promise<NeonGateSessionState> {
  const rows = await withNeon(env, async (sql) => {
    return await sql`
      SELECT id, token_hash, app_id, org_id, auth_mode, created_at, expires_at, revoked
      FROM gate_sessions
      WHERE token_hash = ${tokenHash} AND expires_at > NOW()
      LIMIT 1
    `
  }) as NeonGateSession[] | null

  const row = rows?.[0] ?? null
  return {
    found: Boolean(row),
    revoked: Boolean(row?.revoked),
    session: row,
  }
}

export async function findNeonGateSessionByHash(env: Env, tokenHash: string): Promise<NeonGateSession | null> {
  const state = await getNeonGateSessionStateByHash(env, tokenHash)
  return state.session
}

export async function listNeonUsageEventsForApp(env: Env, appId: string, limit = 50): Promise<Record<string, unknown>[]> {
  const rows = await withNeon(env, async (sql) => {
    return await sql`
      SELECT trace_id, app_id, alias, request_type, status, input_tokens, output_tokens, estimated_cost_usd, billed_cost_usd, created_at
      FROM gate_usage_events
      WHERE app_id = ${appId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
  }) as Array<{
    trace_id: string
    app_id: string | null
    alias: string
    request_type: string
    status: string
    input_tokens: number | null
    output_tokens: number | null
    estimated_cost_usd: number
    billed_cost_usd: number
    created_at: string
  }> | null

  return (rows ?? []).map((row) => ({
    trace_id: row.trace_id,
    job_id: null,
    app_id: row.app_id,
    lane: row.request_type,
    engine_alias: row.alias,
    public_status: row.status,
    usage_json: JSON.stringify({
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      estimated_cost_usd: row.billed_cost_usd ?? row.estimated_cost_usd,
    }),
    created_at: row.created_at,
  }))
}