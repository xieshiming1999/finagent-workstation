import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type { Message, ContentPart, ImageContent } from './message'
import { Role } from './message'

export interface ContentAdapterConfig {
  tmpDir: string
  isVisionCapable: () => boolean
}

export class ContentAdapter {
  private config: ContentAdapterConfig

  constructor(config: ContentAdapterConfig) {
    this.config = config
  }

  adaptMessage(msg: Message): Message {
    if (this.config.isVisionCapable()) return msg
    if (msg.role === Role.Assistant) return msg

    if (msg.contentParts?.length) {
      return this.adaptMultipartMessage(msg)
    }

    if (msg.role === Role.Tool && msg.toolResult) {
      return this.adaptToolResult(msg)
    }

    return msg
  }

  private adaptMultipartMessage(msg: Message): Message {
    const textParts: string[] = []
    const adapted: ContentPart[] = []

    for (const part of msg.contentParts!) {
      if (part.type === 'text') {
        adapted.push(part)
      } else if (part.type === 'image') {
        const filePath = this.saveImageToTmp(part)
        textParts.push(`[Image saved to ${filePath} — use MultimodalAgent to analyze]`)
      }
    }

    if (textParts.length > 0) {
      adapted.push({ type: 'text', text: textParts.join('\n') })
    }

    return {
      ...msg,
      content: adapted.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n'),
      contentParts: undefined,
    }
  }

  private adaptToolResult(msg: Message): Message {
    const content = msg.toolResult!.content
    const imagePattern = /data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/g
    let match = imagePattern.exec(content)
    if (!match) return msg

    let adapted = content
    while (match) {
      const mediaType = match[1]
      const base64Data = match[2]
      const filePath = this.saveImageToTmp({ type: 'image', source: 'base64', data: base64Data, mediaType })
      adapted = adapted.replace(match[0], `[Image saved to ${filePath} — use MultimodalAgent to analyze]`)
      match = imagePattern.exec(content)
    }

    return {
      ...msg,
      toolResult: { ...msg.toolResult!, content: adapted },
    }
  }

  private saveImageToTmp(image: ImageContent): string {
    mkdirSync(this.config.tmpDir, { recursive: true })
    const ext = (image.mediaType ?? 'image/png').split('/')[1] || 'png'
    const name = `img_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`
    const filePath = join(this.config.tmpDir, name)

    if (image.source === 'base64') {
      writeFileSync(filePath, Buffer.from(image.data, 'base64'))
    } else if (image.source === 'file') {
      writeFileSync(filePath, `redirect:${image.data}`)
    }

    return filePath
  }
}
