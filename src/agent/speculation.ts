import type { LLMProvider } from './llm-provider'
import type { Message } from './message'
import { Role } from './message'

/**
 * Speculation: predict what the user might type next.
 * Matching finagent speculation.dart.
 */

export interface SpeculationState {
  inProgress: boolean
  lastSuggestion: string | null
  turnsSinceLastCheck: number
}

export function createSpeculationState(): SpeculationState {
  return { inProgress: false, lastSuggestion: null, turnsSinceLastCheck: 0 }
}

const SPECULATION_PROMPT = `Based on the conversation so far, predict what the user might ask or want to do next.
Provide exactly ONE concise suggestion (1 sentence, in the user's language).
If the conversation doesn't suggest a clear next step, respond with "NO_SUGGESTION".`

export async function hookSpeculation(opts: {
  messages: Message[]
  llm: LLMProvider
  state: SpeculationState
  onSuggestion?: (suggestion: string) => void
}): Promise<void> {
  const { messages, llm, state, onSuggestion } = opts
  if (state.inProgress) return
  if (!onSuggestion) return

  state.turnsSinceLastCheck++
  if (state.turnsSinceLastCheck < 10) return
  state.turnsSinceLastCheck = 0

  if (messages.length < 2) return

  state.inProgress = true
  try {
    const recent = messages.slice(-10)
    recent.push({ role: Role.User, content: SPECULATION_PROMPT, timestamp: new Date().toISOString() })

    const parts: string[] = []
    const stream = llm.sendMessage(
      'You are a conversation flow predictor.',
      recent,
      [],
    )
    for await (const ev of stream) {
      if (ev.type === 'text-delta') parts.push(ev.text)
    }
    const result = parts.join('').trim()
    if (result && !result.includes('NO_SUGGESTION')) {
      state.lastSuggestion = result
      onSuggestion(result)
    }
  } catch { /* */ } finally {
    state.inProgress = false
  }
}
