import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { FinanceNewsDataApiService } from '../../src/domain/market/services/finance-news-data-api-service'

describe('FinanceNewsDataApiService', () => {
  afterEach(() => {
    closeDb()
  })

  it('returns local cache hits for governed finance news rows', async () => {
    const basePath = createStoreBase('finance-news-cache-')
    try {
      const store = await initStore(basePath)
      store.saveFinanceNews([
        {
          news_id: 'cache-news-1',
          title: '美联储利率政策观察',
          summary: '测试摘要',
          source: '东方财富',
          published_at: '2026-06-20T10:00:00.000Z',
        },
      ])
      const service = new FinanceNewsDataApiService(
        {
          readIndexQuotes: async () => null,
          callSidecarRoute: async () => {
            throw new Error('sidecar should not be called on cache hit')
          },
          callGotdxRoute: async () => {
            throw new Error('gotdx not used')
          },
        },
        async () => {
          throw new Error('Wind should not be called on cache hit')
        },
      )

      const result = await service.readNewsFeed(toolContext(basePath), { query: '美联储' })
      expect(result).toMatchObject({
        cacheStatus: 'cache-hit',
        sourceHealth: {
          status: 'cached',
          nextRetryPolicy: expect.stringContaining('use-cache-first'),
        },
      })
      expect(result.provenance).toMatchObject({
        interfaceId: 'news.finance_feed',
        capabilityId: 'local.cache',
        canonicalTable: 'finance_news',
      })
      expect(result.data).toHaveLength(1)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('re-reads canonical finance news rows after a live Wind refresh', async () => {
    const basePath = createStoreBase('finance-news-wind-')
    try {
      const store = await initStore(basePath)
      const service = new FinanceNewsDataApiService(
        {
          readIndexQuotes: async () => null,
          callSidecarRoute: async () => ({ data: [] }),
          callGotdxRoute: async () => ({ data: [] }),
        },
        async (_ctx, query, limit) => {
          expect(query).toBe('美联储')
          expect(limit).toBe(5)
          store.saveFinanceNews([
            {
              news_id: 'wind-news-1',
              title: '美联储利率政策观察',
              summary: 'Wind 新闻',
              source: 'Wind财经',
              published_at: '2026-06-20T10:00:00.000Z',
            },
          ])
        },
      )

      const result = await service.readNewsFeed(toolContext(basePath), {
        query: '美联储',
        limit: 5,
        provider: 'wind',
        cacheMode: 'live-only',
      })
      expect(result.cacheStatus).toBe('provider-hit')
      expect(result.sourceHealth).toMatchObject({
        status: 'live',
        provider: 'wind',
        nextRetryPolicy: expect.stringContaining('normal cache-first reuse'),
      })
      expect(result.provenance).toMatchObject({
        interfaceId: 'news.finance_feed',
        capabilityId: 'wind.news.finance_feed',
        provider: 'wind',
        canonicalTable: 'finance_news',
      })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].title).toContain('美联储')
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('matches space-separated news queries against any contained keyword', async () => {
    const basePath = createStoreBase('finance-news-query-')
    try {
      const store = await initStore(basePath)
      store.saveFinanceNews([
        {
          news_id: 'cache-news-2',
          title: 'A股市场午后走强',
          summary: '测试摘要',
          source: 'akshare',
          published_at: '2026-06-22T10:00:00.000Z',
        },
      ])
      const service = new FinanceNewsDataApiService(
        {
          readIndexQuotes: async () => null,
          callSidecarRoute: async () => {
            throw new Error('sidecar should not be called on cache hit')
          },
          callGotdxRoute: async () => {
            throw new Error('gotdx not used')
          },
        },
        async () => {
          throw new Error('Wind should not be called on cache hit')
        },
      )

      const result = await service.readNewsFeed(toolContext(basePath), { query: 'A股 财经 市场' })
      expect(result.cacheStatus).toBe('cache-hit')
      expect(result.data).toHaveLength(1)
      expect(result.data[0].title).toContain('A股市场')
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('returns unfiltered latest rows when no user query is provided, with priority matches ranked first', async () => {
    const basePath = createStoreBase('finance-news-priority-')
    try {
      const store = await initStore(basePath)
      store.saveFinanceNews([
        {
          news_id: 'cache-news-3',
          title: '普通公司新闻',
          summary: '测试摘要',
          source: 'akshare',
          published_at: '2026-06-22T10:00:00.000Z',
        },
        {
          news_id: 'cache-news-4',
          title: 'A股市场午后走强',
          summary: '测试摘要',
          source: 'akshare',
          published_at: '2026-06-22T09:59:00.000Z',
        },
      ])
      const service = new FinanceNewsDataApiService(
        {
          readIndexQuotes: async () => null,
          callSidecarRoute: async () => {
            throw new Error('sidecar should not be called on cache hit')
          },
          callGotdxRoute: async () => {
            throw new Error('gotdx not used')
          },
        },
        async () => {
          throw new Error('Wind should not be called on cache hit')
        },
      )

      const result = await service.readNewsFeed(toolContext(basePath), { priority_query: 'A股 财经 市场' })
      expect(result.cacheStatus).toBe('cache-hit')
      expect(result.data).toHaveLength(2)
      expect(result.data[0].title).toContain('A股市场')
      expect(result.data[1].title).toBe('普通公司新闻')
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('falls back to the default finance priority query when neither query nor priority_query is provided', async () => {
    const basePath = createStoreBase('finance-news-default-fallback-')
    try {
      const store = await initStore(basePath)
      const service = new FinanceNewsDataApiService(
        {
          readIndexQuotes: async () => null,
          callSidecarRoute: async () => {
            store.saveFinanceNews([
              {
                news_id: 'fallback-news-1',
                title: 'A股市场午后走强',
                summary: '测试摘要',
                source: 'akshare',
                published_at: '2026-06-22T10:00:00.000Z',
              },
            ])
            return { data: [] }
          },
          callGotdxRoute: async () => {
            throw new Error('gotdx not used')
          },
        },
        async () => {
          throw new Error('Wind should not be called in this test')
        },
      )

      const result = await service.readNewsFeed(toolContext(basePath), {})
      expect(result.cacheStatus).toBe('provider-hit')
      expect(result.data).toHaveLength(1)
      expect(result.data[0].title).toContain('A股市场')
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('classifies empty live provider refreshes as source-health failures', async () => {
    const basePath = createStoreBase('finance-news-empty-')
    try {
      const service = new FinanceNewsDataApiService(
        {
          readIndexQuotes: async () => null,
          callSidecarRoute: async () => ({ data: [] }),
          callGotdxRoute: async () => {
            throw new Error('gotdx not used')
          },
        },
        async () => {
          throw new Error('Wind should not be called for strict akshare')
        },
      )

      await expect(service.readNewsFeed(toolContext(basePath), {
        query: '不存在的新闻主题',
        provider: 'akshare',
        providerMode: 'strict',
        cacheMode: 'live-only',
      })).rejects.toThrow('source-health:empty-result')
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
