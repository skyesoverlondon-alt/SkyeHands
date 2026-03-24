import type { NormalizedProviderTextResponse } from '../types'

export function defaultTextResponse(text: string): NormalizedProviderTextResponse {
  return {
    output: { text },
    usage: {
      estimated_cost_usd: 0,
    },
  }
}
