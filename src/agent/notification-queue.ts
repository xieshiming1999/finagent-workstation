export type NotificationPriority = 'now' | 'next' | 'later'

export interface Notification {
  id: string
  source: string
  prompt: string
  priority: NotificationPriority
  timestamp: number
}

export interface NotificationQueueSnapshot {
  queueLength: number
  droppedCount: number
  accepting: boolean
  countBySource: Record<string, number>
}

const PRIORITY_ORDER: Record<NotificationPriority, number> = { now: 0, next: 1, later: 2 }

export interface SourcePolicy {
  enabled: boolean
  minIntervalMs: number | null
}

interface SourcePolicyState extends SourcePolicy {
  lastAcceptedAt: number | null
}

export class NotificationQueue {
  private queue: Notification[] = []
  private nextId = 1
  private sourceThrottle: Map<string, number> = new Map()
  private sourcePolicies: Map<string, SourcePolicyState> = new Map()
  private dropped = 0
  accepting = true
  private throttleMs: Record<string, number> = {
    cron: 30_000,
    monitor: 15_000,
    dashboard: 5_000,
    'task-notification': 0,
    'user_input': 0,
    'goal': 0,
    'goal-status': 0,
  }

  /** Callback triggered on enqueue — used by Agent._pump() for auto-processing. */
  onEnqueue: (() => void) | null = null

  enqueue(source: string, prompt: string, priority: NotificationPriority = 'next'): string {
    if (source !== 'user_input' && !this.accepting) {
      this.dropped++
      return ''
    }

    if (source !== 'user_input') {
      const now = Date.now()
      const policy = this.sourcePolicies.get(source)
      if (policy) {
        if (!policy.enabled) {
          this.dropped++
          return ''
        }
        if (policy.minIntervalMs != null && policy.lastAcceptedAt != null && now - policy.lastAcceptedAt < policy.minIntervalMs) {
          this.dropped++
          return ''
        }
        policy.lastAcceptedAt = now
      } else {
        const lastTime = this.sourceThrottle.get(source) ?? 0
        const throttle = this.throttleMs[source] ?? 10_000
        if (now - lastTime < throttle) {
          this.dropped++
          return ''
        }
        this.sourceThrottle.set(source, now)
      }
    }

    const id = String(this.nextId++)
    this.queue.push({ id, source, prompt, priority, timestamp: Date.now() })
    this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    this.onEnqueue?.()
    return id
  }

  dequeueNext(): Notification | undefined {
    return this.queue.shift()
  }

  get isNotEmpty(): boolean {
    return this.queue.length > 0
  }

  drainAsMessages(): Array<{ role: 'user'; content: string; timestamp: string; source: string }> {
    const drained = this.queue.splice(0)
    return drained.map((n) => ({
      role: 'user' as const,
      content: `[${n.source}] ${n.prompt}`,
      timestamp: new Date(n.timestamp).toISOString(),
      source: n.source,
    }))
  }

  drain(maxCount = 5): Notification[] {
    const drained = this.queue.splice(0, maxCount)
    return drained
  }

  peek(): Notification | undefined {
    return this.queue[0]
  }

  get pending(): readonly Notification[] {
    return [...this.queue]
  }

  get length(): number {
    return this.queue.length
  }

  get droppedCount(): number {
    return this.dropped
  }

  get countBySource(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const n of this.queue) {
      counts[n.source] = (counts[n.source] ?? 0) + 1
    }
    return counts
  }

  get snapshot(): NotificationQueueSnapshot {
    return {
      queueLength: this.length,
      droppedCount: this.droppedCount,
      accepting: this.accepting,
      countBySource: this.countBySource,
    }
  }

  setSourcePolicy(source: string, policy: Partial<SourcePolicy>): void {
    const existing = this.sourcePolicies.get(source) ?? {
      enabled: true,
      minIntervalMs: null,
      lastAcceptedAt: null,
    }
    this.sourcePolicies.set(source, {
      enabled: policy.enabled ?? existing.enabled,
      minIntervalMs: policy.minIntervalMs !== undefined ? policy.minIntervalMs : existing.minIntervalMs,
      lastAcceptedAt: existing.lastAcceptedAt,
    })
  }

  getSourcePolicy(source: string): SourcePolicy | null {
    const policy = this.sourcePolicies.get(source)
    return policy ? { enabled: policy.enabled, minIntervalMs: policy.minIntervalMs } : null
  }

  removeSourcePolicy(source: string): void {
    this.sourcePolicies.delete(source)
  }

  clear(): void {
    this.queue = []
  }

  clearSource(source: string): void {
    this.queue = this.queue.filter((n) => n.source !== source)
  }

  resetThrottles(): void {
    this.sourceThrottle.clear()
    for (const policy of this.sourcePolicies.values()) {
      policy.lastAcceptedAt = null
    }
  }
}
