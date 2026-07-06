import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStrategyLibraryActionPrompt, normalizeStrategyLibraryItems, readStrategyLibrary } from '../../src/main/strategy-library'
import { monitorTemplateForStrategy } from '../../src/domain/market/strategy-spec/strategy-action-contract'
import { normalizeStrategyLibrary } from '../../src/renderer/components/strategy-library-model'
import { summarizeStrategies } from '../../src/renderer/components/StrategyLibrary'

describe('strategy library surface contract', () => {
  it('reads saved custom strategies from the runtime data directory', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'strategy-library-'))
    mkdirSync(join(basePath, 'data'), { recursive: true })
    writeFileSync(join(basePath, 'data', 'custom-strategies.json'), JSON.stringify([
      {
        strategyId: 'custom_rsi_volume_rebound_v1',
        status: 'backtested',
        updatedAt: '2026-07-01T10:00:00.000Z',
        strategySpec: { name: 'RSI volume rebound', symbol: '600519', assetClass: 'stock' },
        backtestEvidence: {
          action: 'custom_strategy_backtest',
          metrics: {
            totalReturnPct: 12.345,
            maxDrawdownPct: -4.2,
            sharpe: 1.234,
          },
          riskRewardEvidence: {
            completedTrades: 4,
            winningTrades: 3,
            losingTrades: 1,
            payoffRatio: 1.75,
            profitFactor: 3.5,
            expectancyPct: 2.25,
          },
          dataEvidence: {
            source: 'cache',
            cacheStatus: 'cache-hit',
            sourceDataTime: '2026-06-30',
            bars: 250,
          },
        },
        dataAndAssumptionSummary: {
          feesAndSlippage: { commissionPct: 0.1, slippagePct: 0.05 },
          positionSizing: {
            type: 'kelly_fraction',
            maxPositionPct: 0.25,
            kellyScale: 0.5,
          },
        },
      },
    ]))

    const payload = readStrategyLibrary(basePath)
    expect(payload).toMatchObject({ ok: true, count: 1 })

    const library = normalizeStrategyLibrary(payload)
    expect(library.strategies[0]).toMatchObject({
      strategyId: 'custom_rsi_volume_rebound_v1',
      name: 'RSI volume rebound',
      status: 'backtested',
      runnable: true,
      symbols: ['600519'],
      evidenceAction: 'custom_strategy_backtest',
      strategyType: 'stock_strategy',
      evidenceSummary: 'return=12.35% · maxDD=-4.20% · sharpe=1.23',
      dataSummary: 'source=cache · cacheStatus=cache-hit · sourceDataTime=2026-06-30 · bars=250',
      riskRewardSummary: 'trades=4 · wins=3 · losses=1 · payoff=1.75 · profitFactor=3.50 · expectancy=2.25%',
      assumptionSummary: 'sizing=kelly_fraction · maxPosition=0.25 · kellyScale=0.50 · commission=0.10% · slippage=0.05%',
    })
  })

  it('keeps observed/ranked strategies as evidence readback instead of pretending they are runnable', () => {
    const library = normalizeStrategyLibrary({
      ok: true,
      strategies: [
        {
          strategyId: 'custom_fund_watch_v1',
          status: 'observed',
          updatedAt: '2026-07-01T10:00:00.000Z',
          spec: { name: 'Fund watch', assetClass: 'fund', codes: ['000001'] },
          evidence: { action: 'custom_strategy_observe' },
        },
      ],
    })

    const item = library.strategies[0]
    expect(item.runnable).toBe(false)

    const prompt = buildStrategyLibraryActionPrompt('read', item)
    expect(prompt).toContain('strategyId=custom_fund_watch_v1')
    expect(prompt).toContain('是否可重跑')
    expect(prompt).not.toContain('custom_strategy_run')
  })

  it('normalizes bounded custom_strategy_list rows with fund evidence summaries', () => {
    const payload = {
      ok: true,
      strategies: [
        {
          strategyId: 'fund_period_v1',
          name: '基金周期观察',
          status: 'observed',
          assetClass: 'fund',
          symbols: ['000001'],
          updatedAt: '2026-07-02T10:00:00.000Z',
          evidenceAction: 'custom_strategy_fund_backtest',
          dataAndAssumptionSummary: {
            fundCoverageEvidence: { status: 'sufficient' },
            fundRiskEvidence: {
              assetClass: 'fund',
              pricingBasis: 'fund_nav',
              worstDrawdownPct: 3.25,
              maxVolatilityPct: 8.5,
              averageGainToPainRatio: 1.42,
              averageOmegaRatio: 1.36,
              averageTailRatio: 1.8,
            },
          },
        },
      ],
    }
    const library = normalizeStrategyLibrary(payload)

    expect(library.strategies[0]).toMatchObject({
      strategyId: 'fund_period_v1',
      name: '基金周期观察',
      status: 'observed',
      assetClass: 'fund',
      strategyType: 'fund_strategy',
      symbols: ['000001'],
      evidenceAction: 'custom_strategy_fund_backtest',
      evidenceSummary: 'fundMaxDD=3.25% · fundVol=8.50% · fundGTP=1.42 · fundOmega=1.36 · fundTail=1.80',
      dataSummary: 'fundCoverage=sufficient · pricingBasis=fund_nav',
    })

    const prompt = buildStrategyLibraryActionPrompt('monitor', library.strategies[0])
    expect(prompt).toContain('fund_rule_monitor')
    expect(prompt).toContain('基金 NAV/yield')

    const mainItems = normalizeStrategyLibraryItems({ ...payload, path: '', count: 1 })
    expect(mainItems[0]).toMatchObject({
      strategyId: 'fund_period_v1',
      name: '基金周期观察',
      assetClass: 'fund',
      symbols: ['000001'],
      evidenceAction: 'custom_strategy_fund_backtest',
    })
  })

  it('summarizes saved strategy lifecycle status for the UI surface', () => {
    const library = normalizeStrategyLibrary({
      ok: true,
      strategies: [
        {
          strategyId: 'stock_backtested_v1',
          status: 'backtested',
          spec: { name: 'Stock backtest', assetClass: 'stock', symbol: '600519' },
          evidence: { action: 'custom_strategy_backtest' },
        },
        {
          strategyId: 'fund_observed_v1',
          status: 'observed',
          spec: { name: 'Fund observe', assetClass: 'fund', codes: ['000001'] },
          evidence: { action: 'custom_strategy_observe' },
        },
      ],
    })

    expect(summarizeStrategies(library.strategies)).toEqual({
      runnable: 1,
      observedOnly: 1,
      stock: 1,
      fund: 1,
      portfolio: 0,
      etf: 0,
      unknown: 0,
      monitorReady: 2,
    })
  })

  it('classifies ranked and ETF strategy artifacts with first-class strategy types', () => {
    const library = normalizeStrategyLibrary({
      ok: true,
      strategies: [
        {
          strategyId: 'ranked_portfolio_v1',
          status: 'ranked',
          spec: { name: 'Portfolio rank', assetClass: 'stock', symbols: ['300059', '600519'] },
          evidence: { action: 'custom_strategy_rank' },
          dataAndAssumptionSummary: {
            portfolioReturnQualityEvidence: {
              annualizedReturnPct: 18.25,
              annualizedVolatilityPct: 12.5,
              sharpeRatio: 1.46,
              sortinoRatio: 2.1,
              calmarRatio: 1.8,
              gainToPainRatio: 1.35,
            },
          },
        },
        {
          strategyId: 'etf_rotation_v1',
          status: 'observed',
          spec: { name: 'ETF rotation', assetClass: 'listed_fund', codes: ['510300'] },
          evidence: { action: 'custom_strategy_observe' },
        },
      ],
    })

    expect(library.strategies[0].strategyType).toBe('portfolio_strategy')
    expect(library.strategies[0].riskRewardSummary)
      .toBe('portfolioReturn=18.25% · portfolioVol=12.50% · portfolioSharpe=1.46 · portfolioSortino=2.10 · portfolioCalmar=1.80 · portfolioGTP=1.35')
    expect(library.strategies[1].strategyType).toBe('etf_market_strategy')
    expect(summarizeStrategies(library.strategies)).toMatchObject({
      portfolio: 1,
      etf: 1,
    })
  })

  it('keeps agent-mediated prompts in the main-process strategy action contract', () => {
    const item = normalizeStrategyLibrary({
      ok: true,
      strategies: [
        {
          strategyId: 'custom_rank_v1',
          status: 'backtested',
          spec: { name: 'Rank', symbols: ['300059', '600519'] },
          evidence: { action: 'custom_strategy_backtest' },
        },
      ],
    }).strategies[0]

    expect(buildStrategyLibraryActionPrompt('rerun', item)).toContain('MarketData(action:"custom_strategy_run")')
    const watchPrompt = buildStrategyLibraryActionPrompt('watch', item)
    expect(watchPrompt).toContain('Watchlist(action:"add")')
    expect(watchPrompt).toContain('Watchlist(action:"list", strategyId:"custom_rank_v1", symbol:"300059", status:"watching")')
    expect(watchPrompt).toContain('strategyRules')
    expect(watchPrompt).toContain('避免重复标的误认')
    expect(watchPrompt).toContain('不要直接下单')

    const monitorPrompt = buildStrategyLibraryActionPrompt('monitor', item)
    expect(monitorPrompt).toContain('MonitorCreate')
    expect(monitorPrompt).toContain('strategy_signal')
    expect(monitorPrompt).toContain('MonitorList')
    expect(monitorPrompt).toContain('strategyRules')
    expect(monitorPrompt).toContain('触发时再次确认边界')
  })

  it('uses fund_rule_monitor for observed fund strategies', () => {
    const item = normalizeStrategyLibrary({
      ok: true,
      strategies: [
        {
          strategyId: 'fund_dca_nav_guard_v1',
          status: 'observed',
          spec: { name: 'Fund watch', assetClass: 'fund', codes: ['110011.OF'] },
          evidence: { action: 'custom_strategy_observe' },
        },
      ],
    }).strategies[0]

    const monitorPrompt = buildStrategyLibraryActionPrompt('monitor', item)
    expect(monitorPrompt).toContain('MonitorCreate(template:"fund_rule_monitor")')
    expect(monitorPrompt).toContain('monitorDraft')
    expect(monitorPrompt).toContain('dcaObservation')
    expect(monitorPrompt).toContain('基金 NAV/yield')
    expect(monitorPrompt).not.toContain('MonitorCreate(template:"strategy_signal")')
  })

  it('keeps main-process automation monitor prompt aligned for fund strategies', () => {
    const monitorPrompt = buildStrategyLibraryActionPrompt('monitor', {
      strategyId: 'fund_dca_nav_guard_v1',
      name: 'Fund watch',
      status: 'observed',
      assetClass: 'fund',
      strategyType: 'fund_strategy',
      symbols: ['110011.OF'],
      updatedAt: '2026-07-01T10:00:00.000Z',
      evidenceAction: 'custom_strategy_observe',
      runnable: false,
    })

    expect(monitorPrompt).toContain('MonitorCreate(template:"fund_rule_monitor")')
    expect(monitorPrompt).toContain('monitorDraft')
    expect(monitorPrompt).toContain('dcaObservation')
    expect(monitorPrompt).not.toContain('MonitorCreate(template:"strategy_signal")')
  })

  it('uses portfolio_rebalance_monitor for ranked strategy artifacts', () => {
    const item = normalizeStrategyLibrary({
      ok: true,
      strategies: [
        {
          strategyId: 'ranked_portfolio_v1',
          status: 'ranked',
          spec: { name: 'Ranked portfolio', assetClass: 'stock', symbols: ['300059', '600519'] },
          evidence: { action: 'custom_strategy_rank' },
        },
      ],
    }).strategies[0]

    const monitorPrompt = buildStrategyLibraryActionPrompt('monitor', item)
    expect(monitorPrompt).toContain('MonitorCreate(template:"portfolio_rebalance_monitor")')
    expect(monitorPrompt).toContain('portfolioEvidence')
    expect(monitorPrompt).toContain('rebalanceDraft')
    expect(monitorPrompt).toContain('不自动调仓或下单')
    expect(monitorPrompt).not.toContain('MonitorCreate(template:"strategy_signal")')

    const mainPrompt = buildStrategyLibraryActionPrompt('monitor', {
      strategyId: 'ranked_portfolio_v1',
      name: 'Ranked portfolio',
      status: 'ranked',
      assetClass: 'stock',
      strategyType: 'portfolio_strategy',
      symbols: ['300059', '600519'],
      updatedAt: '2026-07-01T10:00:00.000Z',
      evidenceAction: 'custom_strategy_rank',
      runnable: false,
    })
    expect(mainPrompt).toContain('MonitorCreate(template:"portfolio_rebalance_monitor")')
    expect(mainPrompt).toContain('portfolioEvidence')
    expect(mainPrompt).toContain('rebalanceDraft')
  })

  it('keeps strategy action routing in the domain contract', () => {
    expect(monitorTemplateForStrategy({
      strategyId: 'fund_observe_v1',
      status: 'observed',
      assetClass: 'fund',
      strategyType: 'fund_strategy',
      symbols: ['000001'],
      evidenceAction: 'custom_strategy_observe',
    })).toBe('fund_rule_monitor')

    expect(monitorTemplateForStrategy({
      strategyId: 'portfolio_rank_v1',
      status: 'ranked',
      assetClass: 'stock',
      strategyType: 'portfolio_strategy',
      symbols: ['300059', '600519'],
      evidenceAction: 'custom_strategy_rank',
    })).toBe('portfolio_rebalance_monitor')
  })
})
