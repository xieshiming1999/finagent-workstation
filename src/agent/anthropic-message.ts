import type { Message } from './message'
import { Role } from './message'
import { anthropicContinueCopy } from './runtime-copy'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'

export type ContentBlock = Record<string, unknown>
export type AnthropicMessage = { role: string; content: ContentBlock[] }

const RECENT_TOOL_RESULT_IMAGES = 3
const MAX_TOOL_RESULT_IMAGE_BYTES = 10 * 1024 * 1024

export function normalizeMessages(messages: Message[], effort?: string, opts?: { includeToolResultImages?: boolean }): AnthropicMessage[] {
  const result: AnthropicMessage[] = []
  const imageEligibleToolResults = opts?.includeToolResultImages
    ? recentToolResultImageMessages(messages, RECENT_TOOL_RESULT_IMAGES)
    : new Set<Message>()

  for (const msg of messages) {
    const converted = toAnthropicMessage(msg, imageEligibleToolResults.has(msg))
    if (!converted) continue

    const last = result[result.length - 1]
    if (last && last.role === converted.role) {
      last.content.push(...converted.content)
    } else {
      result.push(converted)
    }
  }

  // Fix orphan tool_use
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].role !== 'assistant') continue

    const toolUseIds = result[i].content
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.id as string)
    if (toolUseIds.length === 0) continue

    const next = result[i + 1]
    if (next.role !== 'user') continue

    const answeredIds = new Set(
      next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id as string),
    )
    const orphans = toolUseIds.filter((id) => !answeredIds.has(id))

    for (const id of orphans) {
      next.content.unshift({
        type: 'tool_result',
        tool_use_id: id,
        content: 'Tool execution was interrupted.',
        is_error: true,
      })
    }
  }

  // Fix orphan tool_result
  for (let i = 0; i < result.length; i++) {
    if (result[i].role !== 'user') continue

    const prevAssistant = i > 0 && result[i - 1].role === 'assistant' ? result[i - 1] : null
    const validIds = new Set(
      prevAssistant
        ? prevAssistant.content.filter((b) => b.type === 'tool_use').map((b) => b.id as string)
        : [],
    )

    result[i].content = result[i].content.filter((b) => {
      if (b.type !== 'tool_result') return true
      return validIds.has(b.tool_use_id as string)
    })

    if (result[i].content.length === 0) {
      result[i].content = [{ type: 'text', text: '[previous tool results compacted]' }]
    }
  }

  // Inject thinking placeholders when effort is enabled
  if (effort) {
    for (const msg of result) {
      if (msg.role !== 'assistant') continue
      const hasThinking = msg.content.some((b) => b.type === 'thinking')
      if (!hasThinking) {
        msg.content.unshift({ type: 'thinking', thinking: '' })
      }
    }
  }

  // Ensure last message is user role
  if (result.length > 0 && result[result.length - 1].role === 'assistant') {
    result.push({
      role: 'user',
      content: [{ type: 'text', text: anthropicContinueCopy() }],
    })
  }

  // Ensure first message is user role
  if (result.length > 0 && result[0].role !== 'user') {
    result.unshift({ role: 'user', content: [{ type: 'text', text: 'Begin.' }] })
  }

  return result
}

function toAnthropicMessage(msg: Message, includeToolImages = false): AnthropicMessage | null {
  const content: ContentBlock[] = []

  if (msg.role === Role.Assistant) {
    if (msg.reasoning) {
      content.push({ type: 'thinking', thinking: msg.reasoning })
    }
    if (msg.content) {
      content.push({ type: 'text', text: msg.content })
    }
    if (msg.toolUses?.length) {
      for (const tu of msg.toolUses) {
        content.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      }
    }
    if (content.length === 0) return null
    return { role: 'assistant', content }
  }

  if (msg.role === Role.Tool && msg.toolResult) {
    const toolResultContent: unknown[] = []
    if (includeToolImages) {
      toolResultContent.push(...toolResultImageBlocks(msg))
    }
    toolResultContent.push({ type: 'text', text: msg.toolResult.content })
    content.push({
      type: 'tool_result',
      tool_use_id: msg.toolResult.toolUseId,
      content: toolResultContent.length > 1 ? toolResultContent : msg.toolResult.content,
      is_error: msg.toolResult.isError || undefined,
    })
    return { role: 'user', content }
  }

  if (msg.role === Role.User) {
    if (msg.contentParts?.length) {
      for (const part of msg.contentParts) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text })
        } else if (part.type === 'image') {
          if (part.source === 'base64') {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: part.mediaType ?? 'image/png', data: part.data },
            })
          } else {
            content.push({
              type: 'image',
              source: { type: 'url', url: part.data },
            })
          }
        } else if (part.type === 'audio') {
          content.push({
            type: 'text',
            text: `[Audio content: ${part.format ?? 'mp3'}, ${Math.round(part.data.length * 0.75 / 1024)}KB — not supported natively]`,
          })
        }
      }
    } else if (msg.content) {
      content.push({ type: 'text', text: msg.content })
    }
    if (content.length === 0) return null
    return { role: 'user', content }
  }

  return null
}

function recentToolResultImageMessages(messages: Message[], keep: number): Set<Message> {
  const selected = new Set<Message>()
  let remaining = keep
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i--) {
    const msg = messages[i]
    if (msg.role !== Role.Tool || !msg.toolResult) continue
    if ((msg.toolResult.images?.length ?? 0) === 0 && (msg.toolResult.imagePaths?.length ?? 0) === 0) continue
    selected.add(msg)
    remaining--
  }
  return selected
}

function toolResultImageBlocks(msg: Message): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const seen = new Set<string>()
  const metadataByPath = new Map<string, { mediaType?: string }>()
  for (const meta of msg.toolResult?.imageMetadata ?? []) {
    if (meta.path) metadataByPath.set(meta.path, { mediaType: meta.mediaType })
  }

  for (const img of msg.toolResult?.images ?? []) {
    if (img.type !== 'image') continue
    if (img.source === 'base64') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType ?? 'image/png', data: img.data },
      })
      continue
    }
    if (img.source === 'file') {
      const block = imageFileBlock(img.data, img.mediaType)
      if (block) {
        seen.add(img.data)
        blocks.push(block)
      }
    }
  }

  for (const path of msg.toolResult?.imagePaths ?? []) {
    if (seen.has(path)) continue
    const block = imageFileBlock(path, metadataByPath.get(path)?.mediaType)
    if (block) blocks.push(block)
  }

  return blocks
}

function imageFileBlock(path: string, mediaType?: string): ContentBlock | null {
  if (!path || !existsSync(path)) return null
  try {
    if (statSync(path).size > MAX_TOOL_RESULT_IMAGE_BYTES) return null
    const data = readFileSync(path).toString('base64')
    if (!data) return null
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType ?? mediaTypeFromPath(path), data },
    }
  } catch {
    return null
  }
}

function mediaTypeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
    default:
      return 'image/png'
  }
}
