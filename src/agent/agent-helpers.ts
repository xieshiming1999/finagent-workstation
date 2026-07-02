import type { Message } from './message'
import { Role } from './message'

export function trimIncompleteToolUse(messages: Message[]): Message[] {
  const allToolUseIds = new Set<string>()
  for (const msg of messages) {
    if (msg.toolUses) {
      for (const tu of msg.toolUses) allToolUseIds.add(tu.id)
    }
  }
  let result = messages.filter((msg) => {
    if (msg.toolResult && !allToolUseIds.has(msg.toolResult.toolUseId)) return false
    return true
  })

  let i = 0
  while (i < result.length) {
    const msg = result[i]
    if (msg.role === Role.Assistant && msg.toolUses?.length) {
      const nextResults = new Set<string>()
      for (let j = i + 1; j < result.length && result[j].role === Role.Tool; j++) {
        if (result[j].toolResult) nextResults.add(result[j].toolResult!.toolUseId)
      }
      const missing = msg.toolUses.filter((tu) => !nextResults.has(tu.id))
      if (missing.length > 0 && i === result.length - 1) {
        result = result.slice(0, i)
        break
      }
    }
    i++
  }
  return result
}

export function stripOldImages(messages: Message[], keepTurns = 3): void {
  let userTurnCount = 0
  let cutoffIdx = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === Role.User && !messages[i].isCompactSummary) {
      userTurnCount++
      if (userTurnCount >= keepTurns) { cutoffIdx = i; break }
    }
  }
  for (let i = 0; i < cutoffIdx; i++) {
    const msg = messages[i]
    if (msg.contentParts?.some((p) => p.type === 'image')) {
      const imageCount = msg.contentParts.filter((p) => p.type === 'image').length
      messages[i] = {
        ...msg,
        contentParts: msg.contentParts.filter((p) => p.type !== 'image'),
        content: (msg.content || '') + `\n[${imageCount} image(s) removed from context]`,
      }
    }
  }
}

export function enforceImageBudget(messages: Message[], maxBytes = 8 * 1024 * 1024): void {
  let totalBytes = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.contentParts) {
      const imageSize = msg.contentParts
        .filter((p) => p.type === 'image')
        .reduce((sum, p) => sum + ((p as any).data?.length || 0), 0)
      if (totalBytes + imageSize > maxBytes) {
        messages[i] = {
          ...msg,
          contentParts: msg.contentParts.filter((p) => p.type !== 'image'),
          content: (msg.content || '') + '\n[Images removed: budget exceeded]',
        }
      } else {
        totalBytes += imageSize
      }
    }
  }
}

export function detectDoomLoop(recentToolCalls: string[], warningCount: number): { result: 'warn' | 'stop' | false; newWarningCount: number } {
  if (recentToolCalls.length < 6) return { result: false, newWarningCount: warningCount }

  const last = recentToolCalls[recentToolCalls.length - 1]
  let sameCount = 0
  for (let i = recentToolCalls.length - 1; i >= 0 && recentToolCalls[i] === last; i--) sameCount++

  if (sameCount >= 3) {
    const newCount = warningCount + 1
    if (isCaptureCall(last) && newCount >= 3) {
      return { result: 'stop', newWarningCount: newCount }
    }
    return { result: 'warn', newWarningCount: newCount }
  }

  if (recentToolCalls.length >= 6) {
    const a = recentToolCalls[recentToolCalls.length - 2], b = recentToolCalls[recentToolCalls.length - 1]
    if (a !== b) {
      let pairs = 0
      for (let i = recentToolCalls.length - 2; i >= 1; i -= 2) {
        if (recentToolCalls[i] === b && recentToolCalls[i - 1] === a) pairs++
        else break
      }
      if (pairs >= 3) {
        const newCount = warningCount + 1
        if ((isCaptureCall(a) || isCaptureCall(b)) && newCount >= 3) {
          return { result: 'stop', newWarningCount: newCount }
        }
        return { result: 'warn', newWarningCount: newCount }
      }
    }
  }

  return { result: false, newWarningCount: warningCount }
}

function isCaptureCall(call: string): boolean {
  return call.startsWith('Screenshot:') ||
    (call.startsWith('WebView:') && call.includes('"action":"screenshot"'))
}

export function buildDefaultPrompt(): string {
  return [
    'You are a helpful AI assistant. You have access to tools that let you read, write, and search files.',
    '',
    '# Rules',
    '- Use tools to accomplish tasks. Do not just describe what you would do.',
    '- Read files before modifying them.',
    '- Be concise in responses.',
    '- If a task is unclear, ask for clarification.',
  ].join('\n')
}

export function loadApprovedToolsFromDisk(basePath: string): Set<string> {
  const { existsSync, readFileSync } = require('fs')
  const { join } = require('path')
  const file = join(basePath, 'approved_tools.json')
  if (!existsSync(file)) return new Set()
  try {
    return new Set(JSON.parse(readFileSync(file, 'utf-8')))
  } catch { return new Set() }
}

export function saveApprovedToolsToDisk(basePath: string, tools: Set<string>): void {
  const { writeFileSync, mkdirSync, existsSync } = require('fs')
  const { join } = require('path')
  const file = join(basePath, 'approved_tools.json')
  const dir = join(basePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify([...tools], null, 2), 'utf-8')
}
