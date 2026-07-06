import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { WindDataApiService } from '../../src/domain/market/services/wind-data-api-service'

describe('WindDataApiService', () => {
  afterEach(() => {
    closeDb()
  })

  it('reads cached Wind documents through the data API interface router', async () => {
    const basePath = createStoreBase('wind-doc-cache-')
    try {
      const store = await initStore(basePath)
      store.saveWindDocuments([{
        doc_id: 'wind-doc-600519-2025-ar',
        tool: 'get_company_announcements',
        query: '贵州茅台2025年年度报告',
        title: '2025年年度报告',
        publisher: '贵州茅台',
        published_at: '2026-03-31',
        url: 'https://example.test/600519-ar',
        summary: '年度报告摘要',
        entity_code: '600519',
        entity_name: '贵州茅台',
        source: 'wind',
        updated_at: '2026-06-17T00:00:00.000Z',
        raw_json: '{}',
      }])

      const result = await new WindDataApiService().readFinancialDocuments({
        query: '贵州茅台2025年年度报告',
        tool: 'get_company_announcements',
        code: '600519',
      })

      expect(result.source).toBe('local')
      expect(result.data[0]).toMatchObject({
        query: '贵州茅台2025年年度报告',
        tool: 'get_company_announcements',
        entity_code: '600519',
      })
      expect(result.provenance).toMatchObject({
        interfaceId: 'wind.financial_document',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        canonicalSchema: 'wind_document',
        canonicalTable: 'wind_document',
        sourceDataTime: '2026-03-31',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reads cached Wind economic series through the data API interface router', async () => {
    const basePath = createStoreBase('wind-economic-cache-')
    try {
      const store = await initStore(basePath)
      store.saveWindEconomicSeries([{
        series_key: 'cpi:2026-05',
        metric_query: '中国CPI同比',
        metric_name: 'CPI同比',
        metric_code: 'CPI_YOY',
        date: '2026-05-31',
        value_num: 1.2,
        value_text: null,
        unit: '%',
        frequency: 'monthly',
        currency: null,
        source: 'wind',
        updated_at: '2026-06-17T00:00:00.000Z',
        raw_json: '{}',
      }])

      const result = await new WindDataApiService().readEconomicSeries({ metricQuery: '中国CPI同比' })

      expect(result.source).toBe('local')
      expect(result.data[0]).toMatchObject({ metric_query: '中国CPI同比', value_num: 1.2 })
      expect(result.provenance).toMatchObject({
        interfaceId: 'wind.economic_series',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        sourceDataTime: '2026-05-31',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reads cached Wind analytics through the data API interface router', async () => {
    const basePath = createStoreBase('wind-analytics-cache-')
    try {
      const store = await initStore(basePath)
      store.saveWindAnalyticsResults([{
        result_id: 'steel-close-2026-06-17',
        question: '查询螺纹钢主力最近一天收盘价和涨跌幅',
        entity_code: 'RB.SHF',
        entity_name: '螺纹钢主力',
        value_date: '2026-06-17',
        title: '收盘价',
        content: '收盘价 3200',
        value_num: 3200,
        value_text: null,
        unit: 'CNY',
        source: 'wind',
        updated_at: '2026-06-17T00:00:00.000Z',
        raw_json: '{}',
      }])

      const result = await new WindDataApiService().readAnalyticsResult({
        question: '查询螺纹钢主力最近一天收盘价和涨跌幅',
      })

      expect(result.source).toBe('local')
      expect(result.data[0]).toMatchObject({ question: '查询螺纹钢主力最近一天收盘价和涨跌幅', value_num: 3200 })
      expect(result.provenance).toMatchObject({
        interfaceId: 'wind.analytics_result',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        sourceDataTime: '2026-06-17',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('keeps live Wind provider access gated on cache miss', async () => {
    const basePath = createStoreBase('wind-cache-miss-')
    try {
      await initStore(basePath)

      await expect(new WindDataApiService().readEconomicSeries({ metricQuery: 'missing' }))
        .rejects.toThrow(/credential-gated/)
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
