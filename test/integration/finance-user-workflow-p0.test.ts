import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runInNewContext } from 'vm'
import { Agent } from '../../src/agent/agent'
import { ToolRegistry } from '../../src/agent/tool'
import { MarketDataTool } from '../../src/agent/tools/market-data'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import { WatchlistTool } from '../../src/agent/tools/watchlist'
import { DashboardTool } from '../../src/agent/tools/dashboard'
import { PortfolioTool } from '../../src/agent/tools/portfolio'
import { XueqiuTradeTool } from '../../src/agent/tools/xueqiu-trade'
import { CronCreateTool } from '../../src/agent/tools/cron'
import { CronScheduler } from '../../src/agent/cron-scheduler'
import { MonitorCreateTool, MonitorListTool } from '../../src/agent/tools/monitor'
import { MonitorStore } from '../../src/agent/monitor-store'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import { MockLLM } from '../mocks/mock-llm'
import type { AgentEvent } from '../../src/agent/agent-event'
import type { ToolContext } from '../../src/agent/tool'

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const ev of gen) events.push(ev)
  return events
}

function toolResults(events: AgentEvent[], name?: string): AgentEvent[] {
  return events.filter((e) => e.type === 'tool-result' && (!name || e.name === name))
}

function expectNoHiddenApiFailure(events: AgentEvent[]): void {
  for (const ev of toolResults(events) as Array<Extract<AgentEvent, { type: 'tool-result' }>>) {
    expect(ev.result).not.toMatch(/unexpected mocked URL|provider failure hidden|Traceback|ECONNRESET/i)
    if (ev.isError) {
      expect(ev.result).toMatch(/not available|required|blocked|missing|permission|credential|guard/i)
    }
  }
}

class FakeMarketDataActionService {
  readonly calls: Array<{ action: string; input: Record<string, unknown> }> = []

  async call(action: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    this.calls.push({ action, input })
    const code = String(input.code ?? input.symbols ?? '600519')
    const common = {
      provider: 'fixture',
      cacheStatus: 'fixture',
      sourceDataTime: '2026-06-26T09:30:00+08:00',
      fetchedAt: '2026-06-26T09:31:00+08:00',
    }
    switch (action) {
      case 'quote':
        return JSON.stringify({ action, interfaceId: 'stock.quote', code, rows: [{ code, name: code === '000858' ? '五粮液' : '贵州茅台', price: 1215, changePct: 1.8 }], ...common })
      case 'kline':
        return JSON.stringify({ action, interfaceId: 'stock.daily_kline', code, rows: [{ date: '2026-06-25', open: 1200, high: 1220, low: 1190, close: 1215, volume: 100000 }], ...common })
      case 'sector':
        return JSON.stringify({ action, interfaceId: 'market.sector_ranking', rows: [{ code: 'BK0475', name: 'AI算力', changePct: 3.2, leader: '浪潮信息' }], ...common })
      case 'flow_rank':
        return JSON.stringify({ action, interfaceId: 'market.money_flow_rank', rows: [{ code: '600519', name: '贵州茅台', mainNetInflow: 12000000 }], ...common })
      case 'backtest':
        return JSON.stringify({ action, interfaceId: 'strategy.backtest', code, strategy: input.strategy ?? 'rsi', totalReturn: 0.18, sharpe: 1.2, maxDrawdown: 0.08, trades: 6, noFutureLeakage: true, ...common })
      case 'backtest_batch':
        return JSON.stringify({ action, interfaceId: 'strategy.backtest_batch', rows: [{ code: '600519', strategy: 'rsi', score: 82 }, { code: '000858', strategy: 'rsi', score: 76 }], ...common })
      case 'optimize_params':
        return JSON.stringify({ action, interfaceId: 'strategy.parameter_optimization', code, best: { period: 20, oversold: 35, overbought: 65, score: 78 }, ...common })
      case 'fund_nav':
        return JSON.stringify({ action, interfaceId: 'fund.nav', code, rows: [{ date: '2026-06-25', nav: 3.12 }], ...common })
      case 'fund_performance':
        return JSON.stringify({ action, interfaceId: 'fund.performance', code, rows: [{ code, return1y: 12.4, maxDrawdown: 0.11 }], ...common })
      default:
        return JSON.stringify({ action, interfaceId: `fixture.${action}`, code, rows: [], ...common })
    }
  }
}

function mockFinanceFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    if (href.endsWith('/screener/stock')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({
        total_universe: 5200,
        passed_gates: 12,
        returned: body.limit ?? 2,
        stocks: [
          { code: '600519', name: '贵州茅台', price: 1215, composite_score: 92, factors: { roe: 31.2, pe: 19.8 } },
          { code: '000858', name: '五粮液', price: 138, composite_score: 84, factors: { roe: 24.8, pe: 18.1 } },
        ],
      })
    }
    if (href.endsWith('/screener/fund')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({
        mode: body.mode ?? '4433',
        total_universe: 13000,
        passed: 21,
        returned: body.limit ?? 2,
        funds: [
          { code: '110022', name: '易方达消费行业', nav: 3.12, return_1y: 12.4, return_3y: 38.5 },
          { code: '000001', name: '华夏成长混合', nav: 1.08, return_1y: 5.2, return_3y: 18.1 },
        ],
      })
    }
    return Response.json({ error: `unexpected mocked URL: ${href}` }, { status: 500 })
  }))
}

function mockXueqiuFetch(): typeof fetch {
  return vi.fn(async (url: string | URL) => {
    const href = String(url)
    if (href.includes('/trans_group/list.json')) {
      return Response.json({ result_data: { trans_groups: [{ name: 'finasimu', gid: 6705388713207579, open_status: 0, order_id: 1 }] }, result_code: '60000', success: true })
    }
    if (href.includes('/performances.json')) {
      return Response.json({ result_data: { performances: [{ market: 'ALL', assets: 100000, cash: 90000, market_value: 10000, float_rate: 0.05 }] }, result_code: '60000', success: true })
    }
    if (href.includes('/transaction/list.json')) {
      return Response.json({ result_data: { transactions: [{ symbol: 'SH600519', type_name: '买入', shares: 5, price: 1215 }] }, result_code: '60000', success: true })
    }
    if (href.includes('/bank_transfer/query.json')) {
      return Response.json({ result_data: { bank_transfers: [] }, result_code: '60000', success: true })
    }
    if (href.includes('/transaction/add.json')) {
      return Response.json({ result_data: { symbol: 'SH600519', type: 1, shares: 5, price: 1215, amount: 6075 }, msg: '下单成功', result_code: '60000', success: true })
    }
    if (href.includes('/query/v1/search/stock.json')) {
      return Response.json({ stocks: [{ code: 'SH600519', name: '贵州茅台' }], result_code: '60000', success: true })
    }
    if (href.includes('/v5/stock/batch/quote.json')) {
      return Response.json({ data: { items: [{ quote: { symbol: 'SH600519', name: '贵州茅台', current: 1215 } }] }, result_code: '60000', success: true })
    }
    return Response.json({ error: `unexpected xueqiu URL: ${href}` }, { status: 500 })
  }) as unknown as typeof fetch
}

function dashboardHtml(title: string, body: string): string {
  return `<html><body><h1>${title}</h1><p>source time: 2026-06-26T09:30:00+08:00</p><p>retrieved at: 2026-06-26T09:31:00+08:00</p>${body}</body></html>`
}

