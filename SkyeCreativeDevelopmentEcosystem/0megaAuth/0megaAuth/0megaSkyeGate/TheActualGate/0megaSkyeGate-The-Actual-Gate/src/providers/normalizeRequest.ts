import type { MessageContentPart, SkyMessage } from '../types'

function flattenContent(content: string | MessageContentPart[]): string {
  if (typeof content === 'string') return content
  return content.map((part) => part.type === 'text' ? part.text : part.image_url.url).join("\n")
}

export function splitSystemMessages(messages: SkyMessage[]): { system: string; conversation: SkyMessage[] } {
  const systemParts: string[] = []
  const conversation: SkyMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(flattenContent(message.content))
    } else {
      conversation.push(message)
    }
  }

  return {
    system: systemParts.join('\n\n').trim(),
    conversation,
  }
}

export function toPlainPrompt(messages: SkyMessage[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${flattenContent(message.content)}`)
    .join('\n\n')
}
