import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, copyFileSync } from 'fs'
import { join, basename, dirname, relative } from 'path'
import type { Message } from './message'
import { Role } from './message'
import type { SessionIndex } from './session-index'

export interface SessionMeta {
  id: string
  createdAt: string
  feature?: string
  title?: string
}

interface SessionEntry {
  type: string
  [key: string]: unknown
}

export class Session {
  id: string
  private filePath: string
  private historyDir: string
  private archiveDir: string
  private sharedHistoryDir: string | null
  title: string | null = null
  searchIndex: SessionIndex | null = null

  constructor(private basePath: string, sharedHistoryDir?: string) {
    const sessionsDir = join(basePath, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    this.historyDir = join(sessionsDir, 'history')
    this.archiveDir = join(sessionsDir, 'archive')
    mkdirSync(this.historyDir, { recursive: true })
    mkdirSync(this.archiveDir, { recursive: true })
    this.filePath = join(sessionsDir, 'current.jsonl')
    this.sharedHistoryDir = sharedHistoryDir ?? null
    this.id = generateSessionId()
    if (!existsSync(this.filePath)) {
      this.writeSessionMeta()
    }
  }

  /** Append a single message to the session JSONL file (incremental). */
  appendMessage(msg: Message): void {
    const entry = messageToEntry(msg)
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8')

    // Dual-write to search index
    if (this.searchIndex && (msg.role === Role.User || msg.role === Role.Assistant) && msg.content.length > 5) {
      this.searchIndex.indexMessage({
        sessionId: this.id,
        sessionFile: relative(dirname(this.filePath), this.filePath),
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        sessionTitle: this.title ?? undefined,
      })
    }
  }

  /** Append a compact boundary marker. */
  appendCompactBoundary(summary: string, preCompactCount: number): void {
    const entry: SessionEntry = {
      type: 'compact_boundary',
      summary,
      preCompactMessageCount: preCompactCount,
      timestamp: new Date().toISOString(),
    }
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8')
  }

  /** Update session title. */
  setTitle(newTitle: string): void {
    this.title = newTitle
    appendFileSync(this.filePath, JSON.stringify({ type: 'title', title: newTitle, timestamp: new Date().toISOString() }) + '\n', 'utf-8')
  }

  /** Full save — write all messages at once (used for initial session creation or compatibility rewrites). */
  save(messages: Message[]): void {
    const lines: string[] = []
    lines.push(JSON.stringify({ type: 'session_meta', id: this.id, createdAt: new Date().toISOString() }))
    if (this.title) lines.push(JSON.stringify({ type: 'title', title: this.title, timestamp: new Date().toISOString() }))
    for (const msg of messages) {
      lines.push(JSON.stringify(messageToEntry(msg)))
    }
    writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf-8')
  }

  /** Load session from JSONL file. Messages before last compact_boundary are discarded. */
  load(): { meta: SessionMeta | null; messages: Message[] } {
    if (!existsSync(this.filePath)) return { meta: null, messages: [] }

    try {
      return this._parseSessionFile(this.filePath)
    } catch {
      // Corrupted file — rename and start fresh
      try {
        const { renameSync } = require('fs')
        renameSync(this.filePath, this.filePath.replace('.jsonl', '.corrupted.jsonl'))
      } catch { /* */ }
      return { meta: null, messages: [] }
    }
  }

  private _parseSessionFile(filePath: string): { meta: SessionMeta | null; messages: Message[] } {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim())
    let meta: SessionMeta | null = null
    const messages: Message[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as SessionEntry
        if (entry.type === 'session_meta') {
          meta = { id: entry.id as string, createdAt: entry.createdAt as string, feature: entry.feature as string | undefined }
        } else if (entry.type === 'title') {
          if (meta) meta.title = entry.title as string
          this.title = entry.title as string
        } else if (entry.type === 'compact_boundary') {
          messages.length = 0
          messages.push({
            role: Role.User,
            content: wrapCompactSummary(entry.summary as string),
            isCompactSummary: true,
            timestamp: entry.timestamp as string,
          })
        } else if (entry.type === 'message') {
          messages.push(entryToMessage(entry))
        }
      } catch { /* skip malformed lines */ }
    }

    // Trim incomplete tool use/result pairs
    trimIncompleteToolUse(messages)

