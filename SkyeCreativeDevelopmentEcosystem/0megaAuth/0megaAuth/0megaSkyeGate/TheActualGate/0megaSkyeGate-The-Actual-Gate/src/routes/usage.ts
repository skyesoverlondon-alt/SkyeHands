import { verifyAppToken } from '../auth/verifyAppToken'
import { listKaixuTracesForAppWithMirror } from '../db/queries'
import type { Env } from '../types'
import { publicUsageEvents } from '../utils/branding'
import { json } from '../utils/json'

export async function handleUsage(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAppToken(request, env)
  const events = await listKaixuTracesForAppWithMirror(env.DB, auth.appId, 50, env)
  return json({ ok: true, app_id: auth.appId, key_type: '0sKey', events: publicUsageEvents(events) })
}
