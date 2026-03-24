import type { Env } from '../types'
import { getFounderGatewayKey } from '../env'
import { getKaixuTraceById } from '../db/queries'
import { json } from '../utils/json'
import { verifyAdminToken } from '../auth/verifyAdminToken'
import { nowIso } from '../utils/clock'
import { createId } from '../utils/ids'
import { parseSse } from '../utils/sse'

const SMOKE_LOG_KEY = 'smoke:log'
const SMOKE_AUDIT_KEY = 'smoke:audit'

const ALL_ENDPOINTS = [
  'GET /v1/health', 'GET /v1/models', 'GET /v1/wallet', 'GET /v1/usage',
  'POST /v1/chat', 'POST /v1/stream', 'POST /v1/embeddings',
  'POST /v1/images', 'POST /v1/videos',
  'POST /v1/audio/speech', 'POST /v1/audio/transcriptions',
  'POST /v1/realtime/session',
  'GET /v1/errors/events',
  'POST /v1/errors/event',
  'GET /admin/brains', 'POST /admin/brains/resolve',
  'POST /admin/keys/issue', 'GET /admin/keys/list', 'POST /admin/keys/revoke',
  'GET /admin/wallets', 'GET /admin/providers', 'GET /admin/aliases', 'GET /admin/routing',
  'GET /admin/errors/events', 'POST /admin/errors/cleanup',
  'GET /admin/smoke/audit', 'GET /admin/smoke/log', 'POST /admin/smoke/run', 'POST /admin/smoke/founder-fallback',
]

type SmokeResult = { endpoint: string; status: 'ok' | 'skip' | 'error'; note?: string; trace_id?: string | null }

async function persistSmokeEntry(env: Env, entry: Record<string, unknown>, results: SmokeResult[], ts: string, runId: string): Promise<void> {
  if (!env.KAIXU_SMOKE_KV) return
  const raw = await env.KAIXU_SMOKE_KV.get(SMOKE_LOG_KEY)
  const log: unknown[] = raw ? JSON.parse(raw) : []
  log.unshift(entry)
  await env.KAIXU_SMOKE_KV.put(SMOKE_LOG_KEY, JSON.stringify(log.slice(0, 50)))
  await env.KAIXU_SMOKE_KV.put(SMOKE_AUDIT_KEY, JSON.stringify({ checked_at: ts, run_id: runId, issues: results.filter((result) => result.status === 'error') }))
}

function buildFounderHeaders(founderKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-founders-gateway-key': founderKey,
  }
}

function getTraceSummary(trace: Record<string, unknown> | null): string {
  if (!trace) return 'trace missing'
  return [
    `lane=${String(trace.lane || '')}`,
    `status=${String(trace.public_status || '')}`,
    `upstream=${String(trace.upstream_vendor || '')}`,
    `model=${String(trace.upstream_model || '')}`,
  ].join(' ')
}

async function assertFounderTrace(env: Env, traceId: string, expectedLane: 'chat' | 'stream'): Promise<{ ok: boolean; note: string }> {
  const trace = await getKaixuTraceById(env.DB, traceId)
  if (!trace) {
    return { ok: false, note: 'Trace was not written.' }
  }
  if (String(trace.lane || '') !== expectedLane) {
    return { ok: false, note: `Unexpected lane. ${getTraceSummary(trace)}` }
  }
  if (String(trace.public_status || '') !== 'success') {
    return { ok: false, note: `Trace did not succeed. ${getTraceSummary(trace)}` }
  }
  if (String(trace.upstream_vendor || '') !== 'backup-brain') {
    return { ok: false, note: `Founder fallback did not route to backup brain. ${getTraceSummary(trace)}` }
  }
  return { ok: true, note: getTraceSummary(trace) }
}