describe('finance agent P0 user workflow integration', () => {
  let basePath: string
  let marketData: FakeMarketDataActionService

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-user-workflow-p0-'))
    marketData = new FakeMarketDataActionService()
    mockFinanceFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('covers MKT-001 and MKT-002 market understanding prompts with market and sector evidence', async () => {
    const registry = new ToolRegistry()
    registry.register(new MarketDataTool(marketData as any))
    const llm = new MockLLM([
      { toolCalls: [{ id: 'index', name: 'MarketData', arguments: { action: 'quote', code: '000001' } }] },
      { toolCalls: [{ id: 'sector', name: 'MarketData', arguments: { action: 'sector', type: 'industry', limit: 5 } }] },
      { text: '事实: 指数和行业板块数据已核验。推断: AI算力板块相对更强。风险: 只基于2026-06-26 09:30 source time, retrieved at 09:31。' },
      { toolCalls: [{ id: 'sector-hot', name: 'MarketData', arguments: { action: 'sector', type: 'concept', limit: 5 } }] },
      { text: '最近热门板块包括AI算力；已列出领涨股、涨跌幅、source time和retrieved at，未隐藏provider失败。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const marketEvents = await collectEvents(agent.run('今天市场怎么样？'))
    const sectorEvents = await collectEvents(agent.run('最近什么板块热门？'))

    expect(marketData.calls.map((c) => c.action)).toEqual(expect.arrayContaining(['quote', 'sector']))
    expect(sectorEvents.some((e) => e.type === 'tool-result' && e.name === 'MarketData' && e.result.includes('market.sector_ranking'))).toBe(true)
    expect([...marketEvents, ...sectorEvents].some((e) => e.type === 'text-delta' && e.text.includes('事实') && e.text.includes('推断') && e.text.includes('风险'))).toBe(true)
    expectNoHiddenApiFailure([...marketEvents, ...sectorEvents])
  })

  it('covers STK-001 and STK-002 stock research prompts with quote, kline, and grounded final output', async () => {
    const registry = new ToolRegistry()
    registry.register(new MarketDataTool(marketData as any))
    const llm = new MockLLM([
      { toolCalls: [{ id: 'quote-moutai', name: 'MarketData', arguments: { action: 'quote', code: '600519' } }] },
      { toolCalls: [{ id: 'kline-moutai', name: 'MarketData', arguments: { action: 'kline', code: '600519', limit: 120 } }] },
      { text: '茅台分析: 事实=报价和K线已读取; 推断=趋势偏稳; 建议=继续观察; 假设=未使用未验证财报。source time/retrieved at 已披露。' },
      { toolCalls: [{ id: 'quote-wly', name: 'MarketData', arguments: { action: 'quote', code: '000858' } }] },
      { toolCalls: [{ id: 'kline-wly', name: 'MarketData', arguments: { action: 'kline', code: '000858', limit: 180 } }] },
      { toolCalls: [{ id: 'flow-wly', name: 'MarketData', arguments: { action: 'flow_rank', limit: 20 } }] },
      { text: '五粮液深度分析: 覆盖行情、K线、资金线索。结论分为事实、推断、风险，不把不可用财报当成事实。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const moutaiEvents = await collectEvents(agent.run('帮我看看茅台'))
    const wlyEvents = await collectEvents(agent.run('深度分析五粮液'))

    expect(marketData.calls.map((c) => `${c.action}:${c.input.code ?? ''}`)).toEqual(expect.arrayContaining(['quote:600519', 'kline:600519', 'quote:000858', 'kline:000858']))
    expect(moutaiEvents.some((e) => e.type === 'text-delta' && e.text.includes('事实') && e.text.includes('推断') && e.text.includes('建议'))).toBe(true)
    expect(wlyEvents.some((e) => e.type === 'text-delta' && e.text.includes('不把不可用财报当成事实'))).toBe(true)
    expectNoHiddenApiFailure([...moutaiEvents, ...wlyEvents])
  })

  it('covers SEL-001 and SEL-002 stock selection through screener, watchlist, dashboard, and task-style caveat', async () => {
    const dashboard = new DashboardTool()
    dashboard.setPanelQuery(async () => [{ id: 'dash-stock-selection-p0', title: 'Stock Selection P0', url: join(basePath, 'dashboards', 'stock-selection-p0.html'), type: 'dashboard', isActive: true }])
    const registry = new ToolRegistry()
    registry.register(new DataStoreTool())
    registry.register(new WatchlistTool())
    registry.register(dashboard)
    const llm = new MockLLM([
      { toolCalls: [{ id: 'screen-good', name: 'DataStore', arguments: { action: 'screen_stock', limit: 2, sort_by: 'composite_score' } }] },
      { toolCalls: [{ id: 'watch-good', name: 'Watchlist', arguments: { action: 'add', symbol: '600519', name: '贵州茅台', type: 'stock', source: 'stock-picking', score: 92, tags: ['P0'] } }] },
      { toolCalls: [{ id: 'dash-good', name: 'Dashboard', arguments: { id: 'stock-selection-p0', title: 'Stock Selection P0', html: dashboardHtml('Stock Selection P0', '<p>600519 贵州茅台 score 92</p>') } }] },
      { text: '有什么好股票: 已完成候选发现、评分、观察池和看板证据；没有把筛选失败隐藏为成功。' },
      { toolCalls: [{ id: 'screen-pe-roe', name: 'DataStore', arguments: { action: 'screen_stock', limit: 2, filters: { pe_lte: 20, roe_gte: 15 } } }] },
      { text: '全市场筛选 PE<20 ROE>15: 返回任务式筛选结果和候选，若全市场扫描耗时应保留任务句柄并显示失败。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const pickEvents = await collectEvents(agent.run('有什么好股票？'))
    const screenEvents = await collectEvents(agent.run('全市场筛选 PE<20 ROE>15'))

    expect(toolResults(pickEvents, 'DataStore').some((e: any) => e.result.includes('600519'))).toBe(true)
    expect(readFileSync(join(basePath, 'watchlists.json'), 'utf-8')).toContain('stock-picking')
    expect(readFileSync(join(basePath, 'dashboards', 'stock-selection-p0.html'), 'utf-8')).toContain('retrieved at')
    expect(new ArtifactRegistry(basePath).list('dashboard')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'dashboard:stock-selection-p0' })]))
    expect(screenEvents.some((e) => e.type === 'text-delta' && e.text.includes('任务句柄') && e.text.includes('失败'))).toBe(true)
    expectNoHiddenApiFailure([...pickEvents, ...screenEvents])
  })

  it('covers FND-001 and FND-002 fund selection and long-horizon fund research', async () => {
    const registry = new ToolRegistry()
    registry.register(new DataStoreTool())
    registry.register(new MarketDataTool(marketData as any))
    registry.register(new WatchlistTool())
    const llm = new MockLLM([
      { toolCalls: [{ id: 'screen-fund', name: 'DataStore', arguments: { action: 'screen_fund', mode: '4433', limit: 2 } }] },
      { toolCalls: [{ id: 'watch-fund', name: 'Watchlist', arguments: { action: 'add', symbol: '110022', name: '易方达消费行业', type: 'fund', source: 'fund-screening', rating: 'shortlist' } }] },
      { text: '帮我选基金: 已用4433筛选、加入基金观察池，并说明收益、回撤、持仓仍需核验。' },
      { toolCalls: [{ id: 'fund-nav', name: 'MarketData', arguments: { action: 'fund_nav', code: '110022' } }] },
      { toolCalls: [{ id: 'fund-perf', name: 'MarketData', arguments: { action: 'fund_performance', code: '110022' } }] },
      { text: '这个基金适合长期持有吗: 事实=净值和绩效证据; 推断=长期适配度; 风险=回撤和风格漂移。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const selectEvents = await collectEvents(agent.run('帮我选基金'))
    const researchEvents = await collectEvents(agent.run('这个基金适合长期持有吗？'))

    expect(toolResults(selectEvents, 'DataStore').some((e: any) => e.result.includes('110022'))).toBe(true)
    expect(readFileSync(join(basePath, 'watchlists.json'), 'utf-8')).toContain('fund-screening')
    expect(researchEvents.some((e) => e.type === 'text-delta' && e.text.includes('事实') && e.text.includes('风险'))).toBe(true)
    expectNoHiddenApiFailure([...selectEvents, ...researchEvents])
  })

  it('covers QNT-001 and QNT-002 strategy backtest and strategy comparison workflows', async () => {
    const registry = new ToolRegistry()
    registry.register(new MarketDataTool(marketData as any))
    const llm = new MockLLM([
      { toolCalls: [{ id: 'rsi-backtest', name: 'MarketData', arguments: { action: 'backtest', code: '600519', strategy: 'rsi', period: '1y' } }] },
      { text: 'RSI近1年回测: totalReturn 18%, Sharpe 1.2, maxDrawdown 8%; 数据窗口和无未来函数约束已说明。' },
      { toolCalls: [{ id: 'strategy-compare', name: 'MarketData', arguments: { action: 'backtest_batch', symbols: ['600519'], strategies: ['rsi', 'macd', 'ema_cross'], period: '1y' } }] },
      { text: '茅台策略比较: RSI、MACD、EMA按指标排序；结论包含样本窗口、过拟合和执行成本限制。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const backtestEvents = await collectEvents(agent.run('回测 RSI 策略在茅台上最近 1 年表现'))
    const compareEvents = await collectEvents(agent.run('茅台用什么策略最好？'))

    expect(marketData.calls.map((c) => c.action)).toEqual(expect.arrayContaining(['backtest', 'backtest_batch']))
    expect(backtestEvents.some((e) => e.type === 'text-delta' && e.text.includes('无未来函数'))).toBe(true)
    expect(compareEvents.some((e) => e.type === 'text-delta' && e.text.includes('过拟合'))).toBe(true)
    expectNoHiddenApiFailure([...backtestEvents, ...compareEvents])
  })

  it('covers DEC-001 and DEC-004 decision preparation and watchlist observation without unauthorized trade', async () => {
    const registry = new ToolRegistry()
    registry.register(new MarketDataTool(marketData as any))
    registry.register(new WatchlistTool())
    const llm = new MockLLM([
      { toolCalls: [{ id: 'decision-quote', name: 'MarketData', arguments: { action: 'quote', code: '600519' } }] },
      { toolCalls: [{ id: 'decision-kline', name: 'MarketData', arguments: { action: 'kline', code: '600519', limit: 120 } }] },
      { text: '现在可以买吗: 只给入场条件和仓位风险建议，不执行任何交易。事实、推断、建议已分离。' },
      { toolCalls: [{ id: 'watch-decision', name: 'Watchlist', arguments: { action: 'add', symbol: '600519', name: '贵州茅台', type: 'stock', source: 'trade-preparation', entryCondition: '放量站上20日均线', stopLoss: 1150, targetPrice: 1300 } }] },
      { text: '已加入观察池，记录入场条件、止损和目标价，等待后续触发。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const decisionEvents = await collectEvents(agent.run('现在可以买吗？'))
    const watchEvents = await collectEvents(agent.run('加入观察池'))

    expect(decisionEvents.some((e) => e.type === 'text-delta' && e.text.includes('不执行任何交易'))).toBe(true)
    const watchlist = readFileSync(join(basePath, 'watchlists.json'), 'utf-8')
    expect(watchlist).toContain('trade-preparation')
    expect(watchlist).toContain('放量站上20日均线')
    expectNoHiddenApiFailure([...decisionEvents, ...watchEvents])
  })

  it.skip('covers TRD-001 and TRD-002 simulated trading with configured Xueqiu MONI contract and no broker side effect', async () => {
    const registry = new ToolRegistry()
    registry.register(new XueqiuTradeTool(mockXueqiuFetch()))
    const llm = new MockLLM([
      { toolCalls: [{ id: 'xq-portfolios', name: 'XueqiuTrade', arguments: { action: 'portfolios' } }] },
      { toolCalls: [{ id: 'xq-buy', name: 'XueqiuTrade', arguments: { action: 'buy', portfolio: 'finasimu', symbol: 'SH600519', shares: 5, price: 1215 } }] },
      { text: '买入 20% 到雪球模拟盘: 仅使用Xueqiu MONI模拟盘合同，未触发真实券商交易。' },
      { toolCalls: [{ id: 'xq-balance', name: 'XueqiuTrade', arguments: { action: 'balance', portfolio: 'finasimu' } }] },
      { toolCalls: [{ id: 'xq-history', name: 'XueqiuTrade', arguments: { action: 'history', portfolio: 'finasimu' } }] },
      { text: '我的持仓怎么样: 汇总资产、现金、模拟交易历史和source，不当作真实券商持仓。' },
    ])
    const agent = new Agent({
      llm,
      tools: registry,
      basePath,
      skipPermissions: true,
      getConfigValue: (key) => key === 'XQ_COOKIE' ? 'mock_session_cookie=test;' : key === 'XQ_PORTFOLIO' ? 'finasimu' : undefined,
    })

    const buyEvents = await collectEvents(agent.run('买入 20% 到雪球模拟盘'))
    const positionEvents = await collectEvents(agent.run('我的持仓怎么样？'))

    expect(toolResults(buyEvents, 'XueqiuTrade').some((e: any) => e.result.includes('finasimu'))).toBe(true)
    expect(toolResults(buyEvents, 'XueqiuTrade').some((e: any) => e.result.includes('下单成功'))).toBe(true)
    expect(positionEvents.some((e) => e.type === 'text-delta' && e.text.includes('不当作真实券商持仓'))).toBe(true)
    expectNoHiddenApiFailure([...buyEvents, ...positionEvents])
  })

  it('covers MON-001 and MON-002 scheduled watchlist analysis and monitor setup', async () => {
    const scheduler = new CronScheduler(basePath)
    const monitorStore = new MonitorStore(join(basePath, 'memory'))
    monitorStore.load()
    const registry = new ToolRegistry()
    registry.register(new CronCreateTool(scheduler))
    registry.register(new MonitorCreateTool(monitorStore))
    registry.register(new MonitorListTool(monitorStore))
    const llm = new MockLLM([
      { toolCalls: [{ id: 'cron-watchlist', name: 'CronCreate', arguments: { cron: '30 9 * * 1-5', prompt: '每天分析自选股并记录风险变化', durable: true } }] },
      { text: '每天分析自选股: 已创建durable cron，后续进入事件agent处理。' },
      { toolCalls: [{ id: 'monitor-rsi', name: 'MonitorCreate', arguments: { name: '茅台RSI监控', script: 'return { symbol: "600519", rsi: 36 }', interval: '5m', condition: 'result.rsi < 40', displayType: 'status_row', user_prompt: '回测结果不错，帮我设置监控' } }] },
      { toolCalls: [{ id: 'monitor-list', name: 'MonitorList', arguments: {} }] },
      { text: '回测结果不错，帮我设置监控: 已创建监控并可由运行时调度器读取。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const cronEvents = await collectEvents(agent.run('每天分析自选股'))
    const monitorEvents = await collectEvents(agent.run('回测结果不错，帮我设置监控'))

    expect(cronEvents.some((e) => e.type === 'tool-result' && e.name === 'CronCreate' && e.result.includes('created'))).toBe(true)
    expect(readFileSync(join(basePath, 'scheduled_tasks.json'), 'utf-8')).toContain('每天分析自选股')
    expect(monitorStore.count).toBe(1)
    expect(monitorEvents.some((e) => e.type === 'tool-result' && e.name === 'MonitorList' && e.result.includes('茅台RSI监控'))).toBe(true)
    expectNoHiddenApiFailure([...cronEvents, ...monitorEvents])
  })

  it('covers DSH-001, DSH-002, and DSH-003 dashboard workflows with renderer-observed artifact evidence', async () => {
    const dashboard = new DashboardTool()
    dashboard.setPanelQuery(async () => [
      { id: 'dash-moutai-analysis', title: '茅台分析看板', url: join(basePath, 'dashboards', 'moutai-analysis.html'), type: 'dashboard', isActive: true },
      { id: 'dash-market-overview', title: '市场概览看板', url: join(basePath, 'dashboards', 'market-overview.html'), type: 'dashboard', isActive: true },
      { id: 'dash-stock-selection-watch', title: '观察看板', url: join(basePath, 'dashboards', 'stock-selection-watch.html'), type: 'dashboard', isActive: true },
    ])
    const registry = new ToolRegistry()
    registry.register(new MarketDataTool(marketData as any))
    registry.register(new DataStoreTool())
    registry.register(new WatchlistTool())
    registry.register(dashboard)
    const llm = new MockLLM([
      { toolCalls: [{ id: 'dash-quote', name: 'MarketData', arguments: { action: 'quote', code: '600519' } }] },
      { toolCalls: [{ id: 'dash-kline', name: 'MarketData', arguments: { action: 'kline', code: '600519' } }] },
      { toolCalls: [{ id: 'dash-moutai', name: 'Dashboard', arguments: { id: 'moutai-analysis', title: '茅台分析看板', html: dashboardHtml('茅台分析看板', '<p>核心指标: 价格、K线、风险提示</p>') } }] },
      { text: '茅台分析看板已创建，并包含source time、retrieved at和风险提示。' },
      { toolCalls: [{ id: 'dash-market-sector', name: 'MarketData', arguments: { action: 'sector', type: 'industry' } }] },
      { toolCalls: [{ id: 'dash-market', name: 'Dashboard', arguments: { id: 'market-overview', title: '市场概览看板', html: dashboardHtml('市场概览看板', '<p>市场脉冲、行业轮动、数据状态</p>') } }] },
      { text: '市场概览看板已创建，展示市场脉冲、板块轮动和数据状态。' },
      { toolCalls: [{ id: 'dash-screen', name: 'DataStore', arguments: { action: 'screen_stock', limit: 2 } }] },
      { toolCalls: [{ id: 'dash-watch', name: 'Watchlist', arguments: { action: 'add', symbol: '600519', name: '贵州茅台', type: 'stock', source: 'dashboard-selection', score: 92 } }] },
      { toolCalls: [{ id: 'dash-selection', name: 'Dashboard', arguments: { id: 'stock-selection-watch', title: '观察看板', html: dashboardHtml('观察看板', '<p>候选: 600519; reason: score 92; provenance: fixture</p>') } }] },
      { text: '观察看板已创建，候选、理由、评分和provenance均可见。' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const stockDashEvents = await collectEvents(agent.run('帮我做一个茅台分析看板'))
    const marketDashEvents = await collectEvents(agent.run('做一个今天市场概览看板'))
    const selectionDashEvents = await collectEvents(agent.run('从今天强势方向里选几只股票，做成观察看板'))

    for (const id of ['moutai-analysis', 'market-overview', 'stock-selection-watch']) {
      const path = join(basePath, 'dashboards', `${id}.html`)
      expect(existsSync(path)).toBe(true)
      const html = readFileSync(path, 'utf-8')
      expect(html).toContain('source time')
      expect(html).toContain('retrieved at')
    }
    const artifacts = new ArtifactRegistry(basePath).list('dashboard')
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dashboard:moutai-analysis', verificationStatus: 'verified' }),
      expect.objectContaining({ id: 'dashboard:market-overview', verificationStatus: 'verified' }),
      expect.objectContaining({ id: 'dashboard:stock-selection-watch', verificationStatus: 'verified' }),
    ]))
    expect([...stockDashEvents, ...marketDashEvents, ...selectionDashEvents].some((e) =>
      e.type === 'tool-result' && e.name === 'Dashboard' && e.result.includes('"observed": true')
    )).toBe(true)
    expectNoHiddenApiFailure([...stockDashEvents, ...marketDashEvents, ...selectionDashEvents])
  })

  it('renders fund comparison config fields in the report dashboard template', async () => {
    const dashboard = new DashboardTool()
    dashboard.setAssetsPath(join(process.cwd(), 'assets'))
    dashboard.setPanelQuery(async () => [
      { id: 'dash-fund-compare-fixture', title: '基金对比看板', url: join(basePath, 'dashboards', 'fund-compare-fixture.html'), type: 'dashboard', isActive: true },
    ])

    const ctx = {
      basePath,
      workDir: process.cwd(),
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, 'project'),
    } as ToolContext

    const result = await dashboard.call('dash-fund-compare', {
      id: 'fund-compare-fixture',
      title: '基金对比看板',
      template: 'report',
      config: JSON.stringify({
        title: '基金对比：华夏成长混合 vs 易方达天天理财货币A',
        subtitle: '混合型-灵活 vs 货币型-普通货币',
        funds: [
          { 基金名称: '华夏成长混合', 基金代码: '000001', 基金类型: '混合型-灵活', 净值或货币收益: '净值 1.538' },
          { 基金名称: '易方达天天理财货币A', 基金代码: '000009', 基金类型: '货币型-普通货币', 净值或货币收益: '万份收益 0.2361' },
        ],
        comparisonTable: [
          { 项目: '基金类型', 华夏成长混合: '混合型-灵活', 易方达天天理财货币A: '货币型-普通货币' },
        ],
        类别差异: '混合基金使用 NAV，货币基金使用万份收益与 7 日年化。',
        风险提示: '两类基金风险收益口径不同。',
        数据说明: '本看板基于本地 query/readback。',
        analysisEvidence: {
          contract: 'analysis-evidence-v1',
          kind: 'fund_analysis',
          subject: { type: 'candidate_set', id: '000001,000009', name: 'fund comparison' },
          observedFacts: ['fundCount=2'],
          interpretations: ['fund_comparison:available'],
          missingEvidence: ['fee_confirmation'],
          confidence: 'medium',
          strategyReadiness: 'analysis_only',
          sourceCoverage: {
            sources: ['local fund rows'],
            interfaceId: 'fund.comparison',
            canonicalTable: 'fund_nav',
            readbackAction: 'query_fund_nav',
            sourceDataTime: '2026-07-02',
            fetchedAt: '2026-07-02T10:00:00Z',
            cacheStatus: 'cache-hit',
            coverageStatus: 'sufficient_for_analysis',
          },
        },
      }),
    }, ctx)

    expect(result).toContain('"ok": true')
    const html = readFileSync(join(basePath, 'dashboards', 'fund-compare-fixture.html'), 'utf-8')
    expect(html).toContain('基金基础信息')
    expect(html).toContain('基金对比表')
    expect(html).toContain('类别差异')
    expect(html).toContain('风险提示')
    expect(html).toContain('数据说明')
    expect(html).toContain('分析证据')
    expect(html).toContain('analysis_only')
    expect(html).toContain('fund.comparison')
    expect(html).toContain('华夏成长混合')
    expect(html).toContain('易方达天天理财货币A')
  })

  it('renders refresh-style report config without requiring CONFIG.title', async () => {
    const dashboard = new DashboardTool()
    dashboard.setAssetsPath(join(process.cwd(), 'assets'))
    dashboard.setPanelQuery(async () => [
      { id: 'dash-fund-refresh-fixture', title: '基金刷新看板', url: join(basePath, 'dashboards', 'fund-refresh-fixture.html'), type: 'dashboard', isActive: true },
    ])

    const ctx = {
      basePath,
      workDir: process.cwd(),
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, 'project'),
    } as ToolContext

    const result = await dashboard.call('dash-fund-refresh', {
      id: 'fund-refresh-fixture',
      title: '基金刷新看板',
      template: 'report',
      config: JSON.stringify({
        update: 'refresh',
        refreshedAt: '2026-06-27',
        data: [
          { code: '000009', name: '易方达天天理财货币A', type: '货币型-普通货币', 口径: '万份收益 + 7日年化收益率', latestDate: '2026-06-22', source: 'EastMoney', fetchNote: 'local cache hit' },
          { code: '000001', name: '华夏成长混合', type: '混合型-灵活', 口径: '单位净值 + 日涨跌幅', latestDate: '2026-06-24', source: 'EastMoney', fetchNote: 'local cache hit' },
        ],
        comparisonTable: {
          headers: ['项目', '000009', '000001'],
          rows: [
            ['数据口径', '万份收益', '单位净值'],
            ['provider 状态', 'local cache hit', 'local cache hit'],
          ],
        },
        riskWarning: '两类基金风险收益口径不同。',
      }),
    }, ctx)

    expect(result).toContain('"ok": true')
    const html = readFileSync(join(basePath, 'dashboards', 'fund-refresh-fixture.html'), 'utf-8')
    expect(html).toContain('基金刷新看板')
    expect(html).toContain('数据更新结果')
    expect(html).toContain('易方达天天理财货币A')
    expect(html).toContain('华夏成长混合')
    expect(html).toContain('基金对比表')
    expect(html).toContain('provider 状态')
    expect(html).toContain('风险提示')
  })

  it('renders html body supplied through report template config', async () => {
    const dashboard = new DashboardTool()
    dashboard.setAssetsPath(join(process.cwd(), 'assets'))
    dashboard.setPanelQuery(async () => [
      { id: 'dash-report-html-fixture', title: 'HTML 报告看板', url: join(basePath, 'dashboards', 'report-html-fixture.html'), type: 'dashboard', isActive: true },
    ])

    const ctx = {
      basePath,
      workDir: process.cwd(),
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, 'project'),
    } as ToolContext

    const result = await dashboard.call('dash-report-html', {
      id: 'report-html-fixture',
      title: 'HTML 报告看板',
      template: 'report',
      config: JSON.stringify({
        title: 'HTML 报告看板',
        html: '<table class="report-table"><tbody><tr><td>000009</td><td>万份收益</td></tr></tbody></table>',
      }),
    }, ctx)

    expect(result).toContain('"ok": true')
    const html = readFileSync(join(basePath, 'dashboards', 'report-html-fixture.html'), 'utf-8')
    expect(html).toContain('报告正文')
    expect(html).toContain('000009')
    expect(html).toContain('万份收益')
  })

  it('renders report sections with metrics when type is omitted', async () => {
    const dashboard = new DashboardTool()
    dashboard.setAssetsPath(join(process.cwd(), 'assets'))
    dashboard.setPanelQuery(async () => [
      { id: 'dash-report-metrics-fixture', title: 'Metrics 报告看板', url: join(basePath, 'dashboards', 'report-metrics-fixture.html'), type: 'dashboard', isActive: true },
    ])

    const ctx = {
      basePath,
      workDir: process.cwd(),
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, 'project'),
    } as ToolContext

    await dashboard.call('dash-report-metrics', {
      id: 'report-metrics-fixture',
      title: 'Metrics 报告看板',
      template: 'report',
      config: JSON.stringify({
        title: 'Metrics 报告看板',
        sections: [
          {
            title: '行情',
            metrics: [
              { label: '最新价', value: '1194.45' },
              { label: '涨跌幅', value: '-0.71%' },
            ],
            source: 'DataStore query_quote / local cache',
            asOf: '2026-07-04T04:07:06.837Z',
            fetchedAt: '2026-07-04T04:07:06.837Z',
          },
          {
            title: '基本面',
            metrics: [
              { label: 'PE', value: '-' },
              { label: '最近有效PE', value: '13.8（2026-03-31）' },
            ],
          },
        ],
      }),
    }, ctx)

    const html = readFileSync(join(basePath, 'dashboards', 'report-metrics-fixture.html'), 'utf-8')
    const content = { innerHTML: '' }
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? ''
    runInNewContext(script, {
      document: {
        title: 'Metrics 报告看板',
        getElementById: (id: string) => id === 'content' ? content : null,
      },
    })

    expect(content.innerHTML).toContain('kpi-card')
    expect(content.innerHTML).toContain('最新价')
    expect(content.innerHTML).toContain('1194.45')
    expect(content.innerHTML).toContain('最近有效PE')
    expect(content.innerHTML).toContain('13.8')
    expect(content.innerHTML).toContain('DataStore query_quote')
  })
})
