import type { Message } from './message'
import { Role } from './message'
import type { LLMProvider } from './llm-provider'
import { recapPromptCopy } from './runtime-copy'

const RECENT_MESSAGE_WINDOW = 30

function recapPrompt(): string {
  return recapPromptCopy()
}

export function shouldGenerateRecap(messages: Message[]): boolean {
  if (messages.length === 0) return false
  if ((messages[messages.length - 1] as any).isRecap) return false

  let userMsgsSinceLastRecap = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if ((m as any).isRecap) break
    if (m.role === Role.User && !m.isCompactSummary) userMsgsSinceLastRecap++
  }
  return userMsgsSinceLastRecap >= 20
}

export async function generateRecap(messages: Message[], llm: LLMProvider): Promise<string | null> {
  const recent = messages.length > RECENT_MESSAGE_WINDOW
    ? messages.slice(messages.length - RECENT_MESSAGE_WINDOW)
    : [...messages]

  recent.push({ role: Role.User, content: recapPrompt(), timestamp: new Date().toISOString() })

  const parts: string[] = []
  try {
    const stream = llm.sendMessage(
      'You are a session context summarizer.',
      recent,
      [],
    )
    for await (const ev of stream) {
      if (ev.type === 'text-delta') parts.push(ev.text)
    }
  } catch {
    return null
  }

  const result = parts.join('').trim()
  if (!result) return null
  return result.startsWith('[recap]') ? result : `[recap] ${result}`
}
