import { getWalletById, insertWalletTransaction, updateWalletBalance } from '../db/queries'
import type { Env } from '../types'
import { HttpError } from '../utils/errors'

export async function debitWallet(walletId: string, amount: number, note: string | undefined, env: Env): Promise<Record<string, unknown>> {
  const wallet = await getWalletById(env.DB, walletId)
  if (!wallet) {
    throw new HttpError(404, 'WALLET_NOT_FOUND', `Wallet not found: ${walletId}.`)
  }

  const currentBalance = Number(wallet.balance ?? 0)
  if (currentBalance < amount) {
    throw new HttpError(402, 'INSUFFICIENT_SKYFUEL', 'Wallet balance is too low for this debit.')
  }

  const nextBalance = currentBalance - amount
  await updateWalletBalance(env.DB, walletId, nextBalance)
  await insertWalletTransaction(env.DB, {
    walletId,
    txType: 'debit',
    amount: -amount,
    balanceAfter: nextBalance,
    note,
  })

  return {
    wallet_id: walletId,
    previous_balance: currentBalance,
    debited: amount,
    balance: nextBalance,
  }
}
