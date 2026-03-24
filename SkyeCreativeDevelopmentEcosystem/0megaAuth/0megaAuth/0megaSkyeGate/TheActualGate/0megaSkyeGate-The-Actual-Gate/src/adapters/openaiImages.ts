import { getLaneKey, getOpenAIHeaders } from '../env'
import type { Env, InternalAssetRef, KaixuEngineAlias, NormalizedImageResult, SkyImageRequest } from '../types'
import { KaixuError, fromUpstreamResponse } from '../utils/errors'
import { stripDataUrlPrefix, toDataUrl, base64ToBytes } from '../utils/base64'

function assetFromBase64(base64: string, mimeType = 'image/png', index = 0): InternalAssetRef {
  const bytes = base64ToBytes(base64)
  return {
    asset_id: `img_${index + 1}`,
    kind: 'image',
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    data_url: toDataUrl(base64, mimeType),
  }
}

export async function callOpenAIImages(model: string, request: SkyImageRequest, env: Env, alias: KaixuEngineAlias): Promise<NormalizedImageResult> {
  const apiKey = getLaneKey(env, 'image')
  if (!apiKey) throw new KaixuError(503, 'KAIXU_LANE_DISABLED', 'This Kaixu lane is disabled or not configured.')

  const commonHeaders = getOpenAIHeaders(apiKey, env)
  let response: Response

  if (request.input_image_base64) {
    const { base64, mimeType } = stripDataUrlPrefix(request.input_image_base64)
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', request.prompt)
    form.set('size', request.size ?? '1024x1024')
    form.set('background', request.background ?? 'auto')
    form.set('quality', request.quality ?? 'auto')
    form.set('response_format', 'b64_json')
    form.set('image', new File([base64ToBytes(base64)], request.input_image_mime_type ? `input.${request.input_image_mime_type.split('/').pop()}` : 'input.png', { type: request.input_image_mime_type || mimeType || 'image/png' }))

    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: commonHeaders,
      body: form,
    })
  } else {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...commonHeaders,
      },
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        size: request.size ?? '1024x1024',
        background: request.background ?? 'auto',
        quality: request.quality ?? 'auto',
        moderation: request.moderation,
        response_format: 'b64_json',
        metadata: {
          kaixu_engine_alias: alias,
          ...(request.metadata ?? {}),
        },
      }),
    })
  }

  if (!response.ok) throw await fromUpstreamResponse(response)
  const payload: any = await response.json()
  const rawAssets = Array.isArray(payload?.data) ? payload.data : []
  const assets = rawAssets
    .map((item: any, index: number) => typeof item?.b64_json === 'string' ? assetFromBase64(item.b64_json, item?.mime_type || 'image/png', index) : null)
    .filter((item: InternalAssetRef | null): item is InternalAssetRef => !!item)

  return {
    status: 'completed',
    usage: {
      estimated_cost_usd: 0,
      input_tokens: Number(payload?.usage?.input_tokens ?? 0),
      output_tokens: Number(payload?.usage?.output_tokens ?? 0),
    },
    assets,
    raw: payload,
  }
}
