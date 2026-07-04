import type { ChatMessage } from './useAgentStore'
import { summarizeToolInput } from './toolSummary'
import { t } from './useLanguageStore'

export interface SerializedSessionMessage {
  role?: string
  content?: string
  isRecap?: boolean
  toolUses?: Array<{ name?: string; input?: Record<string, unknown> }>
  toolResult?: { content?: string; isError?: boolean }
}

export function restoreChatMessages(
  msgs: SerializedSessionMessage[] | null | undefined,
  opts: { includeToolResults?: boolean } = {},
): ChatMessage[] {
  if (!msgs?.length) return []

  const restored: ChatMessage[] = []
  for (const m of msgs) {
    if (m.isRecap) {
      const content = String(m.content ?? '').startsWith('[recap]')
        ? String(m.content ?? '')
        : `[recap] ${String(m.content ?? '')}`
      restored.push({ role: 'assistant', content, isRecap: true, timestamp: Date.now() })
    } else if (m.role === 'user') {
      restored.push({ role: 'user', content: String(m.content ?? ''), timestamp: Date.now() })
    }

    if (m.role === 'assistant' && m.content) {
      restored.push({ role: 'assistant', content: m.content, timestamp: Date.now() })
    }

    for (const tu of m.toolUses ?? []) {
      const inputSummary = summarizeToolInput(tu.name, tu.input)
      restored.push({
        role: 'tool-use',
        content: `${tu.name ?? t('toolFallback')}(${inputSummary})`,
        toolName: tu.name,
        toolStatus: 'ok',
        timestamp: Date.now(),
      })
    }

    if (opts.includeToolResults && m.toolResult?.content) {
      restored.push({
        role: 'tool-result',
        content: m.toolResult.content,
        isError: Boolean(m.toolResult.isError),
        timestamp: Date.now(),
      })
    }
  }

  return restored
}
