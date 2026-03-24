import type { AuthContext } from '../types'
import { KaixuError } from '../utils/errors'

export function assertAliasAllowed(auth: AuthContext, alias: string): void {
  if (auth.allowedAliases.length > 0 && !auth.allowedAliases.includes(alias)) {
    throw new KaixuError(403, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: `Alias not allowed: ${alias}` })
  }
}
