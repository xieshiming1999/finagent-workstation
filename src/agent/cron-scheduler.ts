import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface CronJob {
  id: string
  schedule: string
  cron?: string
  intervalMs?: number
  fireAtMs?: number
  prompt: string
  recurring: boolean
  durable: boolean
  createdAt: string
  lastFired?: string
  nextFire?: string
  expiresAt?: string
}

export class CronScheduler {
  private jobs: Map<string, CronJob> = new Map()
  private nextId = 1
  private timer: ReturnType<typeof setInterval> | null = null
  private basePath: string
  private onFire: ((job: CronJob) => void) | null = null

  constructor(basePath: string) {
    this.basePath = basePath
    this.loadDurable()
  }

  setFireHandler(handler: (job: CronJob) => void) {
    this.onFire = handler
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 15_000)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  create(opts: { cron: string; prompt: string; recurring?: boolean; durable?: boolean }): CronJob {
    const id = String(this.nextId++)
    const now = new Date()
    const schedule = opts.cron
    const parsed = parseSchedule(schedule, now)
    const job: CronJob = {
      id,
      schedule,
      cron: parsed.type === 'cron' ? parsed.cron : undefined,
      intervalMs: parsed.type === 'interval' ? parsed.intervalMs : undefined,
      fireAtMs: parsed.type === 'delay' ? parsed.fireAtMs : undefined,
      prompt: opts.prompt,
      recurring: opts.recurring ?? parsed.type !== 'delay',
      durable: opts.durable ?? false,
      createdAt: now.toISOString(),
    }
    if (job.recurring) {
      job.expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }
    if (job.intervalMs) job.nextFire = new Date(now.getTime() + job.intervalMs).toISOString()
    if (job.fireAtMs != null) job.nextFire = new Date(job.fireAtMs).toISOString()
    this.jobs.set(id, job)
    if (job.durable) this.saveDurable()
    return job
  }

  delete(id: string): boolean {
    const deleted = this.jobs.delete(id)
    if (deleted) this.saveDurable()
    return deleted
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values())
  }

  private tick() {
    const now = new Date()
    for (const job of this.jobs.values()) {
      if (job.expiresAt && new Date(job.expiresAt) < now) {
        this.jobs.delete(job.id)
        continue
      }

      if (this.shouldFire(job, now)) {
        job.lastFired = now.toISOString()
        this.onFire?.(job)

        if (!job.recurring) {
          this.jobs.delete(job.id)
        } else if (job.intervalMs) {
          job.nextFire = new Date(now.getTime() + job.intervalMs).toISOString()
        }
        if (job.durable) this.saveDurable()
      }
    }
  }

  private shouldFire(job: CronJob, now: Date): boolean {
    if (job.fireAtMs != null) return now.getTime() >= job.fireAtMs
    if (job.intervalMs != null) {
      const next = job.nextFire ? new Date(job.nextFire).getTime() : new Date(job.createdAt).getTime() + job.intervalMs
      job.nextFire = new Date(next).toISOString()
      return now.getTime() >= next
    }
    if (!job.cron) return false
    if (job.lastFired) {
      const lastFired = new Date(job.lastFired)
      if (now.getTime() - lastFired.getTime() < 30_000) return false
    }
    if (!cronMatches(job.cron, now)) return false

    // Apply deterministic jitter: delay by (jitterFrac * 15min) for recurring,
    // up to 90s for one-shot on :00/:30 marks
    const frac = jitterFrac(job.id)
    if (job.recurring) {
      const jitterMs = frac * 15 * 60 * 1000 * 0.1 // up to 10% of 15min = 90s
      const minute = now.getMinutes()
      if (minute === 0 || minute === 30) {
        if (now.getSeconds() * 1000 < jitterMs) return false
      }
    }
    return true
  }

  private loadDurable() {
    const filePath = join(this.basePath, 'scheduled_tasks.json')
    if (!existsSync(filePath)) return
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as CronJob[]
      for (const job of data) {
        migrateJob(job)
        this.jobs.set(job.id, job)
        const id = parseInt(job.id, 10)
        if (id >= this.nextId) this.nextId = id + 1
      }
    } catch { /* ignore */ }
  }

  private saveDurable() {
    const filePath = join(this.basePath, 'scheduled_tasks.json')
    mkdirSync(this.basePath, { recursive: true })
    const durableJobs = Array.from(this.jobs.values()).filter((j) => j.durable)
    writeFileSync(filePath, JSON.stringify(durableJobs, null, 2), 'utf-8')
  }
}

type ScheduleConfig =
  | { type: 'cron'; cron: string }
  | { type: 'interval'; intervalMs: number }
  | { type: 'delay'; fireAtMs: number }

function parseSchedule(schedule: string, now: Date): ScheduleConfig {
  const trimmed = schedule.trim().toLowerCase()
  const interval = trimmed.match(/^every\s+(\d+)\s+(second|minute|hour|day)s?$/)
  if (interval) {
    return { type: 'interval', intervalMs: Number(interval[1]) * unitToMs(interval[2]) }
  }
  const delay = trimmed.match(/^(?:after|in)\s+(\d+)\s+(second|minute|hour|day)s?$/)
  if (delay) {
    return { type: 'delay', fireAtMs: now.getTime() + Number(delay[1]) * unitToMs(delay[2]) }
  }
  return { type: 'cron', cron: schedule }
}

function unitToMs(unit: string): number {
  switch (unit) {
    case 'second': return 1000
    case 'minute': return 60 * 1000
    case 'hour': return 60 * 60 * 1000
    case 'day': return 24 * 60 * 60 * 1000
    default: return 60 * 1000
  }
}

function migrateJob(job: CronJob): void {
  const legacy = job as any
  if (!job.schedule) job.schedule = legacy.cron ?? ''
  if (!job.cron && !job.intervalMs && !job.fireAtMs && legacy.cron) {
    job.cron = legacy.cron
  }
}

function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts
  return (
    fieldMatches(minExpr, date.getMinutes()) &&
    fieldMatches(hourExpr, date.getHours()) &&
    fieldMatches(domExpr, date.getDate()) &&
    fieldMatches(monExpr, date.getMonth() + 1) &&
    fieldMatches(dowExpr, date.getDay())
  )
}

function fieldMatches(expr: string, value: number): boolean {
  if (expr === '*') return true
  for (const part of expr.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      if (range === '*') { if (value % step === 0) return true }
      else {
        const start = parseInt(range, 10)
        if (value >= start && (value - start) % step === 0) return true
      }
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number)
      if (value >= lo && value <= hi) return true
    } else {
      if (parseInt(part, 10) === value) return true
    }
  }
  return false
}

/** Deterministic jitter fraction [0, 1) based on task ID hash. */
function jitterFrac(taskId: string): number {
  const hex = taskId.padEnd(8, '0').slice(0, 8)
  const value = parseInt(hex, 16) || 0
  return value / 0x100000000
}
