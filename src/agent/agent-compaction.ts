import { buildCompactPrompt, applyCompaction, createPostCompactFileAttachments, estimateMessageTokens, formatCompactSummary, COMPACT_SYSTEM_PROMPT, microCompact, pruneOldToolResults, shouldAutoCompact } from './compact'
import { Role, type Message } from './message'
import { trySessionMemoryCompaction, type SessionMemoryState } from './session-memory'
import type { LLMProvider } from './llm-provider'

interface TryCompactArgs {
  messages: Message[]
  contextWindow: number
  llm: LLMProvider
  basePath: string
  sessionId: string
  readFileTimestamps: Map<string, number>
  sessionMemoryState: SessionMemoryState
  lastPromptTokens: number
  lastPromptMsgCount: number
  autoCompactFailures: number
}

interface TryCompactSetters {
  setMessages: (messages: Message[]) => void
  setLastPromptTokens: (value: number) => void
  setLastPromptMsgCount: (value: number) => void
  setAutoCompactFailures: (value: number) => void
  appendCompactBoundary: (summary: string, preCount: number) => void
}

export async function tryCompactAgentContext(
  args: TryCompactArgs,
  setters: TryCompactSetters,
  customInstructions?: string,
): Promise<{ compacted: boolean; preCount: number; postCount: number }> {
  if (args.autoCompactFailures >= 3) return { compacted: false, preCount: 0, postCount: 0 }
  const maxOut = (args.llm as any).config?.maxTokens ?? 16384
  const estimatedTokens = estimateMessageTokens(args.messages)
  if (!shouldAutoCompact(args.messages, args.contextWindow, maxOut, args.lastPromptTokens, args.lastPromptMsgCount)) {
    if (estimatedTokens > Math.max(50_000, args.contextWindow * 0.5)) {
      console.log('[ContextTrace:agent]', {
        source: 'compact-check',
        compacted: false,
        estimatedMessageTokens: estimatedTokens,
        lastPromptTokens: args.lastPromptTokens,
        lastPromptMsgCount: args.lastPromptMsgCount,
        messageCount: args.messages.length,
        contextWindow: args.contextWindow,
        maxOutputTokens: maxOut,
      })
    }
    return { compacted: false, preCount: 0, postCount: 0 }
  }

  const preCount = args.messages.length
  console.log('[ContextTrace:agent]', {
    source: 'compact-start',
    estimatedMessageTokens: estimatedTokens,
    lastPromptTokens: args.lastPromptTokens,
    lastPromptMsgCount: args.lastPromptMsgCount,
    messageCount: preCount,
    contextWindow: args.contextWindow,
    maxOutputTokens: maxOut,
  })

  const microMessages = microCompact(args.messages)
  setters.setMessages(microMessages)
  if (!shouldAutoCompact(microMessages, args.contextWindow, maxOut, 0, 0)) {
    console.log('[ContextTrace:agent]', {
      source: 'compact-micro',
      compacted: false,
      preCount,
      postCount: microMessages.length,
      estimatedMessageTokens: estimateMessageTokens(microMessages),
    })
    return { compacted: false, preCount: 0, postCount: 0 }
  }

  const smResult = trySessionMemoryCompaction(
    microMessages,
    args.sessionMemoryState,
    args.basePath,
    args.sessionId,
    args.readFileTimestamps,
    args.contextWindow,
    maxOut,
  )
  if (smResult) {
    const nextMessages = [smResult.summaryMessage, ...microMessages.slice(-10), ...smResult.fileAttachments]
    setters.setMessages(nextMessages)
    setters.setLastPromptTokens(0)
    setters.setLastPromptMsgCount(0)
    setters.setAutoCompactFailures(0)
    setters.appendCompactBoundary(smResult.summary, preCount)
    console.log('[ContextTrace:agent]', {
      source: 'compact-session-memory',
      compacted: true,
      preCount,
      postCount: nextMessages.length,
      estimatedMessageTokens: estimateMessageTokens(nextMessages),
    })
    return { compacted: true, preCount, postCount: nextMessages.length }
  }

  try {
    const prunedMessages = pruneOldToolResults(microMessages)
    const compactPrompt = buildCompactPrompt(prunedMessages, customInstructions)
    const summaryParts: string[] = []
    const stream = args.llm.sendMessage(
      COMPACT_SYSTEM_PROMPT,
      [...prunedMessages, { role: Role.User, content: compactPrompt, timestamp: new Date().toISOString() }],
      [],
    )
    for await (const ev of stream) {
      if (ev.type === 'text-delta') summaryParts.push(ev.text)
    }
    const rawSummary = summaryParts.join('')
    if (rawSummary.length < 50) {
      setters.setAutoCompactFailures(args.autoCompactFailures + 1)
      return { compacted: false, preCount: 0, postCount: 0 }
    }

    const summary = formatCompactSummary(rawSummary)
    const fileAttachments = createPostCompactFileAttachments(args.readFileTimestamps, args.basePath)
    const compactedMessages = applyCompaction(microMessages, summary)
    const nextMessages = fileAttachments.length > 0 ? [...compactedMessages, ...fileAttachments] : compactedMessages
    setters.setMessages(nextMessages)
    setters.setLastPromptTokens(0)
    setters.setLastPromptMsgCount(0)
    setters.setAutoCompactFailures(0)
    setters.appendCompactBoundary(summary, preCount)
    console.log('[ContextTrace:agent]', {
      source: 'compact-llm',
      compacted: true,
      preCount,
      postCount: nextMessages.length,
      estimatedMessageTokens: estimateMessageTokens(nextMessages),
    })
    return { compacted: true, preCount, postCount: nextMessages.length }
  } catch {
    setters.setAutoCompactFailures(args.autoCompactFailures + 1)
    return { compacted: false, preCount: 0, postCount: 0 }
  }
}
