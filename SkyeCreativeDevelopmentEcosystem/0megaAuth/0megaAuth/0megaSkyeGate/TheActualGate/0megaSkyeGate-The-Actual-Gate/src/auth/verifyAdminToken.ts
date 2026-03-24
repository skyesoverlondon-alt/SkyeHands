import type { Env } from '../types'
import { getAdminToken } from '../env'
import { KaixuError } from '../utils/errors'

export function verifyAdminToken(request: Request, env: Env): void {
  const expected = getAdminToken(env)
  if (!expected) {
    throw new KaixuError(500, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: 'KAIXU_ADMIN_TOKEN is not configured.' })
  }

  const header = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new KaixuError(401, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: 'Missing admin bearer token.' })
  }

  const token = header.slice('Bearer '.length).trim()
  if (token !== expected) {
    throw new KaixuError(403, 'KAIXU_UNAUTHORIZED', 'This Kaixu route is not authorized for the current caller.', { adminDetail: 'Invalid admin token.' })
  }
}
