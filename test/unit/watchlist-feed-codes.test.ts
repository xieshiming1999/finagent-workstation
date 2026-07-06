import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  missingFeedScopePrerequisite,
  parseScopeCodes,
  readFundWatchlistCodes,
  readStockWatchlistCodes,
  resolveFeedCodes,
  resolveFeedCodesWithStore,
} from '../../src/main/watchlist-feed-codes'

function tempBase(): string {
  return mkdtempSync(join(tmpdir(), 'fin-watchlist-feed-'))
}

function writeJson(basePath: string, name: string, data: unknown): void {
  writeFileSync(join(basePath, name), JSON.stringify(data, null, 2), 'utf-8')
}

describe('watchlist feed code resolution', () => {
  it('prefers explicit scope codes over watchlist scope', () => {
    expect(parseScopeCodes('["600519","000001","600519"]')).toEqual(['600519', '000001'])
    expect(resolveFeedCodes({
      feed_type: 'quote_snapshot',
      scope: 'watchlist',
      scope_codes: '600519 000001',
    }, tempBase())).toEqual(['600519', '000001'])
  })

  it('splits unified watchlists into stock and fund feeds by item type', () => {
    const basePath = tempBase()
    writeJson(basePath, 'watchlists.json', {
      groups: [
        { id: 'default', name: 'Stock', type: 'stock' },
        { id: 'fund-default', name: 'Fund', type: 'fund' },
      ],
      items: [
        { id: 's1', groupId: 'default', symbol: '600519', name: '贵州茅台', type: 'stock', status: 'watching' },
        { id: 'i1', groupId: 'default', symbol: '000001', name: '上证', type: 'index', status: 'watching' },
        { id: 'f1', groupId: 'fund-default', symbol: '110022', name: '易方达消费行业', type: 'fund', status: 'watching' },
        { id: 'e1', groupId: 'fund-default', symbol: '510300', name: '沪深300ETF', type: 'etf', status: 'watching' },
        { id: 'x1', groupId: 'fund-default', symbol: '000003', name: '退出基金', type: 'fund', status: 'exited' },
      ],
    })

    expect(readStockWatchlistCodes(basePath)).toEqual(['600519', '000001'])
    expect(readFundWatchlistCodes(basePath)).toEqual(['110022', '510300'])
    expect(resolveFeedCodes({ feed_type: 'fund_nav', scope: 'watchlist', scope_codes: null }, basePath)).toEqual(['110022', '510300'])
    expect(resolveFeedCodes({ feed_type: 'fund_money_yield', scope: 'watchlist', scope_codes: null }, basePath)).toEqual(['110022', '510300'])
  })

  it('falls back to legacy fund watchlists when unified fund rows are missing', () => {
    const basePath = tempBase()
    mkdirSync(join(basePath, 'memory'), { recursive: true })
    writeJson(basePath, 'watchlists.json', {
      groups: [{ id: 'default', name: 'Stock', type: 'stock' }],
      items: [{ id: 's1', groupId: 'default', symbol: '600519', type: 'stock', status: 'watching' }],
    })
    writeJson(basePath, 'fund_watchlists.json', {
      items: [{ code: '110022' }, { code: '000001' }, { code: '110022' }],
    })

    expect(readFundWatchlistCodes(basePath)).toEqual(['110022', '000001'])
  })

  it('resolves all-scope batch feeds from reusable local stock and fund identity tables', () => {
    const store = {
      queryStockList: () => [{ code: '600519' }, { code: '000001' }, { code: '600519' }],
      queryFundList: () => [
        { code: '110022', name: '易方达消费行业', fund_type: '混合型' },
        { code: '000009', name: '易方达天天理财货币A', fund_type: '货币型' },
        { code: '000002', name: '华夏成长混合(后端)', fund_type: '混合型' },
        { code: '000003', name: '债券基金', fund_type: '债券型' },
      ],
    }

    expect(resolveFeedCodesWithStore({ feed_type: 'kline_daily', scope: 'all', scope_codes: null }, tempBase(), store)).toEqual(['600519', '000001'])
    expect(resolveFeedCodesWithStore({ feed_type: 'fund_nav', scope: 'all', scope_codes: null }, tempBase(), store)).toEqual(['110022', '000003'])
    expect(resolveFeedCodesWithStore({ feed_type: 'fund_money_yield', scope: 'all', scope_codes: null }, tempBase(), store)).toEqual(['000009'])
    expect(resolveFeedCodesWithStore({ feed_type: 'fund_holding', scope: 'all', scope_codes: null }, tempBase(), store)).toEqual(['110022'])
  })

  it('resolves CSI scopes from reusable local index constituents', () => {
    const store = {
      queryIndexConstituents: ({ indexCode }: { indexCode?: string }) => (
        indexCode === '000300'
          ? [{ stock_code: '600519' }, { stock_code: '000001' }]
          : [{ stock_code: '300750' }]
      ),
    }

    expect(resolveFeedCodesWithStore({ feed_type: 'fundamental', scope: 'csi300', scope_codes: null }, tempBase(), store)).toEqual(['600519', '000001'])
    expect(resolveFeedCodesWithStore({ feed_type: 'money_flow', scope: 'csi500', scope_codes: null }, tempBase(), store)).toEqual(['300750'])
  })

  it('describes prerequisite tasks for computed scopes with no local universe rows', () => {
    expect(missingFeedScopePrerequisite({ feed_type: 'fund_holding', scope: 'all', scope_codes: null })).toMatchObject({ taskType: 'fund_list', code: null })
    expect(missingFeedScopePrerequisite({ feed_type: 'kline_daily', scope: 'all', scope_codes: null })).toMatchObject({ taskType: 'stock_list', code: null })
    expect(missingFeedScopePrerequisite({ feed_type: 'fundamental', scope: 'csi300', scope_codes: null })).toMatchObject({ taskType: 'index_components', code: '000300' })
    expect(missingFeedScopePrerequisite({ feed_type: 'fundamental', scope: 'watchlist', scope_codes: null })).toBeNull()
  })
})