async function runFounderChatSmoke(request: Request, env: Env, origin: string, founderKey: string, alias: string, prompt: string): Promise<SmokeResult> {
  const response = await fetch(new URL('/v1/chat', origin).toString(), {
    method: 'POST',
    headers: buildFounderHeaders(founderKey),
    body: JSON.stringify({
      alias,
      messages: [{ role: 'user', content: prompt }],
      metadata: { app_id: 'admin-smoke-founder-chat' },
    }),
  })

  const payload = await response.json().catch(() => null)
  const traceId = String(payload?.trace_id || '').trim() || null
  if (!response.ok || !traceId) {
    return {
      endpoint: 'POST /v1/chat founder-fallback',
      status: 'error',
      note: `HTTP ${response.status} ${String(payload?.error?.message || payload?.error || 'Missing trace_id.')}`.trim(),
      trace_id: traceId,
    }
  }

  const verified = await assertFounderTrace(env, traceId, 'chat')
  return {
    endpoint: 'POST /v1/chat founder-fallback',
    status: verified.ok ? 'ok' : 'error',
    note: verified.note,
    trace_id: traceId,
  }
}

async function runFounderStreamSmoke(request: Request, env: Env, origin: string, founderKey: string, alias: string, prompt: string): Promise<SmokeResult> {
  const response = await fetch(new URL('/v1/stream', origin).toString(), {
    method: 'POST',
    headers: buildFounderHeaders(founderKey),
    body: JSON.stringify({
      alias,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
      metadata: { app_id: 'admin-smoke-founder-stream' },
    }),
  })

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    return {
      endpoint: 'POST /v1/stream founder-fallback',
      status: 'error',
      note: `HTTP ${response.status} ${String(payload?.error?.message || payload?.error || 'Stream body missing.')}`.trim(),
    }
  }

  let traceId: string | null = null
  let sawDone = false
  let output = ''

  for await (const event of parseSse(response.body)) {
    if (!event.data) continue
    let payload: any = null
    try {
      payload = JSON.parse(event.data)
    } catch {
      payload = null
    }

    if (event.event === 'meta') {
      traceId = String(payload?.trace_id || '').trim() || traceId
      continue
    }
    if (event.event === 'delta') {
      output += String(payload?.text || '')
      continue
    }
    if (event.event === 'done') {
      sawDone = true
    }
  }

  if (!traceId) {
    return {
      endpoint: 'POST /v1/stream founder-fallback',
      status: 'error',
      note: 'Stream smoke did not receive a trace_id meta event.',
    }
  }

  if (!sawDone) {
    return {
      endpoint: 'POST /v1/stream founder-fallback',
      status: 'error',
      note: 'Stream smoke did not receive a done event.',
      trace_id: traceId,
    }
  }

  if (!output.trim()) {
    return {
      endpoint: 'POST /v1/stream founder-fallback',
      status: 'error',
      note: 'Stream smoke received no delta output.',
      trace_id: traceId,
    }
  }

  const verified = await assertFounderTrace(env, traceId, 'stream')
  return {
    endpoint: 'POST /v1/stream founder-fallback',
    status: verified.ok ? 'ok' : 'error',
    note: verified.ok ? `${verified.note} chars=${output.length}` : verified.note,
    trace_id: traceId,
  }
}

export async function handleSmokeEndpoints(_request: Request, env: Env): Promise<Response> {
  verifyAdminToken(_request, env)
  return json({ ok: true, endpoints: ALL_ENDPOINTS, count: ALL_ENDPOINTS.length })
}

export async function handleSmokeAudit(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  const raw = env.KAIXU_SMOKE_KV ? await env.KAIXU_SMOKE_KV.get(SMOKE_AUDIT_KEY) : null
  const audit = raw ? JSON.parse(raw) : { checked_at: null, issues: [] }
  return json({ ok: true, audit })
}

export async function handleSmokeLog(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  const raw = env.KAIXU_SMOKE_KV ? await env.KAIXU_SMOKE_KV.get(SMOKE_LOG_KEY) : null
  const log: unknown[] = raw ? JSON.parse(raw) : []
  return json({ ok: true, log })
}

export async function handleSmokeRun(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  const runId = createId('smoke')
  const ts = nowIso()
  const results: SmokeResult[] = []

  // Health check — only safe GET we can self-call without auth
  try {
    const healthUrl = new URL('/v1/health', getEnvOrigin(request, env))
    const r = await fetch(healthUrl.toString(), { method: 'GET' })
    results.push({ endpoint: 'GET /v1/health', status: r.ok ? 'ok' : 'error', note: `${r.status}` })
  } catch (e) {
    results.push({ endpoint: 'GET /v1/health', status: 'error', note: String(e) })
  }

  // All other endpoints: mark skip (require live tokens/bodies — manual test only)
  for (const ep of ALL_ENDPOINTS.slice(1)) {
    results.push({ endpoint: ep, status: 'skip', note: 'Requires auth token or request body — run via test client' })
  }

  const entry = { run_id: runId, ts, results }

  await persistSmokeEntry(env, entry, results, ts, runId)

  return json({ ok: true, run_id: runId, ts, results })
}

