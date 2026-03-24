import { HttpError } from '../utils/errors'
import { splitSystemMessages } from './normalizeRequest'
import type { Env, NormalizedProviderEmbeddingsResponse, NormalizedProviderTextResponse, SkyChatRequest, SkyEmbeddingsRequest } from '../types'

function getOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text

  const output = Array.isArray(payload?.output) ? payload.output : []
  const texts = output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => typeof part?.text === 'string')
    .map((part: any) => part.text)

  return texts.join('\n').trim()
}

export async function callOpenAIChat(model: string, request: SkyChatRequest, env: Env): Promise<NormalizedProviderTextResponse> {
  if (!env.OPENAI_API_KEY) {
    throw new HttpError(500, 'OPENAI_KEY_MISSING', 'OPENAI_API_KEY is not configured.')
  }

  const { system, conversation } = splitSystemMessages(request.messages)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: system || undefined,
      input: conversation.map((message) => ({
        role: message.role,
        content: [{ type: 'input_text', text: message.content }],
      })),
      max_output_tokens: request.max_output_tokens,
      temperature: request.temperature,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new HttpError(response.status, 'OPENAI_UPSTREAM_ERROR', detail || 'OpenAI request failed.')
  }

  const payload: any = await response.json()
  return {
    output: {
      text: getOutputText(payload),
    },
    usage: {
      estimated_cost_usd: 0,
      input_tokens: Number(payload?.usage?.input_tokens ?? 0),
      output_tokens: Number(payload?.usage?.output_tokens ?? 0),
    },
  }
}

export async function callOpenAIEmbeddings(model: string, request: SkyEmbeddingsRequest, env: Env): Promise<NormalizedProviderEmbeddingsResponse> {
  if (!env.OPENAI_API_KEY) {
    throw new HttpError(500, 'OPENAI_KEY_MISSING', 'OPENAI_API_KEY is not configured.')
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: request.input,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new HttpError(response.status, 'OPENAI_EMBEDDINGS_ERROR', detail || 'OpenAI embeddings request failed.')
  }

  const payload: any = await response.json()
  return {
    vectors: Array.isArray(payload?.data) ? payload.data.map((item: any) => item.embedding) : [],
    usage: {
      estimated_cost_usd: 0,
      input_tokens: Number(payload?.usage?.prompt_tokens ?? 0),
      output_tokens: 0,
    },
  }
}
