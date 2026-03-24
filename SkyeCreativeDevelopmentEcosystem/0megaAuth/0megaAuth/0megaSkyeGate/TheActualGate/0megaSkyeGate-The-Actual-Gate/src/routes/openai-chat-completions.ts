import { getBrandName } from '../env'
import type { Env, SkyChatRequest } from '../types'
import { json, sse } from '../utils/json'
import { createId } from '../utils/ids'
import { encodeSse, parseSse } from '../utils/sse'
import { publicModelId, publicModelName } from '../utils/branding'
import { handleChat } from './chat'
import { handleStream } from './stream'

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

type OpenAIChatCompletionRequest = {
  model?: string
  messages?: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
  user?: string
}

function resolveAlias(model: string | undefined): string {
  const normalized = String(model || '').trim()
  if (!normalized) return 'kaixu/deep'
  if (normalized.startsWith('kaixu/')) return normalized
  if (/kaixu|0s|skyes over london/i.test(normalized)) return 'kaixu/deep'
  return 'kaixu/deep'
}

function toSkyRequest(body: OpenAIChatCompletionRequest): SkyChatRequest {
  const alias = resolveAlias(body.model)
  return {
    alias,
    engine: alias,
    messages: Array.isArray(body.messages)
      ? body.messages.map((message) => ({ role: message.role, content: String(message.content || '') }))
      : [],
    stream: Boolean(body.stream),
    temperature: body.temperature,
    max_output_tokens: body.max_completion_tokens ?? body.max_tokens,
    metadata: body.user ? { user_id: body.user } : undefined,
  }
}

function cloneHeaders(request: Request): Headers {
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.set('content-type', 'application/json')
  return headers
}

function createOpenAICompletion(alias: string, traceId: string, text: string, usage: Record<string, unknown> | null, brandName: string) {
  const promptTokens = Number(usage?.input_tokens ?? 0)
  const completionTokens = Number(usage?.output_tokens ?? 0)
  return {
    id: createId('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: publicModelName(),
    model_id: publicModelId(),
    provider: brandName,
    trace_id: traceId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

export async function handleOpenAIChatCompletions(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as OpenAIChatCompletionRequest
  const skyRequest = toSkyRequest(body)
  const brandName = getBrandName(env)

  if (body.stream) {
    const streamRequest = new Request(new URL('/v1/stream', request.url), {
      method: 'POST',
      headers: cloneHeaders(request),
      body: JSON.stringify(skyRequest),
    })

    const upstream = await handleStream(streamRequest, env)
    if (!upstream.ok || !upstream.body) return upstream

    const alias = resolveAlias(body.model)
    let traceId = createId('trace')
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const event of parseSse(upstream.body!)) {
          if (!event.data || event.data === '[DONE]') continue
          const payload = JSON.parse(event.data)
          if (event.event === 'meta') {
            traceId = String(payload.trace_id || traceId)
            continue
          }
          if (event.event === 'delta') {
            controller.enqueue(encodeSse('message', {
              id: createId('chatcmplchunk'),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: publicModelName(),
              model_id: publicModelId(),
              provider: brandName,
              trace_id: traceId,
              choices: [{ index: 0, delta: { content: String(payload.text || '') }, finish_reason: null }],
            }))
            continue
          }
          if (event.event === 'done') {
            controller.enqueue(encodeSse('message', {
              id: createId('chatcmplchunk'),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: publicModelName(),
              model_id: publicModelId(),
              provider: brandName,
              trace_id: traceId,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            }))
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          }
        }
        controller.close()
      },
    })

    return sse(stream)
  }

  const chatRequest = new Request(new URL('/v1/chat', request.url), {
    method: 'POST',
    headers: cloneHeaders(request),
    body: JSON.stringify(skyRequest),
  })

  const upstream = await handleChat(chatRequest, env)
  if (!upstream.ok) return upstream

  const payload = await upstream.json() as Record<string, any>
  return json(
    createOpenAICompletion(
      resolveAlias(body.model),
      String(payload.trace_id || createId('trace')),
      String(payload.output?.text || ''),
      payload.usage || null,
      brandName,
    ),
  )
}