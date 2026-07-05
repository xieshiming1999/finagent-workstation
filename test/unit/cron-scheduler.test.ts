import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, afterEach } from 'vitest'
import { CronScheduler } from '../../src/agent/cron-scheduler'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempBase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finagent-workstation-cron-'))
  tempDirs.push(dir)
  return dir
}

describe('CronScheduler', () => {
  it('creates interval jobs with next fire metadata and fires when due', () => {
    const scheduler = new CronScheduler(tempBase())
    const fired: string[] = []
    scheduler.setFireHandler((job) => fired.push(job.id))

    const job = scheduler.create({ cron: 'every 30 seconds', prompt: 'check market', durable: false })
    expect(job.schedule).toBe('every 30 seconds')
    expect(job.intervalMs).toBe(30_000)
    expect(job.recurring).toBe(true)
    expect(job.nextFire).toBeTruthy()

    job.nextFire = new Date(Date.now() - 1000).toISOString()
    ;(scheduler as any).tick()

    expect(fired).toEqual([job.id])
    expect(scheduler.list()[0].nextFire).toBeTruthy()
  })

  it('creates delay jobs as one-shot by default', () => {
    const scheduler = new CronScheduler(tempBase())
    const fired: string[] = []
    scheduler.setFireHandler((job) => fired.push(job.id))

    const job = scheduler.create({ cron: 'in 1 second', prompt: 'remind me', durable: false })
    expect(job.schedule).toBe('in 1 second')
    expect(job.fireAtMs).toBeTypeOf('number')
    expect(job.recurring).toBe(false)

    job.fireAtMs = Date.now() - 1000
    ;(scheduler as any).tick()

    expect(fired).toEqual([job.id])
    expect(scheduler.list()).toHaveLength(0)
  })
})
