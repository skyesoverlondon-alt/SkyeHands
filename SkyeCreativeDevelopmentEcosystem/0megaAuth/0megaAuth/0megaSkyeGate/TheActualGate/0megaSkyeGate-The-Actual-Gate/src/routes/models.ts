import { verifyAppToken } from '../auth/verifyAppToken'
import type { Env } from '../types'
import { PUBLIC_ALIASES, publicModelDescriptors, publicModelId, publicModelName, publicProviderName, publicServiceName } from '../utils/branding'
import { json } from '../utils/json'

export async function handleModels(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAppToken(request, env)
  const allowed = auth.allowedAliases.length > 0 ? PUBLIC_ALIASES.filter((alias) => auth.allowedAliases.includes(alias)) : PUBLIC_ALIASES
  const aliases = publicModelDescriptors(allowed.map((alias) => ({ alias })))
  return json({
    ok: true,
    app_id: auth.appId,
    aliases,
    object: 'list',
    data: allowed.map((alias) => ({
      id: publicModelId(),
      object: 'model',
      created: 0,
      owned_by: publicServiceName(undefined, env),
      provider: publicProviderName(env),
      display_name: publicModelName(),
      engine: aliases.find((item) => item.engine)?.engine || publicModelName(),
    })),
  })
}
