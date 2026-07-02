import type { Message } from './message'
import { Role } from './message'

const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const POST_COMPACT_MAX_FILES = 5
const POST_COMPACT_TOKEN_BUDGET = 50_000
const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

export function estimateMessageTokens(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.content)
    if (msg.reasoning) total += estimateTokens(msg.reasoning)
    if (msg.toolUses) {
      for (const tu of msg.toolUses) {
        total += estimateTokens(tu.name) + estimateTokens(JSON.stringify(tu.input))
      }
    }
    if (msg.toolResult) {
      total += estimateTokens(msg.toolResult.content)
    }
  }
  return total
}

export function shouldAutoCompact(messages: Message[], contextWindow: number, maxOutputTokens = 16384, lastPromptTokens = 0, lastPromptMsgCount = 0): boolean {
  const effectiveWindow = contextWindow - Math.min(maxOutputTokens, 20000)
  const threshold = effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS
  let currentTokens: number
  if (lastPromptTokens > 0 && lastPromptMsgCount > 0) {
    const newMsgs = messages.length > lastPromptMsgCount ? messages.slice(lastPromptMsgCount) : []
    currentTokens = lastPromptTokens + estimateMessageTokens(newMsgs)
  } else {
    currentTokens = estimateMessageTokens(messages)
  }
  return currentTokens > threshold
}

export function microCompact(messages: Message[], preserveRecentTurns = 6): Message[] {
  if (messages.length < preserveRecentTurns * 2) return messages

  let recentTurnCount = 0
  let keepFromIndex = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === Role.User || msg.role === Role.Assistant) {
      recentTurnCount++
      if (recentTurnCount >= preserveRecentTurns) {
        keepFromIndex = i
        break
      }
    }
  }

  return messages.map((msg, i) => {
    if (i >= keepFromIndex) return msg

    if (msg.role === Role.Tool && msg.toolResult) {
      const content = msg.toolResult.content
      if (content.length > 500) {
        return {
          ...msg,
          toolResult: {
            ...msg.toolResult,
            content: `[Tool result truncated, was ${content.length} chars]`,
          },
        }
      }
    }

    if (msg.role === Role.Assistant && msg.toolUses) {
      const truncatedUses = msg.toolUses.map((tu) => {
        const inputStr = JSON.stringify(tu.input)
        if (inputStr.length > 1000) {
          return { ...tu, input: { _truncated: true, summary: inputStr.slice(0, 200) + '...' } }
        }
        return tu
      })
      return { ...msg, toolUses: truncatedUses }
    }

    return msg
  })
}

/**
 * Prune large tool results from the middle of conversation before compact.
 * Keeps head (first 3) and tail (last 5) messages intact.
 * Matching finagent _pruneOldToolResults.
 */
export function pruneOldToolResults(messages: Message[], tailKeep = 5): Message[] {
  if (messages.length <= tailKeep + 3) return messages
  const headKeep = 3
  const tailStart = messages.length - tailKeep

  return messages.map((msg, i) => {
    if (i < headKeep || i >= tailStart) return msg
    if (msg.role === Role.Tool && msg.toolResult && msg.toolResult.content.length > 200) {
      return {
        ...msg,
        toolResult: { ...msg.toolResult, content: '[Old tool output cleared to save context space]' },
      }
    }
    return msg
  })
}

export interface CompactResult {
  summary: string
  summaryMessage: Message
  fileAttachments: Message[]
  preCompactMessageCount: number
}

/**
 * Build the compact prompt matching finagent's structured format.
 * Uses <analysis> + <summary> XML blocks.
 */
export function buildCompactPrompt(messages: Message[], customInstructions?: string): string {
  const parts: string[] = [
    'Please summarize this conversation following the structure below. '
    + 'First produce an <analysis> block (your drafting scratchpad, will be '
    + 'discarded), then a <summary> block with the final summary.',
  ]

  // Include previous summary for iterative update
  const previousSummary = extractPreviousSummary(messages)
  if (previousSummary) {
    parts.push('')
    parts.push("Previous summary to update (incorporate new information, don't lose important details):")
    parts.push(previousSummary)
  }

  if (customInstructions) {
    parts.push('')
    parts.push(`Additional instructions: ${customInstructions}`)
  }

  return parts.join('\n')
}

/**
 * Extract previous compact summary from messages (if conversation was already compacted).
 */
