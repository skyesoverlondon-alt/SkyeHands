export function stripDataUrlPrefix(value: string): { base64: string; mimeType?: string } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value)
  if (!match) return { base64: value }
  return { mimeType: match[1], base64: match[2] }
}

export function toDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`
}

export function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, '')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
