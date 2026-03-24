export function getResponseOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload?.output) ? payload.output : []
  const texts: string[] = []

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const part of content) {
      if (typeof part?.text === 'string') texts.push(part.text)
      if (typeof part?.output_text === 'string') texts.push(part.output_text)
      if (typeof part?.transcript === 'string') texts.push(part.transcript)
    }
  }

  return texts.join('\n').trim()
}

export function estimateSize(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}
