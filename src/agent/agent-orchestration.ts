import type { AgentEvent } from './agent-event'
import type { Message } from './message'
import type { NotificationQueue } from './notification-queue'
import type { Session } from './session'
import type { GoalManager } from './goal-manager'
import type { PromptStash } from './prompt-stash'
import { handleSlashCommand as handleSlashCommandHelper } from './agent-commands'
import type { BackgroundAgentLike } from './agent-background'
import {
  backgroundCurrentTask as backgroundCurrentTaskHelper,
  cancelBackgroundAgent as cancelBackgroundAgentHelper,
  drainNotifications as drainNotificationsHelper,
  findAgentIdByName as findAgentIdByNameHelper,
  pump as pumpHelper,
  registerBackgroundAgent as registerBackgroundAgentHelper,
  removeBackgroundAgent as removeBackgroundAgentHelper,
  sendMessageToAgent as sendMessageToAgentHelper,
  startAutoProcessing as startAutoProcessingHelper,
  stopAutoProcessing as stopAutoProcessingHelper,
} from './agent-background'
import type { TaskRegistry } from './background-task'
import type { TeamRegistry } from './team-context'

export function buildBackgroundDeps(args: {
  backgroundAgents: Map<string, BackgroundAgentLike>
  taskRegistry: TaskRegistry
  teamRegistry: TeamRegistry
  notifications: NotificationQueue
  sessionId: string
  runPrompt: (prompt: string) => AsyncGenerator<AgentEvent>
  pushAndPersist: (msg: Message) => void
  isRunning: () => boolean
  isPumpActive: () => boolean
  setPumpActive: (active: boolean) => void
  setPumpEventSink: (sink: ((ev: AgentEvent) => void) | null) => void
  getPumpEventSink: () => ((ev: AgentEvent) => void) | null
}) {
  return {
    backgroundAgents: args.backgroundAgents,
    taskRegistry: args.taskRegistry,
    teamRegistry: args.teamRegistry,
    notifications: args.notifications,
    sessionId: args.sessionId,
    runPrompt: args.runPrompt,
    pushAndPersist: args.pushAndPersist,
    isRunning: args.isRunning,
    isPumpActive: args.isPumpActive,
    setPumpActive: args.setPumpActive,
    setPumpEventSink: args.setPumpEventSink,
    getPumpEventSink: args.getPumpEventSink,
  }
}

export function registerBackgroundAgent(deps: ReturnType<typeof buildBackgroundDeps>, taskId: string, agent: unknown): void {
  registerBackgroundAgentHelper(deps, taskId, agent as any)
}

export function removeBackgroundAgent(deps: ReturnType<typeof buildBackgroundDeps>, taskId: string): void {
  removeBackgroundAgentHelper(deps, taskId)
}

export function cancelBackgroundAgent(deps: ReturnType<typeof buildBackgroundDeps>, taskId: string): void {
  cancelBackgroundAgentHelper(deps, taskId)
}

export function sendMessageToAgent(deps: ReturnType<typeof buildBackgroundDeps>, taskId: string, message: string): boolean {
  return sendMessageToAgentHelper(deps, taskId, message)
}

export function findAgentIdByName(deps: ReturnType<typeof buildBackgroundDeps>, name: string): string | null {
  return findAgentIdByNameHelper(deps, name)
}

export function startAutoProcessing(deps: ReturnType<typeof buildBackgroundDeps>, onEvent: (ev: AgentEvent) => void): void {
  startAutoProcessingHelper(deps, onEvent)
}

export function stopAutoProcessing(deps: ReturnType<typeof buildBackgroundDeps>): void {
  stopAutoProcessingHelper(deps)
}

export async function pumpBackgroundQueue(deps: ReturnType<typeof buildBackgroundDeps>, onEvent: (ev: AgentEvent) => void): Promise<void> {
  await pumpHelper(deps, onEvent)
}

export async function* drainNotifications(
  notifications: NotificationQueue,
  pushAndPersist: (msg: Message) => void,
): AsyncGenerator<AgentEvent> {
  drainNotificationsHelper(notifications, pushAndPersist)
}

export async function* handleSlashCommand(args: {
  name: string
  argsText: string
  basePath: string
  projectLocalDir: string
  pluginCommandPaths: string[]
  messages: Message[]
  goalManager: GoalManager
  promptStash: PromptStash
  session: Session
  notifications: NotificationQueue
  clearSession: () => void
  resumeSession: (filePath: string) => void
  runPostTurnHooks: () => Promise<AgentEvent[]>
  appendTurnToHistory: () => void
  pushAndPersist: (msg: Message) => void
  agentLoop: () => AsyncGenerator<AgentEvent>
  tryCompact: (customInstructions?: string) => Promise<{ compacted: boolean; preCount: number; postCount: number }>
  runBtw: (question: string) => Promise<string>
  setMessages: (messages: Message[]) => void
  runningRef: { value: boolean }
}): AsyncGenerator<AgentEvent> {
  yield* handleSlashCommandHelper({
    name: args.name,
    args: args.argsText,
    basePath: args.basePath,
    projectLocalDir: args.projectLocalDir,
    pluginCommandPaths: args.pluginCommandPaths,
    messages: args.messages,
    goalManager: args.goalManager,
    promptStash: args.promptStash,
    session: args.session,
    notifications: args.notifications,
    clearSession: args.clearSession,
    resumeSession: args.resumeSession,
    runPostTurnHooks: args.runPostTurnHooks,
    appendTurnToHistory: args.appendTurnToHistory,
    pushAndPersist: args.pushAndPersist,
    agentLoop: args.agentLoop,
    tryCompact: args.tryCompact,
    runBtw: args.runBtw,
    setMessages: args.setMessages,
    runningRef: args.runningRef,
  })
}