export async function handleSmokeFounderFallback(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  const runId = createId('smoke-founder')
  const ts = nowIso()
  const body = await request.json().catch(() => ({})) as { alias?: string; prompt?: string }
  const alias = String(body.alias || 'kaixu/deep').trim() || 'kaixu/deep'
  const promptSeed = String(body.prompt || 'Founder fallback smoke probe').trim() || 'Founder fallback smoke probe'
  const founderKey = getFounderGatewayKey(env)
  const results: SmokeResult[] = []

  if (!founderKey) {
    results.push({ endpoint: 'founder-config', status: 'error', note: 'Founders_GateWay_Key or FOUNDERS_GATEWAY_KEY is not configured.' })
    const entry = { run_id: runId, ts, kind: 'founder-fallback', alias, results }
    await persistSmokeEntry(env, entry, results, ts, runId)
    return json({ ok: false, run_id: runId, ts, kind: 'founder-fallback', results }, 503)
  }

  const origin = getEnvOrigin(request, env)
  const promptBase = `${promptSeed} :: ${runId}`

  try {
    results.push(await runFounderChatSmoke(request, env, origin, founderKey, alias, `${promptBase} :: chat`))
  } catch (error) {
    results.push({ endpoint: 'POST /v1/chat founder-fallback', status: 'error', note: String(error) })
  }

  try {
    results.push(await runFounderStreamSmoke(request, env, origin, founderKey, alias, `${promptBase} :: stream`))
  } catch (error) {
    results.push({ endpoint: 'POST /v1/stream founder-fallback', status: 'error', note: String(error) })
  }

  const entry = { run_id: runId, ts, kind: 'founder-fallback', alias, results }
  await persistSmokeEntry(env, entry, results, ts, runId)
  const ok = results.every((result) => result.status === 'ok')

  return json({ ok, run_id: runId, ts, kind: 'founder-fallback', alias, results }, ok ? 200 : 502)
}

function getEnvOrigin(request: Request, env: Env): string {
  return env.OMEGA_GATE_URL || new URL(request.url).origin
}

export async function handleSmokehouse(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  if (request.method === 'GET') {
    const html = `<!DOCTYPE html><html><head><title>0megaSkyeGate Smokehouse</title>
<style>body{font:14px monospace;background:#07060d;color:#c9b8ff;padding:2rem}
button{background:#4a1fd8;color:#fff;border:none;padding:.5rem 1.5rem;cursor:pointer;border-radius:4px;margin-top:1rem}
pre{background:#0d0b1a;padding:1rem;overflow:auto;border-radius:4px;margin-top:1rem}</style></head>
<body><h2>0megaSkyeGate Smokehouse</h2>
<button onclick="run()">Run Smoke Test</button>
<button onclick="runFounder()">Run Founder Fallback</button>
<pre id="out">Ready.</pre>
<script>
async function run(){
  document.getElementById('out').textContent='Running...';
  const r=await fetch('/admin/smoke/run',{method:'POST',headers:{'Authorization':'Bearer '+prompt('Admin token:')}});
  const d=await r.json();
  document.getElementById('out').textContent=JSON.stringify(d,null,2);
}
async function runFounder(){
  document.getElementById('out').textContent='Running founder fallback smoke...';
  const adminToken = prompt('Admin token:');
  const alias = prompt('Alias for founder smoke:', 'kaixu/deep') || 'kaixu/deep';
  const r=await fetch('/admin/smoke/founder-fallback',{
    method:'POST',
    headers:{'Authorization':'Bearer '+adminToken,'Content-Type':'application/json'},
    body:JSON.stringify({alias})
  });
  const d=await r.json();
  document.getElementById('out').textContent=JSON.stringify(d,null,2);
}
</script></body></html>`
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  // POST — return log
  const raw = env.KAIXU_SMOKE_KV ? await env.KAIXU_SMOKE_KV.get(SMOKE_LOG_KEY) : null
  return json({ ok: true, log: raw ? JSON.parse(raw) : [] })
}
