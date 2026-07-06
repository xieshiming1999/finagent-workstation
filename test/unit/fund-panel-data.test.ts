import { describe, expect, it } from 'vitest'
import { buildFundPulseRefreshRequests, fundNavSeedCodes, queryFundSuggestions } from '../../src/main/fund-panel-data'

class FakeStore {
  activeTasks = new Set<string>()
  coverage = new Map<string, { latest_date: string | null; last_updated: string | null }>()
  funds: Array<{ code: string; name?: string; fund_type?: string; fund_category?: string }> = []
  performance = { count: 0, latest: null as string | null }

  query<T = unknown>(sql: string, ...params: unknown[]): T[] {
    if (sql.includes('FROM fetch_tasks')) {
      const taskType = String(params[0] ?? '')
      const code = typeof params[1] === 'string' && params[1] !== 'pending' ? String(params[1]) : null
      return this.activeTasks.has(`${taskType}:${code ?? ''}`) || this.activeTasks.has(taskType)
        ? [{ id: 1 } as T]
        : []
    }
    if (sql.includes('FROM data_coverage')) {
      const row = this.coverage.get(String(params[0] ?? ''))
      return row ? [row as T] : []
    }
    if (sql.includes('FROM fund_performance_metrics')) {
      return [this.performance as T]
    }
    if (sql.includes('FROM fund_list')) {
      if (sql.includes('code IN')) {
        const codes = new Set(params.map((value) => String(value)))
        return this.funds.filter((fund) => codes.has(fund.code)) as T[]
      }
      const filtered = sql.includes('fund_category NOT IN')
        ? this.funds.filter((fund) => !['money', 'backend', 'unknown'].includes(fund.fund_category ?? 'unknown'))
        : this.funds
      return filtered.slice(0, Number(params[0]) || 8) as T[]
    }
    return []
  }
}

describe('fund panel data planning', () => {
  it('queues pulse bootstrap tasks and stale NAV seeds without duplicating active tasks', () => {
    const store = new FakeStore()
    store.activeTasks.add('fund_list')
    store.funds = [{ code: '110022', fund_category: 'ordinary' }, { code: '000001', fund_category: 'ordinary' }]
    store.coverage.set('110022', { latest_date: '2099-06-11', last_updated: '2099-06-11T00:00:00.000Z' })
    store.coverage.set('000001', { latest_date: null, last_updated: null })

    const plan = buildFundPulseRefreshRequests(store, ['110022'])

    expect(plan.existing).toBe(true)
    expect(plan.requests.map((request) => [request.taskType, request.code])).toEqual([
      ['etf_quotes', null],
      ['fund_performance', null],
      ['fund_nav', '000001'],
    ])
    for (const request of plan.requests) {
      expect(request.params.forceLive).toBe(true)
    }
  })

  it('prefers fund watchlist codes before cached top funds for NAV seeds', () => {
    const store = new FakeStore()
    store.funds = [{ code: '000001', fund_category: 'ordinary' }, { code: '000002', fund_category: 'ordinary' }]

    expect(fundNavSeedCodes(store, ['110022', '000001'], 3)).toEqual(['110022', '000001', '000002'])
  })

  it('skips money funds and backend share classes for ordinary NAV seeds', () => {
    const store = new FakeStore()
    store.funds = [
      { code: '110022', name: '易方达消费行业股票', fund_type: '股票型', fund_category: 'ordinary' },
      { code: '000009', name: '易方达天天理财货币A', fund_type: '货币型-普通货币', fund_category: 'money' },
      { code: '000002', name: '华夏成长混合(后端)', fund_type: '混合型-灵活', fund_category: 'backend' },
      { code: '000008', name: '嘉实中证500ETF联接A', fund_type: '指数型', fund_category: 'etf' },
    ]

    expect(fundNavSeedCodes(store, ['000009', '000002', '110022'], 4)).toEqual(['110022', '000008'])
  })

  it('reads cached fund suggestions without enqueueing provider work', () => {
    const store = new FakeStore()
    store.funds = [{ code: '110022', fund_category: 'ordinary' }, { code: '000001', fund_category: 'ordinary' }]

    expect(queryFundSuggestions(store, 1)).toEqual([{ code: '110022', fund_category: 'ordinary' }])
  })

  it('does not queue duplicate fund nav refresh work for active watchlist tasks', () => {
    const store = new FakeStore()
    store.activeTasks.add('fund_nav:110022')
    store.funds = [{ code: '110022', fund_category: 'ordinary' }, { code: '000001', fund_category: 'ordinary' }]

    const plan = buildFundPulseRefreshRequests(store, ['110022'])

    expect(plan.existing).toBe(true)
    expect(plan.requests.map((request) => [request.taskType, request.code])).toEqual([
      ['fund_list', null],
      ['etf_quotes', null],
      ['fund_performance', null],
      ['fund_nav', '000001'],
    ])
    for (const request of plan.requests) {
      expect(request.params.forceLive).toBe(true)
    }
  })

  it('skips fund performance refresh when performance metrics are fresh or already active', () => {
    const freshStore = new FakeStore()
    freshStore.performance = { count: 20, latest: '2099-06-24T00:00:00.000Z' }
    freshStore.funds = [{ code: '000001', fund_category: 'ordinary' }]

    expect(buildFundPulseRefreshRequests(freshStore, []).requests.map((request) => request.taskType)).toEqual([
      'fund_list',
      'etf_quotes',
      'fund_nav',
    ])

    const activeStore = new FakeStore()
    activeStore.activeTasks.add('fund_performance')
    activeStore.funds = [{ code: '000001', fund_category: 'ordinary' }]

    const activePlan = buildFundPulseRefreshRequests(activeStore, [])
    expect(activePlan.existing).toBe(true)
    expect(activePlan.requests.map((request) => request.taskType)).toEqual([
      'fund_list',
      'etf_quotes',
      'fund_nav',
    ])
  })
})
