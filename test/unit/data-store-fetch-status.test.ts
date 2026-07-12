import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { fetchDataStore, fetchStatus } from '../../src/agent/tools/data-store-tool-fetch'
import { queryFundNav } from '../../src/agent/tools/data-store-tool-query-core-funds'

describe('DataStore fetch_status provenance', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-fetch-status-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('reports empty fetch queue through provider.fetch_task_queue', () => {
    const payload = JSON.parse(fetchStatus(store))

    expect(payload.action).toBe('fetch_status')
    expect(payload.interfaceId).toBe('provider.fetch_task_queue')
    expect(payload.capabilityId).toBe('local.provider.fetch_task_queue')
    expect(payload.canonicalSchema).toBe('fetch_task_queue')
    expect(payload.canonicalTable).toBe('fetch_tasks')
    expect(payload.readbackAction).toBe('fetch_status')
    expect(payload.status).toBe('pending')
    expect(payload.tasks).toEqual([])
    expect(payload.summary.pending).toBe(0)
  })

  it('rejects broad fundamental fetch with valuation-screening recovery guidance', async () => {
    await expect(fetchDataStore(store, null, {
      action: 'fetch',
      type: 'fundamental',
      block: true,
    })).rejects.toThrow(/code required for type "fundamental".*not full-market PE\/PB\/ROE screening.*query_stock_daily_valuation.*screen_stock.*valuation data gap/)
  })

  it('rejects ordinary fund_nav fetch for known money funds', async () => {
    store.saveFundList([{
      code: '000009',
      name: '易方达天天理财货币A',
      fund_type: '货币型',
      company: null,
      manager: null,
      setup_date: null,
      total_size: null,
      nav: null,
      nav_date: null,
      return_1y: null,
      return_3y: null,
      return_ytd: null,
      updated_at: '2026-07-04T00:00:00.000Z',
    }])

    await expect(fetchDataStore(store, null, {
      action: 'fetch',
      type: 'fund_nav',
      code: '000009',
      block: true,
    })).rejects.toThrow(/fund_nav is not valid for known money fund 000009.*query_fund_money_yield.*fund_money_yield.*per-10k income.*7-day annualized yield/)
  })

  it('routes known money fund NAV misses to money-yield readback guidance', () => {
    store.saveFundList([{
      code: '000009',
      name: '易方达天天理财货币A',
      fund_type: '货币型',
      company: null,
      manager: null,
      setup_date: null,
      total_size: null,
      nav: null,
      nav_date: null,
      return_1y: null,
      return_3y: null,
      return_ytd: null,
      updated_at: '2026-07-04T00:00:00.000Z',
    }])

    const result = queryFundNav(store, { action: 'query_fund_nav', code: '000009', limit: 60 })

    expect(result).toContain('known money fund 000009')
    expect(result).toContain('query_fund_money_yield')
    expect(result).toContain('fund_nav" is not valid')
    expect(result).not.toContain('type: "fund_nav"')
  })

  it('supports compact batch fund NAV readback with codes', () => {
    store.saveFundNav([
      { code: '000015', date: '2026-07-06', nav: 1.1998, acc_nav: null, daily_return: 0, source: 'eastmoney', fetched_at: '2026-07-08T05:49:15.866Z' },
      { code: '000051', date: '2026-07-06', nav: 1.8136, acc_nav: null, daily_return: -0.97, source: 'eastmoney', fetched_at: '2026-07-08T02:19:33.494Z' },
    ])

    const result = queryFundNav(store, {
      action: 'query_fund_nav',
      codes: '000015,000051',
      limit: 5,
    })

    expect(result).toContain('000015 fund NAV')
    expect(result).toContain('000051 fund NAV')
    expect(result).toContain('readback:query_fund_nav')
    expect(result).not.toBe('code required')
  })

  it('classifies fetch task actionability through provider.fetch_task_queue', () => {
    const taskId = store.createTask('kline_daily', '600519', { start: '2026-01-01' }, 2)
    const actionableId = store.createTask('screen_advanced', null, { symbols: ['600519'] }, 4)
    store.updateTaskStatus(actionableId, 'failed', { progress: 100 }, 'provider timeout')
    const missingCodeId = store.createTask('fund_holding', null, {}, 5)
    store.updateTaskStatus(missingCodeId, 'failed', { progress: 100 }, 'code required')

    const pendingPayload = JSON.parse(fetchStatus(store))
    expect(pendingPayload.interfaceId).toBe('provider.fetch_task_queue')
    expect(pendingPayload.summary.pending).toBe(1)
    expect(pendingPayload.summary.actionableFailures).toBe(0)
    expect(pendingPayload.tasks).toHaveLength(1)
    expect(pendingPayload.tasks[0]).toMatchObject({
      id: taskId,
      type: 'kline_daily',
      code: '600519',
      status: 'pending',
      priority: 2,
      actionableFailure: false,
      nonActionableEvidence: false,
    })

    const allPayload = JSON.parse(fetchStatus(store, { status: 'all', limit: 10 }))
    expect(allPayload.summary.pending).toBe(1)
    expect(allPayload.summary.failed).toBe(2)
    expect(allPayload.summary.actionableFailures).toBe(1)
    expect(allPayload.summary.nonActionableEvidence).toBe(1)
    expect(allPayload.actionableFailures[0]).toMatchObject({
      id: actionableId,
      type: 'screen_advanced',
      actionableFailure: true,
      nonActionableEvidence: false,
    })
    expect(allPayload.actionableFailures[0].nextAction).toContain('data_health failureActionQueue')
    expect(allPayload.nonActionableEvidence[0]).toMatchObject({
      id: missingCodeId,
      type: 'fund_holding',
      actionableFailure: false,
      nonActionableEvidence: true,
    })
    expect(allPayload.nonActionableEvidence[0].nextAction).toContain('Add task scope/code parameters')
  })

  it('accepts completed as the agent-facing alias for stored done tasks', () => {
    const taskId = store.createTask('stock_list', null, {}, 3)
    store.updateTaskStatus(taskId, 'done', { progress: 100 })

    const completedPayload = JSON.parse(fetchStatus(store, { status: 'completed' }))

    expect(completedPayload.status).toBe('completed')
    expect(completedPayload.queryStatus).toBe('done')
    expect(completedPayload.summary.completed).toBe(1)
    expect(completedPayload.tasks).toHaveLength(1)
    expect(completedPayload.tasks[0]).toMatchObject({
      id: taskId,
      type: 'stock_list',
      status: 'completed',
      rawStatus: 'done',
      actionableFailure: false,
      nonActionableEvidence: false,
    })
    expect(completedPayload.tasks[0].nextAction).toContain('local query/readback')

    const donePayload = JSON.parse(fetchStatus(store, { status: 'done' }))
    expect(donePayload.status).toBe('completed')
    expect(donePayload.summary.completed).toBe(1)
  })

  it('reports completed fetches with zero persisted rows as empty, not persisted success', async () => {
    const fakeQueue = {
      enqueue: (taskType: string, code: string | null, params: Record<string, unknown>, priority: number) => {
        const id = store.createTask(taskType, code, params, priority)
        store.updateTaskStatus(id, 'done', {
          fetched: 0,
          total: 0,
          message: '0 periods saved',
        })
        return id
      },
      start: async () => {},
    }

    const payload = JSON.parse(await fetchDataStore(store, fakeQueue as any, {
      action: 'fetch',
      type: 'fundamental',
      code: '000858',
    }))

    expect(payload.ok).toBe(true)
    expect(payload.retrieval_status).toBe('empty')
    expect(payload.persistedRows).toBe(0)
    expect(payload.note).toContain('no reusable rows were persisted')
    expect(payload.note).not.toContain('has been persisted')
    expect(payload.tasks[0]).toMatchObject({
      type: 'fundamental',
      code: '000858',
      status: 'done',
      progress: expect.objectContaining({
        fetched: 0,
        message: '0 periods saved',
      }),
    })
  })

  it('returns degraded reusable-cache evidence when live K-line refresh fails after local readback exists', async () => {
    store.saveKline(Array.from({ length: 12 }, (_, index) => ({
      code: '300059',
      date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      open: 20 + index / 10,
      high: 21 + index / 10,
      low: 19 + index / 10,
      close: 20.5 + index / 10,
      volume: 1000 + index,
      amount: 2000 + index,
      change_pct: 0.5,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'local-fixture',
    })))

    const fakeQueue = {
      enqueue: (taskType: string, code: string | null, params: Record<string, unknown>, priority: number) => {
        const id = store.createTask(taskType, code, params, priority)
        store.updateTaskStatus(id, 'failed', null, 'All kline providers failed')
        return id
      },
      start: async () => {},
    }

    const payload = JSON.parse(await fetchDataStore(store, fakeQueue as any, {
      action: 'fetch',
      type: 'kline',
      code: '300059',
    }))

    expect(payload.ok).toBe(true)
    expect(payload.retrieval_status).toBe('degraded_reusable_cache')
    expect(payload.failed[0]).toMatchObject({
      type: 'kline_daily',
      code: '300059',
      status: 'failed',
    })
    expect(payload.reusableFallback).toMatchObject({
      readbackAction: 'query_kline',
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      codes: ['300059'],
      rowCount: 12,
      cacheStatus: 'local-reusable-after-provider-refresh-failed',
    })
    expect(payload.reusableFallback.latestByCode['300059']).toBe('2026-06-12')
    expect(payload.note).toContain('Live provider refresh failed')
  })

  it('accepts fundCode as a fetch alias for fund holding tasks', async () => {
    const fakeQueue = {
      enqueue: (taskType: string, code: string | null, params: Record<string, unknown>, priority: number) => {
        const id = store.createTask(taskType, code, params, priority)
        store.updateTaskStatus(id, 'done', {
          fetched: 9,
          total: 9,
          message: '9 holdings saved',
        })
        return id
      },
      start: async () => {},
    }

    const payload = JSON.parse(await fetchDataStore(store, fakeQueue as any, {
      action: 'fetch',
      type: 'fund_holding',
      fundCode: '008988',
    }))

    expect(payload.ok).toBe(true)
    expect(payload.persistedRows).toBe(9)
    expect(payload.tasks[0]).toMatchObject({
      type: 'fund_holding',
      code: '008988',
      status: 'done',
    })
  })
})
