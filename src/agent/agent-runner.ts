import type { AgentEvent } from './agent-event'
import type { PostTurnHookRegistry, HookContext } from './post-turn-hooks'
import type { Message } from './message'

interface RunAgentTurnArgs {
  isRunning: () => boolean
  isCancelled: () => boolean
  setRunning: (value: boolean) => void
  setCancelled: (value: boolean) => void
  setCurrentPrompt: (value: string | null) => void
  setCurrentBackgroundTaskId: (value: string | null) => void
  incrementUserTurnCount: () => void
  resetBudget: () => void
  resetContextScrubber: () => void
  resetToolGuardrail: () => void
  clearRecentToolCalls: () => void
  setDoomLoopWarningCount: (value: number) => void
  setTurnStartTime: (value: number) => void
  setTurnToolCallCount: (value: number) => void
  setTurnPromptTokens: (value: number) => void
  setTurnCompletionTokens: (value: number) => void
  setTurnMessageStartIndex: (value: number) => void
  messages: Message[]
  currentBackgroundTaskId: () => string | null
  currentPrompt: () => string | null
  taskRegistryUpdateStatus: (taskId: string, status: string, payload: Record<string, unknown>) => void
  scheduleRecap: () => void
  shouldPumpNotifications: () => boolean
  pumpAsync: () => void
  handleSlashCommand: (name: string, args: string) => AsyncGenerator<AgentEvent>
  parseSlashCommand: (prompt: string) => { name: string; args: string } | null
  adaptAndPersistUserMessage: (prompt: string, opts?: { images?: Array<{ data: string; mediaType?: string }> }) => void
  agentLoop: () => AsyncGenerator<AgentEvent>
  appendTurnToHistory: () => void
  runPostTurnHooks: () => Promise<AgentEvent[]>
}

export async function* runAgentTurn(args: RunAgentTurnArgs, prompt: string, opts?: { images?: Array<{ data: string; mediaType?: string }> }): AsyncGenerator<AgentEvent> {
  if (args.isRunning()) return
  args.setRunning(true)
  args.setCancelled(false)
  args.setCurrentPrompt(prompt)
  args.setCurrentBackgroundTaskId(null)
  args.incrementUserTurnCount()
  args.resetBudget()
  args.resetContextScrubber()
  args.resetToolGuardrail()
  args.clearRecentToolCalls()
  args.setDoomLoopWarningCount(0)
  args.setTurnStartTime(Date.now())
  args.setTurnToolCallCount(0)
  args.setTurnPromptTokens(0)
  args.setTurnCompletionTokens(0)
  args.setTurnMessageStartIndex(args.messages.length)

  for (const msg of args.messages) {
    msg.reasoning = undefined
  }

  const parsed = args.parseSlashCommand(prompt)
  if (parsed) {
    yield* args.handleSlashCommand(parsed.name, parsed.args)
    return
  }

  args.adaptAndPersistUserMessage(prompt, opts)

  const turnOutputParts: string[] = []
  let turnError: string | null = null
  try {
    for await (const ev of args.agentLoop()) {
      if (ev.type === 'text-delta') turnOutputParts.push(ev.text)
      if (ev.type === 'error') turnError = ev.message
      yield ev
    }

    args.appendTurnToHistory()
    const postTurnEvents = await args.runPostTurnHooks()
    for (const ev of postTurnEvents) yield ev
  } finally {
    const backgroundTaskId = args.currentBackgroundTaskId()
    if (backgroundTaskId) {
      if (args.isCancelled()) {
        args.taskRegistryUpdateStatus(backgroundTaskId, 'killed', { error: 'Cancelled by user' })
      } else if (turnError) {
        args.taskRegistryUpdateStatus(backgroundTaskId, 'failed', { error: turnError })
      } else {
        args.taskRegistryUpdateStatus(backgroundTaskId, 'completed', {
          result: turnOutputParts.join('') || 'Backgrounded turn completed.',
        })
      }
    }
    args.setRunning(false)
    args.setCurrentPrompt(null)
    args.setCurrentBackgroundTaskId(null)
    args.scheduleRecap()
    if (args.shouldPumpNotifications()) {
      setTimeout(() => args.pumpAsync(), 0)
    }
    yield { type: 'done' }
  }
}

export async function runPostTurnHooks(
  hooks: PostTurnHookRegistry,
  basePath: string,
  messages: Message[],
  userTurnCount: number,
  toolCallCount: number,
  pendingPostTurnEvents: AgentEvent[],
): Promise<AgentEvent[]> {
  const context: HookContext = {
    basePath,
    messageCount: messages.length,
    userTurnCount,
    toolCallCount,
    lastToolNames: messages
      .filter((m) => m.toolUses)
      .slice(-3)
      .flatMap((m) => m.toolUses!.map((t) => t.name)),
    timeSinceLastHook: 0,
  }
  await hooks.runAll(context)
  return pendingPostTurnEvents.splice(0)
}
