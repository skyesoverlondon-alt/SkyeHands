import { assertAliasAllowed } from '../auth/policyGuard'
import { verifyAppToken } from '../auth/verifyAppToken'
import { reserveBudget } from '../ledger/reserveBudget'
import { finalizeUsage } from '../ledger/finalizeUsage'
import { refundUsage } from '../ledger/refundUsage'
import { callGeminiEmbeddings } from '../providers/gemini'
import { callOpenAIEmbeddings } from '../providers/openai'
import { chooseProvider } from '../routing/chooseProvider'
import { estimateReserveForEmbeddings, calculateBillingLedger, calculateFinalBurn, publicUsageWithBilledCost } from '../routing/pricing'
import { resolveAlias } from '../routing/resolveAlias'
import type { Env, SkyEmbeddingsRequest } from '../types'
import { publicEngineName, publicError } from '../utils/branding'
import { HttpError, toHttpError } from '../utils/errors'
import { json, readJson } from '../utils/json'
import { createTraceId } from '../utils/trace'

export async function handleEmbeddings(request: Request, env: Env): Promise<Response> {
  const traceId = createTraceId()
  const started = Date.now()
  const auth = await verifyAppToken(request, env)
  const body = await readJson<SkyEmbeddingsRequest>(request)

  assertAliasAllowed(auth, body.alias)

  const reserve = await estimateReserveForEmbeddings(body.alias, body, env)
  await reserveBudget({ walletId: auth.walletId, reserve, traceId, env })

  try {
    const routes = await resolveAlias(body.alias, env)
    const routing = await chooseProvider({ alias: body.alias, appId: auth.appId, orgId: auth.orgId, routes, env })
    const route = routing.primary

    let result
    switch (route.provider) {
      case 'openai':
        result = await callOpenAIEmbeddings(route.model, body, env)
        break
      case 'gemini':
        result = await callGeminiEmbeddings(route.model, body, env)
        break
      default:
        throw new HttpError(400, 'EMBEDDINGS_PROVIDER_UNSUPPORTED', 'The requested Kaixu embeddings route is not wired in this starter pack.')
    }

    const finalBurn = await calculateFinalBurn(body.alias, result.usage, env)
    const billing = calculateBillingLedger(result.usage.estimated_cost_usd, env)
    const publicUsage = publicUsageWithBilledCost(result.usage, env)
    const finalized = await finalizeUsage({
      walletId: auth.walletId,
      reservedAmount: reserve,
      finalBurn,
      traceId,
      env,
      usageRecord: {
        orgId: auth.orgId,
        appId: auth.appId,
        userId: body.metadata?.user_id,
        alias: body.alias,
        provider: route.provider,
        resolvedModel: route.model,
        requestType: 'embeddings',
        estimatedCostUsd: billing.billedCostUsd,
        upstreamCostUsd: billing.upstreamCostUsd,
        billedCostUsd: billing.billedCostUsd,
        markupMultiplier: billing.markupMultiplier,
        inputTokens: result.usage.input_tokens,
        outputTokens: 0,
        latencyMs: Date.now() - started,
      },
    })

    return json({
      ok: true,
      trace_id: traceId,
      alias: body.alias,
      engine: publicEngineName(body.alias),
      vectors: result.vectors,
      usage: {
        skyfuel_burned: finalBurn,
        estimated_cost_usd: publicUsage.estimated_cost_usd,
        billed_cost_usd: publicUsage.billed_cost_usd,
        input_tokens: publicUsage.input_tokens ?? 0,
        output_tokens: 0,
      },
      wallet: {
        refunded: finalized.refunded,
        balance: finalized.balance,
      },
    })
  } catch (error) {
    const httpError = toHttpError(error)
    await refundUsage({
      walletId: auth.walletId,
      reservedAmount: reserve,
      traceId,
      alias: body.alias,
      appId: auth.appId,
      orgId: auth.orgId,
      userId: body.metadata?.user_id,
      requestType: 'embeddings',
      env,
      errorCode: httpError.code,
      errorMessage: httpError.message,
    })

    return json({
      ok: false,
      trace_id: traceId,
      error: publicError(httpError),
    }, httpError.status)
  }
}
