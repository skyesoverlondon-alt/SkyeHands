import { creditWalletById } from '../db/queries'
import type { Env } from '../types'

export async function creditWallet(walletId: string, amount: number, note: string | undefined, env: Env): Promise<Record<string, unknown>> {
  return await creditWalletById(env.DB, walletId, amount, note)
}
