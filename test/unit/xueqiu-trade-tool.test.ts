import { describe, expect, it } from 'vitest'
import { XueqiuTradeTool } from '../../src/agent/tools/xueqiu-trade'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('XueqiuTradeTool', () => {
  it('exposes explicit-share MONI contract on read evidence', async () => {
    const fetchMock: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/MONI/trans_group/list.json')) {
        return jsonResponse({
          result_data: { trans_groups: [{ name: 'finasimu', gid: 6705388713207579, open_status: 0, order_id: 1 }] },
          msg: null,
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/MONI/performances.json')) {
        return jsonResponse({ result_data: { performances: [{ market: 'ALL', assets: 100000, cash: 100000 }] }, success: true })
      }
      throw new Error(`unexpected url ${url}`)
    }) as typeof fetch

    const tool = new XueqiuTradeTool(fetchMock)
    const portfolios = JSON.parse(await tool.call('xq-portfolios-contract', { action: 'portfolios' }, {
      basePath: '/tmp',
      workDir: '/tmp',
      memoryDir: '/tmp/memory',
      bundleDir: '/tmp/bundle',
      projectLocalDir: '/tmp/.finagent-workstation',
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
      getConfigValue: (key: string) => key === 'XQ_COOKIE' ? 'cookie' : key === 'XQ_PORTFOLIO' ? 'finasimu' : '',
    }))
    const balance = JSON.parse(await tool.call('xq-balance-contract', { action: 'balance', portfolio: 'finasimu' }, {
      basePath: '/tmp',
      workDir: '/tmp',
      memoryDir: '/tmp/memory',
      bundleDir: '/tmp/bundle',
      projectLocalDir: '/tmp/.finagent-workstation',
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
      getConfigValue: (key: string) => key === 'XQ_COOKIE' ? 'cookie' : key === 'XQ_PORTFOLIO' ? 'finasimu' : '',
    }))

    for (const payload of [portfolios, balance]) {
      expect(payload.tradeContract.shareSizing).toBe('explicit_shares')
      expect(payload.tradeContract.lotSize).toBe(1)
      expect(payload.tradeContract.localPortfolioLotRuleApplies).toBe(false)
      expect(payload.tradeContract.sizingGuidance.join('\n')).toContain('Do not claim a portfolio cannot buy only because it cannot afford 100 shares')
    }
  })

  it('previews an order with readback evidence without calling write endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/MONI/trans_group/list.json')) {
        return jsonResponse({
          result_data: { trans_groups: [{ name: 'finasimu', gid: 6705388713207579, open_status: 0, order_id: 1 }] },
          msg: null,
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/query/v1/search/stock.json')) return jsonResponse({ stocks: [{ code: 'SH600519' }] })
      if (url.includes('/v5/stock/batch/quote.json')) return jsonResponse({ data: { items: [{ symbol: 'SH600519' }] } })
      if (url.includes('/MONI/performances.json')) {
        return jsonResponse({ result_data: { performances: [{ market: 'ALL', assets: 100000, cash: 100000 }] }, success: true })
      }
      if (url.includes('/MONI/forchart/holdstock.json')) {
        return jsonResponse({ result_data: [], success: true })
      }
      if (url.includes('/MONI/forchart/roa.json')) {
        return jsonResponse({ result_data: { list: [] }, success: true })
      }
      if (url.includes('/MONI/transaction/add.json') || url.includes('/MONI/bank_transfer/add.json')) {
        throw new Error(`preview must not call write endpoint ${url}`)
      }
      throw new Error(`unexpected url ${url}`)
    }) as typeof fetch

    const tool = new XueqiuTradeTool(fetchMock)
    const result = await tool.call('xq-preview', {
      action: 'preview_order',
      portfolio: 'finasimu',
      side: 'buy',
      symbol: '600519',
      shares: 5,
      price: 1215,
    }, {
      basePath: '/tmp',
      workDir: '/tmp',
      memoryDir: '/tmp/memory',
      bundleDir: '/tmp/bundle',
      projectLocalDir: '/tmp/.finagent-workstation',
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
      getConfigValue: (key: string) => key === 'XQ_COOKIE' ? 'cookie' : key === 'XQ_PORTFOLIO' ? 'finasimu' : '',
    })

    expect(calls.some((call) => call.url.includes('/MONI/transaction/add.json'))).toBe(false)
    expect(calls.some((call) => call.url.includes('/MONI/bank_transfer/add.json'))).toBe(false)
    const parsed = JSON.parse(result)
    expect(parsed.action).toBe('preview_order')
    expect(parsed.sideEffect).toBe(false)
    expect(parsed.order.symbol).toBe('SH600519')
    expect(parsed.readbackEvidence.balance.performances[0].cash).toBe(100000)
  })

  it('keeps preview_order non-writing when best-effort readback fails', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/MONI/trans_group/list.json')) {
        return jsonResponse({
          result_data: { trans_groups: [{ name: 'finasimu', gid: 6705388713207579, open_status: 0, order_id: 1 }] },
          msg: null,
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/query/v1/search/stock.json')) {
        return jsonResponse({ result_code: '0', success: false, msg: 'temporary validation failure' })
      }
      if (url.includes('/v5/stock/batch/quote.json')) {
        throw new Error('quote unavailable')
      }
      if (url.includes('/MONI/performances.json') || url.includes('/MONI/forchart/holdstock.json')) {
        throw new Error('readback unavailable')
      }
      if (url.includes('/MONI/transaction/add.json') || url.includes('/MONI/bank_transfer/add.json')) {
        throw new Error(`preview must not call write endpoint ${url}`)
      }
      throw new Error(`unexpected url ${url}`)
    }) as typeof fetch

    const tool = new XueqiuTradeTool(fetchMock)
    const result = await tool.call('xq-preview-warning', {
      action: 'preview_order',
      portfolio: 'finasimu',
      side: 'buy',
      symbol: '300059',
      shares: 900,
      price: 21.89,
    }, {
      basePath: '/tmp',
      workDir: '/tmp',
      memoryDir: '/tmp/memory',
      bundleDir: '/tmp/bundle',
      projectLocalDir: '/tmp/.finagent-workstation',
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
      getConfigValue: (key: string) => key === 'XQ_COOKIE' ? 'cookie' : key === 'XQ_PORTFOLIO' ? 'finasimu' : '',
    })

    expect(calls.some((call) => call.url.includes('/MONI/transaction/add.json'))).toBe(false)
    const parsed = JSON.parse(result)
    expect(parsed.action).toBe('preview_order')
    expect(parsed.sideEffect).toBe(false)
    expect(parsed.order.symbol).toBe('SZ300059')
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.readbackEvidence.balance).toBeNull()
    expect(parsed.readbackEvidence.position).toBeNull()
  })

  it('builds MONI trade requests with gid-based portfolio resolution', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/MONI/trans_group/list.json')) {
        return jsonResponse({
          result_data: { trans_groups: [{ name: 'finasimu', gid: 6705388713207579, open_status: 0, order_id: 1 }] },
          msg: null,
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/query/v1/search/stock.json')) {
        return jsonResponse({ stocks: [{ code: 'SH600519' }] })
      }
      if (url.includes('/v5/stock/batch/quote.json')) {
        return jsonResponse({ data: { items: [{ symbol: 'SH600519' }] } })
      }
      if (url.includes('/MONI/transaction/add.json')) {
        return jsonResponse({
          result_data: { gid: 6705388713207579, symbol: 'SH600519', type: 1, shares: 5, price: 1215 },
          msg: '下单成功',
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/MONI/performances.json')) {
        return jsonResponse({ result_data: { performances: [{ market: 'ALL', assets: 100000, cash: 93920 }] }, result_code: '60000', success: true })
      }
      if (url.includes('/MONI/transaction/list.json')) {
        return jsonResponse({
          result_data: { pos: null, transactions: [{ tid: 6773198613140772, symbol: 'SH600519', type: 1, shares: 5, price: 1215 }] },
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/MONI/bank_transfer/query.json')) {
        return jsonResponse({ result_data: { pos: null, bank_transfers: [] }, result_code: '60000', success: true })
      }
      if (url.includes('/MONI/forchart/holdstock.json')) {
        return jsonResponse({ result_data: [{ symbol: 'SH600519', shares: 5 }], result_code: '60000', success: true })
      }
      if (url.includes('/MONI/forchart/roa.json')) {
        return jsonResponse({ result_data: { list: [] }, result_code: '60000', success: true })
      }
      throw new Error(`unexpected url ${url}`)
    }) as typeof fetch

    const tool = new XueqiuTradeTool(fetchMock)
    const result = await tool.call('xq-buy', {
      action: 'buy',
      portfolio: 'finasimu',
      symbol: '600519',
      shares: 5,
      price: 1215,
    }, {
      basePath: '/tmp',
      workDir: '/tmp',
      memoryDir: '/tmp/memory',
      bundleDir: '/tmp/bundle',
      projectLocalDir: '/tmp/.finagent-workstation',
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
      getConfigValue: (key: string) => key === 'XQ_COOKIE' ? 'cookie' : key === 'XQ_PORTFOLIO' ? 'finasimu' : '',
    })

    const tradeCall = calls.find((call) => call.url.includes('/MONI/transaction/add.json'))
    expect(tradeCall).toBeDefined()
    expect(String(tradeCall?.init?.method)).toBe('POST')
    const body = tradeCall?.init?.body as URLSearchParams
    expect(body.get('gid')).toBe('6705388713207579')
    expect(body.get('type')).toBe('1')
    expect(body.get('symbol')).toBe('SH600519')
    expect(body.get('shares')).toBe('5')
    expect(body.get('price')).toBe('1215')

    const parsed = JSON.parse(result)
    expect(parsed.action).toBe('buy')
    expect(parsed.sideEffect).toBe(true)
    expect(parsed.executionVenue).toBe('xueqiu_moni')
    expect(parsed.result.symbol).toBe('SH600519')
    expect(parsed.postTradeReadback).toMatchObject({
      source: 'xueqiu',
      readbackAction: 'xueqiu_trade_balance_position_history_after_write',
      readbackStatus: 'verified',
      portfolio: { name: 'finasimu', gid: 6705388713207579 },
    })
    expect(parsed.postTradeReadback.balance.performances[0].cash).toBe(93920)
    expect(parsed.postTradeReadback.history.transactions.transactions[0].symbol).toBe('SH600519')
    expect(parsed.postTradeReadback.position.holdstock[0].symbol).toBe('SH600519')
  })

  it('builds transfer-out requests through bank_transfer/add.json', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/MONI/trans_group/list.json')) {
        return jsonResponse({
          result_data: { trans_groups: [{ name: 'finamsim', gid: 6705413862125926, open_status: 0, order_id: 1 }] },
          msg: null,
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/MONI/bank_transfer/add.json')) {
        return jsonResponse({
          result_data: { gid: 6705413862125926, type: 2, amount: 500 },
          msg: '添加成功',
          result_code: '60000',
          success: true,
        })
      }
      if (url.includes('/MONI/performances.json')) {
        return jsonResponse({ result_data: { performances: [{ market: 'ALL', assets: 99500, cash: 99500 }] }, result_code: '60000', success: true })
      }
      if (url.includes('/MONI/transaction/list.json')) {
        return jsonResponse({ result_data: { pos: null, transactions: [] }, result_code: '60000', success: true })
      }
      if (url.includes('/MONI/bank_transfer/query.json')) {
        return jsonResponse({
          result_data: { pos: null, bank_transfers: [{ tid: 6773203897773573, gid: 6705413862125926, type: 2, amount: 500 }] },
          result_code: '60000',
          success: true,
        })
      }
      throw new Error(`unexpected url ${url}`)
    }) as typeof fetch

    const tool = new XueqiuTradeTool(fetchMock)
    const result = await tool.call('xq-transfer', {
      action: 'transfer_out',
      portfolio: 'finamsim',
      amount: 500,
      date: '2026-06-21',
    }, {
      basePath: '/tmp',
      workDir: '/tmp',
      memoryDir: '/tmp/memory',
      bundleDir: '/tmp/bundle',
      projectLocalDir: '/tmp/.finagent-workstation',
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
      getConfigValue: (key: string) => key === 'XQ_COOKIE' ? 'cookie' : key === 'XQ_PORTFOLIO' ? 'finamsim' : '',
    })

    const transferCall = calls.find((call) => call.url.includes('/MONI/bank_transfer/add.json'))
    expect(transferCall).toBeDefined()
    const body = transferCall?.init?.body as URLSearchParams
    expect(body.get('gid')).toBe('6705413862125926')
    expect(body.get('type')).toBe('2')
    expect(body.get('market')).toBe('CHA')
    expect(body.get('amount')).toBe('500')
    expect(body.get('date')).toBe('2026-06-21')

    const parsed = JSON.parse(result)
    expect(parsed.action).toBe('transfer_out')
    expect(parsed.sideEffect).toBe(true)
    expect(parsed.executionVenue).toBe('xueqiu_moni')
    expect(parsed.result.amount).toBe(500)
    expect(parsed.postTradeReadback).toMatchObject({
      source: 'xueqiu',
      readbackAction: 'xueqiu_transfer_balance_history_after_write',
      readbackStatus: 'verified',
      portfolio: { name: 'finamsim', gid: 6705413862125926 },
    })
    expect(parsed.postTradeReadback.balance.performances[0].cash).toBe(99500)
    expect(parsed.postTradeReadback.history.bankTransfers.bank_transfers[0].amount).toBe(500)
  })
})
