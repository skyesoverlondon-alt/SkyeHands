import { verifyAppToken } from '../auth/verifyAppToken'
import { getWalletById } from '../db/queries'
import type { Env } from '../types'
import { json } from '../utils/json'

export async function handleWalletBalance(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAppToken(request, env)
  const wallet = await getWalletById(env.DB, auth.walletId)

  return json({
    ok: true,
    wallet_id: auth.walletId,
    app_id: auth.appId,
    balance: Number(wallet?.balance ?? 0),
    currency: String(wallet?.currency ?? env.DEFAULT_CURRENCY ?? 'SKYFUEL'),
    status: String(wallet?.status ?? 'missing'),
  })
}
