import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, KaixuEngineAlias, NormalizedProviderTextResponse, SkyChatRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'
import { getResponseOutputText } from '../utils/openai-response'

function normalizeMessageContent(content: SkyChatRequest['messages'][number]['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }]
  }

  return content.map((part) => {
    if (part.type === 'text') return { type: 'input_text', text: part.text }
    return {
      type: 'input_image',
      image_url: part.image_url.url,
      detail: part.image_url.detail,
    }
  })
}

export async function callOpenAIChat(model: string, request: SkyChatRequest, env: Env, alias: KaixuEngineAlias): Promise<NormalizedProviderTextResponse> {
  const apiKey = getLaneKey(env, 'chat')
  if (!apiKey) {
    throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getOpenAIHeaders(apiKey, env),
    },
    body: JSON.stringify({
      model,
      store: false,
      stream: false,
      temperature: request.temperature,
      max_output_tokens: request.max_output_tokens,
      input: request.messages.map((message) => ({
        role: message.role,
        content: normalizeMessageContent(message.content),
      })),
      metadata: {
        kaixu_engine_alias: alias,
        ...(request.metadata ?? {}),
      },
    }),
  })

  if (!response.ok) throw await fromUpstreamResponse(response)

  const payload: any = await response.json()
  return {
    output: { text: getResponseOutputText(payload) },
    usage: {
      estimated_cost_usd: 0,
      input_tokens: Number(payload?.usage?.input_tokens ?? payload?.usage?.prompt_tokens ?? 0),
      output_tokens: Number(payload?.usage?.output_tokens ?? payload?.usage?.completion_tokens ?? 0),
    },
    raw: payload,
  }
}
