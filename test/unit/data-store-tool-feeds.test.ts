import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { dataFeeds } from '../../src/agent/tools/data-store-tool-feeds'

describe('DataStore data_feeds action', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-data-feeds-tool-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('returns governed read-only Data Manager feed status with provenance', () => {
    store.getFeedConfigs()
    store.exec(
      'INSERT OR REPLACE INTO fund_nav (code,date,nav,acc_nav,daily_return,source,fetched_at) VALUES (?,?,?,?,?,?,?)',
      '110022',
      '2026-06-24',
      1.23,
      2.34,
      0.12,
      'eastmoney',
      '2026-06-25T08:00:00.000Z',
    )
    store.updateFeedConfig('fund_nav', {
      status: 'waiting_prerequisite',
      scope: 'custom',
      scope_codes: '110022',
      last_error: 'Feed 基金净值 is waiting for prerequisite data: fund_list is required to resolve all-fund feed scope. The target feed has not run yet.',
    } as any)
    store.updateFeedConfig('money_flow', {
      status: 'failed',
      last_error: 'provider timeout',
    } as any)
    store.updateFeedConfig('fund_holding', {
      status: 'failed',
      last_error: 'manual data-feed verification recovered stale active task',
    } as any)

    const payload = JSON.parse(dataFeeds(store, { action: 'data_feeds', limit: 50 }, basePath))

    expect(payload.action).toBe('data_feeds')
    expect(payload.summary.waitingPrerequisite).toBe(1)
    expect(payload.summary.actionableFailures).toBe(1)
    expect(payload.summary.nonActionableEvidence).toBe(2)
    expect(payload.waitingPrerequisite[0]).toMatchObject({
      feedId: 'fund_nav',
      waitingPrerequisite: true,
      resolvedCount: 1,
      targetEvidence: expect.objectContaining({
        interfaceId: 'fund.nav_history',
        canonicalTable: 'fund_nav',
        readbackAction: 'query_fund_nav',
        rowCount: 1,
        symbolCount: 1,
        minRows: 1,
        readbackVerified: true,
        cacheDecision: {
          reusable: true,
          reason: 'fund.nav_history readback row count satisfies request',
        },
        earliestSourceTime: '2026-06-24',
        latestSourceTime: '2026-06-24',
        latestFetchedAt: '2026-06-25T08:00:00.000Z',
        cacheStatus: 'local-reusable',
      }),
    })
    expect(payload.actionableFailures[0]).toMatchObject({
      feedId: 'money_flow',
      actionableFailure: true,
      nextAction: 'Inspect API Health and Data Manager task evidence before retrying the feed.',
    })
    expect(payload.nonActionableEvidence.map((feed: any) => feed.feedId)).toEqual(
      expect.arrayContaining(['fund_nav', 'fund_holding']),
    )
    expect(payload.nonActionableEvidence.find((feed: any) => feed.feedId === 'fund_holding')).toMatchObject({
      actionableFailure: false,
      nonActionableEvidence: true,
      nextAction: 'No provider retry is needed for this stale recovered feed marker; inspect current feed/task status before taking action.',
    })
    expect(payload.provenance).toMatchObject({
      interfaceId: 'data.feed_status',
      canonicalTable: 'data_feed_config',
      readbackAction: 'data_feeds',
      cacheStatus: 'local-evidence',
      cacheDecision: expect.stringContaining('does not itself call providers'),
      basePath,
    })
  })

  it('can focus one configured feed by id', () => {
    const payload = JSON.parse(dataFeeds(store, { action: 'data_feeds', feedId: 'stock_list' }, basePath))

    expect(payload.total).toBe(1)
    expect(payload.feeds).toHaveLength(1)
    expect(payload.feeds[0]).toMatchObject({
      feedId: 'stock_list',
      feedType: 'stock_list',
      updateFrequency: 'daily',
      targetEvidence: expect.objectContaining({
        interfaceId: 'stock.identity_list',
        canonicalTable: 'stock_list',
        readbackAction: 'stock_list',
        readbackVerified: false,
        cacheDecision: {
          reusable: false,
          reason: 'only 0/1 required stock.identity_list readback rows',
        },
      }),
    })
  })

  it('maps every default configured feed to governed target evidence', () => {
    const payload = JSON.parse(dataFeeds(store, { action: 'data_feeds', limit: 100 }, basePath))

    expect(payload.feeds.length).toBeGreaterThan(10)
    expect(payload.feeds.map((feed: any) => [feed.feedId, feed.targetEvidence.interfaceId])).toEqual(
      expect.arrayContaining([
        ['stock_list', 'stock.identity_list'],
        ['fund_performance', 'fund.performance_metrics'],
        ['etf_quotes', 'fund.etf_quote'],
        ['index_components', 'index.constituents'],
        ['index_kline', 'index.daily_kline'],
        ['calendar', 'calendar.trade_days'],
      ]),
    )
    expect(payload.feeds.filter((feed: any) => feed.targetEvidence.cacheStatus === 'not-governed')).toEqual([])
  })
})
