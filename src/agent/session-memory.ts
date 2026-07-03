import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Message } from './message'
import { Role } from './message'
import { estimateMessageTokens, type CompactResult, createPostCompactFileAttachments } from './compact'
import { memoryLifecycleFrontmatter } from './memory-lifecycle'
import { isUsableSessionMemory, normalizeSessionMemoryContent } from './memory-quality'

const MIN_MESSAGE_TOKENS_TO_INIT = 10_000
const MIN_TOKENS_BETWEEN_UPDATE = 5_000
const TOOL_CALLS_BETWEEN_UPDATES = 3

const SM_COMPACT_MIN_TOKENS = 10_000
const SM_COMPACT_MIN_TEXT_MESSAGES = 5
const SM_COMPACT_MAX_TOKENS = 40_000

export interface SessionMemoryState {
  lastSummarizedIndex: number | null
  tokensAtLastExtraction: number
  initialized: boolean
  extracting: boolean
}

export function shouldExtractSessionMemory(
  messages: Message[],
  state: SessionMemoryState,
): boolean {
  if (state.extracting) return false

  const estimatedTokens = estimateMessageTokens(messages)
  if (!state.initialized) {
    if (estimatedTokens < MIN_MESSAGE_TOKENS_TO_INIT) return false
  }

  const tokenGrowth = estimatedTokens - state.tokensAtLastExtraction
  if (tokenGrowth < MIN_TOKENS_BETWEEN_UPDATE) return false

  const toolCallsSinceLast = countToolCallsSince(messages, state.lastSummarizedIndex)
  if (toolCallsSinceLast >= TOOL_CALLS_BETWEEN_UPDATES) return true

  if (toolCallsSinceLast === 0 && messages.length > 0) {
    const last = messages[messages.length - 1]
    return last.role === Role.Assistant && (!last.toolUses || last.toolUses.length === 0)
  }

  return false
}

function countToolCallsSince(messages: Message[], sinceIndex: number | null): number {
  const start = (sinceIndex ?? -1) + 1
  let count = 0
  for (let i = start; i < messages.length; i++) {
    count += messages[i].toolUses?.length ?? 0
  }
  return count
}

export function getSessionMemoryPath(sessionsDir: string, sessionId: string): string {
  return join(sessionsDir, sessionId, 'session-memory.md')
}

export function loadSessionMemory(basePath: string, sessionId: string): string {
  const sessionsDir = join(basePath, 'sessions')
  const path = getSessionMemoryPath(sessionsDir, sessionId)
  if (!existsSync(path)) return DEFAULT_SESSION_MEMORY_TEMPLATE
  return readFileSync(path, 'utf-8')
}

export function saveSessionMemory(basePath: string, sessionId: string, content: string): boolean {
  const normalized = normalizeSessionMemoryContent(content, {
    sessionId,
    extractedAt: new Date().toISOString(),
  })
  if (!normalized.accepted) return false

  const sessionsDir = join(basePath, 'sessions')
  const path = getSessionMemoryPath(sessionsDir, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, normalized.content, 'utf-8')
  return true
}

export function buildSessionMemoryPrompt(messages: Message[], existingContent: string | null): string {
  const existing = existingContent ?? DEFAULT_SESSION_MEMORY_TEMPLATE

  const conversationText = messages.map((m) => {
    const role = m.role.toUpperCase()
    let content = m.content
    if (m.toolUses?.length) {
      const toolNames = m.toolUses.map((t) => t.name).join(', ')
      content += `\n[Tool calls: ${toolNames}]`
    }
    if (m.toolResult) {
      content = `[Tool result: ${m.toolResult.content.length > 200 ? m.toolResult.content.slice(0, 200) + '...' : m.toolResult.content}]`
    }
    return `${role}: ${content}`
  }).join('\n\n')

  return `Here is the current session memory:

${existing}

---

Here is the conversation so far:

${conversationText}

---

Update the session memory to reflect the current state of the conversation.
Keep each section concise (under ~2000 tokens per section, ~12000 tokens total).
Preserve lifecycle frontmatter and section headers. Update content to reflect the latest state.
The final file must include non-placeholder content in Current State, Task Specification, and Worklog. Include provenance, source_session_id, extracted_at, and expires metadata in frontmatter when available.
If a section is not relevant, leave its description in italics.
Keep current task state in this session memory. Do not promote stable facts to durable memory or repeated workflow to skills from this update; that requires a separate reviewed memory/skill action.
Output the complete updated session memory file.`
}