function extractPreviousSummary(messages: Message[]): string | null {
  if (messages.length === 0) return null
  const first = messages[0]
  if (!first.isCompactSummary) return null
  return first.content
}

/**
 * Format the raw LLM output: strip <analysis>, extract <summary>.
 * Matching finagent formatCompactSummary.
 */
export function formatCompactSummary(rawSummary: string): string {
  let result = rawSummary
  result = result.replace(/<analysis>[\s\S]*?<\/analysis>/g, '').trim()
  const summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) result = summaryMatch[1].trim()
  return result
}

/**
 * Apply compaction: replace all messages with summary + preserved recent + file attachments.
 */
export function applyCompaction(messages: Message[], summary: string, preserveCount = 10): Message[] {
  const preserved = messages.slice(-preserveCount)
  const compactMessage: Message = {
    role: Role.User,
    content: wrapSummaryMessage(summary),
    isCompactSummary: true,
    timestamp: new Date().toISOString(),
  }
  return [compactMessage, ...preserved]
}

/**
 * Build post-compact message list from CompactResult.
 */
export function buildPostCompactMessages(result: CompactResult): Message[] {
  return [result.summaryMessage, ...result.fileAttachments]
}

/**
 * Create file restoration attachments after compaction.
 * Reads most recently accessed files from readFileTimestamps.
 * Matching finagent createPostCompactFileAttachments.
 */
export function createPostCompactFileAttachments(readFileTimestamps: Map<string, number>, basePath: string): Message[] {
  if (readFileTimestamps.size === 0) return []

  const { existsSync, readFileSync } = require('fs')
  const { relative } = require('path')

  const sorted = Array.from(readFileTimestamps.entries()).sort((a, b) => b[1] - a[1])
  const attachments: Message[] = []
  let totalTokens = 0

  for (const [filePath] of sorted.slice(0, POST_COMPACT_MAX_FILES)) {
    if (totalTokens >= POST_COMPACT_TOKEN_BUDGET) break
    try {
      if (!existsSync(filePath)) continue
      let content = readFileSync(filePath, 'utf-8') as string
      const maxChars = POST_COMPACT_MAX_TOKENS_PER_FILE * 3
      if (content.length > maxChars) content = content.slice(0, maxChars) + '\n... (truncated)'

      const relativePath = relative(basePath, filePath)
      attachments.push({
        role: Role.User,
        content: `[File restored after compaction: ${relativePath}]\n\n${content}`,
        timestamp: new Date().toISOString(),
      })
      totalTokens += Math.ceil(content.length / 3)
    } catch { continue }
  }

  return attachments
}

function wrapSummaryMessage(summary: string, suppressFollowUp = false): string {
  let result = 'This session is being continued from a previous conversation that ran '
    + 'out of context. The summary below covers the earlier portion of the conversation.\n\n'
    + summary

  if (suppressFollowUp) {
    result += '\n\nContinue the conversation from where it left off without asking the '
      + 'user any further questions. Resume directly with the task at hand.'
  }

  return result
}

/**
 * Compact system prompt — dedicated system prompt for the summarizer LLM call.
 * Matching finagent compactSystemPrompt.
 */
export const COMPACT_SYSTEM_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations.

Respond with TEXT ONLY. Do NOT call any tools.

Produce your response in two XML blocks:

1. <analysis> — Your drafting scratchpad. Think through what matters. This will be discarded.

2. <summary> — The final structured summary with these sections:

## Goal
What is the user trying to accomplish? What is the overall objective and constraints?

## Progress
What has been completed so far? Key milestones and their status.

## Key Decisions
Important decisions made, approaches chosen, and reasoning.

## Relevant Files
Files viewed, edited, or created. Include brief code snippets for critical sections.

## Errors and Fixes
Any errors encountered and how they were resolved.

## All User Messages
Reproduce ALL user messages verbatim or near-verbatim. User feedback and preferences must be preserved.

## Pending Tasks
Tasks mentioned but not completed, with their current status.

## Current Work
What was being worked on most recently? Include file names and specific code if applicable.

## Next Steps
If the conversation ended mid-task, what should happen next? Include direct quotes from the user's last request if relevant.

## Critical Context
Any non-obvious constraints, preferences, or context that would be lost without this summary.

Remember: Respond with TEXT ONLY. Do NOT call any tools.`
