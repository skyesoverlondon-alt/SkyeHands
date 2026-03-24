import { getWalletById, insertWalletTransaction, updateWalletBalance } from '../db/queries'
import type { Env } from '../types'
import { HttpError } from '../utils/errors'

export async function reserveBudget(params: {
  walletId: string
  reserve: number
  traceId: string
  env: Env
}): Promise<{ previousBalance: number; balance: number }> {
  const { walletId, reserve, traceId, env } = params
  const wallet = await getWalletById(env.DB, walletId)
  if (!wallet) {
    throw new HttpError(404, 'WALLET_NOT_FOUND', `Wallet not found: ${walletId}.`)
  }

  const previousBalance = Number(wallet.balance ?? 0)
  if (previousBalance < reserve) {
    throw new HttpError(402, 'INSUFFICIENT_SKYFUEL', 'Wallet balance is too low for this request.')
  }

  const balance = previousBalance - reserve
  await updateWalletBalance(env.DB, walletId, balance)
  await insertWalletTransaction(env.DB, {
    walletId,
    txType: 'reserve',
    amount: -reserve,
    balanceAfter: balance,
    traceId,
    note: 'Reserved SkyFuel before provider call.',
  })

  return { previousBalance, balance }
}
