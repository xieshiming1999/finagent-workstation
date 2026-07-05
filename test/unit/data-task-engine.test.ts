import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTaskEngine } from '../../src/agent/data-task-engine'
import { globalApiStats } from '../../src/agent/data/resilience'

describe('DataTaskEngine', () => {
  let basePath = ''

  afterEach(() => {
    if (basePath) rmSync(basePath, { recursive: true, force: true })
    basePath = ''
  })

  it('records failed tasks in API stats recent failures', async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-data-task-'))
    const baseline = globalApiStats.getRecent(5).length
    const engine = new DataTaskEngine(basePath, {
      getQuote: vi.fn(async () => {
        throw new Error('upstream timeout')
      }),
      getQuoteBatch: vi.fn(),
    })

    const task = engine.create('batch_quote', { codes: ['600519'] })
    await waitFor(() => engine.get(task.id)?.status === 'failed')

    const failed = engine.get(task.id)
    expect(failed).toMatchObject({
      status: 'failed',
    })
    expect(failed?.error).toContain('batch_quote returned no rows')

    const records = globalApiStats.getRecent(5).slice(baseline)
    expect(records).toContainEqual(expect.objectContaining({
      source: 'data_task',
      tool: 'DataTask',
      action: 'batch_quote',
      url: 'data_task:batch_quote',
      status: 0,
      success: false,
      error: expect.stringContaining('upstream timeout'),
    }))
  })

  it('fails batch_score instead of completing with empty rows', async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-data-task-score-'))
    const engine = new DataTaskEngine(basePath, {
      getQuote: vi.fn(),
      getQuoteBatch: vi.fn(async () => []),
    })

    const task = engine.create('batch_score', { codes: ['600519'] })
    await waitFor(() => engine.get(task.id)?.status === 'failed')

    expect(engine.get(task.id)?.error).toContain('batch_score returned no rows')
  })

  it('runs screen_advanced through the stock screener with condition gates', async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-data-task-screen-'))
    const screenStock = vi.fn(async () => '600519 贵州茅台 ¥1200 score:92')
    const engine = new DataTaskEngine(basePath, {
      screenStock,
    })

    const conditions = [{ field: 'CHANGE_RATE_120', op: '>', value: 0 }]
    const task = engine.create('screen_advanced', {
      conditions,
      limit: 10,
    })
    await waitFor(() => engine.get(task.id)?.status === 'completed')

    expect(screenStock).toHaveBeenCalledWith(expect.objectContaining({
      conditions,
      gates: conditions,
      limit: 10,
    }))
    expect(engine.getResult(task.id)).toContain('600519')
  })

  it('fails screen_advanced instead of storing screener errors as results', async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-data-task-screen-fail-'))
    const baseline = globalApiStats.getRecent(5).length
    const engine = new DataTaskEngine(basePath, {
      screenStock: vi.fn(async () => 'Error: sidecar unavailable'),
    })

    const task = engine.create('screen_advanced', { conditions: [] })
    await waitFor(() => engine.get(task.id)?.status === 'failed')

    expect(engine.get(task.id)?.error).toContain('sidecar unavailable')
    const records = globalApiStats.getRecent(5).slice(baseline)
    expect(records).toContainEqual(expect.objectContaining({
      source: 'data_task',
      tool: 'DataTask',
      action: 'screen_advanced',
      url: 'data_task:screen_advanced',
      success: false,
      error: expect.stringContaining('sidecar unavailable'),
    }))
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('condition was not met')
}
