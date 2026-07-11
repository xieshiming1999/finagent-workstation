import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { ingestEndpointResult } from '../../src/agent/data/ingestion/registry'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import type { ToolContext } from '../../src/agent/tool'

vi.mock('../../src/main/sidecar', () => ({
  getGotdxUrl: vi.fn(() => 'http://127.0.0.1:19801'),
}))

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'fin-ingestion-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}

function rows(store: DataStore, table: string): Array<Record<string, unknown>> {
  return (store as any).all(`SELECT * FROM ${table}`)
}

function makeCtx(basePath: string, opts: { tushareToken?: string } = {}): ToolContext {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
    getConfigValue: (key: string) => key === 'TUSHARE_TOKEN' ? opts.tushareToken : undefined,
  }
}

describe('structured endpoint ingestion', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'))
    basePath = makeBasePath()
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    closeDb()
    if (basePath) rmSync(basePath, { recursive: true, force: true })
  })

  it('persists known TDX endpoint schemas into canonical tables', () => {
    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'quote',
      payload: { List: [{ Code: '600519', Name: '贵州茅台', Price: 1281.91, PrevClose: 1307.22, DateTime: '2026-06-04 09:31:00' }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot')[0]).toMatchObject({
      code: '600519',
      source: 'tdx',
      price: 1281.91,
      timestamp: '2026-06-04T09:31:00.000Z',
    })
    expect(rows(store, 'quote_snapshot')[0].fetched_at).toBeTruthy()

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'quotes_list',
      payload: { List: [{ code: '000001', name: '平安银行', market: 0, price: 10.15, prevClose: 10.02, open: 10.05, high: 10.2, low: 9.98, volume: 120000, amount: 1215000 }] },
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '000001')).toMatchObject({ code: '000001', price: 10.15, source: 'tdx' })
    expect(rows(store, 'stock_list').find((row) => row.code === '000001')).toMatchObject({ code: '000001', name: '平安银行', market: 'SZ', stock_type: 'stock' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'mac/quotes',
      payload: {
        Market: 1,
        Code: '600519',
        Name: '贵州茅台',
        DateTime: '2026-06-04 10:30:00',
        Price: 1288.5,
        PreClose: 1300,
        Open: 1292,
        High: 1295,
        Low: 1280,
        Vol: 120000,
        Amount: 154620000,
        Turnover: 0.42,
        ChartData: [{ Time: '10:30:00', Price: 1288.5, Avg: 1287.2, Vol: 1200, Momentum: -11.5 }],
      },
      code: '600519',
      source: 'tdx:mac',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '600519' && row.source === 'tdx:mac')).toMatchObject({
      code: '600519',
      source: 'tdx:mac',
      price: 1288.5,
      timestamp: '2026-06-04T10:30:00.000Z',
      turnover_rate: 0.42,
    })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'kline',
      payload: { List: [{ DateTime: '2026-06-03 15:00:00', Open: 12.8, High: 13.1, Low: 12.7, Close: 12.9, Vol: 1000, Amount: 12900 }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily')[0]).toMatchObject({ code: '600519', date: '2026-06-03', source: 'tdx' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'mac/bars',
      payload: { List: [{ DateTime: '2026-06-04 15:00:00', Open: 1280, High: 1290, Low: 1276, Close: 1288, Vol: 120000, Amount: 154800000 }] },
      code: '600519',
      source: 'tdx:mac',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily').find((row) => row.code === '600519' && row.date === '2026-06-04')).toMatchObject({ code: '600519', date: '2026-06-04', close: 1288, source: 'tdx:mac' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'tick_chart',
      payload: { List: [{ DateTime: '2026-06-04 09:31:00', Price: 1280, AvgPrice: 1280.5, Vol: 20, Amount: 25600 }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'tick_chart_intraday', count: 1 })
    expect(rows(store, 'tick_chart_intraday')[0]).toMatchObject({ code: '600519', trade_date: '2026-06-04', time: '09:31:00' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'transactions',
      payload: { List: [{ DateTime: '2026-06-04 09:32:00', Price: 1281, Vol: 3, Direction: 'B' }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'transactions', count: 1 })
    expect(rows(store, 'transactions')[0]).toMatchObject({ code: '600519', time: '09:32:00', direction: 'B' })

    expect(ingestEndpointResult(store, {
      provider: 'sina',
      endpoint: 'stock_transactions',
      payload: [{ symbol: 'sh600519', ticktime: '09:33:00', price: '1282.50', volume: '200', kind: 'U' }],
      code: '600519',
      params: { date: '2026-06-04' },
    })).toMatchObject({ persisted: true, table: 'transactions', count: 1 })
    expect(rows(store, 'transactions').find((row) => row.time === '09:33:00')).toMatchObject({
      code: '600519',
      trade_date: '2026-06-04',
      price: 1282.5,
      volume: 200,
      direction: 'buy',
      source: 'sina',
    })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'volume_profile',
      payload: { List: [{ Price: 1280, Vol: 100, Pct: 2.5 }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'volume_profile', count: 1 })
    expect(rows(store, 'volume_profile')[0]).toMatchObject({ code: '600519', price: 1280 })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'auction',
      payload: { List: [{ Time: '09:25:00', Price: 1280, Vol: 20, index: 0 }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'auction_snapshot', count: 1 })
    expect(rows(store, 'auction_snapshot')[0]).toMatchObject({ code: '600519', time: '09:25:00', price: 1280 })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'block',
      payload: { List: [{ BlockName: '白酒', BlockType: 2, Code: '600519', Name: '贵州茅台' }] },
      params: { filename: 'block_gn.dat' },
    })).toMatchObject({ persisted: true, table: 'tdx_block_member', count: 1 })
    expect(rows(store, 'tdx_block_member')[0]).toMatchObject({ block_code: 'block_gn.dat:白酒', code: '600519' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'xdxr',
      payload: {
        List: [
          {
            date: '2026-06-05',
            category: 1,
            categoryName: '除权除息',
            a: 10,
            b: 1.2,
            c: 0,
            d: 0.5,
          },
        ],
      },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'xdxr_event', count: 1 })
    expect(rows(store, 'xdxr_event')[0]).toMatchObject({ code: '600519', event_date: '2026-06-05', category: 1, category_name: '除权除息' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'index_momentum',
      payload: { momentum: [1.2, 2.4, 3.6], date: '2026-06-05' },
      code: '000001',
    })).toMatchObject({ persisted: true, table: 'tdx_index_momentum', count: 3 })
    expect(rows(store, 'tdx_index_momentum')[0]).toMatchObject({ code: '000001', trade_date: '2026-06-05', sequence: 0, value: 1.2 })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'top_board',
      payload: {
        category: 0,
        date: '2026-06-05',
        increase: [{ code: '600519', market: 1, price: 1281.91, value: 1200000 }],
        decrease: [{ code: '000001', market: 0, price: 10.2, value: 800000 }],
      },
    })).toMatchObject({ persisted: true, table: 'tdx_top_board', count: 2 })
    expect(rows(store, 'tdx_top_board')).toEqual(expect.arrayContaining([
      expect.objectContaining({ board_date: '2026-06-05', side: 'increase', code: '600519' }),
      expect.objectContaining({ board_date: '2026-06-05', side: 'decrease', code: '000001' }),
    ]))

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'company_info',
      payload: { CompanyName: '贵州茅台酒股份有限公司' },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'stock_company_info', count: 1 })
    expect(rows(store, 'stock_company_info')[0]).toMatchObject({ code: '600519', info_type: 'company_info' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'company_categories',
      payload: { List: [{ Title: '所属行业', Name: '白酒' }, { Title: '地区', Name: '贵州' }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'stock_company_info', count: 2 })
    expect(rows(store, 'stock_company_info')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '600519', info_type: 'company_categories', title: '所属行业' }),
      expect.objectContaining({ code: '600519', info_type: 'company_categories', title: '地区' }),
    ]))

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'index_info',
      payload: { Code: '000001', Close: 4083.97, PreClose: 4075, Open: 4078, High: 4090, Low: 4060, Vol: 1000000, Amount: 200000000 },
      code: '000001',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '000001')).toMatchObject({ code: '000001', price: 4083.97, source: 'tdx' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'stock_list',
      payload: { List: [{ Code: '000001', Name: '平安银行' }] },
    })).toMatchObject({ persisted: true, table: 'stock_list', count: 1 })
    expect(rows(store, 'stock_list').find((row) => row.code === '000001')).toMatchObject({ code: '000001', name: '平安银行', market: 'SZ' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'stock_list_range',
      payload: { List: [{ Code: '600036', Name: '招商银行' }] },
    })).toMatchObject({ persisted: true, table: 'stock_list', count: 1 })
    expect(rows(store, 'stock_list').find((row) => row.code === '600036')).toMatchObject({ code: '600036', name: '招商银行', market: 'SH' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'unusual',
      payload: { List: [{ Code: '600519', Name: '贵州茅台', Market: 1, Time: '09:30:15', Desc: '加速拉升', UnusualType: 4 }] },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'unusual_activity', count: 1 })
    expect(rows(store, 'unusual_activity')[0]).toMatchObject({ code: '600519', event_time: '09:30:15', info: '加速拉升' })
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({ code: '600519', name: '贵州茅台', market: 'SH', stock_type: 'stock' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'count',
      payload: { Count: 5321 },
      params: { market: 1 },
    })).toMatchObject({ persisted: true, table: 'tdx_security_count', count: 1 })
    expect(rows(store, 'tdx_security_count')[0]).toMatchObject({ scope: 'main', market: '1', count: 5321, source: 'tdx' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'chart_sampling',
      payload: { PreClose: 10, Prices: [10.1, 10.2, 9.9] },
      code: '000001',
      params: { market: 0 },
    })).toMatchObject({ persisted: true, table: 'tdx_chart_sampling', count: 3 })
    const samplingRows = rows(store, 'tdx_chart_sampling')
    expect(samplingRows).toHaveLength(3)
    expect(samplingRows[0]).toMatchObject({ scope: 'main', code: '000001', sequence: 0, market: '0', price: 10.1, pre_close: 10 })
    expect(samplingRows[0].change).toBeCloseTo(0.1, 6)
    expect(samplingRows[2]).toMatchObject({ scope: 'main', code: '000001', sequence: 2, market: '0', price: 9.9, pre_close: 10 })
    expect(samplingRows[2].change).toBeCloseTo(-0.1, 6)

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/count',
      payload: { Count: 12345 },
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'tdx_security_count', count: 1 })
    expect(rows(store, 'tdx_security_count').find((row) => row.scope === 'ex')).toMatchObject({ scope: 'ex', market: 'all', count: 12345, source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/chart_sampling',
      payload: { Prices: [612.4, 613.8] },
      code: 'TSLA',
      params: { category: 74 },
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'tdx_chart_sampling', count: 2 })
    expect(rows(store, 'tdx_chart_sampling')).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'ex', code: 'TSLA', sequence: 0, category: '74', price: 612.4, source: 'tdx:ex' }),
      expect.objectContaining({ scope: 'ex', code: 'TSLA', sequence: 1, category: '74', price: 613.8, source: 'tdx:ex' }),
    ]))

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/table',
      payload: '42#IMCI|上期有色,42#T001|通达信商品,',
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'ex_table_entry', count: 2 })
    expect(rows(store, 'ex_table_entry')).toEqual(expect.arrayContaining([
      expect.objectContaining({ entry_key: '42#IMCI', category: '42', code: 'IMCI', name: '上期有色', source: 'tdx:ex' }),
      expect.objectContaining({ entry_key: '42#T001', category: '42', code: 'T001', name: '通达信商品', source: 'tdx:ex' }),
    ]))

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/quote',
      payload: { Code: 'RBL8', Close: 3635, Open: 3610, High: 3650, Low: 3580, Vol: 10000, Amount: 1200000 },
      code: 'RBL8',
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === 'RBL8')).toMatchObject({ code: 'RBL8', price: 3635, source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/quotes',
      payload: { List: [{ code: 'IFL8', price: 3588, prevClose: 3570, open: 3575, high: 3592, low: 3568, volume: 2000, amount: 900000 }] },
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === 'IFL8')).toMatchObject({ code: 'IFL8', price: 3588, source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/quotes_list',
      payload: { List: [{ code: 'HCL8', price: 712.5, prevClose: 705.5, open: 706, high: 715, low: 700, volume: 1300, amount: 500000 }] },
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === 'HCL8')).toMatchObject({ code: 'HCL8', price: 712.5, source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/kline',
      payload: { List: [{ DateTime: '2026-06-03 15:00:00', Open: 3600, High: 3650, Low: 3580, Close: 3635, Vol: 10000, Amount: 1200000 }] },
      code: 'RBL8',
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily').find((row) => row.code === 'RBL8')).toMatchObject({ code: 'RBL8', close: 3635, source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/kline2',
      payload: { List: [{ DateTime: '2026-06-04 15:00:00', Open: 3650, High: 3680, Low: 3620, Close: 3666, Vol: 8000, Amount: 1180000 }] },
      code: 'RBL8',
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily').find((row) => row.code === 'RBL8' && row.date === '2026-06-04')).toMatchObject({ code: 'RBL8', close: 3666, source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/list',
      payload: { List: [{ Market: 31, Category: 30, Code: 'RBL8', Name: '螺纹连续' }] },
    })).toMatchObject({ persisted: true, table: 'stock_list', count: 1 })
    expect(rows(store, 'stock_list').find((row) => row.code === 'RBL8')).toMatchObject({ code: 'RBL8', name: '螺纹连续', market: 'EXT:30', stock_type: 'extended' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/categories',
      payload: { List: [{ Category: 30, Name: '国内期货', Abbr: 'FUT' }] },
      source: 'tdx:ex',
    })).toMatchObject({ persisted: true, table: 'ex_category', count: 1 })
    expect(rows(store, 'ex_category')[0]).toMatchObject({ category: 30, name: '国内期货', abbr: 'FUT', source: 'tdx:ex' })

    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'mac/board_list',
      payload: { List: [{ Code: 'BK0475', Name: '白酒', Price: 101.5, PreClose: 100, SymbolName: '贵州茅台', SymbolRiseSpeed: 2.2 }] },
      params: { sector_type: 'industry' },
      source: 'tdx:mac',
    })).toMatchObject({ persisted: true, table: 'sector_ranking', count: 1 })
    expect(rows(store, 'sector_ranking').find((row) => row.code === 'BK0475')).toMatchObject({ code: 'BK0475', name: '白酒', change_pct: 1.5, leading_stock: '贵州茅台', source: 'tdx:mac' })
  })

  it('does not persist TDX quote rows that fail requested-code validation', () => {
    expect(ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'quote',
      payload: { List: [{ Code: '600519', Name: '贵州茅台', Price: 1281.91, LastClose: 1279.22, Open: 1280, High: 1288, Low: 1272 }] },
      code: '600036',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 0 })

    expect(rows(store, 'quote_snapshot')).toHaveLength(0)
  })

  it('persists known AkShare/EastMoney endpoint schemas into canonical tables', () => {
    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_zt_pool_em',
      payload: { data: [{ '日期': '20260604', '代码': '600519', '名称': '贵州茅台', '涨跌幅': 10, '首次封板时间': '093000' }] },
      params: { date: '20260604' },
    })).toMatchObject({ persisted: true, table: 'limit_pool', count: 1 })
    expect(rows(store, 'limit_pool')[0]).toMatchObject({ date: '2026-06-04', code: '600519', limit_type: 'up' })
    expect(rows(store, 'limit_pool')[0].fetched_at).toBeTruthy()
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({ code: '600519', name: '贵州茅台', stock_type: 'stock', market: 'SH' })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_board_industry_name_em',
      payload: { data: [{ '板块代码': 'BK0475', '板块名称': '白酒', '涨跌幅': 2.1 }] },
    })).toMatchObject({ persisted: true, table: 'sector_ranking', count: 1 })
    expect(rows(store, 'sector_ranking')[0]).toMatchObject({ date: '2026-06-04', code: 'BK0475', name: '白酒' })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'margin',
      payload: {
        data: [{
          '日期': '20260604',
          '证券代码': '600519',
          '证券简称': '贵州茅台',
          '融资买入额': 123456,
          '融资余额': 234567,
          '融券卖出量': 3456,
          '融券余量': 4567,
          '融券余额': 5678,
          '融资融券余额': 240245,
        }],
      },
      params: { code: '600519', date: '20260604' },
      source: 'akshare',
    })).toMatchObject({ persisted: true, table: 'margin_trading', count: 1 })
    expect(rows(store, 'margin_trading')[0]).toMatchObject({
      trade_date: '2026-06-04',
      code: '600519',
      name: '贵州茅台',
      provider: 'akshare',
      capability_id: 'akshare.market.margin_trading',
      source_action: 'margin',
      financing_buy: 123456,
      financing_balance: 234567,
      margin_sell_volume: 3456,
      margin_balance_volume: 4567,
      margin_balance: 5678,
      total_balance: 240245,
    })
    expect(store.queryMarginTradingRows({ code: '600519', tradeDate: '2026-06-04' })[0]).toMatchObject({
      code: '600519',
      trade_date: '2026-06-04',
      provider: 'akshare',
    })
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({ code: '600519', name: '贵州茅台', stock_type: 'stock', market: 'SH' })

    expect(ingestEndpointResult(store, {
      provider: 'eastmoney',
      endpoint: 'sector_cons',
      payload: { data: { diff: [{ f12: '600519', f14: '贵州茅台', f2: 1281.91, f3: 1, f23: 5.98 }] } },
      params: { sector: '白酒' },
    })).toMatchObject({ persisted: true, table: 'industry_map', count: 1 })
    expect(rows(store, 'industry_map')[0]).toMatchObject({ code: '600519', industry_l1: '白酒' })
    expect(rows(store, 'quote_snapshot')[0]).toMatchObject({ code: '600519', price: 1281.91, name: '贵州茅台', pb: 5.98 })
    expect(rows(store, 'stock_list')[0]).toMatchObject({ code: '600519', name: '贵州茅台', industry: '白酒', stock_type: 'stock', market: 'SH' })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_board_concept_cons_em',
      payload: { data: [{ '代码': '300750', '名称': '宁德时代', '最新价': 426.42, '涨跌幅': -1.72, '市盈率-动态': 24.98, '市净率': 5.48, '总市值': 1000000000, '换手率': 2.3 }] },
      params: { symbol: '固态电池', type: 'concept' },
    })).toMatchObject({ persisted: false, table: 'output_only', schema: 'provider_diagnostic_result', count: 0 })
    expect(rows(store, 'industry_map').find((row) => row.code === '300750')).toBeUndefined()
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '300750')).toBeUndefined()
    expect(rows(store, 'stock_list').find((row) => row.code === '300750')).toBeUndefined()

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_hot_rank_em',
      payload: { data: [{ '代码': '600519', '名称': '贵州茅台', '排名': 1, '人气值': 9988 }] },
    })).toMatchObject({ persisted: true, table: 'hot_rank', count: 1 })
    expect(rows(store, 'hot_rank')[0]).toMatchObject({ code: '600519', rank: 1 })
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({ code: '600519', name: '贵州茅台', market: 'SH', stock_type: 'stock' })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_lhb_detail_daily_sina',
      payload: { data: [{ '日期': '2026-06-04', '代码': '600519', '名称': '贵州茅台', '上榜原因': '日涨幅偏离值达7%', '净买额': 1000000 }] },
    })).toMatchObject({ persisted: false, table: 'output_only', schema: 'provider_diagnostic_result', count: 0 })
    expect(rows(store, 'dragon_tiger')[0]).toBeUndefined()

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_hsgt_hist_em',
      payload: {
        data: [{
          '日期': '2026-06-04',
          '当日成交净买额': 20000000,
          '买入成交额': 100000000,
          '卖出成交额': 80000000,
          '持股市值': 1000000000000,
        }],
      },
      params: { symbol: '沪股通' },
    })).toMatchObject({ persisted: true, table: 'northbound_flow', count: 1 })
    expect(rows(store, 'northbound_flow')[0]).toMatchObject({
      trade_date: '2026-06-04',
      mutual_type: '沪股通',
      net_buy: 20000000,
      buy_amount: 100000000,
      sell_amount: 80000000,
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_hsgt_hold_stock_em',
      payload: {
        data: [{
          '日期': '2026-06-04',
          '代码': '600519',
          '名称': '贵州茅台',
          '今日持股-市值': 987654321,
          '今日持股-占流通股比': 1.23,
        }],
      },
    })).toMatchObject({ persisted: false, table: 'output_only', schema: 'provider_diagnostic_result', count: 0 })
    expect(rows(store, 'northbound_holding')[0]).toBeUndefined()

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_changes_em',
      payload: { data: [{ '时间': '09:35:20', '代码': '600519', '名称': '贵州茅台', '板块': '大笔买入', '相关信息': '净流入明显' }] },
    })).toMatchObject({ persisted: false, table: 'output_only', schema: 'provider_diagnostic_result', count: 0 })
    expect(rows(store, 'unusual_activity')[0]).toBeUndefined()

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_individual_fund_flow',
      payload: {
        data: [{
          '日期': '2026-06-04',
          '主力净流入-净额': 1000000,
          '小单净流入-净额': -100000,
          '中单净流入-净额': 200000,
          '大单净流入-净额': 300000,
          '超大单净流入-净额': 700000,
          '收盘价': 1281.91,
          '涨跌幅': 1.2,
        }],
      },
      params: { stock: '600519' },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'money_flow', count: 1 })
    expect(rows(store, 'money_flow')[0]).toMatchObject({
      code: '600519',
      date: '2026-06-04',
      main_net: 1000000,
      super_large_net: 700000,
      close_price: 1281.91,
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_individual_fund_flow_rank',
      payload: {
        data: [{
          '代码': '600519',
          '名称': '贵州茅台',
          '今日主力净流入-净额': 10000000,
          '今日主力净流入-净占比': 2.5,
          '今日超大单净流入-净额': 5000000,
          '今日超大单净流入-净占比': 1.2,
          '今日大单净流入-净额': 3000000,
          '今日大单净流入-净占比': 0.8,
          '今日中单净流入-净额': 2000000,
          '今日中单净流入-净占比': 0.5,
        }],
      },
      params: { indicator: '今日' },
    })).toMatchObject({ persisted: true, table: 'flow_rank', count: 1 })
    expect(rows(store, 'flow_rank')[0]).toMatchObject({
      code: '600519',
      period: 'today',
      main_net: 10000000,
      main_pct: 2.5,
      super_large_net: 5000000,
      large_net: 3000000,
      medium_net: 2000000,
    })
    expect(rows(store, 'flow_rank')[0].fetched_at).toBeTruthy()
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({
      code: '600519',
      name: '贵州茅台',
      market: 'SH',
      stock_type: 'stock',
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_zh_a_spot_em',
      payload: { data: [{ '代码': '600519', '名称': '贵州茅台', '最新价': 1281.91, '涨跌额': 12.3, '涨跌幅': 0.97, '今开': 1270, '最高': 1288, '最低': 1268, '昨收': 1269.61, '成交量': 100000, '成交额': 128000000, '市盈率-动态': 22.5, '市净率': 8.3, '总市值': 1600000000000, '换手率': 1.2 }] },
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '600519' && row.source === 'akshare')).toMatchObject({
      code: '600519',
      price: 1281.91,
      market_cap: 1600000000000,
      turnover_rate: 1.2,
    })
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({
      code: '600519',
      name: '贵州茅台',
      market: 'SH',
      stock_type: 'stock',
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_zh_a_spot',
      payload: { data: [{ '代码': '000001', '名称': '平安银行', '最新价': 9.87, '涨跌额': 0.12, '涨跌幅': 1.23, '今开': 9.75, '最高': 9.9, '最低': 9.7, '昨收': 9.75, '成交量': 123456, '成交额': 1200000000 }] },
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '000001')).toMatchObject({
      code: '000001',
      price: 9.87,
      change: 0.12,
      change_pct: 1.23,
      prev_close: 9.75,
      source: 'akshare',
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_zh_index_spot_em',
      payload: { data: [{ '代码': '000300', '名称': '沪深300', '最新价': 4100.5, '涨跌额': 10.5, '涨跌幅': 0.26, '今开': 4080, '最高': 4112, '最低': 4070, '昨收': 4090, '成交量': 123456, '成交额': 654321000 }] },
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '000300')).toMatchObject({
      code: '000300',
      price: 4100.5,
      source: 'akshare',
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_hk_spot_em',
      payload: { data: [{ '代码': '00593', '名称': '梦东方', '最新价': 2.62, '涨跌额': 1.11, '涨跌幅': 73.51, '今开': 1.6, '最高': 2.8, '最低': 1.6, '昨收': 1.51, '成交量': 2582500, '成交额': 7104955.0 }] },
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '00593')).toMatchObject({
      code: '00593',
      price: 2.62,
      prev_close: 1.51,
      source: 'akshare',
    })
    expect(rows(store, 'stock_list').find((row) => row.code === '00593')).toMatchObject({
      code: '00593',
      name: '梦东方',
      market: 'HK',
      stock_type: 'stock',
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_us_spot_em',
      payload: { data: [{ '代码': '105.BGLC', '名称': 'Bionexus Gene Lab Corp', '最新价': 1.23, '涨跌额': 0.1, '涨跌幅': 8.85, '开盘价': 1.15, '最高价': 1.3, '最低价': 1.1, '昨收价': 1.13, '总市值': 50000000, '市盈率': 12.4, '成交量': 123456, '成交额': 150000.0, '换手率': 427.44 }] },
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot').find((row) => row.code === '105.BGLC')).toMatchObject({
      code: '105.BGLC',
      price: 1.23,
      open: 1.15,
      prev_close: 1.13,
      market_cap: 50000000,
      turnover_rate: 427.44,
      source: 'akshare',
    })
    expect(rows(store, 'stock_list').find((row) => row.code === '105.BGLC')).toMatchObject({
      code: '105.BGLC',
      name: 'Bionexus Gene Lab Corp',
      market: 'US',
      stock_type: 'stock',
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_zh_a_hist',
      payload: { data: [{ '日期': '2026-06-04', '股票代码': '600519', '开盘': 1270, '收盘': 1281.91, '最高': 1288, '最低': 1268, '成交量': 100000, '成交额': 128000000, '涨跌幅': 0.97, '换手率': 1.2 }] },
      params: { symbol: '600519', adjust: 'qfq' },
      code: '600519',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily').find((row) => row.code === '600519')).toMatchObject({
      code: '600519',
      date: '2026-06-04',
      adjust: 'qfq',
      close: 1281.91,
    })

    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_zh_index_daily_em',
      payload: { data: [{ date: '2026-06-04', open: 4080, close: 4100.5, high: 4112, low: 4070, volume: 123456, amount: 654321000 }] },
      params: { symbol: 'sh000300' },
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily').find((row) => row.code === '000300')).toMatchObject({
      code: '000300',
      date: '2026-06-04',
      adjust: 'none',
      close: 4100.5,
    })
  })

  it('returns unknown generic endpoint payloads without persisting them', () => {
    const result = ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'unmapped_endpoint',
      payload: { value: 1 },
      request: { action: 'tdx', tdx_action: 'unmapped_endpoint' },
    })

    expect(result).toBeNull()
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)

    const inspectOnlyResult = ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'another_unmapped_endpoint',
      payload: { value: 2 },
      request: { action: 'tdx', tdx_action: 'another_unmapped_endpoint' },
    })

    expect(inspectOnlyResult).toBeNull()
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
  })

  it('persists registered generic AkShare schemas by default and supports inspect-only opt out', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ '日期': '20260604', '代码': '600519', '名称': '贵州茅台' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await tool.call('opt-out', {
      action: 'akshare',
      func: 'stock_zt_pool_em',
      params: { date: '20260604' },
      persist: false,
    }, makeCtx(basePath))
    expect(rows(store, 'limit_pool')).toHaveLength(0)

    const output = await tool.call('default-persist', {
      action: 'akshare',
      func: 'stock_zt_pool_em',
      params: { date: '20260604' },
    }, makeCtx(basePath))
    expect(output).toContain('"ingestion": "structured"')
    expect(rows(store, 'limit_pool')).toHaveLength(1)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('_provider=eastmoney'))).toBe(true)
  })

  it('routes query_margin_trading through DataStoreTool readback', async () => {
    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'margin',
      payload: {
        data: [{
          '日期': '20260604',
          '证券代码': '600519',
          '证券简称': '贵州茅台',
          '融资买入额': 123456,
          '融资余额': 234567,
          '融券卖出量': 3456,
          '融券余额': 5678,
          '融资融券余额': 240245,
        }],
      },
      params: { code: '600519', date: '20260604' },
      source: 'akshare',
    })).toMatchObject({ persisted: true, table: 'margin_trading', count: 1 })

    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const marginOutput = await tool.call('query-margin', {
      action: 'query_margin_trading',
      code: '600519',
      date: '2026-06-04',
    }, makeCtx(basePath))
    expect(marginOutput).toContain('600519')
    expect(marginOutput).toContain('interface:market.margin_trading')
    expect(marginOutput).toContain('provider:akshare')
    expect(marginOutput).toContain('asOf:2026-06-04')
    expect(marginOutput).toContain('fetchedAt:')
  })

  it('logs AkShare margin trading failed calls without persisting reusable rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'margin unavailable' }),
    })))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await expect(tool.call('margin-fail', {
      action: 'margin_trading',
      code: '600519',
      date: '20260604',
    }, makeCtx(basePath))).rejects.toThrow(/AkShare margin trading failed/)

    expect(rows(store, 'margin_trading')).toHaveLength(0)
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
    expect(rows(store, 'api_call_log').some((r) =>
      r.source === 'akshare' &&
      r.provider === 'akshare' &&
      r.interface_id === 'market.margin_trading' &&
      r.capability_id === 'akshare.market.margin_trading' &&
      r.action === 'margin_trading' &&
      r.endpoint === 'margin' &&
      r.success === 0 &&
      String(r.error ?? '').includes('margin unavailable'),
    )).toBe(true)
  })

  it('persists registered generic AkShare fund schemas by default', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(String(url))
      if (url.includes('fund_portfolio_hold_em')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { '截止日期': '2024Q1', '股票代码': '600519', '股票名称': '贵州茅台', '持股数': 1000, '持仓市值': 1281900, '占净值比例': 8.5 },
            ],
          }),
        }
      }
      if (url.includes('fund_manager_em')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { '经理ID': 'mgr-1', '姓名': '张三', '基金公司': '易方达基金', '起始日期': '2018-01-01', '管理规模': 320.5, '基金数量': 7, '最佳回报': 28.3, '从业年限': 8.2 },
            ],
          }),
        }
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    const holdingOutput = await tool.call('fund-holding', {
      action: 'akshare',
      func: 'fund_portfolio_hold_em',
      params: { symbol: '110011' },
    }, makeCtx(basePath))
    expect(holdingOutput).toContain('"table": "fund_holding"')
    expect(rows(store, 'fund_holding')[0]).toMatchObject({
      fund_code: '110011',
      report_date: '2024-03-31',
      stock_code: '600519',
      stock_name: '贵州茅台',
      hold_pct: 8.5,
    })
    expect(rows(store, 'stock_list').find((row) => row.code === '600519')).toMatchObject({
      code: '600519',
      name: '贵州茅台',
      market: 'SH',
      stock_type: 'stock',
    })

    const managerOutput = await tool.call('fund-manager', {
      action: 'akshare',
      func: 'fund_manager_em',
    }, makeCtx(basePath))
    expect(managerOutput).toContain('"table": "fund_manager"')
    expect(rows(store, 'fund_manager')[0]).toMatchObject({
      manager_id: 'mgr-1',
      name: '张三',
      company: '易方达基金',
      total_size: 320.5,
      fund_count: 7,
    })
    expect(calls.every((url) => url.includes('_provider=eastmoney'))).toBe(true)
  })

  it('persists registered generic AkShare fund list and nav schemas by default', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('fund_open_fund_rank_em')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { '基金代码': '110011', '基金简称': '易方达中小盘', '单位净值': 1.234, '日期': '2026-06-04', '近1年': 12.3, '近3年': 18.9, '今年来': 5.6 },
            ],
          }),
        }
      }
      if (url.includes('fund_open_fund_info_em')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { '净值日期': '2026-06-04', '单位净值': 1.234, '累计净值': 3.456, '日增长率': 0.7 },
            ],
          }),
        }
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    const fundListOutput = await tool.call('fund-list', {
      action: 'akshare',
      func: 'fund_open_fund_rank_em',
      params: { symbol: '全部' },
    }, makeCtx(basePath))
    expect(fundListOutput).toContain('"table": "fund_list"')
    expect(rows(store, 'fund_list')[0]).toMatchObject({
      code: '110011',
      name: '易方达中小盘',
      nav: 1.234,
      nav_date: '2026-06-04',
      return_1y: 12.3,
    })

    const fundNavOutput = await tool.call('fund-nav', {
      action: 'akshare',
      func: 'fund_open_fund_info_em',
      params: { symbol: '110011', indicator: '单位净值走势' },
    }, makeCtx(basePath))
    expect(fundNavOutput).toContain('"table": "fund_nav"')
    expect(rows(store, 'fund_nav')[0]).toMatchObject({
      code: '110011',
      date: '2026-06-04',
      nav: 1.234,
      acc_nav: 3.456,
      daily_return: 0.7,
    })
    const fundNavReadback = await tool.call('query-fund-nav', {
      action: 'query_fund_nav',
      code: '110011',
    }, makeCtx(basePath))
    expect(fundNavReadback).toContain('110011 fund NAV')
    expect(fundNavReadback).toContain('interface:fund.nav_history')
    expect(fundNavReadback).toContain('provider:akshare')
    expect(fundNavReadback).toContain('asOf:2026-06-04')
    expect(fundNavReadback).toContain('fetchedAt:')
    expect(calls.every((url) => url.includes('_provider=eastmoney'))).toBe(true)
  })

  it('persists registered generic TDX schemas by default and supports inspect-only opt out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        List: [{ code: '600519', name: '贵州茅台', price: 1281.91, prevClose: 1275.0, open: 1278, high: 1288, low: 1272, volume: 12345, amount: 1500000 }],
      }),
    })))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await tool.call('tdx-opt-out', {
      action: 'tdx',
      tdx_action: 'quotes_list',
      persist: false,
    }, makeCtx(basePath))
    expect(rows(store, 'quote_snapshot')).toHaveLength(0)

    const output = await tool.call('tdx-default-persist', {
      action: 'tdx',
      tdx_action: 'quotes_list',
    }, makeCtx(basePath))
    expect(output).toContain('"ingestion": "structured"')
    expect(rows(store, 'quote_snapshot')).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: '600519', source: 'tdx', price: 1281.91 })]),
    )
    expect(rows(store, 'stock_list')).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: '600519', name: '贵州茅台', market: 'SH', stock_type: 'stock' })]),
    )
  })

  it('rejects unknown generic AkShare schemas from normal workflow paths', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ field: 'value' }] }),
    })))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await expect(tool.call('unknown-default', {
      action: 'akshare',
      func: 'unknown_func',
    }, makeCtx(basePath))).rejects.toThrow('SCHEMA_UNKNOWN')
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)

    await expect(tool.call('unknown-opt-out', {
      action: 'akshare',
      func: 'unknown_func',
      persist: false,
    }, makeCtx(basePath))).rejects.toThrow('provider_diagnostic')
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)

    const diagnostic = JSON.parse(await tool.call('unknown-diagnostic', {
      action: 'provider_diagnostic',
      provider: 'akshare',
      func: 'unknown_func',
    }, makeCtx(basePath)))
    expect(diagnostic).toMatchObject({
      interfaceId: 'provider.diagnostic',
      schemaId: 'provider_diagnostic_result',
      provider: 'akshare',
      status: 'success',
    })
    expect(diagnostic.data.sampleRows).toEqual([{ field: 'value' }])
  })

  it('keeps Sina and Tencent provider diagnostics output-only and bounded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ url, data: [{ field: 'value' }] }),
    })))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    const sinaDiagnostic = JSON.parse(await tool.call('sina-diagnostic', {
      action: 'provider_diagnostic',
      provider: 'sina',
      endpoint: 'quote',
      code: '600519',
    }, makeCtx(basePath)))
    expect(sinaDiagnostic).toMatchObject({
      interfaceId: 'provider.diagnostic',
      schemaId: 'provider_diagnostic_result',
      provider: 'sina',
      status: 'success',
      provenance: {
        capabilityId: 'sina.provider.diagnostic',
      },
    })
    expect(sinaDiagnostic.data.sampleRows).toEqual([{ field: 'value' }])
    expect(JSON.stringify(sinaDiagnostic.data.rawPreview)).toContain('hq.sinajs.cn')

    const tencentDiagnostic = JSON.parse(await tool.call('tencent-diagnostic', {
      action: 'provider_diagnostic',
      provider: 'tencent',
      endpoint: 'quote',
      code: '600519',
    }, makeCtx(basePath)))
    expect(tencentDiagnostic).toMatchObject({
      interfaceId: 'provider.diagnostic',
      schemaId: 'provider_diagnostic_result',
      provider: 'tencent',
      status: 'success',
      provenance: {
        capabilityId: 'tencent.provider.diagnostic',
      },
    })
    expect(tencentDiagnostic.data.sampleRows).toEqual([{ field: 'value' }])
    expect(JSON.stringify(tencentDiagnostic.data.rawPreview)).toContain('qt.gtimg.cn')
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
  })

  it('persists AkShare stock shareholder rows into the governed shareholder table', async () => {
    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'holders',
      payload: {
        data: [{
          '编号': 1,
          '股东名称': '中国贵州茅台酒厂集团有限责任公司',
          '持股数量': 678000000,
          '持股比例': 54,
          '股本性质': '流通A股',
          '截至日期': '2026-03-31',
          '公告日期': '2026-04-20',
          '股东总数': 120000,
          '平均持股数': 5000,
        }],
      },
      params: { code: '600519' },
      source: 'akshare',
    })).toMatchObject({ persisted: true, table: 'stock_shareholder', count: 1 })
    expect(rows(store, 'stock_shareholder')[0]).toMatchObject({
      code: '600519',
      report_date: '2026-03-31',
      holder_name: '中国贵州茅台酒厂集团有限责任公司',
      source: 'akshare',
      hold_pct: 54,
    })

    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const output = await tool.call('shareholder-query', {
      action: 'query_stock_shareholders',
      code: '600519',
      holderName: '茅台酒厂',
    }, makeCtx(basePath))
    expect(output).toContain('Stock shareholders')
    expect(output).toContain('600519')
    expect(output).toContain('中国贵州茅台酒厂集团有限责任公司')
  })

  it('persists registered yfinance schemas into canonical and typed tables', async () => {
    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'fast_info',
      payload: { symbol: 'AAPL', data: { lastPrice: 315.2, previousClose: 310.1, open: 312, dayHigh: 316, dayLow: 309, lastVolume: 123456, marketCap: 4000000000000 } },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'quote_snapshot', count: 1 })
    expect(rows(store, 'quote_snapshot')[0]).toMatchObject({ code: 'AAPL', source: 'yfinance', price: 315.2 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'history',
      payload: { symbol: 'AAPL', data: [{ _index: '2026-06-03 00:00:00-04:00', Open: 310, High: 316, Low: 309, Close: 315, Volume: 1000 }] },
      params: { period: '5d' },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily')[0]).toMatchObject({ code: 'AAPL', date: '2026-06-03', source: 'yfinance', adjust: 'none' })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'info',
      payload: { symbol: 'AAPL', data: { sector: 'Technology', website: 'https://www.apple.com', marketCap: 4000000000000 } },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_profile_fields', count: 3 })
    expect(rows(store, 'yfinance_profile_fields')).toHaveLength(3)

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'financials',
      payload: { symbol: 'AAPL', data: [{ _index: 'Total Revenue', '2025-09-30T00:00:00': 416000000000 }] },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_statement_items', count: 1 })
    expect(rows(store, 'yfinance_statement_items')[0]).toMatchObject({ symbol: 'AAPL', statement_type: 'financials', item: 'Total Revenue', value: 416000000000 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'recommendations',
      payload: { symbol: 'AAPL', data: [{ period: '0m', strongBuy: 7, buy: 23, hold: 15, sell: 1, strongSell: 2 }] },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_recommendations', count: 1 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'news',
      payload: { symbol: 'AAPL', data: [{ id: 'n1', content: { title: 'Apple news', pubDate: '2026-06-04T10:00:00Z', summary: 'summary' } }] },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_news', count: 1 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'options',
      payload: { symbol: 'AAPL', data: ['2026-06-05', '2026-06-12'] },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_option_expiries', count: 2 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'option_chain',
      payload: { symbol: 'AAPL', calls: [{ contractSymbol: 'AAPL260605C00120000', strike: 120, lastPrice: 194.69, bid: 189.35, ask: 191.55, inTheMoney: true }], puts: [{ contractSymbol: 'AAPL260605P00120000', strike: 120, lastPrice: 0.01 }] },
      params: { date: '2026-06-05' },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_option_contracts', count: 2 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'dividends',
      payload: { symbol: 'AAPL', data: { '2026-05-11 09:30:00-04:00': 0.26 } },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_corporate_actions', count: 1 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'institutional_holders',
      payload: { symbol: 'AAPL', data: [{ Holder: 'Blackrock Inc.', 'Date Reported': '2026-03-31 00:00:00', Shares: 1144695425, Value: 355256232135 }] },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_holders', count: 1 })

    expect(ingestEndpointResult(store, {
      provider: 'yfinance',
      endpoint: 'insider_transactions',
      payload: { symbol: 'AAPL', data: [{ Insider: 'LEVINSON ARTHUR D', Text: 'Sale', 'Start Date': '2026-05-27 00:00:00', Shares: 50000, Value: 15551000 }] },
      code: 'AAPL',
      source: 'yfinance',
    })).toMatchObject({ persisted: true, table: 'yfinance_insider_transactions', count: 1 })

    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const ctx = makeCtx(basePath)
    await expect(tool.call('yf-profile', { action: 'query_yfinance', dataset: 'profile', symbol: 'AAPL' }, ctx)).resolves.toContain('sector')
    await expect(tool.call('yf-news', { action: 'query_yfinance', dataset: 'news', symbol: 'AAPL' }, ctx)).resolves.toContain('Apple news')
    await expect(tool.call('yf-expiries', { action: 'query_yfinance', dataset: 'option_expiries', symbol: 'AAPL' }, ctx)).resolves.toContain('2026-06-12')
  })

  it('persists supported Tushare schemas into canonical tables', () => {
    expect(ingestEndpointResult(store, {
      provider: 'tushare',
      endpoint: 'stock_basic',
      payload: { data: [{ ts_code: '600519.SH', symbol: '600519', name: '贵州茅台', market: '主板', industry: '白酒', list_date: '20010827' }] },
      source: 'tushare',
    })).toMatchObject({ persisted: true, table: 'stock_list', count: 1 })
    expect(rows(store, 'stock_list')[0]).toMatchObject({ code: '600519', name: '贵州茅台', industry: '白酒' })

    expect(ingestEndpointResult(store, {
      provider: 'tushare',
      endpoint: 'daily',
      payload: { data: [{ ts_code: '600519.SH', trade_date: '20260604', open: 1280, high: 1300, low: 1270, close: 1290, vol: 12, amount: 1548, pct_chg: 1.2 }] },
      params: { ts_code: '600519.SH' },
      source: 'tushare',
    })).toMatchObject({ persisted: true, table: 'kline_daily', count: 1 })
    expect(rows(store, 'kline_daily')[0]).toMatchObject({ code: '600519', date: '2026-06-04', volume: 1200, amount: 1548000, adjust: 'none' })

    expect(ingestEndpointResult(store, {
      provider: 'tushare',
      endpoint: 'daily_basic',
      payload: { data: [{ ts_code: '600519.SH', trade_date: '20260604', pe_ttm: 19.37, pb: 5.98, total_mv: 1600000, circ_mv: 1590000 }] },
      source: 'tushare',
    })).toMatchObject({ persisted: true, table: 'fundamental', count: 1 })
    expect(rows(store, 'fundamental')[0]).toMatchObject({ code: '600519', report_date: '2026-06-04', pe_ttm: 19.37, pb: 5.98 })
    expect(rows(store, 'data_coverage').find((r) => r.code === '600519' && r.data_type === 'fundamental')).toMatchObject({ earliest_date: '2026-06-04', latest_date: '2026-06-04' })

    expect(ingestEndpointResult(store, {
      provider: 'tushare',
      endpoint: 'trade_cal',
      payload: { data: [{ exchange: 'SSE', cal_date: '20260604', is_open: 1 }] },
      params: { exchange: 'SSE' },
      source: 'tushare',
    })).toMatchObject({ persisted: true, table: 'trade_calendar', count: 1 })
    expect(rows(store, 'trade_calendar')[0]).toMatchObject({ date: '2026-06-04', market: 'SSE', is_trading_day: 1 })
  })

  it('does not persist disabled Tushare provider APIs as canonical schemas', () => {
    for (const endpoint of ['fina_indicator', 'income', 'balancesheet', 'cashflow', 'moneyflow', 'fund_basic', 'fund_nav']) {
      expect(ingestEndpointResult(store, {
        provider: 'tushare',
        endpoint,
        payload: { data: [{ ts_code: '600519.SH', trade_date: '20260604' }] },
        source: 'tushare',
      })).toBeNull()
    }
  })

  it('queries persisted fund holding and fund manager rows through DataStoreTool', async () => {
    store.saveFundHolding([
      {
        fund_code: '110011.OF',
        report_date: '2026-03-31',
        stock_code: '600519',
        stock_name: '贵州茅台',
        hold_shares: 100000,
        hold_value: 128190000,
        hold_pct: 8.5,
        rank: 1,
        source: 'akshare',
      },
    ])
    store.saveFundManagers([
      {
        manager_id: 'mgr-1',
        name: '张三',
        company: '易方达基金',
        start_date: '2018-01-01',
        total_size: 320.5,
        fund_count: 7,
        best_return: 28.3,
        experience_years: 8.2,
        updated_at: '2026-06-05T00:00:00.000Z',
      },
    ])

    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const ctx = makeCtx(basePath)

    await expect(tool.call('fund-holding', {
      action: 'query_fund_holding',
      code: '110011.OF',
    }, ctx)).resolves.toContain('2026-03-31 110011.OF #1 600519 贵州茅台')

    await expect(tool.call('fund-manager', {
      action: 'query_fund_manager',
      company: '易方达基金',
    }, ctx)).resolves.toContain('张三 易方达基金 size:320.5')
  })

  it('queries persisted fund list rows through DataStoreTool', async () => {
    expect(ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'fund_open_fund_rank_em',
      payload: { data: [{ code: '110011.OF', name: '易方达中小盘', fund_type: '混合型', management: '易方达基金', found_date: '20080619' }] },
      source: 'akshare:eastmoney',
    })).toMatchObject({ persisted: true, table: 'fund_list', count: 1 })

    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const ctx = makeCtx(basePath)
    await expect(tool.call('fund-list', {
      action: 'query_fund_list',
      type: '混合型',
    }, ctx)).resolves.toContain('110011.OF 易方达中小盘 混合型 category:ordinary 易方达基金')
  })

  it('persists registered generic Tushare schemas and logs semantic failures as API health rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount'],
          items: [['600519.SH', '20260604', 1280, 1300, 1270, 1290, 12, 1548]],
        },
      }),
    })))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    const output = await tool.call('ts-default-persist', {
      action: 'tushare',
      api_name: 'daily',
      params: { ts_code: '600519.SH' },
    }, makeCtx(basePath, { tushareToken: 'test-token' }))
    expect(output).toContain('"provider": "tushare"')
    expect(output).toContain('"table": "kline_daily"')
    expect(rows(store, 'kline_daily')).toHaveLength(1)

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: -2001, msg: '每分钟最多访问1次，接口：trade_cal' }),
    })))
    const rateLimitCall = tool.call('ts-rate-limit', {
      action: 'tushare',
      api_name: 'trade_cal',
      params: { exchange: 'SSE', start_date: '20260601', end_date: '20260604' },
    }, makeCtx(basePath, { tushareToken: 'test-token' }))
    const rateLimitExpectation = expect(rateLimitCall).rejects.toThrow(/TUSHARE_RATE_LIMIT/)
    await vi.advanceTimersByTimeAsync(5000)
    await rateLimitExpectation
    expect(rows(store, 'api_call_log').some((r) => r.source === 'tushare' && r.endpoint === 'trade_cal' && r.success === 0)).toBe(true)
  })

  it('logs generic TDX failures as API health rows without persisting reusable data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up')
    }))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await expect(tool.call('tdx-fail', {
      action: 'tdx',
      tdx_action: 'tick_chart',
      code: '600519',
    }, makeCtx(basePath))).rejects.toThrow(/TDX call failed/)

    expect(rows(store, 'tick_chart_intraday')).toHaveLength(0)
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
    expect(rows(store, 'api_call_log').some((r) =>
      r.source === 'tdx' &&
      r.tool === 'DataStore' &&
      r.action === 'tdx' &&
      r.endpoint === 'tick_chart' &&
      r.success === 0 &&
      String(r.error ?? '').includes('socket hang up'),
    )).toBe(true)
  })

  it('logs generic AkShare failures as API health rows without persisting reusable data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:19800')
    }))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await expect(tool.call('akshare-fail', {
      action: 'akshare',
      func: 'stock_zh_a_spot_em',
    }, makeCtx(basePath))).rejects.toThrow(/AkShare call failed/)

    expect(rows(store, 'quote_snapshot')).toHaveLength(0)
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
    expect(rows(store, 'api_call_log').some((r) =>
      r.source === 'akshare' &&
      r.tool === 'DataStore' &&
      r.action === 'akshare' &&
      r.endpoint === 'stock_zh_a_spot_em' &&
      r.success === 0 &&
      String(r.error ?? '').includes('ECONNREFUSED'),
    )).toBe(true)
  })

  it('logs generic yfinance failures as API health rows without persisting reusable data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up')
    }))

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await expect(tool.call('yfinance-fail', {
      action: 'yfinance',
      func: 'fast_info',
      symbol: 'AAPL',
    }, makeCtx(basePath))).rejects.toThrow(/yfinance call failed/)

    expect(rows(store, 'quote_snapshot')).toHaveLength(0)
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
    expect(rows(store, 'api_call_log').some((r) =>
      r.source === 'yfinance' &&
      r.tool === 'DataStore' &&
      r.action === 'yfinance' &&
      r.endpoint === 'fast_info' &&
      r.success === 0 &&
      String(r.error ?? '').includes('socket hang up'),
    )).toBe(true)
  })

  it('persists registered generic yfinance schemas and rejects unknown normal schemas', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ symbol: 'AAPL', data: { lastPrice: 315.2, previousClose: 310.1 } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await tool.call('yf-opt-out', {
      action: 'yfinance',
      func: 'fast_info',
      symbol: 'AAPL',
      persist: false,
    }, makeCtx(basePath))
    expect(rows(store, 'quote_snapshot')).toHaveLength(0)

    const output = await tool.call('yf-default-persist', {
      action: 'yfinance',
      func: 'fast_info',
      symbol: 'AAPL',
    }, makeCtx(basePath))
    expect(output).toContain('"provider": "yfinance"')
    expect(output).toContain('"table": "quote_snapshot"')
    expect(rows(store, 'quote_snapshot')).toHaveLength(1)

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ symbol: 'AAPL', data: [{ field: 'value' }] }),
    })))

    await expect(tool.call('yf-unknown-default', {
      action: 'yfinance',
      func: 'unknown_valid_shape',
      symbol: 'AAPL',
    }, makeCtx(basePath))).rejects.toThrow('SCHEMA_UNKNOWN')
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)

    const diagnostic = JSON.parse(await tool.call('yf-unknown-diagnostic', {
      action: 'provider_diagnostic',
      provider: 'yfinance',
      func: 'unknown_valid_shape',
      symbol: 'AAPL',
    }, makeCtx(basePath)))
    expect(diagnostic).toMatchObject({
      interfaceId: 'provider.diagnostic',
      schemaId: 'provider_diagnostic_result',
      provider: 'yfinance',
      status: 'success',
    })
    expect(diagnostic.data.sampleRows).toEqual([{ field: 'value' }])
    expect(rows(store, 'raw_api_payload')).toHaveLength(0)
  })

  it('exposes structured ingestion tables through agent query actions', async () => {
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'tick_chart',
      payload: { List: [{ DateTime: '2026-06-04 09:31:00', Price: 1280, AvgPrice: 1280.5, Vol: 20 }] },
      code: '600519',
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'transactions',
      payload: { List: [{ DateTime: '2026-06-04 09:32:00', Price: 1281, Vol: 3, Direction: 'B' }] },
      code: '600519',
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'volume_profile',
      payload: { List: [{ Price: 1280, Vol: 100, Pct: 2.5 }] },
      code: '600519',
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'block',
      payload: { List: [{ BlockCode: '880380', BlockName: '白酒', Code: '600519', Name: '贵州茅台' }] },
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'company_info',
      payload: { CompanyName: '贵州茅台酒股份有限公司' },
      code: '600519',
    })
    store.saveStockCompanyInfo([
      {
        code: '110011',
        info_type: 'get_fund_info',
        title: '易方达中小盘',
        content: '基金名称: 易方达中小盘',
        source: 'wind',
        updated_at: '2026-06-04T10:00:00.000Z',
        raw_json: JSON.stringify({ rows: [] }),
      },
      {
        code: '110011',
        info_type: 'get_fund_info:易方达中小盘',
        title: '易方达中小盘',
        content: '基金经理: 张坤',
        source: 'wind',
        updated_at: '2026-06-04T10:00:01.000Z',
        raw_json: JSON.stringify({ entry: { 基金经理: '张坤' } }),
      },
    ])
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'xdxr',
      payload: { List: [{ date: '2026-06-05', category: 1, categoryName: '除权除息', a: 10, b: 1.2 }] },
      code: '600519',
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'auction',
      payload: { List: [{ Time: '09:25:00', Price: 1280, Vol: 20, index: 0 }] },
      code: '600519',
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'index_momentum',
      payload: { momentum: [1.2, 2.4], date: '2026-06-05' },
      code: '000001',
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'top_board',
      payload: {
        category: 0,
        date: '2026-06-05',
        increase: [{ code: '600519', market: 1, price: 1281.91, value: 1200000 }],
      },
    })
    ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'stock_hot_rank_em',
      payload: { data: [{ '代码': '600519', '名称': '贵州茅台', '排名': 1 }] },
    })
    ingestEndpointResult(store, {
      provider: 'eastmoney',
      endpoint: 'dragon_tiger',
      payload: { data: [{ '日期': '2026-06-04', '代码': '600519', '名称': '贵州茅台', '上榜原因': '日涨幅偏离值达7%' }] },
    })
    ingestEndpointResult(store, {
      provider: 'eastmoney',
      endpoint: 'sector_cons',
      payload: { data: { diff: [{ f12: '600519', f14: '贵州茅台', f2: 1281.91, f3: 1 }] } },
      params: { sector: '白酒' },
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'count',
      payload: { Count: 2345 },
      params: { market: 1 },
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'chart_sampling',
      payload: { PreClose: 10, Prices: [10.3, 10.5] },
      code: '000001',
      params: { market: 0 },
    })
    ingestEndpointResult(store, {
      provider: 'tdx',
      endpoint: 'ex/table',
      payload: '42#IMCI|上期有色,',
      source: 'tdx:ex',
    })
    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const ctx = makeCtx(basePath)

    await expect(tool.call('q1', { action: 'query_tick_chart', code: '600519' }, ctx)).resolves.toContain('600519 tick chart')
    await expect(tool.call('q2', { action: 'query_transactions', code: '600519' }, ctx)).resolves.toContain('600519 transactions')
    await expect(tool.call('q3', { action: 'query_volume_profile', code: '600519' }, ctx)).resolves.toContain('600519 volume profile')
    await expect(tool.call('q4', { action: 'query_xdxr', code: '600519' }, ctx)).resolves.toContain('600519 XDXR events')
    await expect(tool.call('q5', { action: 'query_auction', code: '600519' }, ctx)).resolves.toContain('600519 auction snapshots')
    await expect(tool.call('q6', { action: 'query_momentum', code: '000001' }, ctx)).resolves.toContain('000001 index momentum')
    await expect(tool.call('q7', { action: 'query_top_board', code: '600519' }, ctx)).resolves.toContain('TDX top board')
    await expect(tool.call('q8', { action: 'query_tdx_block_member', code: '600519' }, ctx)).resolves.toContain('TDX block members')
    await expect(tool.call('q9', { action: 'query_company_info', code: '600519' }, ctx)).resolves.toContain('600519 company info')
    await expect(tool.call('q9b', { action: 'query_company_info', code: '110011', info_type: 'get_fund_info' }, ctx)).resolves.toContain('基金名称: 易方达中小盘')
    await expect(tool.call('q9b', { action: 'query_company_info', code: '110011', info_type: 'get_fund_info' }, ctx)).resolves.toContain('基金经理: 张坤')
    await expect(tool.call('q10', { action: 'query_hot_rank', code: '600519' }, ctx)).resolves.toContain('Hot rank')
    await expect(tool.call('q11', { action: 'query_dragon_tiger', code: '600519' }, ctx)).resolves.toContain('Dragon tiger')
    await expect(tool.call('q12', { action: 'query_industry_map', code: '600519' }, ctx)).resolves.toContain('Industry map')
    await expect(tool.call('q13', { action: 'query_tdx_count', scope: 'main' }, ctx)).resolves.toContain('TDX security counts')
    await expect(tool.call('q14', { action: 'query_tdx_sampling', code: '000001' }, ctx)).resolves.toContain('TDX chart sampling')
    await expect(tool.call('q15', { action: 'query_ex_table', code: 'IMCI' }, ctx)).resolves.toContain('ExTDX table')
    const rawPayload = await tool.call('q16', { action: 'query_raw_payload', source: 'tdx' }, ctx)
    expect(rawPayload).toContain('No raw API payload audit rows.')
    expect(rawPayload).toContain('interface:provider.raw_payload_audit')
    expect(rawPayload).toContain('policy:diagnostic-only')
    expect(rawPayload).toContain('normalWorkflowAllowed:false')
  })
})
