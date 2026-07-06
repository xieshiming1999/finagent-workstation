import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import type { TradingviewMarketProvider } from '../../src/domain/market/providers/tradingview-market-provider'
import { ScanMarketDataService } from '../../src/domain/market/services/scan-market-data-service'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

class FakeTradingviewMarketProvider implements TradingviewMarketProvider {
  lastTickers?: string[]
  lastIndicators?: string[]
  lastTimeframe?: string
  constructor(
    private readonly rows: Array<Record<string, unknown>>,
  ) {}

  async readScan(
    tickers: string[],
    indicators?: string[],
    timeframe?: string,
  ): Promise<Array<Record<string, unknown>>> {
    this.lastTickers = tickers
    this.lastIndicators = indicators
    this.lastTimeframe = timeframe
    return this.rows
  }
}

describe('ScanMarketDataService', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    closeDb()
    for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  it('formats scan results through the domain service boundary', async () => {
    const provider = new FakeTradingviewMarketProvider([
      { symbol: 'NASDAQ:AAPL', close: 213.4, RSI: 58.2 },
      { symbol: 'BINANCE:BTCUSDT', close: 105000, RSI: 63.1 },
    ])
    const service = new ScanMarketDataService(provider)

    const payload = JSON.parse(await service.readScan('NASDAQ:AAPL,BINANCE:BTCUSDT', {
        timeframe: '4h',
        indicators: ['close', 'RSI'],
      }))

    expect(payload).toMatchObject({
      action: 'market_screening',
      interfaceId: 'market.screening',
      schemaId: 'screening_result',
      provider: 'tradingview',
      status: 'success',
    })
    expect(payload.data.rows[0]).toMatchObject({
      symbol: 'NASDAQ:AAPL',
      fields: { symbol: 'NASDAQ:AAPL', close: 213.4, RSI: 58.2 },
    })
    expect(payload.persistencePolicy).toBe('canonical')
    expect(payload.persistenceRows).toHaveLength(2)

    expect(provider.lastTickers).toEqual(['NASDAQ:AAPL', 'BINANCE:BTCUSDT'])
    expect(provider.lastIndicators).toEqual(['close', 'RSI'])
    expect(provider.lastTimeframe).toBe('4h')
  })

  it('returns a stable empty-result message', async () => {
    const service = new ScanMarketDataService(new FakeTradingviewMarketProvider([]))

    const payload = JSON.parse(await service.readScan('NASDAQ:AAPL', {}))
    expect(payload).toMatchObject({
      interfaceId: 'market.screening',
      status: 'empty',
    })
    expect(payload.data.rows).toEqual([])
  })

  it('persists canonical screening snapshots for readback', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-screening-'))
    cleanupPaths.push(basePath)
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    const store = new DataStore(basePath)
    await store.init()
    const service = new ScanMarketDataService(new FakeTradingviewMarketProvider([
      { symbol: 'NASDAQ:AAPL', name: 'Apple', market: 'US', close: 213.4, 'Recommend.All': 0.42 },
    ]))

    await service.readScan('NASDAQ:AAPL', { timeframe: '1d', indicators: ['close', 'Recommend.All'] }, store)

    const rows = store.queryMarketScreeningSnapshots({ provider: 'tradingview', symbol: 'NASDAQ:AAPL' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      provider: 'tradingview',
      capability_id: 'tradingview.market.screening',
      source_action: 'scan',
      symbol: 'NASDAQ:AAPL',
      name: 'Apple',
      market: 'US',
      score: 0.42,
    })
  })
})
