import { describe, expect, it } from 'vitest'
import {
  buildFundPulseActionPrompt,
  buildFundPulseSummary,
  type FundPulseData,
} from '../../src/renderer/components/fund-pulse-model'

describe('fund pulse product summary model', () => {
  it('reports ready when cached ETF or fund rows are available', () => {
    const data: FundPulseData = {
      etfMovers: [{ code: '510300', name: '沪深300ETF', price: 4.12, change_pct: 1.2, volume: 1000, timestamp: '2026-06-15', source: 'tdx', cache_status: 'cache' }],
      fundLeaders: [],
      navMovers: [],
      cache: { fundListCount: 10, fundNavCount: 20, fundPerformanceCount: 5, etfCount: 1, etfQuoteCount: 1 },
      tasks: [{ id: 1, task_type: 'fund_nav', code: '110022', status: 'failed', error: 'timeout' }],
    }

    const summary = buildFundPulseSummary(data)

    expect(summary.state).toBe('ready')
    expect(summary.hasRows).toBe(true)
    expect(summary.cacheRows).toBe(37)
    expect(summary.failedTasks.map((task) => task.id)).toEqual([1])
  })

  it('distinguishes empty, building, and failed empty-cache states', () => {
    expect(buildFundPulseSummary({ etfMovers: [], fundLeaders: [], navMovers: [] }).state).toBe('empty-cache')

    expect(buildFundPulseSummary({
      etfMovers: [],
      fundLeaders: [],
      navMovers: [],
      tasks: [{ id: 2, task_type: 'fund_list', code: null, status: 'pending' }],
    }).state).toBe('building')

    expect(buildFundPulseSummary({
      etfMovers: [],
      fundLeaders: [],
      navMovers: [],
      tasks: [{ id: 3, task_type: 'fund_list', code: null, status: 'failed', error: 'All sources failed' }],
    }).state).toBe('failed')
  })

  it('prioritizes failed and active tasks in the compact task list', () => {
    const summary = buildFundPulseSummary({
      etfMovers: [],
      fundLeaders: [],
      navMovers: [],
      tasks: [
        { id: 1, task_type: 'done', code: null, status: 'done' },
        { id: 2, task_type: 'running', code: null, status: 'running' },
        { id: 3, task_type: 'failed', code: null, status: 'failed', error: 'timeout' },
        { id: 4, task_type: 'pending', code: null, status: 'pending' },
      ],
    })

    expect(summary.visibleTasks.map((task) => task.id)).toEqual([3, 2, 4, 1])
  })

  it('builds agent prompts for right-click fund pulse actions', () => {
    const target = { kind: 'etf' as const, code: '510300', name: '沪深300ETF' }

    expect(buildFundPulseActionPrompt('analyze', target)).toContain('Analyze 沪深300ETF (510300)')
    expect(buildFundPulseActionPrompt('analyze', target)).toContain('analysis-evidence-v1')
    expect(buildFundPulseActionPrompt('compare', target)).toContain('current peers')
    expect(buildFundPulseActionPrompt('dashboard', target)).toContain('do not present analysis as a validated strategy')
  })
})
