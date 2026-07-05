import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { normalizeFinanceProviders, providerOrder } from '../../src/agent/data/provider-policy'

describe('DataStore maintenance feed defaults', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-maintenance-store-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('seeds stock and fund identity feeds as daily refreshes', () => {
    const feeds = store.getFeedConfigs()

    expect(feed(feeds, 'stock_list')).toMatchObject({
      update_frequency: 'daily',
      source_priority: '["tdx","sina","eastmoney"]',
    })
    expect(feed(feeds, 'fund_list')).toMatchObject({
      update_frequency: 'daily',
      source_priority: '["akshare"]',
    })
    expect(feed(feeds, 'fund_money_yield')).toMatchObject({
      feed_type: 'fund_money_yield',
      scope: 'all',
    })
    expect(feed(feeds, 'fund_nav')).toMatchObject({
      feed_type: 'fund_nav',
      scope: 'all',
    })
    expect(feed(feeds, 'fund_holding')).toMatchObject({
      feed_type: 'fund_holding',
      scope: 'all',
    })
    expect(feed(feeds, 'etf_quotes')).toMatchObject({
      feed_type: 'etf_quotes',
      scope: 'all',
    })
    expect(feed(feeds, 'index_components')).toMatchObject({
      feed_type: 'index_components',
      scope: 'preset',
    })
  })

  it('keeps K-line feed source priorities executable by provider policy', () => {
    const feeds = store.getFeedConfigs()
    const klinePriority = normalizeFinanceProviders(feed(feeds, 'kline_daily').source_priority)
    const indexPriority = normalizeFinanceProviders(feed(feeds, 'index_kline').source_priority)

    expect(providerOrder('kline', {}, klinePriority)).toEqual(['eastmoneyDirect', 'akshare'])
    expect(providerOrder('indexKline', {}, indexPriority)).toEqual(['tdx', 'eastmoneyDirect'])
  })

  it('repairs existing weekly identity feed configs to daily', () => {
    store.getFeedConfigs()
    store.updateFeedConfig('stock_list', { update_frequency: 'weekly', source_priority: '["eastmoney"]' } as any)
    store.updateFeedConfig('fund_list', { update_frequency: 'weekly', source_priority: '[]' } as any)

    const feeds = store.getFeedConfigs()

    expect(feed(feeds, 'stock_list')).toMatchObject({
      update_frequency: 'daily',
      source_priority: '["tdx","sina","eastmoney"]',
    })
    expect(feed(feeds, 'fund_list')).toMatchObject({
      update_frequency: 'daily',
      source_priority: '["akshare"]',
    })
  })

  it('repairs old watchlist fund batch defaults to bounded all-fund scope', () => {
    store.updateFeedConfig('fund_nav', { scope: 'watchlist', scope_codes: null } as any)
    store.updateFeedConfig('fund_money_yield', { scope: 'watchlist', scope_codes: null } as any)
    store.updateFeedConfig('fund_holding', { scope: 'watchlist', scope_codes: null } as any)

    const feeds = store.getFeedConfigs()

    expect(feed(feeds, 'fund_nav')).toMatchObject({ scope: 'all' })
    expect(feed(feeds, 'fund_money_yield')).toMatchObject({ scope: 'all' })
    expect(feed(feeds, 'fund_holding')).toMatchObject({ scope: 'all' })
  })

  it('adds missing default prefetch feeds to existing feed config tables', () => {
    store.getFeedConfigs()
    store.exec('DELETE FROM data_feed_config WHERE feed_id IN (?,?,?,?)', 'fund_performance', 'fund_money_yield', 'etf_quotes', 'index_components')

    const feeds = store.getFeedConfigs()

    expect(feed(feeds, 'fund_performance')).toMatchObject({ feed_type: 'fund_performance_metrics' })
    expect(feed(feeds, 'fund_money_yield')).toMatchObject({ feed_type: 'fund_money_yield' })
    expect(feed(feeds, 'etf_quotes')).toMatchObject({ feed_type: 'etf_quotes' })
    expect(feed(feeds, 'index_components')).toMatchObject({ feed_type: 'index_components' })
  })

  it('marks stale active fetch tasks as failed', () => {
    const old = '2026-06-24T01:00:00.000Z'
    const recent = new Date().toISOString()
    store.exec(
      'INSERT INTO fetch_tasks (task_type,code,params,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      'kline_batch',
      null,
      '{}',
      'running',
      5,
      old,
      old,
    )
    store.exec(
      'INSERT INTO fetch_tasks (task_type,code,params,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      'fund_list',
      null,
      '{}',
      'pending',
      5,
      recent,
      recent,
    )

    const count = store.failStaleActiveTasks(60 * 60 * 1000, 'test recovery')

    expect(count).toBe(1)
    expect(store.query('SELECT task_type,status,error FROM fetch_tasks ORDER BY id')).toEqual([
      expect.objectContaining({ task_type: 'kline_batch', status: 'failed', error: 'test recovery' }),
      expect.objectContaining({ task_type: 'fund_list', status: 'pending', error: null }),
    ])
  })

  it('records row/date coverage for money-fund yield rows', () => {
    store.saveFundMoneyYield([
      {
        code: '000009',
        date: '2026-06-23',
        million_copies_income: 0.5,
        seven_day_annualized_yield: 1.8,
        source: 'eastmoney',
        fetched_at: '2026-06-24T10:00:00.000Z',
      },
      {
        code: '000009',
        date: '2026-06-24',
        million_copies_income: 0.6,
        seven_day_annualized_yield: 1.9,
        source: 'eastmoney',
        fetched_at: '2026-06-24T10:00:00.000Z',
      },
    ])

    expect(store.getCoverage('000009', 'fund_money_yield')).toMatchObject({
      earliest_date: '2026-06-23',
      latest_date: '2026-06-24',
      row_count: 2,
    })
  })

  it('records row/date coverage for fund holding rows', () => {
    store.saveFundHolding([
      {
        fund_code: '000001',
        report_date: '2024Q4',
        stock_code: '600519',
        stock_name: '贵州茅台',
        hold_shares: 100,
        hold_value: 1000,
        hold_pct: 1.2,
        rank: 1,
        source: 'akshare',
      },
      {
        fund_code: '000001',
        report_date: '2025Q1',
        stock_code: '000001',
        stock_name: '平安银行',
        hold_shares: 200,
        hold_value: 2000,
        hold_pct: 1.4,
        rank: 1,
        source: 'akshare',
      },
    ])

    expect(store.getCoverage('000001', 'fund_holding')).toMatchObject({
      earliest_date: '2024Q4',
      latest_date: '2025Q1',
      row_count: 2,
    })
  })

  it('reconciles running feed rows when no active task remains', () => {
    store.getFeedConfigs()
    store.updateFeedConfig('fund_list', { status: 'running', last_error: null } as any)
    store.updateFeedConfig('stock_list', { status: 'running', last_error: null } as any)
    store.exec(
      'INSERT INTO fetch_tasks (task_type,code,params,status,priority,created_at) VALUES (?,?,?,?,?,?)',
      'stock_list',
      null,
      '{}',
      'pending',
      5,
      new Date().toISOString(),
    )

    const count = store.reconcileDanglingRunningFeeds()

    expect(count).toBe(1)
    expect(feed(store.getFeedConfigs(), 'fund_list')).toMatchObject({ status: 'idle', last_error: null })
    expect(feed(store.getFeedConfigs(), 'stock_list')).toMatchObject({ status: 'running', last_error: null })
  })
})

function feed(feeds: ReturnType<DataStore['getFeedConfigs']>, id: string) {
  const row = feeds.find((item) => item.feed_id === id)
  expect(row).toBeTruthy()
  return row!
}