    return { meta, messages }
  }

  /** Archive current session to history directory. */
  archive(): string | null {
    if (!existsSync(this.filePath)) return null
    const now = new Date()
    const date = now.toISOString().split('T')[0]
    const existing = existsSync(this.archiveDir) ? readdirSync(this.archiveDir).filter((f) => f.startsWith(date)) : []
    const idx = String(existing.length + 1).padStart(3, '0')
    const archiveName = `${date}_${idx}.jsonl`
    const archivePath = join(this.archiveDir, archiveName)
    copyFileSync(this.filePath, archivePath)
    this.id = generateSessionId()
    this.title = null
    this.writeSessionMeta()
    return archivePath
  }

  private writeSessionMeta(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify({
        type: 'session_meta',
        id: this.id,
        createdAt: new Date().toISOString(),
      }) + '\n',
      'utf-8',
    )
  }

  /** List archived resumable sessions with summaries. */
  listSessions(): Array<{ id: string; name: string; path: string; title?: string; firstPrompt?: string; createdAt?: string; isCurrent?: boolean }> {
    const currentEntry = readCurrentSessionEntry(this.filePath)
    const files = [
      ...listJsonlFiles(this.archiveDir),
      ...listJsonlFiles(this.historyDir).filter((filePath) => isSessionArchiveFile(filePath)),
    ]
    const archived = files
      .sort((a, b) => b.localeCompare(a))
      .map((filePath) => {
        const summary = readSessionSummary(filePath)
        return {
          id: summary?.id ?? basename(filePath).replace('.jsonl', ''),
          name: basename(filePath).replace('.jsonl', ''),
          path: filePath,
          title: summary?.title,
          firstPrompt: summary?.firstPrompt,
          createdAt: summary?.createdAt,
        }
      })
    return currentEntry ? [currentEntry, ...archived] : archived
  }

  /** List immutable daily audit history files. */
  listHistory(): Array<{ name: string; path: string; source?: string; date?: string; firstPrompt?: string; createdAt?: string }> {
    const dir = this.sharedHistoryDir ?? this.historyDir
    return listJsonlFiles(dir)
      .filter((filePath) => !isSessionArchiveFile(filePath))
      .sort((a, b) => b.localeCompare(a))
      .map((filePath) => {
        const name = basename(filePath).replace('.jsonl', '')
        const match = name.match(/^(\d{4}-\d{2}-\d{2})_(\w+)/)
        return {
          name,
          path: filePath,
          source: match?.[2],
          date: match?.[1],
          firstPrompt: readFirstAuditUserMessage(filePath),
          createdAt: match?.[1],
        }
      })
  }

  /** Resume a session from history. */
  resume(filePath: string): { meta: SessionMeta | null; messages: Message[] } {
    if (filePath === this.filePath) {
      return this.load()
    }
    this.archive()
    if (existsSync(filePath)) {
      copyFileSync(filePath, this.filePath)
    }
    const loaded = this.load()
    if (loaded.meta?.id) this.id = loaded.meta.id
    return loaded
  }

  /** Fork a durable session into a new current session without modifying the source. */
  preload(filePath: string): { meta: SessionMeta; messages: Message[] } {
    const loaded = this._parseSessionFile(filePath)
    this.archive()
    this.save(loaded.messages)
    return {
      meta: { id: this.id, createdAt: new Date().toISOString() },
      messages: loaded.messages,
    }
  }

  /**
   * Fork the current session at a specific message index.
   * Creates a new session with messages up to (but not including) the fork point.
   * Returns the new session's messages for the caller to set.
   * Reference: opencode session fork
   */
  fork(atMessageIndex?: number): { meta: SessionMeta | null; messages: Message[] } {
    const { messages } = this.load()
    if (messages.length === 0) return { meta: null, messages: [] }

    // Fork at index (default: keep all messages)
    const forkIndex = atMessageIndex ?? messages.length
    const forkedMessages = messages.slice(0, forkIndex)

    // Archive the original working context after loading it, then write the
    // sliced context as the new resumable current session.
    this.archive()

    // Save forked messages as new session
    this.save(forkedMessages)
    return { meta: { id: this.id, createdAt: new Date().toISOString() }, messages: forkedMessages }
  }

  /**
   * Dual-write: append a turn's messages to today's history file.
   * File is named {date}_{source}.jsonl in the shared or local history dir.
   */
  appendToHistory(turnMessages: Message[], source: string = 'chat'): void {
    if (turnMessages.length === 0) return

    const dir = this.sharedHistoryDir ?? this.historyDir
    mkdirSync(dir, { recursive: true })

    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]
    const filePath = join(dir, `${dateStr}_${source}.jsonl`)

    const lines = turnMessages.map((msg) => JSON.stringify(summarizeForHistory(msg)))
    appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
  }
}

