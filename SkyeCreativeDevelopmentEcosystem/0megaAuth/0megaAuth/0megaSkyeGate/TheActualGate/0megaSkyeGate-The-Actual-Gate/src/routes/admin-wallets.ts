import { verifyAdminToken } from '../auth/verifyAdminToken'
import { creditWallet } from '../ledger/creditWallet'
import type { Env } from '../types'
import { HttpError } from '../utils/errors'
import { json, readJson } from '../utils/json'

export async function handleAdminWallets(request: Request, env: Env): Promise<Response> {
  verifyAdminToken(request, env)

  if (request.method !== 'POST') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for wallet credit actions.')
  }

  const body = await readJson<{ wallet_id?: string; amount?: number; note?: string }>(request)
  if (!body.wallet_id || typeof body.amount !== 'number' || body.amount <= 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'wallet_id and positive amount are required.')
  }

  const result = await creditWallet(body.wallet_id, body.amount, body.note, env)
  return json({ ok: true, result })
}
