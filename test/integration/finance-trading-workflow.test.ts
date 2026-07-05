import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Agent } from '../../src/agent/agent'
import { ToolRegistry } from '../../src/agent/tool'
import { PortfolioTool } from '../../src/agent/tools/portfolio'
import { XueqiuTradeTool } from '../../src/agent/tools/xueqiu-trade'
import { runBacktest, rsiStrategy } from '../../src/agent/data/backtest'
import type { KlineBar } from '../../src/agent/data/data-manager'
import { MockLLM } from '../mocks/mock-llm'
import type { AgentEvent } from '../../src/agent/agent-event'

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const ev of gen) events.push(ev)
  return events
}

function fixedBars(count: number): KlineBar[] {
  const bars: KlineBar[] = []
  let close = 10
  for (let i = 0; i < count; i++) {
    close += i % 17 < 9 ? 0.12 : -0.08
    bars.push({
      date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: close - 0.05,
      high: close + 0.2,
      low: close - 0.2,
      close: Number(close.toFixed(2)),
      volume: 10_000 + i * 100,
      amount: close * (10_000 + i * 100),
      changePct: null,
      turnoverRate: null,
    })
  }
  return bars
}

describe('finance and trading workflows', () => {
  it('previews local paper trades without mutating the portfolio file', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-trading-preview-'))
    const tool = new PortfolioTool()
    const ctx = {
      basePath,
      workDir: basePath,
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, '.finagent-workstation'),
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set<string>(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: {} as any,
      teamRegistry: {} as any,
    }

    const result = await tool.call('portfolio-preview', {
      action: 'preview_trade',
      market: 'cn',
      symbol: '600519',
      side: 'buy',
      shares: 100,
      price: 1200,
    }, ctx)

    const parsed = JSON.parse(result)
    expect(parsed.action).toBe('preview_trade')
    expect(parsed.sideEffect).toBe(false)
    expect(parsed.executionAllowed).toBe(true)
    expect(parsed.order.symbol).toBe('600519')
    expect(parsed.estimated.cashBefore).toBe(1_000_000)
    expect(existsSync(join(basePath, 'memory', '.portfolio_cn.json'))).toBe(false)
  })

  it('runs paper trading workflow and blocks real-trade path without credentials', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-trading-workflow-'))
    const registry = new ToolRegistry()
    registry.register(new PortfolioTool())
    registry.register(new XueqiuTradeTool())

    const llm = new MockLLM([
      { toolCalls: [{ id: 'pf-clear', name: 'Portfolio', arguments: { action: 'clear', market: 'cn' } }] },
      { toolCalls: [{ id: 'pf-buy', name: 'Portfolio', arguments: { action: 'trade', market: 'cn', symbol: '600519', side: 'buy', shares: 100, price: 100 } }] },
      { toolCalls: [{ id: 'pf-risk', name: 'Portfolio', arguments: { action: 'risk', market: 'cn' } }] },
      { toolCalls: [{ id: 'xq-buy', name: 'XueqiuTrade', arguments: { action: 'buy', symbol: 'SH600519', amount: 10000, portfolio: 'ZH_TEST' } }] },
      { text: 'Paper trade recorded; real Xueqiu trade was blocked because credentials are missing.' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('record a paper trade then test real-trade safety'))

    const portfolioTrade = events.find((e) => e.type === 'tool-result' && e.name === 'Portfolio' && e.result.includes('"action": "trade"'))
    expect(portfolioTrade).toBeTruthy()
    const tradePayload = JSON.parse(portfolioTrade?.type === 'tool-result' ? portfolioTrade.result : '{}')
    expect(tradePayload).toMatchObject({
      action: 'trade',
      sideEffect: true,
      executionVenue: 'local_paper_portfolio',
      externalBrokerStatus: 'not_external_broker',
      postTradeReadback: {
        source: 'local_paper_portfolio',
        readbackAction: 'portfolio_snapshot_after_trade',
        readbackStatus: 'verified',
        symbol: '600519',
        positionsCount: 1,
        tradeCount: 1,
      },
    })
    expect(tradePayload.postTradeReadback.symbolPosition).toMatchObject({ shares: 100 })
    expect(events.some((e) =>
      e.type === 'tool-result' &&
      e.name === 'XueqiuTrade' &&
      e.isError &&
      e.result.includes('XueqiuTrade not available')
    )).toBe(true)
    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('real Xueqiu trade was blocked'))).toBe(true)

    const portfolioPath = join(basePath, 'memory', '.portfolio_cn.json')
    expect(existsSync(portfolioPath)).toBe(true)
    const portfolio = JSON.parse(readFileSync(portfolioPath, 'utf-8'))
    expect(portfolio.positions['600519'].shares).toBe(100)

    const sessionText = readFileSync(join(basePath, 'sessions', 'current.jsonl'), 'utf-8')
    expect(sessionText).toContain('XueqiuTrade not available')
    expect(sessionText).toContain('portfolio_snapshot_after_trade')
  })

  it('runs deterministic backtest inputs without live data or random bars', () => {
    const result = runBacktest(fixedBars(160), rsiStrategy(), 'rsi')
    expect(result.strategy).toBe('rsi')
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(result.maxDrawdown).toBeLessThanOrEqual(1)
    expect(Number.isFinite(result.totalReturn)).toBe(true)
  })
})
