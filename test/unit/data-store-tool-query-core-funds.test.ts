import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { queryFundHolding, queryFundPerformance } from '../../src/agent/tools/data-store-tool-query-core-funds'

describe('DataStore fund query helpers', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-fund-query-tool-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('filters fund performance readback by plural requested codes', () => {
    store.saveFundPerformanceMetrics([
      {
        ...fundPerformanceRow('110011', null),
        metric_date: '2026-06-27',
        nav: null,
        return_ytd: null,
      },
      fundPerformanceRow('110011', 12.3),
      fundPerformanceRow('161725', 24.5),
      fundPerformanceRow('000001', 99.9),
    ])

    const result = queryFundPerformance(store, {
      codes: '110011,161725',
      limit: 10,
    })

    expect(result).toContain('110011')
    expect(result).toContain('161725')
    expect(result).not.toContain('000001')
    expect(result.indexOf('2026-06-24 110011')).toBeLessThan(result.indexOf('2026-06-27 110011'))
  })

  it('recovers fund holding queries when a fund code is passed as stockCode', () => {
    store.saveFundHolding([
      {
        fund_code: '161725',
        report_date: '2026Q1',
        rank: 1,
        stock_code: '600519',
        stock_name: '贵州茅台',
        hold_pct: 10.5,
        hold_value: 100,
        hold_shares: 1,
        source: 'eastmoney',
        fetched_at: '2026-06-25T08:00:00.000Z',
      },
    ])

    const result = queryFundHolding(store, {
      stockCode: '161725',
      limit: 10,
    })

    expect(result).toContain('161725')
    expect(result).toContain('600519')
  })
})

function fundPerformanceRow(code: string, return1y: number | null) {
  return {
    code,
    metric_date: '2026-06-24',
    provider: 'eastmoney',
    capability_id: 'eastmoney.fund.performance_metrics',
    source_action: 'fund_open_fund_rank_em',
    nav: 1.23,
    return_ytd: 1.2,
    return_1w: null,
    return_1m: null,
    return_3m: null,
    return_6m: null,
    return_1y: return1y,
    return_2y: null,
    return_3y: null,
    return_since_inception: null,
    fetched_at: '2026-06-25T08:00:00.000Z',
    raw_json: null,
  }
}
