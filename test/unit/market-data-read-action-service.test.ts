import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { MarketDataReadActionService } from '../../src/domain/market/services/market-data-read-action-service'
import { MarketDataResolveService } from '../../src/domain/market/services/market-data-resolve-service'

const ctx = {} as ToolContext

describe('MarketDataReadActionService', () => {
  it('routes quote actions through the market data read service boundary', async () => {
    const service = new MarketDataReadActionService(new FakeReadService())

    const output = await service.readAction('quote', { code: '600519' }, ctx, '600519', 20)

    expect(output).toContain('Fake Quote')
    expect(output).toContain('Quote provenance:')
    expect(output).toContain('interface=stock.quote')
    expect(output).toContain('asOf=2026-07-06T09:30:00+08:00')
    expect(output).toContain('fetchedAt=2026-07-06T09:31:00+08:00')
  })

  it('routes kline actions through the market data read service boundary', async () => {
    const service = new MarketDataReadActionService(new FakeReadService())

    const output = await service.readAction('kline', { code: '600519' }, ctx, '600519', 20)

    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      contract: 'market-kline-result-v1',
      action: 'kline',
      code: '600519',
      rows: [expect.objectContaining({ date: '2024-01-02' })],
      provenance: expect.objectContaining({
        interfaceId: 'stock.daily_kline',
        asOf: '2024-01-02',
      }),
    }))
  })

  it('rejects non-daily kline periods until they have governed interface/readback support', async () => {
    const service = new MarketDataReadActionService(new FakeReadService())

    await expect(
      service.readAction('kline', { code: '600519', period: 'weekly' }, ctx, '600519', 20),
    ).rejects.toThrow(
      'MarketData(action:"kline") currently supports only governed daily K-line in FinAgent Workstation',
    )
  })
})

class FakeReadService extends MarketDataResolveService {
  async readQuotes() {
    return {
      quotes: [
        {
          code: '600519',
          name: 'Fake Quote',
          price: 123.4,
          change: 1,
          changePct: 0.8,
          open: 120,
          high: 124,
          low: 119,
          prevClose: 122.4,
          volume: 1000,
          amount: 123400,
          source: 'fake',
        },
      ],
      cachedCount: 0,
      freshCount: 1,
      freshSources: ['fake'],
      status: 'hit',
      reason: 'fixture quote evidence',
      missingCodes: [],
      staleCodes: [],
      provenance: [
        {
          interfaceId: 'stock.quote',
          provider: 'fake',
          source: 'fake',
          capabilityId: 'fake.stock.quote',
          cacheStatus: 'provider-hit',
          asOf: '2026-07-06T09:30:00+08:00',
          fetchedAt: '2026-07-06T09:31:00+08:00',
          canonicalSchema: 'quote_snapshot',
          canonicalTable: 'quote_snapshot',
          endpoint: 'fixture:quote',
        },
      ],
    }
  }

  async readKline() {
    return {
      bars: [
        {
          date: '2024-01-02',
          open: 10,
          close: 11,
          high: 12,
          low: 9,
          volume: 1000,
          amount: 11000,
          changePct: 10,
          turnoverRate: 2,
        },
      ],
      source: 'fake',
      period: 'daily',
      adjust: 'qfq',
      status: 'hit',
      reason: 'fixture kline evidence',
      coverage: { rowCount: 1, requiredRows: 1 },
      provenance: {
        interfaceId: 'stock.daily_kline',
        provider: 'fake',
        source: 'fake',
        capabilityId: 'fake.stock.daily_kline',
        cacheStatus: 'provider-hit',
        asOf: '2024-01-02',
        fetchedAt: '2026-07-06T09:31:00+08:00',
        canonicalSchema: 'kline_daily',
        canonicalTable: 'kline_daily',
        endpoint: 'fixture:kline',
      },
    }
  }
}
