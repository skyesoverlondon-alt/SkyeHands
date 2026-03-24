import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, KaixuEngineAlias, SkyChatRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'

function normalizeMessageContent(content: SkyChatRequest['messages'][number]['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ type: 'input_text', text: content }]
  return content.map((part) => part.type === 'text'
    ? { type: 'input_text', text: part.text }
    : { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail })
}

export async function callOpenAIStream(model: string, request: SkyChatRequest, env: Env, alias: KaixuEngineAlias): Promise<Response> {
  const apiKey = getLaneKey(env, 'stream')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getOpenAIHeaders(apiKey, env),
    },
    body: JSON.stringify({
      model,
      store: false,
      stream: true,
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
  if (!response.body) throw new KaixuError(502, 'KAIXU_ENGINE_UNAVAILABLE', 'The requested Kaixu engine is unavailable right now.')
  return response
}
