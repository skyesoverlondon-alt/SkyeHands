import { HttpError } from '../utils/errors'
import { splitSystemMessages } from './normalizeRequest'
import type { Env, NormalizedProviderTextResponse, SkyChatRequest } from '../types'

function anthropicText(payload: any): string {
  const content = Array.isArray(payload?.content) ? payload.content : []
  return content.filter((item: any) => typeof item?.text === 'string').map((item: any) => item.text).join('\n').trim()
}

export async function callAnthropicChat(model: string, request: SkyChatRequest, env: Env): Promise<NormalizedProviderTextResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(500, 'ANTHROPIC_KEY_MISSING', 'ANTHROPIC_API_KEY is not configured.')
  }

  const { system, conversation } = splitSystemMessages(request.messages)
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: system || undefined,
      max_tokens: request.max_output_tokens ?? 1200,
      temperature: request.temperature,
      messages: conversation.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })),
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new HttpError(response.status, 'ANTHROPIC_UPSTREAM_ERROR', detail || 'Anthropic request failed.')
  }

  const payload: any = await response.json()
  return {
    output: {
      text: anthropicText(payload),
    },
    usage: {
      estimated_cost_usd: 0,
      input_tokens: Number(payload?.usage?.input_tokens ?? 0),
      output_tokens: Number(payload?.usage?.output_tokens ?? 0),
    },
  }
}
