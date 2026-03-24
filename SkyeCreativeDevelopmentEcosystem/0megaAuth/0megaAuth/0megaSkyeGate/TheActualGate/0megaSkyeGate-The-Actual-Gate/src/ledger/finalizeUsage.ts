import { insertUsageEvent, insertWalletTransaction, updateWalletBalance, getWalletById } from '../db/queries'
import type { Env, TraceUsageRecord } from '../types'

export async function finalizeUsage(params: {
  walletId: string
  reservedAmount: number
  finalBurn: number
  traceId: string
  env: Env
  usageRecord: Omit<TraceUsageRecord, 'traceId' | 'skyfuelBurned' | 'status'> & { status?: 'success' | 'error' }
}): Promise<{ refunded: number; balance: number }> {
  const { walletId, reservedAmount, finalBurn, traceId, env, usageRecord } = params
  const wallet = await getWalletById(env.DB, walletId)
  const currentBalance = Number(wallet?.balance ?? 0)
  const refunded = Math.max(reservedAmount - finalBurn, 0)
  const balance = currentBalance + refunded

  if (refunded > 0) {
    await updateWalletBalance(env.DB, walletId, balance)
    await insertWalletTransaction(env.DB, {
      walletId,
      txType: 'refund',
      amount: refunded,
      balanceAfter: balance,
      traceId,
      note: 'Refunded unused reserved SkyFuel.',
    })
  }

  await insertUsageEvent(env.DB, {
    traceId,
    orgId: usageRecord.orgId,
    appId: usageRecord.appId,
    userId: usageRecord.userId,
    walletId,
    alias: usageRecord.alias,
    provider: usageRecord.provider,
    resolvedModel: usageRecord.resolvedModel,
    requestType: usageRecord.requestType,
    skyfuelBurned: finalBurn,
    estimatedCostUsd: usageRecord.estimatedCostUsd,
    inputTokens: usageRecord.inputTokens,
    outputTokens: usageRecord.outputTokens,
    latencyMs: usageRecord.latencyMs,
    status: usageRecord.status ?? 'success',
    errorCode: usageRecord.errorCode,
    errorMessage: usageRecord.errorMessage,
  }, env)

  return { refunded, balance }
}
