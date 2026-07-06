import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import type { ToolContext } from '../../src/agent/tool'

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'fin-transactions-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}

function makeCtx(basePath: string): ToolContext {
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
  }
}

describe('TransactionsMarketDataService', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T10:00:00.000Z'))
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

  it('honors strict provider constraints when reading reusable transaction cache rows', async () => {
    store.saveTransactions([
      {
        code: '600519',
        trade_date: '2026-06-23',
        time: '09:31:00',
        price: 1281,
        volume: 100,
        amount: 128100,
        direction: 'buy',
        source: 'sina',
        raw_json: '{}',
      },
      {
        code: '600519',
        trade_date: '2026-06-23',
        time: '09:32:00',
        price: 1282,
        volume: 200,
        amount: 256400,
        direction: 'sell',
        source: 'tencent',
        raw_json: '{}',
      },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('strict provider cache hit should not call live provider')
    }))

    const { TransactionsMarketDataService } = await import('../../src/domain/market/services/transactions-market-data-service')
    const service = new TransactionsMarketDataService()
    const result = await service.readTransactions(makeCtx(basePath), '600519', 10, {
      provider: 'tencent',
      cacheMode: 'cache-first',
      date: '2026-06-23',
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ time: '09:32:00', source: 'tencent' }),
    ])
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.transactions',
      capabilityId: 'local.cache',
      provider: 'tencent',
      source: 'tencent',
      cachedCapabilityId: 'local.cache',
      cachedProvider: 'tencent',
      cachedSource: 'tencent',
      cacheStatus: 'cache-hit',
      providerMode: 'strict',
      requestedProvider: 'tencent',
    })
    expect(result.provenance?.cacheDecision).toContain('from tencent')
  })

  it('routes strict Sina transactions through the governed interface with readback provenance', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('CN_Bill.GetBillList')
      expect(url).toContain('symbol=sh600519')
      return {
        ok: true,
        json: async () => ([
          { symbol: 'sh600519', name: '贵州茅台', ticktime: '09:33:00', price: '1282.50', volume: '200', kind: 'U' },
        ]),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { TransactionsMarketDataService } = await import('../../src/domain/market/services/transactions-market-data-service')
    const service = new TransactionsMarketDataService()
    const result = await service.readTransactions(makeCtx(basePath), '600519', 10, {
      provider: 'sina',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
      date: '2026-06-23',
    })

    expect(result).toMatchObject({
      kind: 'transactions',
      code: '600519',
      tradeDate: '2026-06-23',
      rows: [expect.objectContaining({ code: '600519', time: '09:33:00', source: 'sina' })],
      provenance: {
        interfaceId: 'stock.transactions',
        capabilityId: 'sina.stock.transactions',
        provider: 'sina',
        source: 'sina',
        canonicalSchema: 'transactions',
        canonicalTable: 'transactions',
        cacheStatus: 'provider-hit',
      },
    })
    expect(store.query<Record<string, unknown>>('SELECT * FROM transactions WHERE code = ?', '600519')).toEqual([
      expect.objectContaining({ trade_date: '2026-06-23', time: '09:33:00', direction: 'buy' }),
    ])
  })

  it('routes strict Tencent transactions across paginated page markers', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('stock.gtimg.cn/data/index.php')
      const page = new URL(url).searchParams.get('p')
      const firstPageRows = Array.from(
        { length: 70 },
        (_, index) => `${index + 1}/09:33:00/1282.50/0.10/10/1282500/B`,
      ).join('|')
      const body = page === '0'
        ? `v_detail_data_sh600519=[0,"${firstPageRows}"];`
        : page === '1'
          ? 'v_detail_data_sh600519=[1,"71/09:34:00/1283.00/0.50/20/2566000/S"];'
          : 'v_detail_data_sh600519=[2,""];'
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { TransactionsMarketDataService } = await import('../../src/domain/market/services/transactions-market-data-service')
    const service = new TransactionsMarketDataService()
    const result = await service.readTransactions(makeCtx(basePath), '600519', 90, {
      provider: 'tencent',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
      date: '2026-06-23',
    })

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('p=1'))).toBe(true)
    expect(result).toMatchObject({
      kind: 'transactions',
      code: '600519',
      tradeDate: '2026-06-23',
      rows: [
        expect.objectContaining({ code: '600519', time: '09:33:00', source: 'tencent' }),
        expect.objectContaining({ code: '600519', time: '09:34:00', source: 'tencent' }),
      ],
      provenance: {
        interfaceId: 'stock.transactions',
        capabilityId: 'tencent.stock.transactions',
        provider: 'tencent',
        source: 'tencent',
        canonicalSchema: 'transactions',
        canonicalTable: 'transactions',
        cacheStatus: 'provider-hit',
      },
    })
    expect(store.query<Record<string, unknown>>(
      'SELECT * FROM transactions WHERE code = ? ORDER BY time',
      '600519',
    )).toEqual([
      expect.objectContaining({ trade_date: '2026-06-23', time: '09:33:00', direction: 'buy' }),
      expect.objectContaining({ trade_date: '2026-06-23', time: '09:34:00', direction: 'sell' }),
    ])
  })

  it('routes ETF transaction ticks through the ETF interface while reusing canonical transactions readback', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('stock.gtimg.cn/data/index.php')
      expect(url).toContain('c=sh510300')
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(
          'v_detail_data_sh510300=[1,"0/09:25:04/5.079/0.000/22294/11323123/S"];',
        ).buffer,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { TransactionsMarketDataService } = await import('../../src/domain/market/services/transactions-market-data-service')
    const service = new TransactionsMarketDataService()
    const result = await service.readTransactions(makeCtx(basePath), '510300', 10, {
      provider: 'tencent',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
      date: '2026-06-23',
    })

    expect(result).toMatchObject({
      kind: 'transactions',
      code: '510300',
      tradeDate: '2026-06-23',
      rows: [expect.objectContaining({ code: '510300', time: '09:25:04', source: 'tencent' })],
      provenance: {
        interfaceId: 'fund.etf_transactions',
        capabilityId: 'tencent.fund.etf_transactions',
        provider: 'tencent',
        source: 'tencent',
        canonicalSchema: 'transactions',
        canonicalTable: 'transactions',
        cacheStatus: 'provider-hit',
      },
    })
    expect(store.query<Record<string, unknown>>(
      'SELECT * FROM transactions WHERE code = ? ORDER BY time',
      '510300',
    )).toEqual([
      expect.objectContaining({ trade_date: '2026-06-23', time: '09:25:04', direction: 'sell' }),
    ])
  })
})
