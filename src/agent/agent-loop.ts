import type { AgentEvent } from './agent-event'
import { estimateMessageTokens } from './compact'
import { executeToolCalls, type ToolExecutionResult } from './agent-tool-execution'
import { assistantMessage, Role, toolMessage, userMessage, type Message, type ToolUse } from './message'
import { sanitizeToolInputForSession } from './session'
import type { Tool, ToolContext, ToolRegistry } from './tool'
import type { LLMProvider } from './llm-provider'
import type { NotificationQueue } from './notification-queue'
import type { TaskRegistry } from './background-task'
import type { DomainWorkflowHooks } from './domain-workflow-hooks'

interface AgentLoopArgs {
  getCancelled: () => boolean
  iterationLimit: number
  budgetExhausted: () => boolean
  budgetUsed: () => number
  notifications: NotificationQueue
  shouldDrainNotificationsInLoop: boolean
  drainNotifications: () => AsyncGenerator<AgentEvent>
  taskRegistry: TaskRegistry
  pushAndPersist: (msg: Message) => void
  detectDoomLoop: () => 'warn' | 'stop' | false
  recentToolCalls: string[]
  tryCompact: () => Promise<{ compacted: boolean; preCount: number; postCount: number }>
  messages: Message[]
  setMessages: (messages: Message[]) => void
  drainContextHints: () => string | null
  contextScrubber: { scrub: (text: string) => string }
  llm: LLMProvider
  systemPrompt: string
  tools: ToolRegistry
  contextWindow: number
  setLastPromptTokens: (value: number) => void
  setLastPromptMsgCount: (value: number) => void
  addTurnPromptTokens: (value: number) => void
  addTurnCompletionTokens: (value: number) => void
  recordGoalUsage: (promptTokens: number, completionTokens: number) => void
  turnStartTime: number
  getTurnToolCallCount: () => number
  contextExceededRetried: boolean
  setContextExceededRetried: (value: boolean) => void
  maxTokensRecoveryCount: number
  maxTokensRecoveryLimit: number
  setMaxTokensRecoveryCount: (value: number) => void
  toolContext: ToolContext
  permissionDecision: (tool: Tool, input: Record<string, unknown>) => 'allow' | 'deny' | 'ask'
  waitForPermissionConfirmation: (requestId: string) => Promise<{ approved: boolean; alwaysAllow?: boolean; rejectReason?: string }>
  approveToolPermanently: (toolName: string) => void
  executeToolCall: (tc: ToolUse, tool: Tool, ctx: ToolContext) => Promise<ToolExecutionResult>
  domainWorkflowHooks: DomainWorkflowHooks
}

