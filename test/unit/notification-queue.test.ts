import { describe, it, expect } from 'vitest'
import { NotificationQueue } from '../../src/agent/notification-queue'

describe('NotificationQueue', () => {
  it('enqueues and drains in priority order', () => {
    const q = new NotificationQueue()
    q.enqueue('cron', 'low priority task', 'later')
    q.enqueue('user_input', 'urgent task', 'now')
    q.enqueue('monitor', 'normal task', 'next')

    const drained = q.drain()
    expect(drained[0].source).toBe('user_input')
    expect(drained[1].source).toBe('monitor')
    expect(drained[2].source).toBe('cron')
  })

  it('throttles same source', () => {
    const q = new NotificationQueue()
    const id1 = q.enqueue('cron', 'task 1')
    const id2 = q.enqueue('cron', 'task 2')
    expect(id1).not.toBe('')
    expect(id2).toBe('')
  })

  it('does not throttle user_input', () => {
    const q = new NotificationQueue()
    const id1 = q.enqueue('user_input', 'msg 1')
    const id2 = q.enqueue('user_input', 'msg 2')
    expect(id1).not.toBe('')
    expect(id2).not.toBe('')
  })

  it('respects drain limit', () => {
    const q = new NotificationQueue()
    q.enqueue('user_input', 'a', 'now')
    q.enqueue('user_input', 'b', 'now')
    q.enqueue('user_input', 'c', 'now')

    const drained = q.drain(2)
    expect(drained.length).toBe(2)
    expect(q.length).toBe(1)
  })

  it('tracks dropped notifications when globally paused', () => {
    const q = new NotificationQueue()
    q.accepting = false

    expect(q.enqueue('cron', 'paused task')).toBe('')
    expect(q.droppedCount).toBe(1)
    expect(q.length).toBe(0)
  })

  it('lets user input bypass global pause', () => {
    const q = new NotificationQueue()
    q.accepting = false

    expect(q.enqueue('user_input', 'foreground message')).not.toBe('')
    expect(q.droppedCount).toBe(0)
    expect(q.length).toBe(1)
  })

  it('supports source policies for enablement and throttling', () => {
    const q = new NotificationQueue()
    q.setSourcePolicy('api-health', { enabled: false })
    expect(q.enqueue('api-health', 'disabled')).toBe('')
    expect(q.droppedCount).toBe(1)

    q.setSourcePolicy('api-health', { enabled: true, minIntervalMs: 30_000 })
    expect(q.enqueue('api-health', 'first')).not.toBe('')
    expect(q.enqueue('api-health', 'second')).toBe('')
    expect(q.droppedCount).toBe(2)
    expect(q.getSourcePolicy('api-health')).toEqual({ enabled: true, minIntervalMs: 30_000 })
  })

  it('exposes pending notifications and counts by source', () => {
    const q = new NotificationQueue()
    q.enqueue('user_input', 'a', 'now')
    q.enqueue('monitor', 'b', 'later')
    q.enqueue('user_input', 'c', 'next')

    expect(q.pending.map((n) => n.source)).toEqual(['user_input', 'user_input', 'monitor'])
    expect(q.countBySource).toEqual({ user_input: 2, monitor: 1 })
    expect(q.snapshot).toEqual({
      queueLength: 3,
      droppedCount: 0,
      accepting: true,
      countBySource: { user_input: 2, monitor: 1 },
    })
  })

  it('clears a single source without losing other pending notifications', () => {
    const q = new NotificationQueue()
    q.enqueue('user_input', 'a', 'now')
    q.enqueue('monitor', 'b', 'next')

    q.clearSource('monitor')
    expect(q.pending.map((n) => n.source)).toEqual(['user_input'])
  })

  it('can reset throttle state', () => {
    const q = new NotificationQueue()
    q.setSourcePolicy('cron', { minIntervalMs: 30_000 })

    expect(q.enqueue('cron', 'first')).not.toBe('')
    expect(q.enqueue('cron', 'second')).toBe('')
    q.resetThrottles()
    expect(q.enqueue('cron', 'after reset')).not.toBe('')
  })
})
