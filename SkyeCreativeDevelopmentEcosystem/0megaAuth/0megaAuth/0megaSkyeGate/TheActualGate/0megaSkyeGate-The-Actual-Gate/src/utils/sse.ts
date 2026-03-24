export type ParsedSseEvent = {
  event: string
  data: string
}

export function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ParsedSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary === -1) break
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const lines = raw.split(/\r?\n/)
        let event = 'message'
        const parts: string[] = []
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) parts.push(line.slice(5).trim())
        }
        yield { event, data: parts.join('\n') }
      }
    }

    const flushed = decoder.decode()
    if (flushed) buffer += flushed
    const tail = buffer.trim()
    if (tail) {
      const lines = tail.split(/\r?\n/)
      let event = 'message'
      const parts: string[] = []
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) parts.push(line.slice(5).trim())
      }
      yield { event, data: parts.join('\n') }
    }
  } finally {
    reader.releaseLock()
  }
}
