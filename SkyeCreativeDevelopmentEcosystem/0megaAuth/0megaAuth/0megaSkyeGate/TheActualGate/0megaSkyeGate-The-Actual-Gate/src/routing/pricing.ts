import { getPricingRule } from '../db/queries'
import { requireDb, getEnvNumber } from '../env'
import type { Env, PricingRule, SkyChatRequest, SkyEmbeddingsRequest } from '../types'
import { HttpError } from '../utils/errors'

function roundUsd(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function estimateInputUnitsFromMessages(request: SkyChatRequest): number {
  return request.messages.reduce((sum, message) => sum + Math.ceil(message.content.length / 4), 0)
}

function estimateOutputUnits(request: SkyChatRequest): number {
  const max = request.max_output_tokens ?? 600
  return Math.min(max, 4000)
}

function estimateEmbeddingUnits(request: SkyEmbeddingsRequest): number {
  return request.input.reduce((sum, item) => sum + Math.ceil(item.length / 4), 0)
}

export async function loadPricing(alias: string, env: Env): Promise<PricingRule> {
  const rule = await getPricingRule(requireDb(env), alias)
  if (!rule) {
    throw new HttpError(500, 'PRICING_NOT_FOUND', `No pricing rule found for alias ${alias}.`)
  }
  return rule
}

export async function estimateReserveForChat(alias: string, request: SkyChatRequest, env: Env): Promise<number> {
  const pricing = await loadPricing(alias, env)
  const inputEstimate = estimateInputUnitsFromMessages(request)
  const outputEstimate = estimateOutputUnits(request)
  const reserve = Math.ceil(pricing.base_burn + (inputEstimate * pricing.input_token_rate) + (outputEstimate * pricing.output_token_rate))
  const hardCap = getEnvNumber(env, 'DEFAULT_MAX_SKYFUEL_PER_CALL', 60)
  return Math.min(Math.max(reserve, pricing.base_burn), hardCap)
}

export async function estimateReserveForEmbeddings(alias: string, request: SkyEmbeddingsRequest, env: Env): Promise<number> {
  const pricing = await loadPricing(alias, env)
  const inputEstimate = estimateEmbeddingUnits(request)
  return Math.max(Math.ceil(pricing.base_burn + (inputEstimate * pricing.input_token_rate)), pricing.base_burn)
}

export async function calculateFinalBurn(alias: string, usage: { input_tokens?: number; output_tokens?: number }, env: Env): Promise<number> {
  const pricing = await loadPricing(alias, env)
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  return Math.max(Math.ceil(pricing.base_burn + (input * pricing.input_token_rate) + (output * pricing.output_token_rate)), pricing.base_burn)
}

export function getBillingMarkupMultiplier(env: Env): number {
  const markupPercent = getEnvNumber(env, 'KAIXU_BILLING_MARKUP_PERCENT', 31)
  return Math.max(1, 1 + (markupPercent / 100))
}

export function calculateBillingLedger(upstreamCostUsd: number, env: Env): {
  upstreamCostUsd: number
  billedCostUsd: number
  markupMultiplier: number
} {
  const normalizedUpstream = Math.max(0, Number(upstreamCostUsd) || 0)
  const markupMultiplier = getBillingMarkupMultiplier(env)
  return {
    upstreamCostUsd: roundUsd(normalizedUpstream),
    billedCostUsd: roundUsd(normalizedUpstream * markupMultiplier),
    markupMultiplier: roundUsd(markupMultiplier),
  }
}

export function publicUsageWithBilledCost<T extends { estimated_cost_usd?: number; input_tokens?: number; output_tokens?: number }>(usage: T, env: Env): T & {
  billed_cost_usd: number
} {
  const ledger = calculateBillingLedger(usage.estimated_cost_usd ?? 0, env)
  return {
    ...usage,
    estimated_cost_usd: ledger.billedCostUsd,
    billed_cost_usd: ledger.billedCostUsd,
  }
}
