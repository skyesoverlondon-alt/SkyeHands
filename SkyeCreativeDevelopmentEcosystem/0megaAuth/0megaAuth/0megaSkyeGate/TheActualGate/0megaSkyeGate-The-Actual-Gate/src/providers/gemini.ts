import { HttpError } from '../utils/errors'
import { splitSystemMessages } from './normalizeRequest'
import type { Env, NormalizedProviderEmbeddingsResponse, NormalizedProviderTextResponse, SkyChatRequest, SkyEmbeddingsRequest } from '../types'

function geminiText(payload: any): string {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
  const first = candidates[0]
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : []
  return parts.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('\n').trim()
}

export async function callGeminiChat(model: string, request: SkyChatRequest, env: Env): Promise<NormalizedProviderTextResponse> {
  if (!env.GEMINI_API_KEY) {
    throw new HttpError(500, 'GEMINI_KEY_MISSING', 'GEMINI_API_KEY is not configured.')
  }

  const { system, conversation } = splitSystemMessages(request.messages)
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: conversation.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_output_tokens,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new HttpError(response.status, 'GEMINI_UPSTREAM_ERROR', detail || 'Gemini request failed.')
  }

  const payload: any = await response.json()
  return {
    output: {
      text: geminiText(payload),
    },
    usage: {
      estimated_cost_usd: 0,
      input_tokens: Number(payload?.usageMetadata?.promptTokenCount ?? 0),
      output_tokens: Number(payload?.usageMetadata?.candidatesTokenCount ?? 0),
    },
  }
}

export async function callGeminiEmbeddings(model: string, request: SkyEmbeddingsRequest, env: Env): Promise<NormalizedProviderEmbeddingsResponse> {
  if (!env.GEMINI_API_KEY) {
    throw new HttpError(500, 'GEMINI_KEY_MISSING', 'GEMINI_API_KEY is not configured.')
  }

  const vectors: number[][] = []
  let promptTokens = 0

  for (const item of request.input) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        content: {
          parts: [{ text: item }],
        },
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new HttpError(response.status, 'GEMINI_EMBEDDINGS_ERROR', detail || 'Gemini embeddings request failed.')
    }

    const payload: any = await response.json()
    vectors.push(Array.isArray(payload?.embedding?.values) ? payload.embedding.values : [])
    promptTokens += Number(payload?.usageMetadata?.promptTokenCount ?? 0)
  }

  return {
    vectors,
    usage: {
      estimated_cost_usd: 0,
      input_tokens: promptTokens,
      output_tokens: 0,
    },
  }
}
