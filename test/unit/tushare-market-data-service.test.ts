import { beforeEach, describe, expect, it, vi } from 'vitest'

const tushareCall = vi.fn()

vi.mock('../../src/agent/data/tushare-fetcher', () => ({
  tushareCall,
}))

describe('TushareMarketDataService', () => {
  beforeEach(() => {
    vi.resetModules()
    tushareCall.mockReset()
  })

  it('persists registered tushare responses through the repository boundary', async () => {
    const ingest = vi.fn(() => ({ persisted: true, table: 'trade_calendar', count: 1 }))
    const recordApiCall = vi.fn()
    vi.doMock('../../src/domain/market/repositories/tushare-market-data-repository', () => ({
      TushareMarketDataRepository: class {
        ingest = ingest
        recordApiCall = recordApiCall
      },
    }))
    tushareCall.mockResolvedValue([{ cal_date: '20260605', is_open: 1 }])

    const { TushareMarketDataService } = await import('../../src/domain/market/services/tushare-market-data-service')
    const service = new TushareMarketDataService()
    const output = await service.readAction(
      {
        action: 'tushare',
        api_name: 'trade_cal',
        params: { exchange: 'SSE' },
        fields: 'cal_date,is_open',
      },
      ctxWithToken('test-token'),
      '',
      10,
    )

    expect(tushareCall).toHaveBeenCalledWith(
      'test-token',
      'trade_cal',
      { exchange: 'SSE' },
      'cal_date,is_open',
    )
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      basePath: '/tmp/finagent-workstation-test',
      workDir: '/tmp/finagent-workstation-test',
    })
    expect(ingest.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        provider: 'tushare',
        endpoint: 'trade_cal',
        source: 'tushare',
      }),
    )
    expect(recordApiCall).not.toHaveBeenCalled()
    expect(JSON.parse(output)).toMatchObject({
      action: 'tushare',
      source: 'tushare',
      api_name: 'trade_cal',
      count: 1,
      ingestion: { persisted: true, table: 'trade_calendar', count: 1 },
      truncated: false,
    })
  })

  it('records rate-limit failures through the repository boundary', async () => {
    const ingest = vi.fn()
    const recordApiCall = vi.fn()
    vi.doMock('../../src/domain/market/repositories/tushare-market-data-repository', () => ({
      TushareMarketDataRepository: class {
        ingest = ingest
        recordApiCall = recordApiCall
      },
    }))
    tushareCall.mockRejectedValue(
      new Error('TUSHARE_RATE_LIMIT: trade_cal frequency limited by Tushare'),
    )

    const { TushareMarketDataService } = await import('../../src/domain/market/services/tushare-market-data-service')
    const service = new TushareMarketDataService()

    await expect(
      service.readAction(
        { action: 'tushare', api_name: 'trade_cal', params: { exchange: 'SSE' } },
        ctxWithToken('test-token'),
        '',
        10,
      ),
    ).rejects.toThrow(/Do not retry immediately/)

    expect(ingest).not.toHaveBeenCalled()
    expect(recordApiCall).toHaveBeenCalledTimes(1)
    expect(recordApiCall.mock.calls[0]?.[0]).toMatchObject({
      basePath: '/tmp/finagent-workstation-test',
      workDir: '/tmp/finagent-workstation-test',
    })
    expect(recordApiCall.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        source: 'tushare',
        tool: 'MarketData',
        action: 'tushare',
        endpoint: 'trade_cal',
        success: false,
      }),
    )
  })
})

function ctxWithToken(token: string) {
  return {
    basePath: '/tmp/finagent-workstation-test',
    workDir: '/tmp/finagent-workstation-test',
    memoryDir: '/tmp/finagent-workstation-test/memory',
    bundleDir: '/tmp/finagent-workstation-test/bundle',
    projectLocalDir: '/tmp/finagent-workstation-test/.finagent-workstation',
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as any,
    teamRegistry: {} as any,
    getConfigValue: (key: string) => (key === 'TUSHARE_TOKEN' ? token : undefined),
  }
}