/** Remove orphaned tool_use and tool_result messages. */
function trimIncompleteToolUse(messages: Message[]): void {
  // Pass 1: collect all valid tool use IDs
  const allToolUseIds = new Set<string>()
  for (const msg of messages) {
    if (msg.toolUses) {
      for (const tu of msg.toolUses) allToolUseIds.add(tu.id)
    }
  }

  // Remove orphan tool_results
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].toolResult && !allToolUseIds.has(messages[i].toolResult!.toolUseId)) {
      messages.splice(i, 1)
    }
  }

  // Pass 2: remove assistant messages with incomplete tool_results
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role !== Role.Assistant || !msg.toolUses?.length) { i++; continue }
    const expected = msg.toolUses!.length
    let actual = 0
    for (let j = i + 1; j < messages.length && j <= i + expected; j++) {
      if (messages[j].toolResult) actual++
      else break
    }
    if (actual < expected) {
      messages.splice(i, 1 + actual)
    } else {
      i += 1 + actual
    }
  }
}

function wrapCompactSummary(summary: string): string {
  return 'This session is being continued from a previous conversation that ran ' +
    'out of context. Here is a summary of the conversation so far:\n\n' +
    summary + '\n\n' +
    'Continue the conversation from where it left off without asking the ' +
    'user any further questions. Resume directly with the task at hand.'
}

function generateSessionId(): string {
  const now = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  return `${now.toString(36)}-${random}`
}

function readSessionSummary(filePath: string): { id?: string; title?: string; firstPrompt?: string; createdAt?: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim())
    let id: string | undefined, title: string | undefined, firstPrompt: string | undefined, createdAt: string | undefined

    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        if (json.type === 'session_meta') {
          id = json.id; createdAt = json.createdAt
        } else if (json.type === 'title') {
          title = json.title
        } else if (json.type === 'message' && json.role === 'user' && !firstPrompt) {
          firstPrompt = json.content?.slice(0, 100)
        }
        if (id && title && firstPrompt) break
      } catch { /* skip */ }
    }
    return { id, title, firstPrompt, createdAt }
  } catch { return null }
}

function readCurrentSessionEntry(filePath: string): { id: string; name: string; path: string; title?: string; firstPrompt?: string; createdAt?: string; isCurrent: true } | null {
  if (!existsSync(filePath)) return null
  const summary = readSessionSummary(filePath)
  if (!summary?.title && !summary?.firstPrompt && !fileHasSessionMessages(filePath)) return null
  return {
    id: summary?.id ?? 'current',
    name: 'current',
    path: filePath,
    title: summary?.title ?? 'Current session',
    firstPrompt: summary?.firstPrompt,
    createdAt: summary?.createdAt,
    isCurrent: true,
  }
}

function fileHasSessionMessages(filePath: string): boolean {
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim())
    return lines.some((line) => {
      try {
        const json = JSON.parse(line)
        return json?.type === 'message'
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

function isSessionArchiveFile(filePath: string): boolean {
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n')
    const first = lines.find((line) => line.trim())
    if (!first) return false
    const json = JSON.parse(first)
    return json?.type === 'session_meta'
  } catch {
    return false
  }
}

function listJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(dir, name))
}

function readFirstAuditUserMessage(filePath: string): string | undefined {
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim())
    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        if (json.role === 'user' && typeof json.content === 'string' && json.content.trim()) {
          return json.content.trim().slice(0, 100)
        }
      } catch {
        // Skip malformed audit lines.
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Summarize a message for history (strip large tool results). */
function summarizeForHistory(msg: Message): Record<string, unknown> {
  const json: Record<string, unknown> = {
    role: msg.role,
    timestamp: msg.timestamp ?? new Date().toISOString(),
  }

  if (msg.role === Role.User) {
    json.content = msg.content
  } else if (msg.role === Role.Assistant) {
    json.content = msg.content
    if (msg.toolUses?.length) {
      json.toolUses = msg.toolUses.map((t) => ({
        name: t.name,
        input: summarizeToolInput(t.name, t.input),
      }))
    }
  } else if (msg.toolResult) {
    json.tool_result = {
      ...(msg.toolResult.isError ? { isError: true } : {}),
      content: msg.toolResult.content.length > 500 ? msg.toolResult.content.slice(0, 500) + '...[truncated]' : msg.toolResult.content,
    }
  }

  return json
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case 'Write': case 'FileWrite':
      return { file_path: input.file_path ?? input.path }
    case 'Edit': case 'FileEdit':
      return { file_path: input.file_path ?? input.path }
    case 'Read': case 'FileRead':
      return { file_path: input.file_path ?? input.path, ...(input.offset != null ? { offset: input.offset } : {}), ...(input.limit != null ? { limit: input.limit } : {}) }
    case 'UIControl':
      return { action: input.action }
    default: {
      const summarized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(input)) {
        summarized[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '...' : v
      }
      return summarized
    }
  }
}

