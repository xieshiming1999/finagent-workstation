import { join } from 'path'
import type { AgentEvent } from './agent-event'
import type { LLMProvider } from './llm-provider'
import type { Message, Role } from './message'
import type { BridgeRequestHandler } from './tool'
import type { SessionMemoryState } from './session-memory'
import { buildSessionMemoryPrompt, loadSessionMemory, saveSessionMemory, shouldExtractSessionMemory } from './session-memory'
import { estimateMessageTokens } from './compact'
import { runExtractMemories } from './extract-memories'
import type { PostTurnHookRegistry } from './post-turn-hooks'
import type { GoalManager } from './goal-manager'
import type { JudgeFn, VerifierFn } from './goal-manager'
import { createGoalVerifier } from './goal-verifier'

type RegisterDeps = {
  hooks: PostTurnHookRegistry
  llm: LLMProvider
  messages: Message[]
  basePath: string
  assetsPath: string
  sessionId: string
  readFileTimestamps: Map<string, number>
  pluginSkillPaths: string[]
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
  autoDreamState: { inProgress: boolean }
  skillImprovementState: { lastRunTurn: number; inProgress: boolean }
  housekeepingDone: boolean
  setHousekeepingDone(value: boolean): void
  magicDocsState: unknown
  speculationState: unknown
  pendingPostTurnEvents: AgentEvent[]
  goalManager: GoalManager
  goalJudge: JudgeFn
  goalVerifier?: VerifierFn
  notifications: { enqueue(source: string, prompt: string, when: 'now' | 'next'): string }
  userTurnCount: number
  turnMessageStartIndex: number
  lastExtractMemoriesTime: number
  setLastExtractMemoriesTime(value: number): void
  sessionMemoryState: SessionMemoryState
  extractSessionMemoryAsync(tokens: number): Promise<void>
  assistantRole: Role
}

export function registerDefaultHooks(deps: RegisterDeps): void {
  deps.hooks.register('session_memory', async () => {
    const tokens = estimateMessageTokens(deps.messages)
    if (!shouldExtractSessionMemory(deps.messages, deps.sessionMemoryState)) return
    if (deps.sessionMemoryState.extracting) return
    deps.sessionMemoryState.extracting = true
    deps.extractSessionMemoryAsync(tokens).catch(() => {}).finally(() => {
      deps.sessionMemoryState.extracting = false
    })
  })

  deps.hooks.register('extract_memories', async () => {
    if (deps.userTurnCount < 20) return
    const now = Date.now()
    if (now - deps.lastExtractMemoriesTime < 30 * 60 * 1000) return
    deps.setLastExtractMemoriesTime(now)
    runExtractMemories({
      messages: deps.messages,
      turnStartIndex: deps.turnMessageStartIndex,
      llm: deps.llm,
      basePath: deps.basePath,
      assetsPath: deps.assetsPath,
      sessionId: deps.sessionId,
      readFileTimestamps: deps.readFileTimestamps,
      pluginSkillPaths: deps.pluginSkillPaths,
      bridgeRequest: deps.bridgeRequest,
      getConfigValue: deps.getConfigValue,
    }).catch(() => {})
  })

  deps.hooks.register('auto_dream', async () => {
    const { maybeRunAutoDream } = await import('./auto-dream')
    maybeRunAutoDream({ llm: deps.llm, basePath: deps.basePath, state: deps.autoDreamState }).catch(() => {})
  })

  deps.hooks.register('skill_improvement', async () => {
    const { maybeRunSkillImprovement } = await import('./skill-improvement')
    maybeRunSkillImprovement({
      llm: deps.llm,
      basePath: deps.basePath,
      assetsPath: deps.assetsPath,
      sessionId: deps.sessionId,
      messages: deps.messages,
      readFileTimestamps: deps.readFileTimestamps,
      pluginSkillPaths: deps.pluginSkillPaths,
      bridgeRequest: deps.bridgeRequest,
      getConfigValue: deps.getConfigValue,
      state: deps.skillImprovementState,
      userTurnCount: deps.userTurnCount,
    }).catch(() => {})
  })

  deps.hooks.register('housekeeping', async () => {
    if (deps.housekeepingDone) return
    if (deps.userTurnCount < 2) return
    deps.setHousekeepingDone(true)
    setTimeout(async () => {
      const { runBackgroundHousekeeping } = await import('./background-housekeeping')
      runBackgroundHousekeeping(join(deps.basePath, 'memory')).catch(() => {})
    }, 10 * 60 * 1000)
  })

  deps.hooks.register('magic_docs', async () => {
    const { hookMagicDocs } = await import('./magic-docs')
    hookMagicDocs({
      llm: deps.llm,
      basePath: deps.basePath,
      assetsPath: deps.assetsPath,
      messages: deps.messages,
      state: deps.magicDocsState as any,
    }).catch(() => {})
  })

  deps.hooks.register('speculation', async () => {
    const { hookSpeculation } = await import('./speculation')
    await hookSpeculation({
      messages: deps.messages,
      llm: deps.llm,
      state: deps.speculationState as any,
      onSuggestion: (suggestion) => {
        deps.pendingPostTurnEvents.push({ type: 'suggestion', text: suggestion })
      },
    })
  })

  deps.hooks.register('goal_continuation', async () => {
    if (!deps.goalManager.isActive()) return
    const lastAssistant = [...deps.messages].reverse().find((m) => m.role === deps.assistantRole)
    const lastResponse = lastAssistant?.content ?? ''
    if (!lastResponse.trim()) return
    const verifier = deps.goalVerifier ?? createGoalVerifier()
    const decision = await deps.goalManager.evaluateAfterTurn(lastResponse, deps.goalJudge, verifier)
    if (decision.message) deps.notifications.enqueue('goal-status', decision.message, 'now')
    if (decision.shouldContinue && decision.continuationPrompt) {
      deps.notifications.enqueue('goal', decision.continuationPrompt, 'next')
    }
  })
}

type SessionMemoryDeps = {
  basePath: string
  sessionId: string
  messages: Message[]
  llm: LLMProvider
  sessionMemoryState: SessionMemoryState
  userRole: Role
}

export async function extractSessionMemoryAsync(deps: SessionMemoryDeps, tokens: number): Promise<void> {
  const existing = loadSessionMemory(deps.basePath, deps.sessionId)
  const prompt = buildSessionMemoryPrompt(deps.messages, existing)
  const parts: string[] = []
  const stream = deps.llm.sendMessage(
    'You are a session memory manager. Update the session memory document.',
    [{ role: deps.userRole, content: prompt, timestamp: new Date().toISOString() }],
    [],
  )
  for await (const ev of stream) {
    if (ev.type === 'text-delta') parts.push(ev.text)
  }
  const result = parts.join('')
  if (result.length <= 100) return
  const saved = saveSessionMemory(deps.basePath, deps.sessionId, result)
  if (!saved) return
  deps.sessionMemoryState.initialized = true
  deps.sessionMemoryState.tokensAtLastExtraction = tokens
  deps.sessionMemoryState.lastSummarizedIndex = deps.messages.length - 1
}
