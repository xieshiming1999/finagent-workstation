import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { WindStructuredMarketDataService } from '../../src/domain/market/services/wind-structured-market-data-service'

describe('WindStructuredMarketDataService', () => {
  afterEach(() => {
    closeDb()
  })

  it('returns local cache hits for governed Wind company-info interfaces', async () => {
    const basePath = createStoreBase('wind-structured-company-')
    try {
      const store = await initStore(basePath)
      store.saveStockCompanyInfo([
        {
          code: '110011',
          info_type: 'get_fund_company_info',
          title: '基金管理人',
          content: '易方达基金管理有限公司',
          source: 'Wind',
          updated_at: '2026-06-19T00:00:00.000Z',
          raw_json: '{}',
        },
      ])
      const service = new WindStructuredMarketDataService(async () => {
        throw new Error('live Wind should not be called on cache hit')
      })

      const content = await service.readAction(
        'fund_company_info',
        {},
        toolContext(basePath),
        '110011',
        20,
      )
      const result = JSON.parse(content) as Record<string, unknown>

      expect(result).toMatchObject({
        action: 'fund_company_info',
        interfaceId: 'fund.company_info',
        provider: 'local',
        capabilityId: 'local.cache',
        cacheStatus: 'cache-hit',
        canonicalSchema: 'stock_company_info',
        canonicalTable: 'stock_company_info',
        count: 1,
      })
      expect((result.data as Array<Record<string, unknown>>)[0]).toMatchObject({
        code: '110011',
        info_type: 'get_fund_company_info',
        source: 'Wind',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('re-reads canonical rows after a live Wind structured refresh', async () => {
    const basePath = createStoreBase('wind-structured-live-')
    try {
      const store = await initStore(basePath)
      const service = new WindStructuredMarketDataService(async (spec, _ctx, windcode) => {
        expect(spec.interfaceId).toBe('stock.risk_metrics')
        expect(windcode).toBe('600519.SH')
        store.saveStockCompanyInfo([
          {
            code: '600519',
            info_type: 'get_risk_metrics',
            title: '贝塔系数',
            content: '0.82',
            source: 'Wind',
            updated_at: '2026-06-20T00:00:00.000Z',
            raw_json: '{}',
          },
        ])
      })

      const content = await service.readAction(
        'stock_risk_metrics',
        { cacheMode: 'live-only' },
        toolContext(basePath),
        '600519',
        20,
      )
      const result = JSON.parse(content) as Record<string, unknown>

      expect(result).toMatchObject({
        action: 'stock_risk_metrics',
        interfaceId: 'stock.risk_metrics',
        provider: 'wind',
        providerId: 'wind',
        capabilityId: 'wind.stock.risk_metrics',
        cacheStatus: 'provider-hit',
        canonicalSchema: 'stock_company_info',
        canonicalTable: 'stock_company_info',
        count: 1,
      })
      expect((result.data as Array<Record<string, unknown>>)[0]).toMatchObject({
        code: '600519',
        info_type: 'get_risk_metrics',
        source: 'Wind',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('re-reads canonical rows for governed Wind fundamental interfaces', async () => {
    const basePath = createStoreBase('wind-structured-fundamental-')
    try {
      const store = await initStore(basePath)
      const service = new WindStructuredMarketDataService(async (spec, _ctx, windcode) => {
        expect(spec.interfaceId).toBe('index.fundamentals')
        expect(windcode).toBe('000300.SH')
        store.saveFundamental([
          {
            code: '000300',
            report_date: '2026-06-20',
            pe_ttm: 14.2,
            source: 'Wind',
            fetched_at: '2026-06-20T00:00:00.000Z',
          },
        ])
      })

      const content = await service.readAction(
        'index_fundamentals',
        { cacheMode: 'live-only', reportDate: '2026-06-20' },
        toolContext(basePath),
        '000300',
        20,
      )
      const result = JSON.parse(content) as Record<string, unknown>

      expect(result).toMatchObject({
        action: 'index_fundamentals',
        interfaceId: 'index.fundamentals',
        provider: 'wind',
        providerId: 'wind',
        capabilityId: 'wind.index.fundamentals',
        cacheStatus: 'provider-hit',
        canonicalSchema: 'fundamental',
        canonicalTable: 'fundamental',
        count: 1,
      })
      expect((result.data as Array<Record<string, unknown>>)[0]).toMatchObject({
        code: '000300',
        report_date: '2026-06-20',
        source: 'Wind',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })
})

function createStoreBase(prefix: string): string {
  const basePath = mkdtempSync(join(tmpdir(), prefix))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
  return basePath
}

async function initStore(basePath: string): Promise<DataStore> {
  const store = new DataStore(basePath)
  await store.init()
  return store
}

function toolContext(basePath: string) {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set<string>(),
    planMode: false,
    readFileTimestamps: new Map<string, number>(),
    taskRegistry: {} as never,
    teamRegistry: {} as never,
    getConfigValue: () => undefined,
  }
}