export async function* runAgentLoop(args: AgentLoopArgs, depth = 0): AsyncGenerator<AgentEvent> {
  if (args.getCancelled()) return
  if (args.iterationLimit > 0 && depth > args.iterationLimit) {
    yield { type: 'error', message: `Agent depth limit exceeded (${args.iterationLimit}). Use a new message to continue, or set Agent > Depth Limit to 0 to disable this cap.` }
    return
  }

  if (args.budgetExhausted()) {
    yield { type: 'error', message: `Iteration budget exhausted (${args.budgetUsed()} iterations). Use a new message to continue, or set Agent > Depth Limit to 0 to disable this cap.` }
    return
  }

  if (args.shouldDrainNotificationsInLoop && args.notifications.isNotEmpty) {
    yield* args.drainNotifications()
  }

  const completedTasks = args.taskRegistry.getCompletedUnnotified()
  for (const task of completedTasks) {
    const notification = userMessage(
      `<task-notification>\n<task_id>${task.id}</task_id>\n<status>${task.status}</status>\n<description>${task.description}</description>\n<result>${task.result ?? 'No result'}</result>\n</task-notification>`
    )
    args.pushAndPersist(notification)
    args.taskRegistry.markNotified(task.id)
  }

  const doomLoop = args.detectDoomLoop()
  if (doomLoop === 'stop') {
    yield { type: 'error', message: 'Agent stuck in a loop — same tool calls repeating. Stopping.' }
    return
  }
  if (doomLoop === 'warn') {
    const lastCall = args.recentToolCalls[args.recentToolCalls.length - 1]
    const toolName = lastCall?.split(':')[0] ?? 'unknown'
    args.pushAndPersist(toolMessage(
      `warn-${Date.now()}`,
      `Warning: You have called "${toolName}" multiple times with identical arguments. This appears to be a loop. Try a different approach or different parameters.`,
      true,
    ))
  }

  const compactResult = await args.tryCompact()
  if (compactResult.compacted) {
    yield { type: 'compacted', preCount: compactResult.preCount, postCount: compactResult.postCount }
  }

  const hints = args.drainContextHints()
  if (hints && args.messages.length > 0) {
    let lastUserIdx = -1
    for (let i = args.messages.length - 1; i >= 0; i--) {
      if (args.messages[i].role === Role.User) { lastUserIdx = i; break }
    }
    if (lastUserIdx >= 0) {
      const nextMessages = [...args.messages]
      nextMessages[lastUserIdx] = {
        ...nextMessages[lastUserIdx],
        content: `${nextMessages[lastUserIdx].content}\n\n${hints}`,
      }
      args.setMessages(nextMessages)
    }
  }

  const preflightEvidenceSearches = args.domainWorkflowHooks.buildPreflightToolCalls(args.messages)
  if (preflightEvidenceSearches) {
    yield { type: 'stream-start' }
    args.pushAndPersist(assistantMessage('', preflightEvidenceSearches))
    yield* executeToolCalls({
      toolCalls: preflightEvidenceSearches,
      tools: args.tools,
      ctx: args.toolContext,
      isCancelled: args.getCancelled,
      permissionDecision: args.permissionDecision,
      waitForPermissionConfirmation: args.waitForPermissionConfirmation,
      approveToolPermanently: args.approveToolPermanently,
      executeToolCall: args.executeToolCall,
      pushAndPersist: args.pushAndPersist,
    })
    if (args.getCancelled()) {
      yield { type: 'cancelled', reason: 'user' }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }
    const answer = args.domainWorkflowHooks.maybeBuildPreflightAnswer(args.messages)
    if (answer) {
      args.pushAndPersist(assistantMessage(answer))
      yield { type: 'text-delta', text: answer }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }
  }

  yield { type: 'stream-start' }

  const textBuffer: string[] = []
  const reasoningBuffer: string[] = []
  const toolCalls: ToolUse[] = []
  let finishReason: string | undefined

  const stream = args.llm.sendMessage(
    args.systemPrompt,
    args.messages.filter((m) => m.content || m.toolUses?.length || m.toolResult),
    args.tools.toOpenAI(),
  )

  for await (const ev of stream) {
    if (args.getCancelled()) break

    switch (ev.type) {
      case 'text-delta':
        textBuffer.push(ev.text)
        {
          const scrubbed = args.contextScrubber.scrub(ev.text)
          if (scrubbed) yield { type: 'text-delta', text: scrubbed }
        }
        break
      case 'thinking-delta':
        reasoningBuffer.push(ev.text)
        yield { type: 'thinking', text: ev.text }
        break
      case 'tool-call-start':
        yield { type: 'tool-call-streaming', name: ev.name }
        break
      case 'tool-call-delta':
        yield { type: 'tool-call-delta', name: ev.name, chars: ev.text.length }
        break
      case 'tool-call':
        toolCalls.push({ id: ev.id, name: ev.name, input: ev.arguments })
        break
      case 'usage':
        args.setLastPromptTokens(ev.promptTokens)
        args.setLastPromptMsgCount(args.messages.length)
        args.addTurnPromptTokens(ev.promptTokens)
        args.addTurnCompletionTokens(ev.completionTokens)
        args.recordGoalUsage(ev.promptTokens, ev.completionTokens)
        console.log('[ContextTrace:agent]', {
          source: 'usage',
          promptTokens: ev.promptTokens,
          completionTokens: ev.completionTokens,
          contextWindow: args.contextWindow,
          messageCount: args.messages.length,
          estimatedMessageTokens: estimateMessageTokens(args.messages),
        })
        yield { type: 'usage', promptTokens: ev.promptTokens, completionTokens: ev.completionTokens, contextWindow: args.contextWindow }
        break
      case 'done':
        finishReason = ev.finishReason
        break
      case 'error':
        yield { type: 'error', message: ev.message }
        return
    }
  }

  if (args.getCancelled()) {
    yield { type: 'cancelled', reason: 'user' }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }

  let text = textBuffer.join('')

  if (finishReason === 'refusal') {
    if (!text) yield { type: 'text-delta', text: '[Request refused by the model.]' }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }

  if (finishReason === 'context_exceeded') {
    if (args.contextExceededRetried) {
      yield { type: 'error', message: 'Context window still full after compaction.' }
      return
    }
    args.setContextExceededRetried(true)
    yield { type: 'text-delta', text: '\n[Context window full — compacting...]\n' }
    const cr = await args.tryCompact()
    if (cr.compacted) yield { type: 'compacted', preCount: cr.preCount, postCount: cr.postCount }
    yield* runAgentLoop(args, depth + 1)
    return
  }

  if (finishReason === 'length') {
    const nextRecoveryCount = args.maxTokensRecoveryCount + 1
    args.setMaxTokensRecoveryCount(nextRecoveryCount)
    if (nextRecoveryCount > args.maxTokensRecoveryLimit) {
      yield { type: 'error', message: `Output repeatedly truncated after ${args.maxTokensRecoveryLimit} recovery attempts.` }
      return
    }
    if (text) {
      const lastMsg = args.messages[args.messages.length - 1]
      if (lastMsg.role === Role.Assistant) {
        lastMsg.content = text
        lastMsg.toolUses = undefined
      }
    }
    args.messages.push(assistantMessage(''))
    yield* runAgentLoop(args, depth + 1)
    return
  }

  args.setMaxTokensRecoveryCount(0)
  args.setContextExceededRetried(false)

  const reasoning = reasoningBuffer.join('') || undefined
  if (toolCalls.length === 0) {
    const requiredEvidenceSearches = args.domainWorkflowHooks.buildPreflightToolCalls(args.messages)
    if (requiredEvidenceSearches) {
      text = ''
      toolCalls.push(...requiredEvidenceSearches)
    }
  }

  if (toolCalls.length === 0) {
    const boundedAnswerBeforeFinalText = args.domainWorkflowHooks.maybeBuildBoundedAnswer(args.messages)
    if (boundedAnswerBeforeFinalText) {
      const msg = assistantMessage(boundedAnswerBeforeFinalText)
      args.pushAndPersist(msg)
      yield { type: 'text-delta', text: boundedAnswerBeforeFinalText }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }
  }

  let autoAnswerProbe: ToolUse[] | undefined
  if (toolCalls.length > 0) {
    const boundedAnswerBeforePersistedTools = args.domainWorkflowHooks.maybeBuildBoundedAnswer(args.messages)
    if (boundedAnswerBeforePersistedTools) {
      const msg = assistantMessage(boundedAnswerBeforePersistedTools)
      args.pushAndPersist(msg)
      yield { type: 'text-delta', text: boundedAnswerBeforePersistedTools }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }

    const prePersistInterception = args.domainWorkflowHooks.maybeInterceptToolCalls(args.messages, toolCalls)
    if (prePersistInterception) {
      if (prePersistInterception.answer) {
        const msg = assistantMessage(prePersistInterception.answer)
        args.pushAndPersist(msg)
        yield { type: 'text-delta', text: prePersistInterception.answer }
        yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
        return
      }
      if (prePersistInterception.autoToolCalls) {
        toolCalls.splice(0, toolCalls.length, ...prePersistInterception.autoToolCalls)
        autoAnswerProbe = prePersistInterception.autoAnswerProbe
        text = ''
      }
    }
  }

  const assistantMsg: Message = {
    role: Role.Assistant,
    content: text,
    toolUses: toolCalls.length > 0 ? toolCalls.map((tc) => ({
      ...tc,
      input: sanitizeToolInputForSession(tc.name, tc.input),
    })) : undefined,
    reasoning,
    timestamp: new Date().toISOString(),
  }
  args.pushAndPersist(assistantMsg)

  if (toolCalls.length === 0) {
    if (args.shouldDrainNotificationsInLoop && args.notifications.isNotEmpty) {
      yield* args.drainNotifications()
      args.messages.push(assistantMessage(''))
      yield* runAgentLoop(args, depth + 1)
      return
    }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }

  const boundedAnswerBeforeMoreTools = autoAnswerProbe
    ? null
    : args.domainWorkflowHooks.maybeBuildBoundedAnswer(args.messages)
  if (boundedAnswerBeforeMoreTools) {
    const skippedReason =
      'Skipped: enough bounded domain evidence already exists for this turn. ' +
      'No extra tool calls were executed; answer now from the collected evidence.'
    for (const call of toolCalls) {
      const result = toolMessage(call.id, skippedReason, false)
      args.pushAndPersist(result)
      yield { type: 'tool-result', name: call.name, result: result.toolResult?.content ?? '', isError: false, durationMs: 0 }
    }
    const msg = assistantMessage(boundedAnswerBeforeMoreTools)
    args.pushAndPersist(msg)
    yield { type: 'text-delta', text: boundedAnswerBeforeMoreTools }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }

  const domainInterception = autoAnswerProbe
    ? null
    : args.domainWorkflowHooks.maybeInterceptToolCalls(args.messages, toolCalls)
  if (domainInterception) {
    for (const call of toolCalls) {
      const result = toolMessage(
        call.id,
        domainInterception.skippedReason,
        false,
      )
      args.pushAndPersist(result)
      yield { type: 'tool-result', name: call.name, result: result.toolResult?.content ?? '', isError: false, durationMs: 0 }
    }
    if (domainInterception.answer) {
      const msg = assistantMessage(domainInterception.answer)
      args.pushAndPersist(msg)
      yield { type: 'text-delta', text: domainInterception.answer }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }
    if (domainInterception.autoToolCalls) {
      args.pushAndPersist(assistantMessage('', domainInterception.autoToolCalls))
      yield* executeToolCalls({
        toolCalls: domainInterception.autoToolCalls,
        tools: args.tools,
        ctx: args.toolContext,
        isCancelled: args.getCancelled,
        permissionDecision: args.permissionDecision,
        waitForPermissionConfirmation: args.waitForPermissionConfirmation,
        approveToolPermanently: args.approveToolPermanently,
        executeToolCall: args.executeToolCall,
        pushAndPersist: args.pushAndPersist,
      })
      if (args.getCancelled()) {
        yield { type: 'cancelled', reason: 'user' }
        yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
        return
      }
      const answer = domainInterception.autoAnswerProbe
        ? args.domainWorkflowHooks.maybeInterceptToolCalls(args.messages, domainInterception.autoAnswerProbe)?.answer
        : null
      if (answer) {
        const msg = assistantMessage(answer)
        args.pushAndPersist(msg)
        yield { type: 'text-delta', text: answer }
        yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
        return
      }
      args.messages.push(assistantMessage(''))
      yield* runAgentLoop(args, depth + 1)
      return
    }
    return
  }

  yield* executeToolCalls({
    toolCalls,
    tools: args.tools,
    ctx: args.toolContext,
    isCancelled: args.getCancelled,
    permissionDecision: args.permissionDecision,
    waitForPermissionConfirmation: args.waitForPermissionConfirmation,
    approveToolPermanently: args.approveToolPermanently,
    executeToolCall: args.executeToolCall,
    pushAndPersist: args.pushAndPersist,
  })

  if (args.getCancelled()) {
    yield { type: 'cancelled', reason: 'user' }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }

  if (args.shouldDrainNotificationsInLoop && args.notifications.isNotEmpty) {
    yield* args.drainNotifications()
  }
  const autoAnswer = autoAnswerProbe
    ? args.domainWorkflowHooks.maybeInterceptToolCalls(args.messages, autoAnswerProbe)?.answer
    : null
  if (autoAnswer) {
    const msg = assistantMessage(autoAnswer)
    args.pushAndPersist(msg)
    yield { type: 'text-delta', text: autoAnswer }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }
  const boundedDomainAnswer = args.domainWorkflowHooks.maybeBuildBoundedAnswer(args.messages)
  if (boundedDomainAnswer) {
    const msg = assistantMessage(boundedDomainAnswer)
    args.pushAndPersist(msg)
    yield { type: 'text-delta', text: boundedDomainAnswer }
    yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
    return
  }
  const domainRecovery = args.domainWorkflowHooks.buildRecovery(args.messages)
  if (domainRecovery) {
    args.pushAndPersist(assistantMessage('', domainRecovery.toolCalls))
    yield* executeToolCalls({
      toolCalls: domainRecovery.toolCalls,
      tools: args.tools,
      ctx: args.toolContext,
      isCancelled: args.getCancelled,
      permissionDecision: args.permissionDecision,
      waitForPermissionConfirmation: args.waitForPermissionConfirmation,
      approveToolPermanently: args.approveToolPermanently,
      executeToolCall: args.executeToolCall,
      pushAndPersist: args.pushAndPersist,
    })
    if (args.getCancelled()) {
      yield { type: 'cancelled', reason: 'user' }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }
    const answer = domainRecovery.answerAfterTools(args.messages)
    if (answer) {
      const msg = assistantMessage(answer)
      args.pushAndPersist(msg)
      yield { type: 'text-delta', text: answer }
      yield { type: 'turn-complete', durationMs: Date.now() - args.turnStartTime, toolCallCount: args.getTurnToolCallCount() }
      return
    }
  }
  args.messages.push(assistantMessage(''))
  yield* runAgentLoop(args, depth + 1)
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.role === Role.Assistant ? message.toolUses ?? [] : [])
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function successfulToolResults(messages: Message[]): Map<string, string> {
  const resultByToolUseId = new Map<string, string>()
  for (const message of messages) {
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) {
      resultByToolUseId.set(message.toolResult.toolUseId, message.toolResult.content)
    }
  }
  return resultByToolUseId
}
