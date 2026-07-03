export enum Role {
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool',
}

export interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolUseId: string
  content: string
  isError: boolean
  imagePaths?: string[]
  images?: ImageContent[]
  imageMetadata?: Array<{ path: string; mediaType?: string; width?: number; height?: number; sizeBytes?: number }>
}

export interface ImageContent {
  type: 'image'
  source: 'base64' | 'url' | 'file'
  data: string
  mediaType?: string
}

export interface AudioContent {
  type: 'audio'
  source: 'base64' | 'file'
  data: string
  format?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac'
}

export interface TextContent {
  type: 'text'
  text: string
}

export type ContentPart = TextContent | ImageContent | AudioContent

export interface Message {
  role: Role
  content: string
  contentParts?: ContentPart[]
  toolUses?: ToolUse[]
  toolResult?: ToolResult
  timestamp?: string
  isCompactSummary?: boolean
  isRecap?: boolean
  reasoning?: string
}

export function userMessage(content: string, images?: ImageContent[]): Message {
  const msg: Message = { role: Role.User, content, timestamp: new Date().toISOString() }
  if (images?.length) {
    msg.contentParts = [{ type: 'text', text: content }, ...images]
  }
  return msg
}

export function assistantMessage(content: string, toolUses?: ToolUse[]): Message {
  return { role: Role.Assistant, content, toolUses, timestamp: new Date().toISOString() }
}

export function toolMessage(toolUseId: string, content: string, isError = false, extras?: Partial<Omit<ToolResult, 'toolUseId' | 'content' | 'isError'>>): Message {
  return {
    role: Role.Tool,
    content: '',
    toolResult: { toolUseId, content, isError, ...extras },
    timestamp: new Date().toISOString(),
  }
}
