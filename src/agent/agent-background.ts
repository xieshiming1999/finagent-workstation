import type { AgentEvent } from './agent-event'
import type { NotificationQueue } from './notification-queue'
import type { Message } from './message'
import { userMessage } from './message'

export type BackgroundAgentLike = {
  cancel(): void
  notifications: NotificationQueue
}

type BackgroundDeps = {
  backgroundAgents: Map<string, BackgroundAgentLike>
  taskRegistry: {
    register(details: { description: string; prompt: string; parentSessionId: string; isBackgrounded: boolean }): { id: string }
    get(id: string): { description: string } | undefined
    updateStatus(id: string, status: string, details?: Record<string, unknown>): void
  }
  teamRegistry: {
    findMemberTaskId(name: string): string | null
    updateMemberStatusByTask(taskId: string, status: string, reason?: string): void
  }
  notifications: NotificationQueue
  sessionId: string
  runPrompt(prompt: string): AsyncGenerator<AgentEvent>
  pushAndPersist(msg: Message): void
  isRunning(): boolean
  isPumpActive(): boolean
  setPumpActive(active: boolean): void
  setPumpEventSink(sink: ((ev: AgentEvent) => void) | null): void
  getPumpEventSink(): ((ev: AgentEvent) => void) | null
}

export function registerBackgroundAgent(deps: BackgroundDeps, taskId: string, agent: BackgroundAgentLike): void {
  deps.backgroundAgents.set(taskId, agent)
}

export function removeBackgroundAgent(deps: BackgroundDeps, taskId: string): void {
  deps.backgroundAgents.delete(taskId)
}

export function cancelBackgroundAgent(deps: BackgroundDeps, taskId: string): void {
  deps.backgroundAgents.get(taskId)?.cancel()
  deps.backgroundAgents.delete(taskId)
  deps.teamRegistry.updateMemberStatusByTask(taskId, 'killed', 'Cancelled by parent agent')
}

export function sendMessageToAgent(deps: BackgroundDeps, taskId: string, message: string): boolean {
  const agent = deps.backgroundAgents.get(taskId)
  if (!agent) return false
  agent.notifications.enqueue('send_message', `<teammate-message>\n${message}\n</teammate-message>`, 'now')
  return true
}

export function findAgentIdByName(deps: BackgroundDeps, name: string): string | null {
  const teamMemberTaskId = deps.teamRegistry.findMemberTaskId(name)
  if (teamMemberTaskId && deps.backgroundAgents.has(teamMemberTaskId)) return teamMemberTaskId
  for (const [id] of deps.backgroundAgents) {
    const task = deps.taskRegistry.get(id)
    if (task && task.description.includes(name)) return id
  }
  return null
}

export function startAutoProcessing(deps: BackgroundDeps, onEvent: (ev: AgentEvent) => void): void {
  deps.setPumpActive(true)
  deps.setPumpEventSink(onEvent)
  deps.notifications.onEnqueue = () => {
    onEvent(queueStatusEvent(deps.notifications, deps.isRunning() ? 'Queued' : 'Queued for processing'))
    pump(deps, onEvent).catch(() => {})
  }
}

export function stopAutoProcessing(deps: BackgroundDeps): void {
  deps.setPumpActive(false)
  deps.setPumpEventSink(null)
  deps.notifications.onEnqueue = null
}

export async function pump(deps: BackgroundDeps, onEvent: (ev: AgentEvent) => void): Promise<void> {
  if (deps.isRunning()) return
  if (!deps.notifications.isNotEmpty) return

  const next = deps.notifications.dequeueNext()
  if (!next) return

  onEvent(queueStatusEvent(deps.notifications, `Processing ${next.source}`))
  console.log('[EventAgentPump] dequeue', {
    source: next.source,
    notificationId: next.id,
    queueLength: deps.notifications.length,
    sessionId: deps.sessionId,
  })
  onEvent({ type: 'text-delta', text: `\n[${next.source}] Processing notification...\n` })

  const prompt = next.source === 'cron'
    ? `<scheduled-task>\n${next.prompt}\n</scheduled-task>`
    : next.prompt

  try {
    let emittedText = false
    let failed = false
    let failureMessage: string | null = null
    for await (const ev of deps.runPrompt(prompt)) {
      if (ev.type === 'text-delta' && ev.text.trim()) emittedText = true
      if (ev.type === 'error') {
        failed = true
        failureMessage = ev.message
      }
      onEvent(ev)
    }
    if (failed) {
      console.error('[EventAgentPump] failed', {
        source: next.source,
        notificationId: next.id,
        sessionId: deps.sessionId,
        error: failureMessage ?? 'agent loop error',
      })
      onEvent(queueStatusEvent(deps.notifications, deps.notifications.isNotEmpty ? 'Queued after failure' : 'Failed'))
    } else if (!emittedText) {
      onEvent({ type: 'text-delta', text: `[${next.source}] Notification completed with no text output.\n` })
      console.log('[EventAgentPump] complete', {
        source: next.source,
        notificationId: next.id,
        queueLength: deps.notifications.length,
        sessionId: deps.sessionId,
      })
      onEvent(queueStatusEvent(deps.notifications, deps.notifications.isNotEmpty ? 'Queued' : undefined))
    } else {
      console.log('[EventAgentPump] complete', {
        source: next.source,
        notificationId: next.id,
        queueLength: deps.notifications.length,
        sessionId: deps.sessionId,
      })
      onEvent(queueStatusEvent(deps.notifications, deps.notifications.isNotEmpty ? 'Queued' : undefined))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[EventAgentPump] failed', {
      source: next.source,
      notificationId: next.id,
      sessionId: deps.sessionId,
      error: message,
    })
    onEvent({ type: 'error', message })
    onEvent(queueStatusEvent(deps.notifications, deps.notifications.isNotEmpty ? 'Queued' : undefined))
  }

  if (deps.isPumpActive() && deps.notifications.isNotEmpty) {
    await pump(deps, onEvent)
  }
}

export function queueStatusEvent(queue: NotificationQueue, status?: string): AgentEvent {
  return {
    type: 'queue-status',
    ...queue.snapshot,
    status,
  }
}

export function backgroundCurrentTask(
  deps: Pick<BackgroundDeps, 'taskRegistry' | 'sessionId'> & {
    running: boolean
    currentBackgroundTaskId: string | null
    currentPrompt: string | null
    setCurrentBackgroundTaskId(taskId: string): void
  },
): string | null {
  if (!deps.running) return null
  if (deps.currentBackgroundTaskId) return deps.currentBackgroundTaskId
  const task = deps.taskRegistry.register({
    description: 'Backgrounded current turn',
    prompt: deps.currentPrompt ?? '',
    parentSessionId: deps.sessionId,
    isBackgrounded: true,
  })
  deps.taskRegistry.updateStatus(task.id, 'running')
  deps.setCurrentBackgroundTaskId(task.id)
  return task.id
}

export function drainNotifications(queue: NotificationQueue, pushAndPersist: (msg: Message) => void): void {
  const notifications = queue.drain()
  for (const notification of notifications) {
    const content = notification.source === 'cron'
      ? `<scheduled-task>\n${notification.prompt}\n</scheduled-task>`
      : notification.prompt
    pushAndPersist(userMessage(content))
  }
}
