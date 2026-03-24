import { getRoutingPolicy } from '../db/queries'
import { requireDb } from '../env'
import type { Env, RouteOption } from '../types'

export async function chooseProvider(params: {
  alias: string
  appId: string
  orgId: string
  routes: RouteOption[]
  env: Env
}): Promise<{ primary: RouteOption; fallbacks: RouteOption[]; allowFallback: boolean }> {
  const { alias, appId, orgId, routes, env } = params
  const policy = await getRoutingPolicy(requireDb(env), alias, appId, orgId)
  const allowFallback = Number(policy?.allow_fallback ?? 1) === 1
  return {
    primary: routes[0],
    fallbacks: routes.slice(1),
    allowFallback,
  }
}
