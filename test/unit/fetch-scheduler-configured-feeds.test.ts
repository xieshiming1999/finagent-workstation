import { describe, expect, it, vi } from 'vitest'
import { FetchScheduler } from '../../src/agent/data/queue/fetch-scheduler'
import type { FeedConfig } from '../../src/agent/data/store/data-store-types'

function feed(overrides: Partial<FeedConfig>): FeedConfig {
  return {
    feed_id: 'kline_daily',
    display_name: '日K线数据',
    feed_type: 'kline_daily',
    enabled: 1,
    scope: 'custom',
    scope_codes: '600519 000001',
    history_years: 5,
    update_frequency: 'daily',
    trigger_time: '15:30',
    source_priority: '["eastmoney"]',
    status: 'idle',
    last_run_at: null,
    last_error: null,
    config_json: null,
    updated_at: null,
    ...overrides,
  }
}

function makeHarness(feeds: FeedConfig[]) {
  const enqueued: Array<{ taskType: string; code: string | null; params: Record<string, unknown>; priority: number }> = []
  let activeTasks: Array<{ task_type: string; code?: string | null }> = []
  const queue = {
    enqueue: vi.fn((taskType: string, code: string | null, params: Record<string, unknown>, priority: number) => {
      enqueued.push({ taskType, code, params, priority })
      return enqueued.length
    }),
  }
  const store = {
    getFeedConfigs: vi.fn(() => feeds),
    updateFeedConfig: vi.fn(),
    query: vi.fn((sql: string, taskType?: string, code?: string) => {
      if (String(sql).includes('FROM fetch_tasks')) {
        const filtersByCode = String(sql).includes('code = ?')
        return activeTasks
          .filter((task) => task.task_type === taskType && (!filtersByCode || task.code === code))
          .map((_, index) => ({ id: index + 1 }))
      }
      return []
    }),
    queryFundList: vi.fn(() => [
      { code: '000009', name: '易方达天天理财货币A', fund_type: '货币型', fund_category: 'money' },
      { code: '110022', name: '易方达消费行业', fund_type: '混合型', fund_category: 'ordinary' },
    ]),
    queryStockList: vi.fn(() => [{ code: '600519' }, { code: '000001' }]),
    queryIndexConstituents: vi.fn(() => [{ stock_code: '600519' }, { stock_code: '000001' }]),
  }
  return {
    enqueued,
    queue,
    store,
    setActiveTasks: (tasks: Array<{ task_type: string; code?: string | null }>) => { activeTasks = tasks },
    scheduler: new FetchScheduler(store as any, queue as any, ''),
  }
}

describe('FetchScheduler configured Data Feeds', () => {
  it('automatically enqueues due K-line feeds as one batch task', () => {
    const { scheduler, enqueued } = makeHarness([
      feed({ feed_id: 'kline_daily', feed_type: 'kline_daily', scope: 'custom', scope_codes: '600519 000001' }),
    ])

    const ids = scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))

    expect(ids).toEqual([1])
    expect(enqueued).toEqual([
      expect.objectContaining({
        taskType: 'kline_batch',
        code: null,
        params: expect.objectContaining({ codes: ['600519', '000001'], source: 'configured-feed-scheduler' }),
      }),
    ])
  })

  it('splits broad fund NAV feeds into ordinary NAV and money-yield tasks', () => {
    const { scheduler, enqueued } = makeHarness([
      feed({ feed_id: 'fund_nav', feed_type: 'fund_nav', scope: 'custom', scope_codes: '000009 110022' }),
    ])

    scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))

    expect(enqueued.map((item) => [item.taskType, item.code])).toEqual([
      ['fund_nav', '110022'],
      ['fund_money_yield', '000009'],
    ])
  })

  it('does not duplicate scheduled split fund NAV work while money-yield task is active', () => {
    const { scheduler, enqueued, setActiveTasks } = makeHarness([
      feed({ feed_id: 'fund_nav', feed_type: 'fund_nav', scope: 'custom', scope_codes: '000009 110022' }),
    ])
    setActiveTasks([{ task_type: 'fund_money_yield', code: '000009' }])

    const ids = scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))

    expect(ids).toEqual([])
    expect(enqueued).toEqual([])
  })

  it('queues prerequisite universe tasks for computed scopes with no local rows', () => {
    const { scheduler, enqueued, store } = makeHarness([
      feed({ feed_id: 'fund_holding', display_name: '基金持仓', feed_type: 'fund_holding', scope: 'all', scope_codes: null }),
    ])
    store.queryFundList.mockReturnValue([])

    scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))

    expect(enqueued).toEqual([
      expect.objectContaining({ taskType: 'fund_list', code: null }),
    ])
    expect(store.updateFeedConfig).toHaveBeenCalledWith('fund_holding', {
      status: 'waiting_prerequisite',
      last_error: 'Feed 基金持仓 is waiting for prerequisite data: fund_list is required to resolve all-fund feed scope. The target feed has not run yet.',
    })
    expect(store.updateFeedConfig).not.toHaveBeenCalledWith(
      'fund_holding',
      expect.objectContaining({ last_run_at: expect.any(String) }),
    )
  })

  it('runs the target feed after prerequisite rows become available', () => {
    const scheduledFeed = feed({ feed_id: 'fund_holding', display_name: '基金持仓', feed_type: 'fund_holding', scope: 'all', scope_codes: null })
    const { scheduler, enqueued, store } = makeHarness([scheduledFeed])
    store.queryFundList.mockReturnValueOnce([])

    scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))
    expect(enqueued.map((item) => [item.taskType, item.code])).toEqual([['fund_list', null]])
    expect(scheduledFeed.last_run_at).toBeNull()

    scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:05:00.000Z'))

    expect(enqueued.map((item) => [item.taskType, item.code])).toEqual([
      ['fund_list', null],
      ['fund_holding', '110022'],
    ])
    expect(store.updateFeedConfig).toHaveBeenLastCalledWith(
      'fund_holding',
      expect.objectContaining({ status: 'running', last_run_at: expect.any(String) }),
    )
  })

  it('records a non-provider configuration reason when a due feed has no codes and no prerequisite', () => {
    const { scheduler, enqueued, store } = makeHarness([
      feed({
        feed_id: 'watchlist_money_flow',
        display_name: '资金流',
        feed_type: 'money_flow',
        scope: 'watchlist',
        scope_codes: null,
      }),
    ])

    const ids = scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))

    expect(ids).toEqual([])
    expect(enqueued).toEqual([])
    expect(store.updateFeedConfig).toHaveBeenCalledWith('watchlist_money_flow', {
      status: 'idle',
      last_error: 'Feed 资金流 needs codes. Add items to the related watchlist or set scope_codes.',
    })
  })

  it('skips manual, disabled, and not-yet-due feeds', () => {
    const { scheduler, enqueued } = makeHarness([
      feed({ feed_id: 'manual_feed', update_frequency: 'manual' }),
      feed({ feed_id: 'disabled_feed', enabled: 0 }),
      feed({ feed_id: 'recent_feed', last_run_at: '2026-06-24T07:50:00.000Z' }),
    ])

    const ids = scheduler.triggerDueConfiguredFeeds(new Date('2026-06-24T08:00:00.000Z'))

    expect(ids).toEqual([])
    expect(enqueued).toEqual([])
  })
})
