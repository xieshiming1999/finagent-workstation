import { Role, type Message } from './message'
import { shouldGenerateRecap, generateRecap } from './recap'
import type { Session } from './session'
import type { NotificationQueue } from './notification-queue'
import type { LLMProvider } from './llm-provider'
import type { SessionMemoryState } from './session-memory'

export function pushAndPersistMessage(messages: Message[], session: Session, msg: Message): void {
  messages.push(msg)
  session.appendMessage(msg)
}

export function appendTurnToHistory(session: Session, messages: Message[], turnMessageStartIndex: number, source = 'chat'): void {
  if (turnMessageStartIndex >= messages.length) return
  const turnMessages = messages.slice(turnMessageStartIndex)
  session.appendToHistory(turnMessages, source)
}

export function clearSessionState(
  session: Session,
  messages: Message[],
  resetState: {
    setMessages: (messages: Message[]) => void
    setUserTurnCount: (value: number) => void
    setToolCallCount: (value: number) => void
    setDoomLoopWarningCount: (value: number) => void
    setMaxTokensRecoveryCount: (value: number) => void
    setContextExceededRetried: (value: boolean) => void
    setSessionMemoryState: (value: SessionMemoryState) => void
  },
): void {
  session.archive()
  resetState.setMessages([])
  resetState.setUserTurnCount(0)
  resetState.setToolCallCount(0)
  resetState.setDoomLoopWarningCount(0)
  resetState.setMaxTokensRecoveryCount(0)
  resetState.setContextExceededRetried(false)
  resetState.setSessionMemoryState({
    lastSummarizedIndex: null,
    tokensAtLastExtraction: 0,
    initialized: false,
    extracting: false,
  })
}

export function restoreSessionState(session: Session, setMessages: (messages: Message[]) => void): void {
  const { meta, messages } = session.load()
  if (meta?.id) {
    session.id = meta.id
  }
  if (messages.length > 0) {
    setMessages(messages)
  }
}

export function scheduleRecapTimer(args: {
  existingTimer: ReturnType<typeof setTimeout> | null
  messages: Message[]
  llm: LLMProvider
  isRunning: () => boolean
  pushAndPersist: (msg: Message) => void
  onRecap: ((msg: Message) => void) | null
  setTimer: (timer: ReturnType<typeof setTimeout> | null) => void
}): void {
  if (args.existingTimer) clearTimeout(args.existingTimer)
  const timer = setTimeout(async () => {
    if (args.isRunning()) return
    if (!shouldGenerateRecap(args.messages)) return
    try {
      const text = await generateRecap(args.messages, args.llm.clone())
      if (!text || args.isRunning()) return
      const msg: Message = { role: Role.User, content: text, isRecap: true, timestamp: new Date().toISOString() }
      args.pushAndPersist(msg)
      args.onRecap?.(msg)
    } catch { /* ignore */ }
  }, 5 * 60 * 1000)
  args.setTimer(timer)
}

export function createDrainNotificationsRunner(
  notifications: NotificationQueue,
  pushAndPersist: (msg: Message) => void,
): AsyncGenerator<never, void, unknown> {
  async function* noop(): AsyncGenerator<never, void, unknown> {
    void notifications
    void pushAndPersist
  }
  return noop()
}
