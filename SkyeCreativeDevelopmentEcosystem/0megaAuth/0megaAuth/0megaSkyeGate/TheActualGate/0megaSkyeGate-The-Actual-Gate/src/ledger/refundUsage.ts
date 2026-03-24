import { getWalletById, insertUsageEvent, insertWalletTransaction, updateWalletBalance } from '../db/queries'
import type { Env } from '../types'

export async function refundUsage(params: {
  walletId: string
  reservedAmount: number
  traceId: string
  alias: string
  appId: string
  orgId: string
  userId?: string
  requestType: 'chat' | 'stream' | 'embeddings'
  env: Env
  errorCode?: string
  errorMessage?: string
}): Promise<void> {
  const { walletId, reservedAmount, traceId, alias, appId, orgId, userId, requestType, env, errorCode, errorMessage } = params
  const wallet = await getWalletById(env.DB, walletId)
  const currentBalance = Number(wallet?.balance ?? 0)
  const balance = currentBalance + reservedAmount

  await updateWalletBalance(env.DB, walletId, balance)
  await insertWalletTransaction(env.DB, {
    walletId,
    txType: 'refund',
    amount: reservedAmount,
    balanceAfter: balance,
    traceId,
    note: 'Refunded full reserve after failed provider call.',
  })

  await insertUsageEvent(env.DB, {
    traceId,
    orgId,
    appId,
    userId,
    walletId,
    alias,
    requestType,
    skyfuelBurned: 0,
    estimatedCostUsd: 0,
    status: 'error',
    errorCode,
    errorMessage,
  })
}
