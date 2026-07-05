import { describe, expect, it, vi } from 'vitest'
import { enqueueConfiguredDataFeed } from '../../src/agent/data/queue/data-feed-enqueue'
import type { FeedConfig } from '../../src/agent/data/store/data-store-types'

function feed(overrides: Partial<FeedConfig>): FeedConfig {
  return {
    feed_id: 'fund_nav',
    display_name: '基金净值',
    feed_type: 'fund_nav',
    enabled: 1,
    scope: 'custom',
    scope_codes: '000009 110022',
    history_years: 5,
    update_frequency: 'daily',
    trigger_time: '15:30',
    source_priority: 'auto',
    status: 'idle',
    last_run_at: null,
    last_error: null,
    config_json: null,
    updated_at: null,
    ...overrides,
  }
}

function harness() {
  const enqueued: Array<{ taskType: string; code: string | null; params: Record<string, unknown>; priority: number }> = []
  const queue = {
    enqueue: vi.fn((taskType: string, code: string | null, params: Record<string, unknown>, priority: number) => {
      enqueued.push({ taskType, code, params, priority })
      return enqueued.length
    }),
  }
  const store = {
    updateFeedConfig: vi.fn(),
    queryFundList: vi.fn(() => [
      { code: '000009', name: '易方达天天理财货币A', fund_type: '货币型', fund_category: 'money' },
      { code: '110022', name: '易方达消费行业', fund_type: '混合型', fund_category: 'ordinary' },
    ]),
    queryStockList: vi.fn(() => [{ code: '600519' }]),
    queryIndexConstituents: vi.fn(() => []),
  }
  return { enqueued, queue, store }
}

describe('enqueueConfiguredDataFeed', () => {
  it('splits fund NAV feeds and preserves feed run provenance params', () => {
    const { enqueued, queue, store } = harness()
    const result = enqueueConfiguredDataFeed(store as any, queue, feed({}), {
      basePath: '',
      feedRunId: 'fund_nav:test-run',
      extraParams: { source: 'manual-test' },
      taskPriority: 2,
      prerequisitePriority: 1,
      now: new Date('2026-06-24T08:00:00.000Z'),
    })

    expect(result).toMatchObject({ kind: 'started', taskIds: [1, 2] })
    expect(enqueued.map((row) => [row.taskType, row.code, row.priority])).toEqual([
      ['fund_nav', '110022', 2],
      ['fund_money_yield', '000009', 2],
    ])
    expect(enqueued[0].params).toMatchObject({
      _feedId: 'fund_nav',
      _feedRunId: 'fund_nav:test-run',
      source: 'manual-test',
      scope: 'custom',
      scope_codes: '000009 110022',
    })
    expect(store.updateFeedConfig).toHaveBeenCalledWith('fund_nav', {
      status: 'running',
      last_run_at: '2026-06-24T08:00:00.000Z',
    })
  })

  it('records prerequisite wait without consuming target feed freshness', () => {
    const { enqueued, queue, store } = harness()
    store.queryFundList.mockReturnValue([])

    const result = enqueueConfiguredDataFeed(store as any, queue, feed({
      feed_id: 'fund_holding',
      display_name: '基金持仓',
      feed_type: 'fund_holding',
      scope: 'all',
      scope_codes: null,
    }), {
      basePath: '',
      taskPriority: 4,
      prerequisitePriority: 3,
      now: new Date('2026-06-24T08:00:00.000Z'),
    })

    expect(result).toMatchObject({ kind: 'prerequisite', taskIds: [1], reason: 'fund_list is required to resolve all-fund feed scope' })
    expect(enqueued).toEqual([
      expect.objectContaining({ taskType: 'fund_list', code: null, priority: 3 }),
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
})
