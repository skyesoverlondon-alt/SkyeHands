import { listRoutesForAlias } from '../db/queries'
import { requireDb } from '../env'
import type { Env, RouteOption } from '../types'
import { HttpError } from '../utils/errors'

export async function resolveAlias(alias: string, env: Env): Promise<RouteOption[]> {
  const routes = await listRoutesForAlias(requireDb(env), alias)
  if (routes.length === 0) {
    throw new HttpError(404, 'ALIAS_NOT_FOUND', `No route found for alias ${alias}.`)
  }
  return routes
}
