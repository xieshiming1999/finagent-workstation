import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { queryStockDailyValuation } from '../../src/agent/tools/data-store-tool-query-core-fundamentals'
import { queryIndexQuote, queryQuote } from '../../src/agent/tools/data-store-tool-query-quotes'

describe('query_stock_daily_valuation bounded samples', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-valuation-query-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
    store.saveFundamental([
      {
        code: '000001',
        report_date: '2026-03-31',
        pe_ttm: 12,
        pb: 1.1,
        roe: 18,
        source: 'fixture',
        updated_at: '2026-06-26T00:00:00Z',
      },
      {
        code: '000002',
        report_date: '2026-03-31',
        pe_ttm: 25,
        pb: 0.9,
        roe: 20,
        source: 'fixture',
        updated_at: '2026-06-26T00:00:00Z',
      },
      {
        code: '000003',
        report_date: '2026-03-31',
        pe_ttm: 8,
        pb: 2.2,
        roe: 6,
        source: 'fixture',
        updated_at: '2026-06-26T00:00:00Z',
      },
    ] as any)
    store.saveQuoteSnapshots([
      {
        code: '000001',
        timestamp: '2026-06-26 10:00:00',
        fetched_at: '2026-06-26T02:00:00Z',
        source: 'fixture',
        name: '平安银行',
        price: 10.5,
        change_pct: 1.2,
      },
      {
        code: '000002',
        timestamp: '2026-06-26 10:00:00',
        fetched_at: '2026-06-26T02:00:00Z',
        source: 'fixture',
        name: '万科A',
        price: 7.1,
        change_pct: -0.5,
      },
    ] as any)
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('applies nested params filters when no code is provided', () => {
    const result = queryStockDailyValuation(store, {
      limit: 10,
      params: { pe_lte: 20, roe_gte: 15 },
    })

    expect(result).toContain('000001 2026-03-31 PE:12')
    expect(result).not.toContain('000002')
    expect(result).not.toContain('000003')
    expect(result).toContain('readback:query_stock_daily_valuation')
    expect(result).toContain('kind":"valuation_analysis')
    expect(result).toContain('strategyReadiness":"analysis_only')
  })

  it('supports batch quote readback through comma-separated codes', () => {
    const result = queryQuote(store, {
      codes: '000001,000002',
      limit: 2,
    })

    expect(result).toContain('000001 quote snapshots')
    expect(result).toContain('平安银行')
    expect(result).toContain('000002 quote snapshots')
    expect(result).toContain('万科A')
    expect(result).toContain('readback:query_quote')
  })

  it('supports batch index quote readback through comma-separated codes', () => {
    const result = queryIndexQuote(store, {
      codes: '000001,000002',
      limit: 2,
    })

    expect(result).toContain('000001 quote snapshots')
    expect(result).toContain('平安银行')
    expect(result).toContain('000002 quote snapshots')
    expect(result).toContain('万科A')
    expect(result).toContain('readback:query_index_quote')
  })

  it('applies top-level filters when no code is provided', () => {
    const result = queryStockDailyValuation(store, {
      limit: 10,
      pe_lte: 20,
      roe_gte: 15,
    })

    expect(result).toContain('000001 2026-03-31 PE:12')
    expect(result).not.toContain('000002')
    expect(result).not.toContain('000003')
    expect(result).toContain('kind":"valuation_analysis')
  })

  it('accepts common PE/ROE alias filters when no code is provided', () => {
    const result = queryStockDailyValuation(store, {
      limit: 10,
      params: { pe_max: 20, roe_min: 15 },
    })

    expect(result).toContain('000001 2026-03-31 PE:12')
    expect(result).not.toContain('000002')
    expect(result).not.toContain('000003')
  })
})
