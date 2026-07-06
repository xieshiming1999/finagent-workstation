import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ToolContext } from '../../src/agent/tool'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

const tushareCall = vi.fn()

vi.mock('../../src/agent/data/tushare-fetcher', () => ({
  tushareCall,
}))

describe('MarketData Tushare action', () => {
  beforeEach(() => {
    tushareCall.mockReset()
  })

  it('calls Tushare with the configured token', async () => {
    tushareCall.mockResolvedValue([{ cal_date: '20260605', is_open: 1 }])
    const { MarketDataTool } = await import('../../src/agent/tools/market-data')
    const tool = new MarketDataTool()

    const output = await tool.call('tool-1', {
      action: 'tushare',
      api_name: 'trade_cal',
      params: { exchange: 'SSE', start_date: '20260601', end_date: '20260605' },
      fields: 'cal_date,is_open',
      limit: 10,
    }, ctxWithToken('test-token'))

    expect(tushareCall).toHaveBeenCalledWith(
      'test-token',
      'trade_cal',
      { exchange: 'SSE', start_date: '20260601', end_date: '20260605' },
      'cal_date,is_open',
    )
    expect(JSON.parse(output)).toMatchObject({
      action: 'tushare',
      source: 'tushare',
      api_name: 'trade_cal',
      count: 1,
      data: [{ cal_date: '20260605', is_open: 1 }],
      truncated: false,
    })
  })

  it('persists and queries trade calendar rows through the local store', async () => {
    tushareCall.mockResolvedValue([
      { exchange: 'SSE', cal_date: '20260604', is_open: 1 },
      { exchange: 'SSE', cal_date: '20260605', is_open: 0 },
    ])
    const { MarketDataTool } = await import('../../src/agent/tools/market-data')
    const { DataStoreTool } = await import('../../src/agent/tools/data-store-tool')
    const tool = new MarketDataTool()
    const queryTool = new DataStoreTool()

    const basePath = makeBasePath()
    const store = new DataStore(basePath)
    await store.init()
    queryTool.setDataStore(store)
    try {
      await tool.call('tool-1', {
        action: 'tushare',
        api_name: 'trade_cal',
        params: { exchange: 'SSE', start_date: '20260604', end_date: '20260605' },
        persist: true,
      }, ctxWithToken('test-token', basePath))

      const output = await queryTool.call('query-1', {
        action: 'query_trade_calendar',
        market: 'SSE',
        start: '2026-06-04',
        end: '2026-06-05',
      }, ctxWithToken('test-token', basePath))

      expect(output).toContain('2026-06-04 SSE open')
      expect(output).toContain('2026-06-05 SSE closed')
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('fails clearly when TUSHARE_TOKEN is missing', async () => {
    const { MarketDataTool } = await import('../../src/agent/tools/market-data')
    const tool = new MarketDataTool()

    await expect(tool.call('tool-1', {
      action: 'tushare',
      api_name: 'daily',
      params: { ts_code: '600519.SH' },
    }, ctxWithToken(''))).rejects.toThrow(/KEY_MISSING: TUSHARE_TOKEN/)
    expect(tushareCall).not.toHaveBeenCalled()
  })

  it('supports flat params in the agent tool path', async () => {
    tushareCall.mockResolvedValue([{ ts_code: '600519.SH' }])
    const { MarketDataTool } = await import('../../src/agent/tools/market-data')
    const tool = new MarketDataTool()

    await tool.call('tool-1', {
      action: 'tushare',
      api_name: 'daily',
      ts_code: '600519.SH',
      fields: 'ts_code,trade_date,close',
    }, ctxWithToken('test-token'))

    expect(tushareCall).toHaveBeenCalledWith(
      'test-token',
      'daily',
      { ts_code: '600519.SH' },
      'ts_code,trade_date,close',
    )
  })
})

function ctxWithToken(token: string, basePath = '/tmp/finagent-workstation-test'): ToolContext {
  return {
    basePath,
    workDir: basePath,
    memoryDir: `${basePath}/memory`,
    bundleDir: `${basePath}/bundle`,
    projectLocalDir: `${basePath}/.finagent-workstation`,
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
    getConfigValue: (key) => key === 'TUSHARE_TOKEN' ? token : undefined,
  }
}

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'finagent-workstation-tushare-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}