/**
 * Try session memory compaction (free path, no LLM call needed).
 * Uses existing session memory as summary instead of calling LLM.
 * Returns CompactResult if successful, null if should fall back to traditional compact.
 * Matching finagent trySessionMemoryCompaction.
 */
export function trySessionMemoryCompaction(
  messages: Message[],
  state: SessionMemoryState,
  basePath: string,
  sessionId: string,
  readFileTimestamps: Map<string, number>,
  contextWindow: number,
  maxOutputTokens: number,
): CompactResult | null {
  if (!state.initialized || state.lastSummarizedIndex == null) return null

  const sessionsDir = join(basePath, 'sessions')
  const memoryPath = getSessionMemoryPath(sessionsDir, sessionId)
  if (!existsSync(memoryPath)) return null

  const memoryContent = readFileSync(memoryPath, 'utf-8').trim()
  if (!memoryContent || memoryContent === DEFAULT_SESSION_MEMORY_TEMPLATE) return null
  if (!isUsableSessionMemory(memoryContent)) return null

  if (state.lastSummarizedIndex >= messages.length) return null

  const keepIndex = calculateMessagesToKeepIndex(messages, state.lastSummarizedIndex)
  const messagesToKeep = messages.slice(keepIndex)

  const summaryContent =
    'This session is being continued from a previous conversation that ran ' +
    'out of context. The summary below covers the earlier portion of the conversation.\n\n' +
    memoryContent + '\n\n' +
    'Continue the conversation from where it left off without asking the ' +
    'user any further questions. Resume directly with the task at hand.'

  const summaryMessage: Message = {
    role: Role.User,
    content: summaryContent,
    isCompactSummary: true,
    timestamp: new Date().toISOString(),
  }

  const postCompactMessages = [summaryMessage, ...messagesToKeep]
  const postCompactTokens = estimateMessageTokens(postCompactMessages)
  const effectiveWindow = contextWindow - Math.min(maxOutputTokens, 20000)
  const threshold = effectiveWindow - 13_000

  if (postCompactTokens >= threshold) return null

  const fileAttachments = createPostCompactFileAttachments(readFileTimestamps, basePath)

  return {
    summary: memoryContent,
    summaryMessage,
    fileAttachments,
    preCompactMessageCount: messages.length,
  }
}

function calculateMessagesToKeepIndex(messages: Message[], lastSummarizedIndex: number): number {
  let startIndex = lastSummarizedIndex + 1
  if (startIndex >= messages.length) startIndex = messages.length

  let keepIndex = startIndex
  while (keepIndex > 0) {
    const kept = messages.slice(keepIndex)
    const tokens = estimateMessageTokens(kept)
    const textBlocks = kept.filter((m) => m.role === Role.User || m.role === Role.Assistant).length

    if (tokens >= SM_COMPACT_MAX_TOKENS) break
    if (tokens >= SM_COMPACT_MIN_TOKENS && textBlocks >= SM_COMPACT_MIN_TEXT_MESSAGES) break

    keepIndex--
    if (keepIndex >= 0 && messages[keepIndex].isCompactSummary) { keepIndex++; break }
  }

  // Don't split tool_use/tool_result pairs
  if (keepIndex > 0 && keepIndex < messages.length && messages[keepIndex].role === Role.Tool) {
    keepIndex--
  }

  return keepIndex
}

export const SESSION_MEMORY_SYSTEM_PROMPT =
  'You are a session memory manager. Your job is to maintain a structured ' +
  'summary of the current conversation session. Output ONLY the updated ' +
  'session memory file content. Do NOT call any tools.'

const DEFAULT_SESSION_MEMORY_TEMPLATE = `${memoryLifecycleFrontmatter('session')}## Session Title
*Auto-generated title for this conversation*

## Current State
*What the assistant is currently doing*

## Task Specification
*The user's original request and constraints*

## Files and Functions
*Key files and functions involved in this session*

## Workflow
*Steps taken so far*

## Errors & Corrections
*Errors encountered and how they were fixed*

## Key Results
*Important outputs and conclusions*

## Worklog
*Chronological log of actions taken*
`