function messageToEntry(msg: Message): SessionEntry {
  const entry: SessionEntry = {
    type: 'message',
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp ?? new Date().toISOString(),
  }
  if (msg.toolUses?.length) {
    entry.toolUses = msg.toolUses.map((tu) => ({ id: tu.id, name: tu.name, input: sanitizeToolInputForSession(tu.name, tu.input) }))
  }
  if (msg.toolResult) {
    entry.toolResult = {
      toolUseId: msg.toolResult.toolUseId,
      content: msg.toolResult.content.length > 5000 ? msg.toolResult.content.slice(0, 5000) + '\n...(truncated)' : msg.toolResult.content,
      isError: msg.toolResult.isError,
      ...(msg.toolResult.imagePaths?.length ? { imagePaths: msg.toolResult.imagePaths } : {}),
      ...(msg.toolResult.imageMetadata?.length ? { imageMetadata: msg.toolResult.imageMetadata } : {}),
    }
  }
  if (msg.isCompactSummary) entry.isCompactSummary = true
  if (msg.reasoning) entry.reasoning = msg.reasoning
  return entry
}

export function sanitizeToolInputForSession(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case 'Write':
    case 'FileWrite': {
      const content = typeof input.content === 'string' ? input.content : undefined
      return {
        file_path: input.file_path ?? input.path,
        ...(content != null ? summarizeContentField('content', content) : {}),
        ...(content == null && input.content_summary ? { content_summary: input.content_summary } : {}),
        ...(content == null && input.content_preview ? { content_preview: input.content_preview } : {}),
      }
    }
    case 'Edit':
    case 'FileEdit': {
      const oldString = typeof input.old_string === 'string' ? input.old_string : undefined
      const newString = typeof input.new_string === 'string' ? input.new_string : undefined
      return {
        file_path: input.file_path ?? input.path,
        replace_all: input.replace_all,
        ...(oldString != null ? summarizeContentField('old_string', oldString) : {}),
        ...(newString != null ? summarizeContentField('new_string', newString) : {}),
        ...(oldString == null && input.old_string_summary ? { old_string_summary: input.old_string_summary } : {}),
        ...(oldString == null && input.old_string_preview ? { old_string_preview: input.old_string_preview } : {}),
        ...(newString == null && input.new_string_summary ? { new_string_summary: input.new_string_summary } : {}),
        ...(newString == null && input.new_string_preview ? { new_string_preview: input.new_string_preview } : {}),
      }
    }
    default: {
      const summarized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(input)) {
        summarized[k] = typeof v === 'string' && v.length > 1000
          ? `${v.slice(0, 300)}\n...[${v.length} chars truncated for session hygiene]`
          : v
      }
      return summarized
    }
  }
}

function summarizeContentField(name: string, content: string): Record<string, unknown> {
  const byteLength = Buffer.byteLength(content, 'utf-8')
  const lineCount = content.length === 0 ? 0 : content.split('\n').length
  if (content.length <= 1000) return { [name]: content }
  return {
    [`${name}_summary`]: `[${content.length} chars, ${lineCount} lines, ${(byteLength / 1024).toFixed(1)}KB omitted from session; file_path identifies the artifact]`,
    [`${name}_preview`]: content.slice(0, 300),
  }
}

function entryToMessage(entry: SessionEntry): Message {
  const msg: Message = {
    role: entry.role as Role,
    content: (entry.content as string) ?? '',
    timestamp: entry.timestamp as string,
  }
  if (entry.toolUses) {
    msg.toolUses = (entry.toolUses as Array<{ id: string; name: string; input: Record<string, unknown> }>)
  }
  if (entry.toolResult) {
    const tr = entry.toolResult as {
      toolUseId: string
      content: string
      isError: boolean
      imagePaths?: string[]
      imageMetadata?: Array<{ path: string; mediaType?: string; width?: number; height?: number; sizeBytes?: number }>
    }
    msg.toolResult = {
      toolUseId: tr.toolUseId,
      content: tr.content,
      isError: tr.isError,
      imagePaths: tr.imagePaths,
      imageMetadata: tr.imageMetadata,
    }
  }
  if (entry.isCompactSummary) msg.isCompactSummary = true
  if (entry.reasoning) msg.reasoning = entry.reasoning as string
  return msg
}
