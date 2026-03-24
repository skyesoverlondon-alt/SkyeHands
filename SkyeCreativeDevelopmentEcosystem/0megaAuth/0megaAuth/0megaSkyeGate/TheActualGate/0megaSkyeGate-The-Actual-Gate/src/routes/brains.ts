import type { Env } from '../types'
import { json } from '../utils/json'
import { verifyAdminToken } from '../auth/verifyAdminToken'
import { getEnvString } from '../env'

function buildRegistry(request: Request, env: Env): Record<string, { id: string; url: string; active: boolean }> {
  const selfUrl = getEnvString(env, 'OMEGA_GATE_URL', new URL(request.url).origin)
  const flow32Url = getEnvString(env, 'KAIXU_BRAIN_BASE_FLOW32', '')
  const backupUrl = getEnvString(env, 'KAIXU_BRAIN_BASE_BACKUP', '')

  const registry: Record<string, { id: string; url: string; active: boolean }> = {
    omega: { id: 'omega', url: selfUrl, active: true },
  }

  if (flow32Url) {
    registry['flow32'] = { id: 'flow32', url: flow32Url, active: true }
  }

  if (backupUrl) {
    registry['backup'] = { id: 'backup', url: backupUrl, active: true }
  }

  return registry
}

export async function handleBrainsList(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)
  const registry = buildRegistry(request, env)
  return json({ ok: true, brains: Object.values(registry), count: Object.keys(registry).length })
}

export async function handleBrainsResolve(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  let body: { target?: string }
  try {
    body = await request.json() as { target?: string }
  } catch {
    return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } }, 400)
  }

  const target = (body.target || '').toLowerCase().trim()
  if (!target) return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing target field.' } }, 400)

  const registry = buildRegistry(request, env)

  // Support legacy IDs
  const legacyMap: Record<string, string> = {
    kaixu67: 'omega',
    kaixu0s: 'omega',
    core67: 'omega',
    coresi4: 'omega',
    omega_backup: 'backup',
    'omega-backup': 'backup',
    backupbrain: 'backup',
  }
  const resolvedId = legacyMap[target] ?? target

  const brain = registry[resolvedId]
  if (!brain) {
    return json({ ok: false, error: { code: 'NOT_FOUND', message: `Brain '${target}' not found. Available: ${Object.keys(registry).join(', ')}` } }, 404)
  }

  return json({ ok: true, target, resolved_id: resolvedId, brain })
}
