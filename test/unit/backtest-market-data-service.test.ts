import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('BacktestMarketDataService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('exposes the current custom strategy indicator catalog through MarketData schema and help', async () => {
    const { MARKET_DATA_SCHEMA } = await import('../../src/agent/tools/market-data-schema')
    const { MARKET_DATA_HELP_TEXT } = await import('../../src/agent/tools/market-data-help')
    const { indicatorRegistry } = await import('../../src/domain/market/strategy-spec/strategy-spec-registry')
    const executable = indicatorRegistry
      .filter((definition: { executable?: boolean }) => definition.executable !== false)
      .map((definition: { type: string }) => definition.type)

    const strategySpec = (MARKET_DATA_SCHEMA.properties as any).strategySpec
    expect(strategySpec.description).toContain('custom_strategy_help as the code-owned discovery')
    expect(MARKET_DATA_HELP_TEXT).toContain('code-owned executable indicator catalog')
    for (const indicator of executable) {
      expect(strategySpec.description).toContain(indicator)
      expect(MARKET_DATA_HELP_TEXT).toContain(indicator)
    }
  })

  it('preserves explicitly declared StrategySpec indicator ids in right-hand references', async () => {
    const { validateStrategySpec } = await import('../../src/domain/market/strategy-spec/strategy-spec-engine')

    const validation = validateStrategySpec({
      name: 'volume pullback',
      market: 'cn',
      universe: { type: 'single', symbols: ['300059'] },
      indicators: [
        { id: 'ema20', type: 'ema', source: 'close', params: { period: 20 } },
        { id: 'volSma20', type: 'volume_sma', source: 'volume', params: { period: 20 } },
      ],
      entry: {
        all: [
          { left: 'ema20', op: '>', right: 0 },
          { left: 'volume', op: '<=', right: { mul: ['volSma20', 0.85] } },
        ],
      },
      exit: { any: [{ type: 'stop_loss_pct', value: 6 }] },
    })

    expect(validation.status).toBe('validated')
    expect(validation.errors).not.toContain(expect.stringContaining('volSma2014'))
    expect(validation.spec.entry?.all?.at(-1)).toMatchObject({
      left: 'volume',
      right: { mul: ['volSma20', 0.85] },
    })
  })

  it('uses local kline rows before sidecar fetch for backtest', async () => {
    const queryKline = vi.fn(() =>
      Array.from({ length: 120 }, (_, index) => ({
        date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
        open: 10 + index,
        high: 11 + index,
        low: 9 + index,
        close: 10.5 + index,
        volume: 1000 + index,
        amount: 10000 + index,
        change_pct: 1.2,
        turnover_rate: 0.8,
      })),
    )
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = queryKline
      },
    }))
    const getKline = vi.fn()
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const result = await service.readAction('backtest', { strategy: 'rsi' }, { basePath: '/tmp' } as any, '600519', 120)

    expect(JSON.parse(result)).toMatchObject({
      contract: 'strategy-backtest-result-v1',
      action: 'backtest',
      code: '600519',
      strategy: 'rsi',
      sample: { bars: 120 },
      dataEvidence: { source: 'local kline_daily', cacheStatus: 'local-hit' },
    })
    expect(queryKline).toHaveBeenCalledWith({ basePath: '/tmp' }, '600519', { limit: 500 })
    expect(getKline).not.toHaveBeenCalled()
  })

  it('accepts the shared mobile preset strategy names through FinAgent Workstation backtest', async () => {
    const bars = Array.from({ length: 140 }, (_, index) => {
      const wave = Math.sin(index / 8) * 4
      const trend = index * 0.18
      const close = 30 + trend + wave
      return {
        date: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
        open: close - 0.4,
        high: close + 1.2,
        low: close - 1.2,
        close,
        volume: 3000 + index * 20 + Math.round(Math.abs(wave) * 100),
        amount: 30000 + index * 200,
        change_pct: 0.5,
        turnover_rate: 0.7,
      }
    })
    const queryKline = vi.fn(() => bars)
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = queryKline
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const { BUILTIN_STRATEGIES } = await import('../../src/agent/data/backtest')
    const service = new BacktestMarketDataService()
    const registeredPresetNames = Object.keys(BUILTIN_STRATEGIES)
    expect(registeredPresetNames).toEqual([
      'rsi',
      'macd',
      'bollinger',
      'ema_cross',
      'supertrend',
      'donchian',
      'kdj',
      'ma_golden_cross',
      'volume_breakout',
      'dual_thrust',
      'adx_emerging',
      'mean_reversion',
      'turtle_breakout',
      'rsi_conservative',
      'boll_tight',
    ])

    for (const strategy of registeredPresetNames) {
      const result = await service.readAction('backtest', { strategy }, { basePath: '/tmp' } as any, '600519', 140)
      expect(JSON.parse(result)).toMatchObject({
        contract: 'strategy-backtest-result-v1',
        action: 'backtest',
        strategy,
      })
    }
  })

  it('computes volume_sma from volume when source is omitted', async () => {
    const { computeStrategyIndicators } = await import('../../src/domain/market/strategy-spec/strategy-indicator-calculators')
    const values = computeStrategyIndicators(
      {
        indicators: [
          {
            id: 'vol2',
            type: 'volume_sma',
            params: { period: 2 },
          },
        ],
      },
      [
        { date: '2026-01-01', open: 10, high: 10, low: 10, close: 10, volume: 100 },
        { date: '2026-01-02', open: 20, high: 20, low: 20, close: 20, volume: 300 },
        { date: '2026-01-03', open: 30, high: 30, low: 30, close: 30, volume: 500 },
      ] as any,
    )

    expect(values.vol2).toEqual([null, 200, 400])
  })

  it('formats batch backtest results through the domain service boundary', async () => {
    const bars = Array.from({ length: 80 }, (_, index) => ({
      date: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
      open: 20 + index,
      high: 21 + index,
      low: 19 + index,
      close: 20.5 + index,
      volume: 2000 + index,
      amount: 20000 + index,
      changePct: 0.5,
      turnoverRate: 0.4,
    }))
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    const getKline = vi.fn(async () => bars)
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = await service.readAction(
      'backtest_batch',
      { symbols: ['600519', '000858'], strategy: 'rsi' },
      { basePath: '/tmp' } as any,
      '',
      60,
    )

    expect(output).toContain('"action": "backtest_batch"')
    expect(output).toContain('"symbol": "600519"')
    expect(getKline).toHaveBeenCalledTimes(2)
  })

  it('routes symbol aliases and multi-symbol enhanced backtests through the governed backtest contract', async () => {
    const backtestActionService = {
      readAction: vi.fn(async () => '{"ok":true}'),
    }
    const { MarketDataActionService } = await import('../../src/domain/market/services/market-data-action-service')
    const actionService = new MarketDataActionService(
      {} as any,
      {} as any,
      backtestActionService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )

    await actionService.call('custom_strategy_backtest', { symbol: '000725', strategySpec: customStrategySpec() }, { basePath: '/tmp' } as any)
    expect(backtestActionService.readAction).toHaveBeenLastCalledWith(
      'custom_strategy_backtest',
      expect.any(Object),
      expect.any(Object),
      '000725',
      60,
    )

    await actionService.call('backtest_enhanced', { symbols: ['600519', '000858'], strategy: 'rsi' }, { basePath: '/tmp' } as any)
    expect(backtestActionService.readAction).toHaveBeenLastCalledWith(
      'backtest_enhanced',
      expect.any(Object),
      expect.any(Object),
      '600519,000858',
      60,
    )
  })

  it('treats multi-symbol enhanced backtest requests as batch evidence instead of single-code errors', async () => {
    const bars = Array.from({ length: 80 }, (_, index) => ({
      date: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
      open: 20 + index,
      high: 21 + index,
      low: 19 + index,
      close: 20.5 + index,
      volume: 2000 + index,
      amount: 20000 + index,
      changePct: 0.5,
      turnoverRate: 0.4,
    }))
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    const getKline = vi.fn(async () => bars)
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = await service.readAction(
      'backtest_enhanced',
      { symbols: ['600519', '000858'], strategy: 'rsi' },
      { basePath: '/tmp' } as any,
      '600519,000858',
      60,
    )
    const parsed = JSON.parse(output)

    expect(parsed).toMatchObject({ action: 'backtest_batch', strategy: 'rsi', count: 2 })
    expect(parsed.results.map((row: Record<string, unknown>) => row.symbol)).toEqual(['600519', '000858'])
    expect(getKline).toHaveBeenCalledTimes(2)
  })

  it('accepts Bollinger as an alias for the built-in boll strategy', async () => {
    const bars = Array.from({ length: 120 }, (_, index) => ({
      date: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
      open: 30 + index,
      high: 31 + index,
      low: 29 + index,
      close: 30.5 + index,
      volume: 3000 + index,
      amount: 30000 + index,
      changePct: 0.3,
      turnoverRate: 0.2,
    }))
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    const getKline = vi.fn(async () => bars)
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = await service.readAction(
      'backtest',
      { strategy: 'bollinger' },
      { basePath: '/tmp' } as any,
      '600519',
      120,
    )
    const aliasOutput = await service.readAction(
      'backtest',
      { strategy: 'boll' },
      { basePath: '/tmp' } as any,
      '600519',
      120,
    )

    expect(JSON.parse(output)).toMatchObject({
      contract: 'strategy-backtest-result-v1',
      action: 'backtest',
      code: '600519',
      strategy: 'bollinger',
      sample: { bars: 120 },
      metrics: {
        totalReturnPct: expect.any(Number),
        maxDrawdownPct: expect.any(Number),
        sharpeRatio: expect.any(Number),
        winRatePct: expect.any(Number),
        tradeCount: expect.any(Number),
      },
    })
    expect(JSON.parse(aliasOutput)).toMatchObject({ strategy: 'bollinger' })
    expect(getKline).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed backtest period values instead of silently treating them as strategy evidence', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()

    await expect(
      service.readAction(
        'backtest',
        { strategy: 'rsi', period: '}RSI Strategy: rsi Total Return: 0.00%' },
        { basePath: '/tmp' } as any,
        '600519',
        120,
      ),
    ).rejects.toThrow('Unsupported backtest period/window')
  })

  it('evaluates RSI optimizer grids with parameterized strategy functions and drawdown metrics', async () => {
    const bars = Array.from({ length: 180 }, (_, index) => {
      const wave = Math.sin(index / 6) * 8
      const trend = index * 0.03
      const close = 100 + wave + trend
      return {
        date: `2026-04-${String((index % 28) + 1).padStart(2, '0')}`,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000 + index,
        amount: 10000 + index,
        changePct: 0.2,
        turnoverRate: 0.1,
      }
    })
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => bars),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = await service.readAction(
      'optimize_params',
      {
        strategy: 'rsi',
        paramGrid: {
          period: [6, 14],
          oversold: [30, 45],
          overbought: [55, 70],
        },
      },
      { basePath: '/tmp' } as any,
      '600519',
      120,
    )
    const parsed = JSON.parse(output)

    expect(parsed).toMatchObject({ action: 'optimize_params', code: '600519', strategy: 'rsi' })
    expect(parsed.tested).toBe(8)
    expect(parsed.best[0]).toHaveProperty('maxDrawdown')
    expect(parsed.best[0].params).toHaveProperty('period')
    expect(parsed.best[0].params).toHaveProperty('oversold')
    expect(parsed.best[0].params).toHaveProperty('overbought')
    expect(parsed.parameterStability).toMatchObject({
      status: 'evaluated',
      basis: 'top optimizer results',
    })
    expect(parsed.parameterStability.parameterSpread).toHaveProperty('period')
    expect(['stable', 'fragile', 'inconclusive']).toContain(parsed.parameterStability.stabilityClass)
    expect(parsed.parameterStability.testedParameterKeys).toEqual(expect.arrayContaining(['period', 'oversold', 'overbought']))
    expect(parsed.parameterStability.decisionBoundary).toContain('in-sample only')
  })

  it('validates, backtests, saves, and reruns a governed custom strategy spec', async () => {
    const bars = customStrategyBars()
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => bars),
    }))

    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-custom-strategy-'))
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = { ...customStrategySpec(), symbol: '600519' }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated', strategyId: 'custom_rsi_volume_rebound_v1' })

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath } as any, '600519', 120))
    expect(backtest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested', code: '600519' })
    expect(backtest.metrics).toHaveProperty('tradeCount')
    expect(backtest.benchmarkEvidence).toMatchObject({ mode: 'buy_and_hold_close_to_close' })
    expect(backtest.benchmarkEvidence).toHaveProperty('benchmarkReturnPct')
    expect(backtest.benchmarkEvidence).toHaveProperty('excessReturnPct')
    expect(backtest.signals).toMatchObject({ completedTradeCount: backtest.metrics.tradeCount })
    expect(backtest.riskRewardEvidence).toMatchObject({
      status: expect.any(String),
      tradeCount: expect.any(Number),
      expectancyPct: expect.any(Number),
    })
    expect(backtest.riskRewardEvidence).toHaveProperty('profitFactor')
    expect(backtest.riskRewardEvidence).toHaveProperty('payoffRatio')
    expect(backtest.riskRewardEvidence).toHaveProperty('bestTradePct')
    expect(backtest.riskRewardEvidence).toHaveProperty('worstTradePct')
    expect(backtest.riskEvidence.riskRewardEvidence).toEqual(backtest.riskRewardEvidence)
    expect(backtest.metrics.expectancyPct).toEqual(backtest.riskRewardEvidence.expectancyPct)
    expect(backtest.lifecycleAdvice).toMatchObject({
      status: 'saveable_backtest_evidence',
      saveable: true,
      runnableAfterSave: true,
      evidenceStatus: 'backtested',
      nextActions: ['custom_strategy_save', 'custom_strategy_run'],
      zeroTradeStillSaveable: backtest.metrics.tradeCount === 0,
    })
    expect(backtest.riskEvidence).toMatchObject({
      status: 'evaluated',
      feesAndSlippage: expect.objectContaining({ applied: true }),
      tradeBoundary: expect.stringContaining('explicit user confirmation'),
    })
    expect(backtest.assumptions).toHaveProperty('commissionPct')
    expect(backtest.dataEvidence).toMatchObject({ cacheStatus: 'local-miss-then-fetch', rows: bars.length })
    expect(backtest.dataCoverage).toMatchObject({
      mode: 'strategy_backtest_kline_coverage',
      symbol: '600519',
      rows: bars.length,
      requiredBars: 40,
      sufficient: true,
      cacheStatus: 'local-miss-then-fetch',
    })
    expect(backtest.validationSummary).toMatchObject({ canBacktest: true })
    expect(backtest.validationIssues).toEqual([])
    expect(backtest.unsupportedDetails).toEqual([])
    expect(backtest.dataRequirements).toMatchObject({ requiredLookbackBars: 20 })

    const saved = JSON.parse(await service.readAction('custom_strategy_save', { strategySpec, evidence: backtest }, { basePath } as any, '', 120))
    expect(saved).toMatchObject({ action: 'custom_strategy_save', strategyId: 'custom_rsi_volume_rebound_v1', status: 'backtested' })
    expect(saved).toMatchObject({
      artifactContract: 'strategy-library-v1',
      paths: expect.objectContaining({
        libraryPath: path.join(basePath, 'strategies', 'custom-strategies.json'),
        itemDir: path.join(basePath, 'strategies', 'items'),
      }),
      itemPath: path.join(basePath, 'strategies', 'items', 'custom_rsi_volume_rebound_v1.json'),
    })
    expect(fs.existsSync(path.join(basePath, 'strategies', 'custom-strategies.json'))).toBe(true)
    expect(fs.existsSync(path.join(basePath, 'strategies', 'items', 'custom_rsi_volume_rebound_v1.json'))).toBe(true)
    expect(saved.strategySpec).toMatchObject({ id: 'custom_rsi_volume_rebound_v1' })
    expect(saved.validationReport).toMatchObject({ status: 'validated' })
    expect(saved.validationSummary).toMatchObject({ canBacktest: true })
    expect(saved.validationIssues).toEqual([])
    expect(saved.repairPlan).toEqual([])
    expect(saved.unsupportedDetails).toEqual([])
    expect(saved.dataRequirements).toMatchObject({ requiredLookbackBars: 20 })
    expect(saved.backtestEvidence).toMatchObject({ action: 'custom_strategy_backtest' })
    expect(saved.dataAndAssumptionSummary).toMatchObject({
      tradeBoundary: expect.stringContaining('explicit confirmation'),
      dataEvidence: expect.objectContaining({ cacheStatus: 'local-miss-then-fetch' }),
      dataCoverage: expect.objectContaining({ requiredBars: 40, sufficient: true }),
      riskRewardEvidence: backtest.riskRewardEvidence,
    })
    expect(saved.lifecycle).toMatchObject({ status: 'backtested', runnable: true })
    const firstCreatedAt = saved.lifecycle.createdAt

    const listed = JSON.parse(await service.readAction('custom_strategy_list', {}, { basePath } as any, '', 120))
    expect(listed).toMatchObject({ action: 'custom_strategy_list', detail: 'summary', count: 1, returned: 1 })
    expect(listed).toMatchObject({
      artifactContract: 'strategy-library-v1',
    })
    expect(listed.paths).toBeUndefined()
    expect(listed.strategies[0]).toMatchObject({
      evidenceAction: 'custom_strategy_backtest',
      assetClass: 'stock',
      runnable: true,
      lifecycleStatus: 'backtested',
      validationSummary: expect.objectContaining({ canBacktest: true }),
      validationIssueCount: 0,
      repairStepCount: 0,
      unsupportedCount: 0,
      dataAndAssumptionSummary: expect.objectContaining({
        dataCoverage: expect.objectContaining({ sufficient: true }),
      }),
    })
    expect(listed.strategies[0].itemPath).toBeUndefined()
    expect(listed.strategies[0].dataRequirements).toBeUndefined()
    expect(listed.strategies[0].validationIssues).toBeUndefined()
    expect(JSON.stringify(listed).length).toBeLessThan(9000)
    const fullListed = JSON.parse(await service.readAction('custom_strategy_list', { detail: 'full', strategyIds: ['custom_rsi_volume_rebound_v1'] }, { basePath } as any, '', 120))
    expect(fullListed).toMatchObject({ action: 'custom_strategy_list', detail: 'full', count: 1, returned: 1 })
    expect(fullListed.paths).toMatchObject({
      libraryPath: path.join(basePath, 'strategies', 'custom-strategies.json'),
      itemDir: path.join(basePath, 'strategies', 'items'),
    })
    expect(fullListed.strategies[0]).toMatchObject({
      strategyId: 'custom_rsi_volume_rebound_v1',
      itemPath: path.join(basePath, 'strategies', 'items', 'custom_rsi_volume_rebound_v1.json'),
      validationIssues: [],
      repairPlan: [],
      unsupportedDetails: [],
      lifecycle: expect.any(Object),
    })
    const nestedFullListed = JSON.parse(await service.readAction('custom_strategy_list', { params: { detail: 'full', strategyIds: ['custom_rsi_volume_rebound_v1'] } }, { basePath } as any, '', 120))
    expect(nestedFullListed).toMatchObject({ action: 'custom_strategy_list', detail: 'full', returned: 1 })
    const readback = JSON.parse(await service.readAction('custom_strategy_read', { strategyId: 'custom_rsi_volume_rebound_v1' }, { basePath } as any, '', 120))
    expect(readback).toMatchObject({
      action: 'custom_strategy_read',
      strategyId: 'custom_rsi_volume_rebound_v1',
      runnable: true,
      strategySpec: expect.objectContaining({
        id: 'custom_rsi_volume_rebound_v1',
        assetClass: 'stock',
      }),
      nextActions: expect.arrayContaining([
        expect.objectContaining({ action: 'custom_strategy_run', strategyId: 'custom_rsi_volume_rebound_v1' }),
      ]),
    })
    expect(readback.paths).toBeUndefined()
    expect(readback.itemPath).toBeUndefined()

    const rerun = JSON.parse(await service.readAction('custom_strategy_run', { strategyId: 'custom_rsi_volume_rebound_v1' }, { basePath } as any, '', 120))
    expect(rerun).toMatchObject({ action: 'custom_strategy_run', strategyId: 'custom_rsi_volume_rebound_v1' })
    expect(rerun.validationSummary).toMatchObject({ canBacktest: true })
    expect(rerun.validationIssues).toEqual([])
    expect(rerun.repairPlan).toEqual([])
    expect(rerun.unsupportedDetails).toEqual([])
    expect(rerun.dataRequirements).toMatchObject({ requiredLookbackBars: 20 })
    expect(rerun.benchmarkEvidence).toMatchObject({ mode: 'buy_and_hold_close_to_close' })
    expect(rerun.dataEvidence).toMatchObject({ cacheStatus: 'local-miss-then-fetch', rows: bars.length })
    expect(rerun.dataCoverage).toMatchObject({
      mode: 'strategy_backtest_kline_coverage',
      symbol: '600519',
      requiredBars: 40,
      sufficient: true,
    })

    const updatedSave = JSON.parse(await service.readAction('custom_strategy_save', { strategySpec }, { basePath } as any, '', 120))
    expect(updatedSave.lifecycle).toMatchObject({ createdAt: firstCreatedAt, status: 'backtested', runnable: true })
    expect(updatedSave.status).toBe('backtested')
    expect(updatedSave.backtestEvidence).toMatchObject({ action: 'custom_strategy_backtest' })
  })

  it('rejects unsupported executable custom strategy sources before backtest', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      indicators: [{ id: 'sentiment', type: 'sentiment', params: {} }],
      entry: { all: [{ left: 'news_sentiment', op: '>', right: 0.8 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('unsupported indicator "sentiment"')
    expect(validation.errors.join('\n')).toContain('unsupported executable rule source "news_sentiment"')
    expect(validation.unsupported.join('\n')).toContain('unsupported indicator "sentiment"')
    expect(validation.unsupported.join('\n')).toContain('unsupported executable rule source "news_sentiment"')
    expect(validation.unsupportedDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'indicator',
        path: 'indicators.sentiment',
        field: 'type',
        value: 'sentiment',
        suggestion: expect.stringContaining('custom_strategy_help'),
        candidateTypes: expect.arrayContaining(['sma']),
      }),
      expect.objectContaining({ category: 'rule_source', path: 'entry.left', field: 'left', value: 'news_sentiment', suggestion: expect.stringContaining('Declare the referenced source') }),
    ]))
    expect(validation.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'indicator',
        source: 'unsupportedDetails',
        repairAction: 'replace_with_supported_indicator',
        target: 'strategySpec.indicators',
        patchHint: expect.objectContaining({
          operation: 'replace_indicator_type',
          candidateTypes: expect.arrayContaining(['sma']),
          candidateCatalog: expect.arrayContaining([expect.objectContaining({ type: 'sma' })]),
        }),
      }),
      expect.objectContaining({
        category: 'rule_source',
        repairAction: 'declare_source_or_use_builtin_series',
        target: 'strategySpec.entry_or_exit',
        patchHint: expect.objectContaining({ operation: 'declare_indicator_or_use_builtin_series' }),
        blocking: true,
      }),
    ]))
    expect(validation.validationSummary).toMatchObject({
      nextAction: 'revise_strategy_spec',
      canBacktest: false,
    })

    await expect(
      service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120),
    ).rejects.toThrow('custom strategy validation failed')
  })

  it('rejects proxy custom StrategySpec until explicit structured approval is present', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const proxySpec = {
      ...customStrategySpec(),
      proxyFor: { requestId: 'unsupported-news-fund-flow-tape' },
      unsupportedOriginalSignals: ['news_sentiment', 'main_fund_flow', 'order_book_tape'],
    }

    const rejected = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec: proxySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(rejected.status).toBe('rejected')
    expect(rejected.validationSummary).toMatchObject({ canBacktest: false, nextAction: 'revise_strategy_spec' })
    expect(rejected.unsupportedDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'proxy_strategy',
        field: 'proxyApproval',
        suggestion: expect.stringContaining('separate strategy'),
      }),
    ]))

    const approved = JSON.parse(await service.readAction(
      'custom_strategy_validate',
      { strategySpec: { ...proxySpec, proxyApproval: { approved: true, source: 'user-confirmed-redesign' } } },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(approved.status).toBe('validated')
    expect(approved.unsupportedDetails).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'proxy_strategy' }),
    ]))
  })

  it('treats saved status-only backtest evidence as runnable', async () => {
    const bars = customStrategyBars()
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => bars),
    }))

    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-custom-strategy-status-only-'))
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = { ...customStrategySpec(), symbol: '600519' }
    const evidence = {
      status: 'backtested',
      strategyId: 'custom_rsi_volume_rebound_v1',
      actualStartDate: '2025-12-24',
      actualEndDate: '2026-06-30',
      bars: bars.length,
      dataCoverage: { rows: bars.length, sufficient: true },
    }

    const saved = JSON.parse(await service.readAction('custom_strategy_save', { strategySpec, evidence }, { basePath } as any, '', 120))
    expect(saved).toMatchObject({
      action: 'custom_strategy_save',
      status: 'backtested',
      lifecycle: expect.objectContaining({ runnable: true }),
      backtestEvidence: expect.objectContaining({ status: 'backtested' }),
    })

    const rerun = JSON.parse(await service.readAction('custom_strategy_run', { strategyId: saved.strategyId }, { basePath } as any, '600519', 120))
    expect(rerun).toMatchObject({
      action: 'custom_strategy_run',
      strategyId: saved.strategyId,
    })
    expect(rerun.status).not.toBe('readback_only')
  })

  it('validates fund-specific observation specs without stock custom backtest', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const help = JSON.parse(await service.readAction('custom_strategy_help', {}, { basePath: '/tmp' } as any, '', 120))
    expect(help).toMatchObject({
      action: 'custom_strategy_help',
      detail: 'summary',
      supportedActions: expect.arrayContaining(['custom_strategy_validate', 'custom_strategy_fund_backtest']),
      fundObservationV1: expect.objectContaining({
        requires: expect.arrayContaining(['assetClass:fund']),
        indicatorCount: expect.any(Number),
        indicatorsPreview: expect.arrayContaining(['fund_drawdown']),
        indicatorCategories: expect.arrayContaining(['fund_risk_adjusted', 'fund_return_quality', 'money_fund_yield']),
      }),
    })
    expect(help.executableV1.indicatorCount).toBeGreaterThan(20)
    expect(help.executableV1.indicatorsPreview).toEqual(expect.arrayContaining(['rsi']))
    expect(help.executableV1.catalogRequest).toMatchObject({ detail: 'catalog' })
    expect(help.executableV1.indicatorPreviewCatalog).toBeUndefined()
    expect(help.executableV1.indicatorCatalog).toBeUndefined()
    expect(help.fundObservationV1.indicatorPreviewCatalog).toBeUndefined()
    expect(help.fundObservationV1.indicatorCatalog).toBeUndefined()
    expect(help.executableV1.stockExample).toBeUndefined()
    expect(help.fundObservationV1.ordinaryFundExample).toBeUndefined()
    expect(help.proxyContract).toBeUndefined()
    expect(help.unsupportedV1).toBeUndefined()
    expect(help.inputContracts).toBeUndefined()
    expect(help.outputContracts).toBeUndefined()
    expect(JSON.stringify(help).length).toBeLessThan(7000)
    const contractHelp = JSON.parse(await service.readAction('custom_strategy_help', { detail: 'contracts' }, { basePath: '/tmp' } as any, '', 120))
    expect(contractHelp.outputContracts.custom_strategy_run.coreFields).toContain('lifecycle')
    expect(contractHelp.outputContracts.custom_strategy_compare.coreFields).toContain('strategies')
    expect(contractHelp.executableV1.indicatorCatalog).toBeUndefined()
    const fieldHelp = JSON.parse(await service.readAction('custom_strategy_help', { fields: 'executableV1.indicatorCatalog,executableV1.indicators', indicators: ['sma', 'rsi'] }, { basePath: '/tmp' } as any, '', 120))
    expect(fieldHelp.detail).toBe('catalog')
    expect(fieldHelp.executableV1.indicatorCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rsi' }),
    ]))
    expect(fieldHelp.executableV1.stockExample).toMatchObject({
      indicators: expect.any(Array),
      entry: expect.objectContaining({ all: expect.any(Array) }),
      exit: expect.objectContaining({ any: expect.any(Array) }),
    })
    const detailedHelp = JSON.parse(await service.readAction('custom_strategy_help', { detail: 'catalog' }, { basePath: '/tmp' } as any, '', 120))
    expect(detailedHelp).toMatchObject({
      action: 'custom_strategy_help',
      detail: 'catalog',
      fundObservationV1: expect.objectContaining({
        indicators: expect.arrayContaining(['fund_drawdown', 'money_yield']),
      }),
    })
    expect(detailedHelp.fundObservationV1.indicatorCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'fund_sharpe',
        source: 'nav',
        scoreDirection: 1,
        requiredFields: expect.arrayContaining(['date', 'nav']),
      }),
      expect.objectContaining({
        type: 'fund_drawdown',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_downside_volatility',
        category: 'fund_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_rolling_max_drawdown',
        category: 'fund_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_average_drawdown',
        category: 'fund_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_ulcer_index',
        category: 'fund_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_drawdown_duration_bars',
        category: 'fund_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
    ]))
    expect(detailedHelp.fundObservationV1.indicatorCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'fund_gain_to_pain',
        category: 'fund_return_quality',
        source: 'nav',
        scoreDirection: 1,
      }),
      expect.objectContaining({
        type: 'fund_value_at_risk',
        category: 'fund_tail_loss_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_conditional_value_at_risk',
        category: 'fund_tail_loss_risk',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'dca_interval',
        scoreDirection: 0,
      }),
    ]))
    expect(detailedHelp.fundObservationV1.indicatorCatalogByCategory.fund_return_quality).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fund_omega' }),
      expect.objectContaining({
        type: 'fund_momentum_acceleration',
        source: 'nav',
        scoreDirection: 1,
      }),
    ]))
    expect(detailedHelp.fundObservationV1.indicatorCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'fund_positive_period_ratio',
        category: 'fund_return_consistency',
        source: 'nav',
        scoreDirection: 1,
      }),
      expect.objectContaining({
        type: 'fund_negative_period_ratio',
        category: 'fund_return_consistency',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_max_consecutive_down_periods',
        category: 'fund_return_consistency',
        source: 'nav',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        type: 'fund_max_consecutive_up_periods',
        category: 'fund_return_consistency',
        source: 'nav',
        scoreDirection: 1,
      }),
      expect.objectContaining({
        type: 'fund_return_skewness',
        category: 'fund_return_distribution',
        source: 'nav',
        scoreDirection: 1,
      }),
      expect.objectContaining({
        type: 'fund_return_kurtosis',
        category: 'fund_return_distribution',
        source: 'nav',
        scoreDirection: -1,
      }),
    ]))
    expect(detailedHelp.fundObservationV1.indicatorCatalogByCategory.fund_return_consistency).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fund_positive_period_ratio' }),
      expect.objectContaining({ type: 'fund_negative_period_ratio' }),
      expect.objectContaining({ type: 'fund_max_consecutive_down_periods' }),
      expect.objectContaining({ type: 'fund_max_consecutive_up_periods' }),
    ]))
    expect(detailedHelp.fundObservationV1.indicatorCatalogByCategory.fund_return_distribution).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fund_return_skewness' }),
      expect.objectContaining({ type: 'fund_return_kurtosis' }),
    ]))
    expect(detailedHelp.fundObservationV1.indicatorCatalogByCategory.money_fund_yield).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'seven_day_yield' }),
    ]))
    expect(help.executableV1.exits).toContain('max_drawdown_stop_pct')
    expect(help.executableV1.exits).toContain('atr_stop_loss')
    expect(help.executableV1.indicatorCategories).toEqual(expect.arrayContaining(['trend', 'momentum', 'volume', 'risk', 'price_action']))
    expect(detailedHelp.executableV1.indicatorCatalogByCategory.momentum).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rsi' }),
      expect.objectContaining({ type: 'stochastic_d' }),
    ]))
    expect(detailedHelp.executableV1.indicatorCatalogByCategory.volume).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'money_flow_index' }),
    ]))
    expect(detailedHelp.executableV1.stockExample).toMatchObject({
      indicators: expect.any(Array),
      entry: expect.objectContaining({ all: expect.any(Array) }),
      exit: expect.objectContaining({ any: expect.any(Array) }),
    })
    expect(detailedHelp.outputContracts.custom_strategy_backtest.coreFields).toContain('dataCoverage')
    expect(detailedHelp.outputContracts.custom_strategy_backtest.coreFields).toContain('benchmarkEvidence')
    expect(detailedHelp.outputContracts.custom_strategy_backtest.coreFields).toContain('riskRewardEvidence')
    expect(detailedHelp.outputContracts.custom_strategy_backtest.coreFields).toContain('lifecycleAdvice')
    expect(detailedHelp.outputContracts.custom_strategy_backtest.lifecycleAdvice).toContain('Zero completed trades')
    expect(detailedHelp.inputContracts.custom_strategy_validate.requiredFields).toContain('strategySpec')
    expect(detailedHelp.inputContracts.custom_strategy_validate.boundary).toContain('Validation is read-only')
    expect(detailedHelp.inputContracts.custom_strategy_backtest.requiredFields).toContain('strategySpec')
    expect(detailedHelp.inputContracts.custom_strategy_backtest.symbolFields).toContain('strategySpec.universe.symbols[0]')
    const backtestInputField = (name: string) => detailedHelp.inputContracts.custom_strategy_backtest.optionalFields.find((field: any) => field.name === name)
    expect(backtestInputField('outOfSampleRatio')).toMatchObject({ max: 0.8 })
    expect(backtestInputField('walkForwardFolds')).toMatchObject({ min: 2 })
    expect(detailedHelp.inputContracts.custom_strategy_backtest.boundary).toContain('stock StrategySpec only')
    expect(detailedHelp.inputContracts.custom_strategy_observe.requiredFields).toEqual(expect.arrayContaining(['strategySpec', 'fundRows']))
    expect(detailedHelp.inputContracts.custom_strategy_fund_backtest.boundary).toContain('NAV/yield rows')
    expect(detailedHelp.inputContracts.custom_strategy_rank.requiredFields).toEqual(expect.arrayContaining(['strategySpec', 'symbols']))
    const rankInputField = (name: string) => detailedHelp.inputContracts.custom_strategy_rank.optionalFields.find((field: any) => field.name === name)
    expect(rankInputField('topN')).toMatchObject({ max: 10 })
    expect(rankInputField('rankingMetric').values).toContain('relative_strength_pct')
    expect(rankInputField('rebalanceInterval').values).toContain('monthly')
    expect(rankInputField('maxPositionWeight')).toMatchObject({ max: 1 })
    expect(rankInputField('minScore')).toMatchObject({ default: null })
    expect(rankInputField('maxPairwiseCorrelation')).toMatchObject({ max: 1 })
    expect(detailedHelp.inputContracts.custom_strategy_rank.selectionEvidenceFields).toEqual(expect.arrayContaining([
      'exclusionReason',
      'maxPairwiseCorrelation',
      'correlationConstraintEvidence',
    ]))
    expect(detailedHelp.inputContracts.custom_strategy_save.requiredFields).toContain('strategySpec')
    expect(detailedHelp.inputContracts.custom_strategy_save.boundary).toContain('strategy artifact only')
    expect(detailedHelp.inputContracts.custom_strategy_run.requiredFields).toContain('strategyId')
    expect(detailedHelp.inputContracts.custom_strategy_run.boundary).toContain('readback_only')
    expect(detailedHelp.outputContracts.custom_strategy_rank.coreFields).toContain('candidateFailureEvidence')
    expect(detailedHelp.outputContracts.custom_strategy_rank.coreFields).toEqual(expect.arrayContaining([
      'validationSummary',
      'validationIssues',
      'unsupportedDetails',
      'dataRequirements',
      'selectionEvidence',
      'concentrationEvidence',
      'portfolioScoringEvidence',
      'portfolioDrawdownBudgetEvidence',
      'portfolioReturnQualityEvidence',
      'transactionCostEvidence',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_rank.portfolioRebalanceSimulationFields).toEqual(expect.arrayContaining([
      'grossSimulatedReturnPct',
      'estimatedTransactionCostPct',
      'simulatedReturnPct',
      'transactionCostEvidence',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_rank.portfolioBacktestEvidenceFields).toContain('transactionCostEvidence')
    expect(detailedHelp.outputContracts.custom_strategy_rank.rankedRowFields).toEqual(expect.arrayContaining([
      'benchmarkEvidence',
      'riskEvidence',
      'selectionEvidence',
      'weightEvidence',
      'dataCoverage',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_validate.coreFields).toContain('validationIssues')
    expect(detailedHelp.outputContracts.custom_strategy_validate.coreFields).toContain('repairPlan')
    expect(detailedHelp.outputContracts.custom_strategy_validate.repairPlanFields).toEqual(expect.arrayContaining(['target', 'patchHint']))
    expect(detailedHelp.outputContracts.custom_strategy_save.coreFields).toEqual(expect.arrayContaining([
      'validationSummary',
      'validationIssues',
      'repairPlan',
      'unsupportedDetails',
      'dataRequirements',
      'dataAndAssumptionSummary',
      'lifecycle',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_save.dataAndAssumptionSummaryFields).toEqual(expect.arrayContaining([
      'portfolioEvidence',
      'rebalanceDraft',
      'portfolioValidation',
      'concentrationEvidence',
      'candidateFailureEvidence',
      'rankedRowsEvidence',
      'periodEvidence',
      'ruleEvidence',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_list.rowFields).toEqual(expect.arrayContaining([
      'validationSummary',
      'validationIssues',
      'unsupportedDetails',
      'dataRequirements',
      'dataAndAssumptionSummary',
      'lifecycle',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_list.dataAndAssumptionSummaryFields).toEqual(expect.arrayContaining([
      'portfolioEvidence',
      'rebalanceDraft',
      'portfolioValidation',
      'candidateFailureEvidence',
      'rankedRowsEvidence',
      'periodEvidence',
      'ruleEvidence',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_compare.rowFields).toEqual(expect.arrayContaining([
      'strategyId',
      'strategyType',
      'runnable',
      'metrics',
      'portfolioMetrics',
      'dataCoverage',
      'score',
      'tradeBoundary',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_run.runnableBacktestedFields).toEqual(expect.arrayContaining([
      'validationSummary',
      'validationIssues',
      'unsupportedDetails',
      'dataRequirements',
      'benchmarkEvidence',
      'dataCoverage',
    ]))
    expect(detailedHelp.outputContracts.custom_strategy_run.readbackOnlyFields).toContain('lifecycleIssue')
    expect(detailedHelp.outputContracts.custom_strategy_run.readbackOnlyFields).toContain('validationIssues')
    expect(detailedHelp.outputContracts.custom_strategy_run.readbackOnlyFields).toContain('concentrationEvidence')
    expect(detailedHelp.text).toContain('readback_only')

    const strategySpec = fundStrategySpec()

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({
      action: 'custom_strategy_validate',
      status: 'validated',
      assetClass: 'fund',
      backtestable: false,
    })
    expect(validation.accepted).toEqual(expect.arrayContaining([
      'fund_indicator:navTrend:nav_trend',
      'fund_indicator:drawdown:fund_drawdown',
      'fund_indicator:maxDrawdown:fund_rolling_max_drawdown',
      'fund_indicator:averageDrawdown:fund_average_drawdown',
      'fund_indicator:ulcerIndex:fund_ulcer_index',
      'fund_indicator:drawdownDuration:fund_drawdown_duration_bars',
      'fund_indicator:volatility:fund_volatility',
      'fund_indicator:downsideVolatility:fund_downside_volatility',
      'fund_indicator:sharpe:fund_sharpe',
      'fund_indicator:sortino:fund_sortino',
      'fund_indicator:calmar:fund_calmar',
      'fund_indicator:recoveryRatio:fund_recovery_ratio',
      'fund_indicator:gainToPain:fund_gain_to_pain',
      'fund_indicator:momentumAcceleration:fund_momentum_acceleration',
      'fund_indicator:omega:fund_omega',
      'fund_indicator:tailRatio:fund_tail_ratio',
      'fund_indicator:positivePeriods:fund_positive_period_ratio',
      'fund_indicator:negativePeriods:fund_negative_period_ratio',
      'fund_indicator:maxDownStreak:fund_max_consecutive_down_periods',
      'fund_indicator:maxUpStreak:fund_max_consecutive_up_periods',
      'fund_indicator:returnSkewness:fund_return_skewness',
      'fund_indicator:returnKurtosis:fund_return_kurtosis',
      'fund_indicator:valueAtRisk:fund_value_at_risk',
      'fund_indicator:conditionalValueAtRisk:fund_conditional_value_at_risk',
    ]))
    expect(validation.validationSummary).toMatchObject({
      nextAction: 'gather_fund_evidence_or_observe',
      canBacktest: false,
    })
    expect(validation.dataRequirements.indicators).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'sharpe',
        type: 'fund_sharpe',
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'averageDrawdown',
        type: 'fund_average_drawdown',
        category: 'fund_risk',
        scoreDirection: -1,
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'recoveryRatio',
        type: 'fund_recovery_ratio',
        category: 'fund_risk_adjusted',
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'gainToPain',
        type: 'fund_gain_to_pain',
        category: 'fund_return_quality',
      }),
      expect.objectContaining({
        id: 'momentumAcceleration',
        type: 'fund_momentum_acceleration',
        category: 'fund_return_quality',
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'positivePeriods',
        type: 'fund_positive_period_ratio',
        category: 'fund_return_consistency',
      }),
      expect.objectContaining({
        id: 'negativePeriods',
        type: 'fund_negative_period_ratio',
        category: 'fund_return_consistency',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        id: 'maxDownStreak',
        type: 'fund_max_consecutive_down_periods',
        category: 'fund_return_consistency',
        scoreDirection: -1,
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'maxUpStreak',
        type: 'fund_max_consecutive_up_periods',
        category: 'fund_return_consistency',
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'drawdown',
        scoreDirection: -1,
      }),
      expect.objectContaining({
        id: 'downsideVolatility',
        type: 'fund_downside_volatility',
        category: 'fund_risk',
        scoreDirection: -1,
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'maxDrawdown',
        type: 'fund_rolling_max_drawdown',
        category: 'fund_risk',
        scoreDirection: -1,
        readbacks: ['query_fund_nav'],
      }),
      expect.objectContaining({
        id: 'valueAtRisk',
        type: 'fund_value_at_risk',
        category: 'fund_tail_loss_risk',
        scoreDirection: -1,
      }),
    ]))
    expect(validation.workflowAdvice).toContain('Do not call custom_strategy_backtest')

    await expect(
      service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '110011', 120),
    ).rejects.toThrow('fund StrategySpec')

    const observed = JSON.parse(await service.readAction(
      'custom_strategy_observe',
      { strategySpec, fundRows: sampleFundRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(observed).toMatchObject({
      action: 'custom_strategy_observe',
      status: 'observed',
      assetClass: 'fund',
      backtestable: false,
      rows: 90,
    })
    expect(observed.workflowAdvice).toContain('not a stock K-line backtest')
    expect(observed.indicators.navTrend).toBeGreaterThan(0)
    expect(typeof observed.indicators.maxDrawdown).toBe('number')
    expect(typeof observed.indicators.downsideVolatility).toBe('number')
    expect(typeof observed.indicators.sharpe).toBe('number')
    expect(typeof observed.indicators.sortino).toBe('number')
    expect(typeof observed.indicators.calmar).toBe('number')
    expect(typeof observed.indicators.gainToPain).toBe('number')
    expect(typeof observed.indicators.omega).toBe('number')
    expect(typeof observed.indicators.tailRatio).toBe('number')
    expect(typeof observed.indicators.maxDownStreak).toBe('number')
    expect(typeof observed.indicators.maxUpStreak).toBe('number')
    expect(observed.fundCategoryEvidence).toMatchObject({
      category: 'ordinary_fund',
      pricingBasis: 'fund_nav',
    })
    expect(observed.entry.satisfied).toBe(true)
    expect(observed.dcaObservation).toMatchObject({
      mode: 'fund_observation_only',
      suggestion: 'observe_or_prepare',
      cadenceDays: 30,
    })
    expect(observed.dcaObservation.tradeBoundary).toContain('Do not subscribe')
    expect(observed.monitorDraft).toMatchObject({
      mode: 'fund_rule_monitor',
      assetClass: 'fund',
    })
    expect(observed.monitorDraft.entryRules).toBeInstanceOf(Array)
    expect(observed.monitorDraft.unsupportedExecution).toContain('not a stock backtest')

    const fundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_fund_backtest',
      { strategySpec, fundRows: sampleFundRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(fundBacktest).toMatchObject({
      action: 'custom_strategy_fund_backtest',
      status: 'fund_backtested',
      mode: 'fund_period_evidence',
      stockBacktestable: false,
    })
    expect(fundBacktest.tradeBoundary).toContain('Do not subscribe')
    expect(fundBacktest.fundCoverageEvidence).toMatchObject({
      status: 'sufficient',
      requestedMinRows: 60,
    })
    expect(fundBacktest.fundRiskEvidence).toMatchObject({
      assetClass: 'fund',
      coverageStatus: 'sufficient',
      averageUlcerIndex: expect.any(Number),
      averageDrawdownPct: expect.any(Number),
      averageDrawdownDurationBars: expect.any(Number),
      maxDrawdownDurationBars: expect.any(Number),
      averageGainToPainRatio: expect.any(Number),
      averageRecoveryRatio: expect.any(Number),
      averageOmegaRatio: expect.any(Number),
      averageTailRatio: expect.any(Number),
      averagePositivePeriodRatioPct: expect.any(Number),
      averageNegativePeriodRatioPct: expect.any(Number),
      averageReturnSkewness: expect.any(Number),
      averageReturnKurtosis: expect.any(Number),
      averageValueAtRiskPct: expect.any(Number),
      averageConditionalValueAtRiskPct: expect.any(Number),
    })
    expect(fundBacktest.periodEvidence).toMatchObject({
      mode: 'fund_period_evidence',
      pricingBasis: 'fund_nav',
    })
    expect(fundBacktest.ruleEvidence).toMatchObject({
      mode: 'fund_rule_evidence',
      entrySatisfiedCount: 1,
    })
    expect(fundBacktest.fundResults).toHaveLength(1)
    expect(fundBacktest.fundResults[0].metrics).toBeTruthy()
    expect(fundBacktest.fundResults[0].metrics).toMatchObject({
      ulcerIndex: expect.any(Number),
      averageDrawdownPct: expect.any(Number),
      drawdownDurationBars: expect.any(Number),
      gainToPainRatio: expect.any(Number),
      recoveryRatio: expect.any(Number),
      omegaRatio: expect.any(Number),
      tailRatio: expect.any(Number),
      positivePeriodRatioPct: expect.any(Number),
      negativePeriodRatioPct: expect.any(Number),
      returnSkewness: expect.any(Number),
      returnKurtosis: expect.any(Number),
      valueAtRiskPct: expect.any(Number),
      conditionalValueAtRiskPct: expect.any(Number),
    })
    expect(fundBacktest.fundResults[0].fundCoverageEvidence).toMatchObject({
      status: 'sufficient',
      pricingBasis: 'fund_nav',
    })
    expect(fundBacktest.fundResults[0].fundRiskEvidence).toMatchObject({
      pricingBasis: 'fund_nav',
      ulcerIndex: expect.any(Number),
      averageDrawdownPct: expect.any(Number),
      drawdownDurationBars: expect.any(Number),
      gainToPainRatio: expect.any(Number),
      recoveryRatio: expect.any(Number),
      omegaRatio: expect.any(Number),
      tailRatio: expect.any(Number),
      positivePeriodRatioPct: expect.any(Number),
      negativePeriodRatioPct: expect.any(Number),
      returnSkewness: expect.any(Number),
      returnKurtosis: expect.any(Number),
      valueAtRiskPct: expect.any(Number),
      conditionalValueAtRiskPct: expect.any(Number),
    })
    expect(fundBacktest.fundResults[0].fundRiskEvidence.tradeBoundary).toContain('research-only')
    expect(fundBacktest.fundResults[0].fundCategoryEvidence).toMatchObject({
      pricingBasis: 'fund_nav',
    })

    const fundBacktestBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-fund-strategy-backtest-save-'))
    const savedFundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_save',
      { strategySpec, evidence: fundBacktest },
      { basePath: fundBacktestBasePath } as any,
      '',
      120,
    ))
    expect(savedFundBacktest).toMatchObject({
      action: 'custom_strategy_save',
      status: 'observed',
    })
    expect(savedFundBacktest.dataAndAssumptionSummary.fundRiskEvidence).toMatchObject({
      assetClass: 'fund',
      averageUlcerIndex: expect.any(Number),
      averageDrawdownPct: expect.any(Number),
      averageDrawdownDurationBars: expect.any(Number),
      averageGainToPainRatio: expect.any(Number),
      averageRecoveryRatio: expect.any(Number),
      averageOmegaRatio: expect.any(Number),
      averageTailRatio: expect.any(Number),
      averagePositivePeriodRatioPct: expect.any(Number),
      averageNegativePeriodRatioPct: expect.any(Number),
      averageReturnSkewness: expect.any(Number),
      averageReturnKurtosis: expect.any(Number),
      averageValueAtRiskPct: expect.any(Number),
    })
    expect(savedFundBacktest.dataAndAssumptionSummary.fundCoverageEvidence).toMatchObject({
      status: 'sufficient',
    })
    expect(savedFundBacktest.dataAndAssumptionSummary.periodEvidence).toMatchObject({
      mode: 'fund_period_evidence',
    })
    expect(savedFundBacktest.dataAndAssumptionSummary.ruleEvidence).toMatchObject({
      mode: 'fund_rule_evidence',
    })
    const listedFundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_list',
      { detail: 'full', strategyIds: [savedFundBacktest.strategyId] },
      { basePath: fundBacktestBasePath } as any,
      '',
      120,
    ))
    expect(listedFundBacktest.strategies[0]).toMatchObject({
      evidenceAction: 'custom_strategy_fund_backtest',
      assetClass: 'fund',
    })
    expect(listedFundBacktest.strategies[0].dataAndAssumptionSummary.fundRiskEvidence).toMatchObject({
      assetClass: 'fund',
      averageGainToPainRatio: expect.any(Number),
      averageOmegaRatio: expect.any(Number),
      averageTailRatio: expect.any(Number),
      averageValueAtRiskPct: expect.any(Number),
    })
    expect(listedFundBacktest.strategies[0].dataAndAssumptionSummary.periodEvidence).toMatchObject({
      mode: 'fund_period_evidence',
    })

    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-fund-strategy-observed-'))
    const saved = JSON.parse(await service.readAction(
      'custom_strategy_save',
      { strategySpec, evidence: observed },
      { basePath } as any,
      '',
      120,
    ))
    expect(saved).toMatchObject({ action: 'custom_strategy_save', status: 'observed' })
    const observedReadback = JSON.parse(await service.readAction(
      'custom_strategy_run',
      { strategyId: strategySpec.id },
      { basePath } as any,
      '110011',
      120,
    ))
    expect(observedReadback).toMatchObject({
      action: 'custom_strategy_run',
      strategyId: strategySpec.id,
      status: 'readback_only',
      runnable: false,
      savedStatus: 'observed',
      evidenceAction: 'custom_strategy_observe',
    })
    expect(observedReadback.dataAndAssumptionSummary).toBeTruthy()
    expect(observedReadback.lifecycle).toBeTruthy()

    const fundBacktestReadback = JSON.parse(await service.readAction(
      'custom_strategy_run',
      { strategyId: strategySpec.id },
      { basePath: fundBacktestBasePath } as any,
      '110011',
      120,
    ))
    expect(fundBacktestReadback).toMatchObject({
      action: 'custom_strategy_run',
      status: 'readback_only',
      evidenceAction: 'custom_strategy_fund_backtest',
    })
    expect(fundBacktestReadback.dataAndAssumptionSummary.fundRiskEvidence).toMatchObject({
      assetClass: 'fund',
    })
  })

  it('resolves fund strategy rows from local governed fund storage when fundRows is omitted', async () => {
    const queryFundRows = vi.fn(() => sampleFundRows())
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryFundRows = queryFundRows
      },
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const observed = JSON.parse(await service.readAction(
      'custom_strategy_observe',
      { code: '110011', strategySpec: fundStrategySpec() },
      { basePath: '/tmp' } as any,
      '110011',
      120,
    ))
    expect(observed).toMatchObject({
      action: 'custom_strategy_observe',
      status: 'observed',
      rows: sampleFundRows().length,
    })
    expect(queryFundRows).toHaveBeenCalledWith(expect.any(Object), '110011', 120)

    const fundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_fund_backtest',
      { code: '110011', strategySpec: fundStrategySpec() },
      { basePath: '/tmp' } as any,
      '110011',
      120,
    ))
    expect(fundBacktest).toMatchObject({
      action: 'custom_strategy_fund_backtest',
      status: 'fund_backtested',
      rows: sampleFundRows().length,
    })
  })

  it('custom strategy observe returns fund comparison evidence', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const observed = JSON.parse(await service.readAction(
      'custom_strategy_observe',
      { strategySpec: fundStrategySpec(), fundRows: sampleFundComparisonRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(observed.comparisonEvidence).toMatchObject({
      mode: 'fund_indicator_comparison',
      status: 'compared',
      fundCount: 2,
    })
    expect(observed.comparisonEvidence.tradeBoundary).toContain('Do not subscribe')
    expect(observed.comparisonEvidence.rows).toHaveLength(2)
    expect(observed.comparisonEvidence.rows.map((row: any) => row.code)).toEqual(expect.arrayContaining(['110011', '000001']))
    for (const row of observed.comparisonEvidence.rows) {
      expect(typeof row.rank).toBe('number')
      expect(row.indicators).toBeTruthy()
    }
  })

  it('custom strategy normalizes fund observation aliases', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const validation = JSON.parse(await service.readAction(
      'custom_strategy_validate',
      { strategySpec: fundObservationAliasSpec() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(validation).toMatchObject({
      action: 'custom_strategy_validate',
      status: 'validated',
      assetClass: 'fund',
    })
    expect(validation.accepted).toEqual(expect.arrayContaining([
      'fund_indicator:fundDrawdown20:fund_drawdown',
      'fund_indicator:navTrend20:nav_trend',
    ]))

    const observed = JSON.parse(await service.readAction(
      'custom_strategy_observe',
      { strategySpec: fundObservationAliasSpec(), fundRows: sampleFundRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(observed).toMatchObject({
      action: 'custom_strategy_observe',
      assetClass: 'fund',
    })

    const fundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_fund_backtest',
      { strategySpec: fundObservationAliasSpec(), fundRows: sampleFundRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(fundBacktest).toMatchObject({
      action: 'custom_strategy_fund_backtest',
      status: 'fund_backtested',
    })
  })

  it('normalizes structured top-level fund signals into executable observation rules', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const validation = JSON.parse(await service.readAction(
      'custom_strategy_validate',
      { strategySpec: fundTopLevelSignalSpec() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(validation).toMatchObject({
      action: 'custom_strategy_validate',
      status: 'validated',
      assetClass: 'fund',
    })
    expect(validation.spec.entry.all).toEqual(expect.arrayContaining([
      expect.objectContaining({ left: 'fundDrawdown60', op: '>=', right: 10 }),
      expect.objectContaining({ left: 'navTrend20', op: '>', right: 0 }),
    ]))
    expect(validation.accepted).toEqual(expect.arrayContaining([
      'entry:fundDrawdown60:>=',
      'entry:navTrend20:>',
    ]))
  })

  it('normalizes fund output aliases and object-form rule sides', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const validation = JSON.parse(await service.readAction(
      'custom_strategy_validate',
      { strategySpec: fundOutputAliasSignalSpec() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(validation).toMatchObject({
      action: 'custom_strategy_validate',
      status: 'validated',
      assetClass: 'fund',
    })
    expect(validation.spec.indicators.map((item: any) => item.id)).toEqual(expect.arrayContaining(['dd_120', 'nav_trend_20']))
    expect(validation.spec.entry.all).toEqual(expect.arrayContaining([
      expect.objectContaining({ left: 'dd_120', op: '>', right: 10 }),
      expect.objectContaining({ left: 'nav_trend_20', op: '>', right: 0 }),
    ]))
  })

  it('rejects money fund StrategySpec without money-yield indicators', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...fundStrategySpec(),
      id: 'fund_money_wrong_v1',
      name: '货币基金普通净值策略',
      fundType: '货币基金',
      indicators: [{ id: 'navTrend', type: 'nav_trend', params: { period: 20 } }],
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('money_yield or seven_day_yield')
  })

  it('classifies money-fund yield evidence for fund backtests', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const validation = JSON.parse(await service.readAction(
      'custom_strategy_validate',
      { strategySpec: moneyFundStrategySpec() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(validation.status).toBe('validated')
    expect(validation.dataRequirements.indicators).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'seven_day_yield',
        readbacks: ['query_fund_money_yield'],
      }),
    ]))
    const fundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_fund_backtest',
      { strategySpec: moneyFundStrategySpec(), fundRows: sampleMoneyFundRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(fundBacktest.fundCategoryEvidence).toMatchObject({
      category: 'money_fund',
      pricingBasis: 'money_yield',
      requiredReadbacks: ['query_fund_money_yield'],
    })
    expect(fundBacktest.fundCoverageEvidence).toMatchObject({
      status: 'sufficient',
      requiredFields: ['date', 'moneyYield', 'sevenDayYield'],
    })
    expect(fundBacktest.fundRiskEvidence).toMatchObject({
      pricingBasis: 'money_yield',
    })
    expect(fundBacktest.fundResults[0].fundCoverageEvidence).toMatchObject({
      status: 'sufficient',
      pricingBasis: 'money_yield',
    })
    expect(fundBacktest.fundResults[0].fundRiskEvidence).toMatchObject({
      riskLevel: 'income_stability',
    })
    expect(fundBacktest.fundResults[0].metrics).toMatchObject({
      dataClass: 'money_fund_yield',
    })
    expect(fundBacktest.fundResults[0].metrics.averageSevenDayYield).not.toBeNull()
  })

  it('separates ETF fund pricing bases in fund evidence', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const observed = JSON.parse(await service.readAction(
      'custom_strategy_observe',
      { strategySpec: etfFundStrategySpec(), fundRows: sampleEtfNavRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(observed.fundCategoryEvidence).toMatchObject({
      category: 'etf_or_etf_link',
      pricingBasis: 'fund_nav',
      hasNav: true,
      hasListedPrice: false,
      hasUnderlyingIndex: false,
      requiredReadbacks: ['query_fund_nav', 'query_quote', 'query_index_quote'],
    })
    expect(observed.fundCategoryEvidence.etfPricingEvidence).toMatchObject({
      observedPricingBases: ['fund_nav'],
      missingPricingBases: expect.arrayContaining(['listed_market_price', 'underlying_index']),
    })
    expect(observed.fundCategoryEvidence.warnings).toEqual([])

    const fundBacktest = JSON.parse(await service.readAction(
      'custom_strategy_fund_backtest',
      { strategySpec: etfFundStrategySpec(), fundRows: sampleEtfNavRows() },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(fundBacktest.fundResults[0].fundCategoryEvidence).toMatchObject({
      pricingBasis: 'fund_nav',
      etfPricingEvidence: expect.any(Object),
    })
  })

  it('validates and backtests expanded executable custom strategy indicators', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const { indicatorRegistry } = await import('../../src/domain/market/strategy-spec/strategy-spec-registry')
    const service = new BacktestMarketDataService()
    const defaultIndicatorParams = (definition: any): Record<string, unknown> => {
      if (Array.isArray(definition.parameterSchema) && definition.parameterSchema.length > 0) {
        return Object.fromEntries(
          definition.parameterSchema
            .filter((entry: any) => typeof entry?.name === 'string' && Object.prototype.hasOwnProperty.call(entry, 'default'))
            .map((entry: any) => [entry.name, entry.default]),
        )
      }
      return definition.usesPeriodParameter === false ? {} : { period: definition.defaultPeriod }
    }
    const indicators = indicatorRegistry
      .filter((definition) => definition.executable !== false)
      .map((definition) => {
        const id = `${definition.type.replaceAll('_', '')}${definition.defaultPeriod}`
        const params = defaultIndicatorParams(definition)
        return {
          id,
          type: definition.type,
          ...(Object.keys(params).length === 0 ? {} : { params }),
        }
      })
    const ruleFor = (indicator: { id: string; type: string }) => {
      if (indicator.type === 'drawdown_pct' || indicator.type === 'rolling_max_drawdown_pct') return { left: indicator.id, op: '<=', right: 0 }
      if (['price_change_pct', 'ema_slope', 'ma_distance_pct'].includes(indicator.type)) {
        return { left: indicator.id, op: '>', right: -100 }
      }
      if (['price_zscore', 'volume_zscore'].includes(indicator.type)) {
        return { left: indicator.id, op: '>', right: -10 }
      }
      if (indicator.type === 'moving_average_regime' || indicator.type === 'volatility_regime') return { left: indicator.id, op: '>=', right: -1 }
      if (indicator.type === 'supertrend_direction') return { left: indicator.id, op: '>=', right: -1 }
      if (indicator.type === 'dmi_spread') return { left: indicator.id, op: '>=', right: -100 }
      if (indicator.type === 'supertrend_distance_pct' || indicator.type === 'chandelier_stop_distance_pct') return { left: indicator.id, op: '>', right: -100 }
      return { left: indicator.id, op: '>=', right: 0 }
    }
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_expanded_indicator_v1',
      dataRequirements: { minBars: 60, adjust: 'none' },
      indicators,
      entry: {
        all: indicators.map(ruleFor),
      },
      exit: { any: [{ type: 'stop_loss_pct', value: 8 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('validated')
    expect(validation.errors).toEqual([])
    expect(validation.accepted).toEqual(expect.arrayContaining(
      indicators.map((indicator) => `indicator:${indicator.id}:${indicator.type}`),
    ))
    expect(validation.dataRequirements.indicators.atrpct14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.atrpct14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.supertrenddirection10.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.supertrenddirection10.lookbackBars).toBe(10)
    expect(validation.dataRequirements.indicators.supertrenddistancepct10.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.supertrenddistancepct10.lookbackBars).toBe(10)
    expect(validation.dataRequirements.indicators.chandelierstopdistancepct22.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.chandelierstopdistancepct22.lookbackBars).toBe(22)
    expect(validation.dataRequirements.indicators.volumezscore20.requiredFields).toEqual(['volume'])
    expect(validation.dataRequirements.indicators.volumezscore20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.liquidityratio20.requiredFields).toEqual(['volume'])
    expect(validation.dataRequirements.indicators.liquidityratio20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.downsidevolatilitypct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.downsidevolatilitypct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.volatilitypercentile20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.volatilitypercentile20.lookbackBars).toBe(60)
    expect(validation.dataRequirements.indicators.bollingerpercentb20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.bollingerpercentb20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.bollingerbanddistancepct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.bollingerbanddistancepct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.volumebreakout20.requiredFields).toEqual(['volume'])
    expect(validation.dataRequirements.indicators.volumebreakout20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.volumerateofchangepct20.requiredFields).toEqual(['volume'])
    expect(validation.dataRequirements.indicators.volumerateofchangepct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.momentumaccelerationpct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.momentumaccelerationpct20.lookbackBars).toBe(40)
    expect(validation.dataRequirements.indicators.moneyflowindex14.requiredFields).toEqual(['high', 'low', 'close', 'volume'])
    expect(validation.dataRequirements.indicators.moneyflowindex14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.onbalancevolume1.requiredFields).toEqual(['close', 'volume'])
    expect(validation.dataRequirements.indicators.onbalancevolume1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.accumulationdistributionline1.requiredFields).toEqual(['high', 'low', 'close', 'volume'])
    expect(validation.dataRequirements.indicators.accumulationdistributionline1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.chaikinmoneyflow20.requiredFields).toEqual(['high', 'low', 'close', 'volume'])
    expect(validation.dataRequirements.indicators.chaikinmoneyflow20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.commoditychannelindex20.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.commoditychannelindex20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.williamsr14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.williamsr14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.stochasticd9.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.stochasticd9.lookbackBars).toBe(9)
    expect(validation.dataRequirements.indicators.stochasticj9.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.stochasticj9.lookbackBars).toBe(9)
    expect(validation.dataRequirements.indicators.breakoutpct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.breakoutpct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.intradayrangepct1.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.intradayrangepct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.gappct1.requiredFields).toEqual(['open', 'close'])
    expect(validation.dataRequirements.indicators.gappct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.closelocationpct1.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.closelocationpct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.bodyreturnpct1.requiredFields).toEqual(['open', 'close'])
    expect(validation.dataRequirements.indicators.bodyreturnpct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.uppershadowpct1.requiredFields).toEqual(['open', 'high', 'close'])
    expect(validation.dataRequirements.indicators.uppershadowpct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.lowershadowpct1.requiredFields).toEqual(['open', 'low', 'close'])
    expect(validation.dataRequirements.indicators.lowershadowpct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.shadowbalancepct1.requiredFields).toEqual(['open', 'high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.shadowbalancepct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.bodytorangepct1.requiredFields).toEqual(['open', 'high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.bodytorangepct1.lookbackBars).toBe(1)
    expect(validation.dataRequirements.indicators.momentumrank20.lookbackBars).toBe(60)
    expect(validation.dataRequirements.indicators.stochasticrsi14.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.stochasticrsi14.lookbackBars).toBe(28)
    expect(validation.dataRequirements.indicators.efficiencyratio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.efficiencyratio20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.linearregressionslopepct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.linearregressionslopepct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.linearregressionr220.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.linearregressionr220.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.chandemomentumoscillator14.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.chandemomentumoscillator14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.aroonoscillator25.requiredFields).toEqual(['high', 'low'])
    expect(validation.dataRequirements.indicators.aroonoscillator25.lookbackBars).toBe(25)
    expect(validation.dataRequirements.indicators.aroonup25.requiredFields).toEqual(['high', 'low'])
    expect(validation.dataRequirements.indicators.aroonup25.lookbackBars).toBe(25)
    expect(validation.dataRequirements.indicators.aroondown25.requiredFields).toEqual(['high', 'low'])
    expect(validation.dataRequirements.indicators.aroondown25.lookbackBars).toBe(25)
    expect(validation.dataRequirements.indicators.vortexspread14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.vortexspread14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.dmiplus14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.dmiplus14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.dmiminus14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.dmiminus14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.dmispread14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.dmispread14.lookbackBars).toBe(14)
    expect(validation.dataRequirements.indicators.donchianwidthpct20.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.donchianwidthpct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.rangecompressionratio20.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.rangecompressionratio20.lookbackBars).toBe(60)
    expect(validation.dataRequirements.indicators.donchianpositionpct20.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.donchianpositionpct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.keltnerwidthpct20.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.keltnerwidthpct20.lookbackBars).toBe(20)
    const { indicatorHelpCatalog } = await import('../../src/domain/market/strategy-spec/strategy-spec-registry')
    const catalogEntry = (type: string) => indicatorHelpCatalog.find((entry) => entry.type === type) as any
    expect(catalogEntry('volatility_regime').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['shortPeriod', 'baselinePeriod']))
    expect(catalogEntry('volatility_percentile').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'baselinePeriod']))
    expect(catalogEntry('volatility_percentile').lookbackBars).toBe(60)
    expect(catalogEntry('volatility_percentile').category).toBe('volatility')
    expect(catalogEntry('volatility_percentile').description).toContain('percentile')
    expect(catalogEntry('momentum_rank').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'rankPeriod']))
    expect(catalogEntry('rsi').parameterSchema).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'period' })]))
    expect(catalogEntry('stochastic_rsi').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['rsiPeriod', 'stochasticPeriod', 'lookbackPeriod']))
    expect(catalogEntry('stochastic_rsi').lookbackBars).toBe(28)
    expect(catalogEntry('stochastic_rsi').category).toBe('momentum')
    expect(catalogEntry('chandelier_stop_distance_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'atrPeriod', 'atrMultiplier']))
    expect(catalogEntry('chandelier_stop_distance_pct').lookbackBars).toBe(22)
    expect(catalogEntry('chandelier_stop_distance_pct').category).toBe('risk')
    expect(catalogEntry('accumulation_distribution_line').lookbackBars).toBe(1)
    expect(catalogEntry('accumulation_distribution_line').category).toBe('volume')
    expect(catalogEntry('macd').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['fastPeriod', 'slowPeriod', 'signalPeriod']))
    expect(catalogEntry('macd').lookbackBars).toBe(26)
    expect(validation.dataRequirements.indicators.ppo12.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.ppo12.lookbackBars).toBe(26)
    expect(catalogEntry('ppo').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['fastPeriod', 'slowPeriod', 'signalPeriod']))
    expect(catalogEntry('ppo').category).toBe('momentum')
    expect(catalogEntry('ppo').description).toContain('normalized by slow EMA')
    expect(validation.dataRequirements.indicators.trix15.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.trix15.lookbackBars).toBe(15)
    expect(catalogEntry('trix').category).toBe('momentum')
    expect(catalogEntry('trix').description).toContain('triple EMA')
    expect(validation.dataRequirements.indicators.truestrengthindex25.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.truestrengthindex25.lookbackBars).toBe(25)
    expect(catalogEntry('true_strength_index').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['longPeriod', 'shortPeriod']))
    expect(catalogEntry('true_strength_index').category).toBe('momentum')
    expect(catalogEntry('true_strength_index').description).toContain('double-smoothed momentum')
    expect(catalogEntry('vortex_spread').category).toBe('trend')
    expect(catalogEntry('vortex_spread').description).toContain('VI+ minus VI-')
    expect(catalogEntry('volatility_regime').lookbackBars).toBe(60)
    expect(catalogEntry('turnover_rate').lookbackBars).toBe(1)
    expect(catalogEntry('turnover_rate').parameterSchema).toEqual([])
    expect(catalogEntry('efficiency_ratio').category).toBe('trend')
    expect(catalogEntry('efficiency_ratio').description).toContain('trend efficiency')
    expect(catalogEntry('kama_distance_pct').category).toBe('trend')
    expect(catalogEntry('kama_distance_pct').description).toContain('Kaufman Adaptive Moving Average')
    expect(catalogEntry('kama_distance_pct').lookbackBars).toBe(30)
    expect(catalogEntry('kama_distance_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['erPeriod', 'fastPeriod', 'slowPeriod']))
    expect(catalogEntry('kama_slope_pct').category).toBe('trend')
    expect(catalogEntry('kama_slope_pct').description).toContain('Kaufman Adaptive Moving Average')
    expect(catalogEntry('kama_slope_pct').lookbackBars).toBe(30)
    expect(validation.dataRequirements.indicators.kamadistancepct10).toMatchObject({ requiredFields: ['close'], lookbackBars: 30 })
    expect(validation.dataRequirements.indicators.kamaslopepct10).toMatchObject({ requiredFields: ['close'], lookbackBars: 30 })
    expect(catalogEntry('linear_regression_slope_pct').category).toBe('trend')
    expect(catalogEntry('linear_regression_slope_pct').description).toContain('least-squares trend slope')
    expect(catalogEntry('linear_regression_r2').category).toBe('trend')
    expect(catalogEntry('linear_regression_r2').description).toContain('trend quality evidence')
    expect(catalogEntry('chande_momentum_oscillator').category).toBe('momentum')
    expect(catalogEntry('chande_momentum_oscillator').description).toContain('-100 to 100')
    expect(catalogEntry('aroon_oscillator').category).toBe('trend')
    expect(catalogEntry('aroon_oscillator').description).toContain('Aroon Up minus Aroon Down')
    expect(catalogEntry('aroon_up').category).toBe('trend')
    expect(catalogEntry('aroon_up').description).toContain('recency of the rolling high')
    expect(catalogEntry('aroon_down').category).toBe('trend')
    expect(catalogEntry('aroon_down').description).toContain('recency of the rolling low')
    expect(catalogEntry('dmi_plus').category).toBe('trend')
    expect(catalogEntry('dmi_plus').description).toContain('Positive Directional Indicator')
    expect(catalogEntry('dmi_minus').category).toBe('trend')
    expect(catalogEntry('dmi_minus').description).toContain('Negative Directional Indicator')
    expect(catalogEntry('dmi_spread').category).toBe('trend')
    expect(catalogEntry('dmi_spread').description).toContain('+DI minus -DI')
    expect(catalogEntry('donchian_width_pct').category).toBe('volatility')
    expect(catalogEntry('donchian_width_pct').description).toContain('Donchian channel width')
    expect(catalogEntry('range_compression_ratio').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'baselinePeriod']))
    expect(catalogEntry('range_compression_ratio').lookbackBars).toBe(60)
    expect(catalogEntry('range_compression_ratio').category).toBe('volatility')
    expect(catalogEntry('range_compression_ratio').description).toContain('range contraction')
    expect(catalogEntry('donchian_position_pct').category).toBe('breakout')
    expect(catalogEntry('donchian_position_pct').description).toContain('close location')
    expect(catalogEntry('keltner_width_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'atrPeriod', 'atrMultiplier']))
    expect(catalogEntry('keltner_width_pct').category).toBe('volatility')
    expect(catalogEntry('keltner_width_pct').description).toContain('EMA centerline')
    expect(catalogEntry('liquidity_ratio').category).toBe('liquidity')
    expect(catalogEntry('liquidity_ratio').description).toContain('Relative volume')
    expect(catalogEntry('volume_breakout').category).toBe('volume')
    expect(catalogEntry('volume_breakout').description).toContain('rolling average volume')
    expect(validation.dataRequirements.indicators.volumeoscillatorpct12.requiredFields).toEqual(['volume'])
    expect(validation.dataRequirements.indicators.volumeoscillatorpct12.lookbackBars).toBe(26)
    expect(catalogEntry('volume_oscillator_pct').category).toBe('volume')
    expect(catalogEntry('volume_oscillator_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['fastPeriod', 'slowPeriod']))
    expect(catalogEntry('volume_oscillator_pct').description).toContain('fast volume EMA')
    expect(catalogEntry('volume_rate_of_change_pct').category).toBe('volume')
    expect(catalogEntry('volume_rate_of_change_pct').description).toContain('rate of change')
    expect(catalogEntry('volume_percentile').category).toBe('volume')
    expect(catalogEntry('volume_percentile').lookbackBars).toBe(60)
    expect(catalogEntry('volume_percentile').description).toContain('percentile rank')
    expect(catalogEntry('momentum_acceleration_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'lagPeriod']))
    expect(catalogEntry('momentum_acceleration_pct').lookbackBars).toBe(40)
    expect(catalogEntry('momentum_acceleration_pct').category).toBe('momentum')
    expect(catalogEntry('momentum_acceleration_pct').description).toContain('previous lagged period return')
    expect(catalogEntry('money_flow_index').category).toBe('volume')
    expect(catalogEntry('money_flow_index').description).toContain('0-100')
    expect(catalogEntry('on_balance_volume').category).toBe('volume')
    expect(catalogEntry('on_balance_volume').parameterSchema).toEqual([])
    expect(catalogEntry('on_balance_volume').description).toContain('On-Balance Volume')
    expect(validation.dataRequirements.indicators.volumepricetrend1.requiredFields).toEqual(['close', 'volume'])
    expect(validation.dataRequirements.indicators.volumepricetrend1.lookbackBars).toBe(1)
    expect(catalogEntry('volume_price_trend').category).toBe('volume')
    expect(catalogEntry('volume_price_trend').parameterSchema).toEqual([])
    expect(catalogEntry('volume_price_trend').description).toContain('close-to-close percentage change')
    expect(validation.dataRequirements.indicators.positivevolumeindex1.requiredFields).toEqual(['close', 'volume'])
    expect(validation.dataRequirements.indicators.positivevolumeindex1.lookbackBars).toBe(1)
    expect(catalogEntry('positive_volume_index').category).toBe('volume')
    expect(catalogEntry('positive_volume_index').parameterSchema).toEqual([])
    expect(catalogEntry('positive_volume_index').description).toContain('volume increases')
    expect(validation.dataRequirements.indicators.negativevolumeindex1.requiredFields).toEqual(['close', 'volume'])
    expect(validation.dataRequirements.indicators.negativevolumeindex1.lookbackBars).toBe(1)
    expect(catalogEntry('negative_volume_index').category).toBe('volume')
    expect(catalogEntry('negative_volume_index').parameterSchema).toEqual([])
    expect(catalogEntry('negative_volume_index').description).toContain('volume decreases')
    expect(catalogEntry('chaikin_money_flow').category).toBe('volume')
    expect(catalogEntry('chaikin_money_flow').description).toContain('rolling volume')
    expect(validation.dataRequirements.indicators.forceindex13.requiredFields).toEqual(['close', 'volume'])
    expect(validation.dataRequirements.indicators.forceindex13.lookbackBars).toBe(13)
    expect(catalogEntry('force_index').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'smoothingPeriod']))
    expect(catalogEntry('force_index').category).toBe('volume')
    expect(catalogEntry('force_index').description).toContain('close-to-close price change')
    expect(validation.dataRequirements.indicators.easeofmovement14.requiredFields).toEqual(['high', 'low', 'volume'])
    expect(validation.dataRequirements.indicators.easeofmovement14.lookbackBars).toBe(14)
    expect(catalogEntry('ease_of_movement').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'volumeDivisor']))
    expect(catalogEntry('ease_of_movement').category).toBe('volume')
    expect(catalogEntry('ease_of_movement').description).toContain('midpoint movement')
    expect(validation.dataRequirements.indicators.vwapdistancepct20.requiredFields).toEqual(['high', 'low', 'close', 'volume'])
    expect(validation.dataRequirements.indicators.vwapdistancepct20.lookbackBars).toBe(20)
    expect(catalogEntry('vwap_distance_pct').category).toBe('volume')
    expect(catalogEntry('vwap_distance_pct').description).toContain('rolling VWAP')
    expect(validation.dataRequirements.indicators.rollingvwap20.requiredFields).toEqual(['high', 'low', 'close', 'volume'])
    expect(validation.dataRequirements.indicators.rollingvwap20.lookbackBars).toBe(20)
    expect(catalogEntry('rolling_vwap').category).toBe('volume')
    expect(catalogEntry('rolling_vwap').description).toContain('VWAP price')
    expect(validation.dataRequirements.indicators.ichimokucloudposition52.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.ichimokucloudposition52.lookbackBars).toBe(52)
    expect(catalogEntry('ichimoku_cloud_position').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['conversionPeriod', 'basePeriod', 'spanBPeriod']))
    expect(catalogEntry('ichimoku_cloud_position').category).toBe('trend')
    expect(catalogEntry('ichimoku_cloud_position').description).toContain('historical windows')
    expect(validation.dataRequirements.indicators.parabolicsardirection2.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.parabolicsardirection2.lookbackBars).toBe(2)
    expect(catalogEntry('parabolic_sar_direction').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['acceleration', 'maxAcceleration']))
    expect(catalogEntry('parabolic_sar_direction').category).toBe('trend')
    expect(catalogEntry('parabolic_sar_direction').description).toContain('above SAR')
    expect(catalogEntry('commodity_channel_index').category).toBe('momentum')
    expect(catalogEntry('commodity_channel_index').description).toContain('typical price')
    expect(catalogEntry('williams_r').category).toBe('momentum')
    expect(catalogEntry('williams_r').description).toContain('-100 to 0')
    expect(catalogEntry('breakout_pct').category).toBe('breakout')
    expect(catalogEntry('breakout_pct').description).toContain('previous rolling high')
    expect(validation.dataRequirements.indicators.distancetolowpct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.distancetolowpct20.lookbackBars).toBe(20)
    expect(validation.dataRequirements.indicators.breakdownpct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.breakdownpct20.lookbackBars).toBe(20)
    expect(catalogEntry('distance_to_low_pct').category).toBe('risk')
    expect(catalogEntry('distance_to_low_pct').description).toContain('support-distance')
    expect(catalogEntry('breakdown_pct').category).toBe('risk')
    expect(catalogEntry('breakdown_pct').description).toContain('prior support')
    expect(catalogEntry('intraday_range_pct').category).toBe('volatility')
    expect(catalogEntry('intraday_range_pct').description).toContain('high-low range')
    expect(catalogEntry('gap_pct').category).toBe('price_action')
    expect(catalogEntry('gap_pct').description).toContain('previous close')
    expect(catalogEntry('close_location_pct').category).toBe('price_action')
    expect(catalogEntry('close_location_pct').description).toContain('0-100')
    expect(catalogEntry('body_return_pct').category).toBe('price_action')
    expect(catalogEntry('body_return_pct').description).toContain('Open-to-close')
    expect(catalogEntry('upper_shadow_pct').category).toBe('price_action')
    expect(catalogEntry('upper_shadow_pct').description).toContain('Upper candle shadow')
    expect(catalogEntry('lower_shadow_pct').category).toBe('price_action')
    expect(catalogEntry('lower_shadow_pct').description).toContain('Lower candle shadow')
    expect(catalogEntry('shadow_balance_pct').category).toBe('price_action')
    expect(catalogEntry('shadow_balance_pct').description).toContain('shadow balance')
    expect(validation.dataRequirements.indicators.atrstopdistancepct14.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.atrstopdistancepct14.lookbackBars).toBe(14)
    expect(catalogEntry('atr_stop_distance_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'atrMultiplier']))
    expect(catalogEntry('atr_stop_distance_pct').category).toBe('risk')
    expect(catalogEntry('atr_stop_distance_pct').description).toContain('ATR stop distance')
    expect(validation.dataRequirements.indicators.riskrewardratio20.requiredFields).toEqual(['high', 'low', 'close'])
    expect(validation.dataRequirements.indicators.riskrewardratio20.lookbackBars).toBe(20)
    expect(catalogEntry('risk_reward_ratio').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['targetPeriod', 'atrPeriod', 'atrMultiplier']))
    expect(catalogEntry('risk_reward_ratio').category).toBe('risk')
    expect(catalogEntry('risk_reward_ratio').description).toContain('rolling high')
    expect(catalogEntry('body_to_range_pct').category).toBe('price_action')
    expect(catalogEntry('body_to_range_pct').description).toContain('high-low range')
    expect(catalogEntry('downside_volatility_pct').category).toBe('risk')
    expect(catalogEntry('downside_volatility_pct').description).toContain('downside-only volatility')
    expect(validation.dataRequirements.indicators.sortinoratio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.sortinoratio20.lookbackBars).toBe(20)
    expect(catalogEntry('sortino_ratio').category).toBe('risk')
    expect(catalogEntry('sortino_ratio').description).toContain('Sortino-style')
    expect(validation.dataRequirements.indicators.sharperatio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.sharperatio20.lookbackBars).toBe(20)
    expect(catalogEntry('sharpe_ratio').category).toBe('risk')
    expect(catalogEntry('sharpe_ratio').description).toContain('total return volatility')
    expect(validation.dataRequirements.indicators.calmarratio60.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.calmarratio60.lookbackBars).toBe(60)
    expect(catalogEntry('calmar_ratio').category).toBe('risk')
    expect(catalogEntry('calmar_ratio').description).toContain('maximum drawdown')
    expect(validation.dataRequirements.indicators.ulcerindex20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.ulcerindex20.lookbackBars).toBe(20)
    expect(catalogEntry('ulcer_index').category).toBe('risk')
    expect(catalogEntry('ulcer_index').description).toContain('high-water mark')
    expect(validation.dataRequirements.indicators.positiveperiodratio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.positiveperiodratio20.lookbackBars).toBe(20)
    expect(catalogEntry('positive_period_ratio').category).toBe('risk')
    expect(catalogEntry('positive_period_ratio').description).toContain('return consistency')
    expect(validation.dataRequirements.indicators.negativeperiodratio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.negativeperiodratio20.lookbackBars).toBe(20)
    expect(catalogEntry('negative_period_ratio').category).toBe('risk')
    expect(catalogEntry('negative_period_ratio').description).toContain('downside frequency')
    expect(validation.dataRequirements.indicators.maxconsecutivedownbars20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.maxconsecutivedownbars20.lookbackBars).toBe(20)
    expect(catalogEntry('max_consecutive_down_bars').category).toBe('risk')
    expect(catalogEntry('max_consecutive_down_bars').description).toContain('losing-streak')
    expect(validation.dataRequirements.indicators.maxconsecutiveupbars20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.maxconsecutiveupbars20.lookbackBars).toBe(20)
    expect(catalogEntry('max_consecutive_up_bars').category).toBe('risk')
    expect(catalogEntry('max_consecutive_up_bars').description).toContain('winning-streak')
    expect(validation.dataRequirements.indicators.returnskewness60.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.returnskewness60.lookbackBars).toBe(60)
    expect(catalogEntry('return_skewness').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period']))
    expect(catalogEntry('return_skewness').category).toBe('risk')
    expect(catalogEntry('return_skewness').description).toContain('skewness')
    expect(validation.dataRequirements.indicators.returnkurtosis60.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.returnkurtosis60.lookbackBars).toBe(60)
    expect(catalogEntry('return_kurtosis').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period']))
    expect(catalogEntry('return_kurtosis').category).toBe('risk')
    expect(catalogEntry('return_kurtosis').description).toContain('fatter-tailed')
    expect(validation.dataRequirements.indicators.gaintopainratio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.gaintopainratio20.lookbackBars).toBe(20)
    expect(catalogEntry('gain_to_pain_ratio').category).toBe('risk')
    expect(catalogEntry('gain_to_pain_ratio').description).toContain('positive returns')
    expect(validation.dataRequirements.indicators.omegaratio20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.omegaratio20.lookbackBars).toBe(20)
    expect(catalogEntry('omega_ratio').category).toBe('risk')
    expect(catalogEntry('omega_ratio').description).toContain('shortfall')
    expect(validation.dataRequirements.indicators.tailratio60.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.tailratio60.lookbackBars).toBe(60)
    expect(catalogEntry('tail_ratio').category).toBe('risk')
    expect(catalogEntry('tail_ratio').description).toContain('tail ratio')
    expect(validation.dataRequirements.indicators.valueatriskpct60.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.valueatriskpct60.lookbackBars).toBe(60)
    expect(catalogEntry('value_at_risk_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'confidence']))
    expect(catalogEntry('value_at_risk_pct').category).toBe('risk')
    expect(catalogEntry('value_at_risk_pct').description).toContain('Value at Risk')
    expect(validation.dataRequirements.indicators.conditionalvalueatriskpct60.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.conditionalvalueatriskpct60.lookbackBars).toBe(60)
    expect(catalogEntry('conditional_value_at_risk_pct').parameterSchema.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['period', 'confidence']))
    expect(catalogEntry('conditional_value_at_risk_pct').category).toBe('risk')
    expect(catalogEntry('conditional_value_at_risk_pct').description).toContain('expected shortfall')
    expect(validation.dataRequirements.indicators.rollingmaxdrawdownpct20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.rollingmaxdrawdownpct20.lookbackBars).toBe(20)
    expect(catalogEntry('rolling_max_drawdown_pct').category).toBe('risk')
    expect(catalogEntry('rolling_max_drawdown_pct').description).toContain('peak-to-trough')
    expect(validation.dataRequirements.indicators.drawdowndurationbars20.requiredFields).toEqual(['close'])
    expect(validation.dataRequirements.indicators.drawdowndurationbars20.lookbackBars).toBe(20)
    expect(catalogEntry('drawdown_duration_bars').category).toBe('risk')
    expect(catalogEntry('drawdown_duration_bars').description).toContain('high-water mark')

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested', strategyId: 'custom_expanded_indicator_v1' })
    expect(backtest.metrics).toHaveProperty('tradeCount')
  })

  it('keeps every executable registry method backed by an explicit calculator', async () => {
    const { indicatorRegistry } = await import('../../src/domain/market/strategy-spec/strategy-spec-registry')
    const { strategyIndicatorCalculatorTypes } = await import('../../src/domain/market/strategy-spec/strategy-indicator-calculators')
    const executable = indicatorRegistry
      .filter((definition) => definition.executable !== false)
      .map((definition) => definition.type)

    expect([...strategyIndicatorCalculatorTypes]).toEqual(expect.arrayContaining(executable))
  })

  it('rejects invalid custom strategy indicator parameters', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_invalid_params_v1',
      indicators: [
        { id: 'rsiBad', type: 'rsi', params: { period: 0 } },
        { id: 'volRegimeBad', type: 'volatility_regime', params: { shortPeriod: 1, unexpected: 20 } },
        { id: 'macdBad', type: 'macd', params: { fastPeriod: 0, slowPeriod: 1, signalPeriod: 0 } },
      ],
      entry: { all: [{ left: 'rsiBad', op: '>=', right: 0 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('indicator.rsiBad params.period must be >= 1')
    expect(validation.errors.join('\n')).toContain('indicator.volRegimeBad params.shortPeriod must be >= 2')
    expect(validation.errors.join('\n')).toContain('indicator.volRegimeBad params.unexpected is not supported for volatility_regime')
    expect(validation.errors.join('\n')).toContain('indicator.macdBad params.fastPeriod must be >= 1')
    expect(validation.errors.join('\n')).toContain('indicator.macdBad params.slowPeriod must be >= 2')
    expect(validation.errors.join('\n')).toContain('indicator.macdBad params.signalPeriod must be >= 1')
    expect(validation.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'indicator_params',
        path: 'indicators.rsiBad.params.period',
        field: 'period',
        value: '0',
        suggestion: expect.stringContaining('at least 1'),
      }),
      expect.objectContaining({
        category: 'indicator_params',
        path: 'indicators.volRegimeBad.params.unexpected',
        field: 'unexpected',
        suggestion: expect.stringContaining('parameterSchema'),
      }),
    ]))
    expect(validation.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'indicator_params',
        path: 'indicators.rsiBad.params.period',
        patchHint: expect.objectContaining({
          operation: 'conform_params_to_parameter_schema',
          path: 'indicators.rsiBad.params.period',
          field: 'period',
          currentValue: '0',
          indicatorId: 'rsiBad',
          parameterName: 'period',
          schemaSource: 'dataRequirements.indicators.rsiBad.parameterSchema',
        }),
      }),
    ]))
    expect(validation.dataRequirements.indicators.rsiBad.parameterSchema).toEqual(expect.any(Array))
  })

  it('rejects custom strategy data windows shorter than indicator lookback', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_short_window_v1',
      dataRequirements: { minBars: 40 },
      indicators: [
        { id: 'volatilityRegime', type: 'volatility_regime', params: { shortPeriod: 20, baselinePeriod: 60 } },
      ],
      entry: { all: [{ left: 'volatilityRegime', op: '>=', right: 0 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('dataRequirements.minBars must be >= required indicator lookbackBars 60')
    expect(validation.dataRequirements.requiredLookbackBars).toBe(60)
    expect(validation.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'dataRequirements',
        path: 'dataRequirements.minBars',
        field: 'minBars',
        value: '40',
        suggestion: expect.stringContaining('at least 60'),
      }),
    ]))
    expect(validation.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'dataRequirements',
        path: 'dataRequirements.minBars',
        patchHint: expect.objectContaining({
          operation: 'set_min_bars',
          currentMinBars: 40,
          requiredMinBars: 60,
          requiredLookbackBars: 60,
          targetValue: 60,
        }),
      }),
    ]))
  })

  it('rejects undeclared custom strategy rule sources', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      entry: { all: [{ left: 'imaginaryAlpha', op: '>', right: 0 }] },
      exit: { any: [{ left: 'rsi5', op: '>', right: 'missingExitRef' }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('entry rule source "imaginaryAlpha" is not declared in StrategySpec indicators or built-in series')
    expect(validation.errors.join('\n')).toContain('exit rule "rsi5" right source "missingExitRef" is not declared in StrategySpec indicators or built-in series')
    expect(validation.unsupportedDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'rule_source', path: 'entry.left', field: 'left', value: 'imaginaryAlpha', suggestion: expect.stringContaining('Declare the referenced source') }),
      expect.objectContaining({ category: 'rule_source', path: 'exit.right', field: 'right', value: 'missingExitRef' }),
    ]))
  })

  it('reports custom strategy schema and rule-shape validation issues', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      name: '',
      indicators: [{ type: 'rsi', params: { period: 5 } }],
      entry: { all: [] },
      exit: { any: [{ left: 'rsi5', op: '>', right: null }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('name is required')
    expect(validation.errors.join('\n')).toContain('entry rule group must contain all[] or any[] rules')
    expect(validation.errors.join('\n')).toContain('exit rule "rsi5" has no executable right-hand value')
    expect(validation.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'schema', path: 'name', field: 'name' }),
      expect.objectContaining({ category: 'rule_shape', path: 'entry', field: 'rules' }),
      expect.objectContaining({ category: 'rule_shape', path: 'exit.right', field: 'right', value: 'null' }),
    ]))
  })

  it('raw custom strategy validator reports missing indicator id issue', async () => {
    const { validateStockStrategySpec } = await import('../../src/domain/market/strategy-spec/strategy-spec-validator')
    const validation = validateStockStrategySpec({
      id: 'raw_missing_indicator_id_v1',
      name: 'Raw missing indicator id',
      version: 1,
      indicators: [{ type: 'rsi', params: { period: 5 } } as any],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ left: 'close', op: '<', right: 0 }] },
    })

    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('indicator.id is required')
    expect(validation.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'schema', path: 'indicators[0].id', field: 'id' }),
    ]))
  })

  it('normalizes structured operator-key typos in agent-authored StrategySpec conditions', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'operator_key_typo_v1',
      name: 'Operator key typo',
      entry: {
        all: [
          {
            left: 'close',
            op: '',
            '>=,': 'right',
            right: 0,
          },
        ],
      },
      exit: {
        any: [
          { left: 'rsi5', op: '>', right: 70 },
        ],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('validated')
    expect(validation.spec.entry.all[0]).toMatchObject({ left: 'close', op: '>=' })
  })

  it('normalizes no-op Bollinger stdDev params from agent-authored StrategySpec indicators', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'bollinger_stddev_alias_v1',
      name: 'Bollinger stdDev alias',
      indicators: [
        { id: 'bolZ20', type: 'bollinger', source: 'close', params: { period: 20, stdDev: 2 } },
      ],
      entry: {
        all: [{ left: 'bolZ20', op: '<=', right: -0.5 }],
      },
      exit: {
        any: [{ type: 'stop_loss_pct', value: 6 }],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('validated')
    expect(validation.spec.indicators[0].params).toEqual({ period: 20 })
  })

  it('validates and backtests Bollinger percent-b and band-distance components', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'bollinger_component_v1',
      name: 'Bollinger component strategy',
      indicators: [
        { id: 'bbp20', type: 'bollinger_percent_b', source: 'close', params: { period: 20, stdDev: 2 } },
        { id: 'bbd20', type: 'bollinger_band_distance_pct', source: 'close', params: { period: 20, standardDeviation: 2 } },
      ],
      entry: {
        all: [
          { left: 'bbp20', op: '>=', right: 0 },
          { left: 'bbd20', op: '>=', right: 0 },
        ],
      },
      exit: {
        any: [{ type: 'stop_loss_pct', value: 6 }],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('validated')
    expect(validation.spec.indicators.map((indicator: any) => indicator.type)).toEqual(expect.arrayContaining(['bollinger_percent_b', 'bollinger_band_distance_pct']))
    expect(validation.spec.indicators[0].params).toEqual({ period: 20, stdDevMultiplier: 2 })
    expect(validation.dataRequirements.indicators.bbp20.parameterSchema).toEqual(expect.any(Array))

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.action).toBe('custom_strategy_backtest')
  })

  it('normalizes ma_distance_pct maPeriod params from agent-authored StrategySpec indicators', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'ma_distance_period_alias_v1',
      name: 'MA distance period alias',
      indicators: [
        { id: 'distEma20', type: 'ma_distance_pct', source: 'close', params: { maPeriod: 20 } },
      ],
      entry: {
        all: [{ left: 'distEma20', op: '<=', right: 2.5 }],
      },
      exit: {
        any: [{ type: 'stop_loss_pct', value: 6 }],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('validated')
    expect(validation.spec.indicators[0].params).toEqual({ period: 20 })
  })

  it('reports root schema issue when custom strategy spec is missing', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', {}, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('strategySpec object is required')
    expect(validation.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'schema',
        path: 'strategySpec',
        field: 'strategySpec',
        suggestion: expect.stringContaining('JSON object'),
      }),
    ]))
  })

  it('validates custom strategy risk, sizing, and exit bounds', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      positionSizing: { type: 'fixed_fraction', value: 1.5 },
      risk: { maxLossPerTradePct: 2 },
      exit: {
        any: [
          { left: 'rsi5', op: '>', right: 70 },
          { type: 'stop_loss_pct', value: -1 },
          { type: 'chandelier_exit', value: 2 },
        ],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('positionSizing.value')
    expect(validation.errors.join('\n')).toContain('risk.maxLossPerTradePct')
    expect(validation.errors.join('\n')).toContain('stop_loss_pct value')
    expect(validation.errors.join('\n')).toContain('unsupported exit exit type "chandelier_exit"')
    expect(validation.unsupportedDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'exit_type',
        path: 'exit.type',
        field: 'type',
        value: 'chandelier_exit',
        candidateExitTypes: expect.arrayContaining(['stop_loss_pct', 'atr_stop_loss', 'time_stop_bars']),
        candidateExitCatalog: expect.arrayContaining([
          expect.objectContaining({ type: 'atr_stop_loss', valueUnit: 'atr_multiple' }),
        ]),
      }),
    ]))
    expect(validation.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'positionSizing',
        path: 'positionSizing.value',
        field: 'value',
        value: '1.5',
      }),
      expect.objectContaining({
        category: 'risk',
        path: 'risk.maxLossPerTradePct',
        field: 'maxLossPerTradePct',
        value: '2',
      }),
      expect.objectContaining({
        category: 'exit_value',
        path: 'exit.stop_loss_pct.value',
        field: 'value',
        value: '-1',
      }),
    ]))
    expect(validation.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'exit_type',
        repairAction: 'use_supported_exit_type',
        target: 'strategySpec.exit',
        patchHint: expect.objectContaining({
          operation: 'replace_exit_type',
          candidateExitTypes: expect.arrayContaining(['stop_loss_pct', 'atr_stop_loss']),
          candidateExitCatalog: expect.arrayContaining([
            expect.objectContaining({ type: 'time_stop_bars' }),
          ]),
        }),
      }),
    ]))
  })

  it('executes custom strategy trailing stop exits', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => trailingStopBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_trailing_stop_v1',
      dataRequirements: { minBars: 60, adjust: 'none' },
      indicators: [{ id: 'sma5', type: 'sma', params: { period: 5 } }],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ type: 'trailing_stop_pct', value: 10 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toContain('exit:trailing_stop_pct')

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.signals.stopExitCount).toBeGreaterThan(0)
    expect(backtest.recentTrades.at(-1).reason).toBe('trailing_stop_pct')
  })

  it('executes max drawdown stop exits in custom StrategySpec backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => trailingStopBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_max_drawdown_stop_v1',
      dataRequirements: { minBars: 40, adjust: 'none' },
      indicators: [{ id: 'sma5', type: 'sma', params: { period: 5 } }],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ type: 'max_drawdown_stop_pct', value: 10 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toContain('exit:max_drawdown_stop_pct')

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.signals.stopExitCount).toBeGreaterThan(0)
    expect(backtest.recentTrades.at(-1).reason).toBe('max_drawdown_stop_pct')
  })

  it('executes ATR stop exits in custom StrategySpec backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => trailingStopBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_atr_stop_v1',
      dataRequirements: { minBars: 40, adjust: 'none' },
      indicators: [{ id: 'atr2', type: 'atr', params: { period: 2 } }],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ type: 'atr_stop_loss', value: 1, period: 2 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toContain('exit:atr_stop_loss')

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.signals.stopExitCount).toBeGreaterThan(0)
    expect(backtest.recentTrades.at(-1).reason).toBe('atr_stop_loss')
  })

  it('executes time stop exits in custom StrategySpec backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_time_stop_v1',
      dataRequirements: { minBars: 40, adjust: 'none' },
      indicators: [{ id: 'sma5', type: 'sma', params: { period: 5 } }],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ type: 'time_stop_bars', value: 5 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toContain('exit:time_stop_bars')

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.signals.stopExitCount).toBeGreaterThan(0)
    expect(backtest.recentTrades.at(-1).reason).toBe('time_stop_bars')
  })

  it('executes volume and liquidity indicators in custom StrategySpec backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_volume_liquidity_indicators_v1',
      dataRequirements: { minBars: 60, adjust: 'none' },
      indicators: [
        { id: 'force13', type: 'force_index', params: { period: 13, smoothingPeriod: 3 } },
        { id: 'eom3', type: 'ease_of_movement', params: { period: 3, volumeDivisor: 1000000 } },
        { id: 'pvo', type: 'volume_oscillator_pct', params: { fastPeriod: 3, slowPeriod: 6 } },
        { id: 'vroc3', type: 'volume_rate_of_change_pct', params: { period: 3 } },
        { id: 'vpct5', type: 'volume_percentile', params: { period: 5 } },
        { id: 'vpt', type: 'volume_price_trend' },
        { id: 'pvi', type: 'positive_volume_index' },
        { id: 'nvi', type: 'negative_volume_index' },
      ],
      entry: {
        all: [
          { left: 'force13', op: '>', right: -999999999 },
          { left: 'eom3', op: '>', right: -999999999 },
          { left: 'pvo', op: '>', right: -999999999 },
          { left: 'vroc3', op: '>', right: -999999999 },
          { left: 'vpct5', op: '>=', right: 0 },
          { left: 'vpt', op: '>', right: -999999999 },
          { left: 'pvi', op: '>', right: 0 },
          { left: 'nvi', op: '>', right: 0 },
        ],
      },
      exit: { any: [{ type: 'time_stop_bars', value: 5 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toEqual(expect.arrayContaining([
      'indicator:force13:force_index',
      'indicator:eom3:ease_of_movement',
      'indicator:pvo:volume_oscillator_pct',
      'indicator:vroc3:volume_rate_of_change_pct',
      'indicator:vpct5:volume_percentile',
      'indicator:vpt:volume_price_trend',
      'indicator:pvi:positive_volume_index',
      'indicator:nvi:negative_volume_index',
    ]))

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.action).toBe('custom_strategy_backtest')
    expect(backtest.signals.entrySignalCount).toBeGreaterThan(0)
  })

  it('executes risk per trade position sizing in custom StrategySpec backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_risk_per_trade_v1',
      dataRequirements: { minBars: 40, adjust: 'none' },
      indicators: [{ id: 'sma5', type: 'sma', params: { period: 5 } }],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ type: 'time_stop_bars', value: 5 }] },
      positionSizing: {
        method: 'riskPerTrade',
        riskPerTradePct: 0.02,
        stopLossPct: 10,
        maxPositionPct: 0.5,
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toContain('positionSizing:risk_per_trade')
    expect(validation.spec.positionSizing).toMatchObject({
      type: 'risk_per_trade',
      riskPct: 0.02,
      stopLossPct: 10,
      maxPositionPct: 0.5,
    })

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.recentTrades[0].shares).toBe(100)
    expect(backtest.assumptions.positionSizing.type).toBe('risk_per_trade')
  })

  it('executes capped Kelly fraction position sizing in custom StrategySpec backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      id: 'custom_kelly_fraction_v1',
      dataRequirements: { minBars: 40, adjust: 'none' },
      indicators: [{ id: 'sma5', type: 'sma', params: { period: 5 } }],
      entry: { all: [{ left: 'close', op: '>', right: 0 }] },
      exit: { any: [{ type: 'time_stop_bars', value: 5 }] },
      positionSizing: {
        method: 'kellyFraction',
        fallbackFraction: 0.2,
        maxPositionPct: 0.3,
        minTrades: 2,
        kellyScale: 0.5,
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.accepted).toContain('positionSizing:kelly_fraction')
    expect(validation.spec.positionSizing).toMatchObject({
      type: 'kelly_fraction',
      initialFraction: 0.2,
      maxPositionPct: 0.3,
      minTrades: 2,
      kellyScale: 0.5,
    })

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.recentTrades[0].shares).toBe(100)
    expect(backtest.assumptions.positionSizing.type).toBe('kelly_fraction')
    expect(backtest.riskRewardEvidence).toMatchObject({ status: expect.any(String) })
  })

  it('normalizes close price rule references without adding synthetic periods', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      entry: {
        all: [
          { left: 'close14', op: '>', right: 'ema20' },
          { left: 'rsi14', op: '>', right: 50 },
        ],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))

    expect(validation.status).toBe('validated')
    expect(validation.spec.entry.all[0].left).toBe('close')
    expect(validation.accepted).toContain('entry:close:>')
    expect(validation.accepted.join('\n')).not.toContain('close1414')
  })

  it('reads back custom strategy run when the saved strategy has validation evidence only', async () => {
    const bars = customStrategyBars()
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => bars),
    }))

    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-custom-strategy-validated-only-'))
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = { ...customStrategySpec(), symbol: '600519' }

    const saved = JSON.parse(await service.readAction('custom_strategy_save', { strategySpec }, { basePath } as any, '', 120))
    expect(saved).toMatchObject({ action: 'custom_strategy_save', status: 'validated' })
    const readback = JSON.parse(await service.readAction(
      'custom_strategy_run',
      { strategyId: 'custom_rsi_volume_rebound_v1' },
      { basePath } as any,
      '',
      120,
    ))
    expect(readback).toMatchObject({
      action: 'custom_strategy_run',
      strategyId: 'custom_rsi_volume_rebound_v1',
      status: 'readback_only',
      runnable: false,
      savedStatus: 'validated',
    })
    expect(readback.lifecycleIssue).toEqual(expect.objectContaining({
      category: 'lifecycle',
      field: 'status',
      value: 'validated',
      suggestion: expect.stringContaining('backtested stock StrategySpec'),
    }))
    expect(readback.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'lifecycle', path: 'strategyId' }),
    ]))
    expect(readback.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        repairAction: 'repair_and_save_validated_strategy_spec',
        blocking: true,
      }),
    ]))
  })

  it('marks stale invalid saved strategies as non-runnable and returns readback instead of tool error', async () => {
    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-custom-strategy-invalid-saved-'))
    fs.mkdirSync(path.join(basePath, 'data'), { recursive: true })
    fs.writeFileSync(path.join(basePath, 'data', 'custom-strategies.json'), JSON.stringify([
      {
        strategyId: 'custom_invalid_price_ref_v1',
        status: 'backtested',
        updatedAt: '2026-07-07T00:00:00.000Z',
        strategySpec: {
          id: 'custom_invalid_price_ref_v1',
          name: 'Invalid saved strategy',
          market: 'cn',
          symbol: '600519',
          indicators: [
            { id: 'sma20', type: 'sma', source: 'close', params: { period: 20 } },
          ],
          entry: { all: [{ left: 'price14', op: 'crosses_above', right: 'sma20' }] },
          exit: { any: [{ type: 'stop_loss_pct', value: 5 }] },
          positionSizing: { type: 'fixed_fraction', value: 0.2 },
        },
        backtestEvidence: { action: 'custom_strategy_backtest', status: 'backtested' },
      },
    ]))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()

    const listed = JSON.parse(await service.readAction('custom_strategy_list', {}, { basePath } as any, '', 120))
    expect(listed.strategies[0]).toMatchObject({
      strategyId: 'custom_invalid_price_ref_v1',
      savedStatus: 'backtested',
      runnable: false,
      lifecycleStatus: 'invalid',
      lifecycleIssue: expect.objectContaining({ category: 'validation' }),
    })

    const readback = JSON.parse(await service.readAction(
      'custom_strategy_run',
      { strategyId: 'custom_invalid_price_ref_v1' },
      { basePath } as any,
      '600519',
      120,
    ))
    expect(readback).toMatchObject({
      action: 'custom_strategy_run',
      strategyId: 'custom_invalid_price_ref_v1',
      status: 'readback_only',
      runnable: false,
      savedStatus: 'backtested',
    })
    expect(readback.reason).toContain('price14')
    expect(readback.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'lifecycle' }),
    ]))
    expect(readback.lifecycleIssue.message).toContain('price14')
  })

  it('compares saved custom strategy lifecycle evidence without rerun', async () => {
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-custom-strategy-compare-'))
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const primary = { ...customStrategySpec(), symbol: '600519' }
    const secondary = {
      ...customStrategySpec(),
      id: 'custom_validation_only_v1',
      name: 'Validation-only comparison candidate',
      symbol: '000858',
    }

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec: primary }, { basePath } as any, '600519', 120))
    const savedPrimary = JSON.parse(await service.readAction('custom_strategy_save', { strategySpec: primary, evidence: backtest }, { basePath } as any, '', 120))
    expect(savedPrimary).toMatchObject({ strategyId: 'custom_rsi_volume_rebound_v1', status: 'backtested' })
    const savedSecondary = JSON.parse(await service.readAction('custom_strategy_save', { strategySpec: secondary }, { basePath } as any, '', 120))
    expect(savedSecondary).toMatchObject({ strategyId: 'custom_validation_only_v1', status: 'validated' })

    const compared = JSON.parse(await service.readAction('custom_strategy_compare', {}, { basePath } as any, '', 120))
    expect(compared).toMatchObject({ action: 'custom_strategy_compare', count: 2 })
    expect(compared.comparisonNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('saved artifact evidence only'),
    ]))
    expect(compared.strategies.map((row: any) => row.strategyId)).toEqual(expect.arrayContaining([
      'custom_rsi_volume_rebound_v1',
      'custom_validation_only_v1',
    ]))
    expect(compared.strategies.find((row: any) => row.strategyId === 'custom_rsi_volume_rebound_v1')).toMatchObject({
      status: 'backtested',
      runnable: true,
      strategyType: 'stock_strategy',
      metrics: expect.any(Object),
      dataCoverage: expect.any(Object),
    })
    expect(compared.bestBy.score).toMatchObject({ strategyId: 'custom_rsi_volume_rebound_v1' })

    const subset = JSON.parse(await service.readAction(
      'custom_strategy_compare',
      { strategyIds: ['custom_validation_only_v1', 'missing_strategy'] },
      { basePath } as any,
      '',
      120,
    ))
    expect(subset).toMatchObject({
      action: 'custom_strategy_compare',
      count: 1,
      missingStrategyIds: ['missing_strategy'],
    })
  })

  it('classifies compact fund observation evidence as observed and keeps fund code readback', async () => {
    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-custom-strategy-fund-observed-'))
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      name: 'fund observation',
      assetClass: 'fund',
      market: 'fund',
      fundCode: '110011',
      code: '110011',
      indicators: [{ id: 'fundDrawdown20', type: 'fund_drawdown', source: 'nav', params: { period: 20 } }],
      entry: { all: [{ left: 'fundDrawdown20', op: '>=', right: 5 }] },
      exit: { any: [{ left: 'fundDrawdown20', op: '>=', right: 15 }] },
    }

    const saved = JSON.parse(await service.readAction(
      'custom_strategy_save',
      { strategySpec, evidence: { signal: 'wait', fundDrawdown20: 8.4, source: 'local fund_nav' } },
      { basePath } as any,
      '',
      120,
    ))
    expect(saved).toMatchObject({ action: 'custom_strategy_save', status: 'observed' })

    const readback = JSON.parse(await service.readAction(
      'custom_strategy_run',
      { strategyId: saved.strategyId },
      { basePath } as any,
      '',
      120,
    ))
    expect(readback).toMatchObject({
      action: 'custom_strategy_run',
      status: 'readback_only',
      savedStatus: 'observed',
    })
    expect(readback.reason).toContain('not runnable')
    expect(readback.reason).not.toContain('code-unavailable')
  })

  it('reports no-entry signal evidence for custom strategy backtests', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      ...customStrategySpec(),
      entry: { all: [{ left: 'rsi5', op: '<', right: 0 }] },
    }

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest.signals).toMatchObject({
      entrySignalCount: 0,
      completedTradeCount: 0,
      noSignalReason: 'entry rules never triggered in the tested data window',
    })
  })

  it('accepts loose agent-authored custom strategy condition specs', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec: looseAgentStrategySpec() }, { basePath: '/tmp' } as any, '', 120))

    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated', version: 1 })
    expect(validation.spec.entry).toHaveProperty('all')
    expect(validation.spec.exit).toHaveProperty('any')

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec: looseAgentStrategySpec() }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested' })
  })

  it('treats agent stock observation arrays as indicators, not fund specs', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = p0StrategyObservationSpec()
    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))

    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.validationSummary.assetClass).toBe('stock')
    expect(validation.spec.market).toBe('cn')
    expect(validation.spec.indicators.map((indicator: { id: string }) => indicator.id)).toEqual(['sma10', 'sma30', 'rsi14'])
    expect(validation.spec.entry.all).toEqual(expect.arrayContaining([
      expect.objectContaining({ left: 'sma10', op: 'crosses_above', right: 'sma30' }),
    ]))
    expect(validation.spec.exit.any).toEqual(expect.arrayContaining([
      expect.objectContaining({ left: 'sma10', op: 'crosses_below', right: 'sma30' }),
    ]))

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '300059', 120))
    expect(backtest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested', code: '300059' })
  })

  it('accepts entryConditions and exitConditions custom strategy lists', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      name: '茅台RSI超跌放量策略',
      symbol: '600519.SH',
      entryConditions: [
        { indicator: 'rsi', period: 14, operator: '<', value: 35 },
        {
          indicator: 'volume',
          operator: '>',
          value: { indicator: 'volume_sma', period: 20, multiplier: 1.5 },
        },
      ],
      exitConditions: [
        { indicator: 'rsi', period: 14, operator: '>', value: 60 },
        { type: 'stop_loss_pct', value: 8 },
      ],
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))

    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.spec.entry).toHaveProperty('all')
    expect(validation.spec.exit).toHaveProperty('any')
    expect(validation.spec.entry.all.at(-1).right).toEqual({ mul: ['vol20', 1.5] })
  })

  it('normalizes legacy structured signals and exits into StrategySpec v1', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      name: '茅台RSI均值回归',
      type: 'stockTrading',
      market: 'cn',
      signals: {
        entry: [
          { indicator: 'rsi', period: 14, operator: '<', value: 35 },
          { indicator: 'price_change_pct', period: 1, operator: '>', value: 0 },
        ],
      },
      exits: {
        stop_loss_pct: 8,
        take_profit_pct: 12,
        trailing_stop_pct: 6,
      },
      positionSizing: 'fixed_fraction',
      fixedFraction: 0.3,
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))

    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.spec.indicators.map((indicator: { id: string }) => indicator.id)).toEqual(expect.arrayContaining(['rsi14', 'price_change_pct1']))
    expect(validation.spec.entry.all).toEqual(expect.arrayContaining([
      expect.objectContaining({ left: 'rsi14', op: '<', right: 35 }),
      expect.objectContaining({ left: 'price_change_pct1', op: '>', right: 0 }),
    ]))
    expect(validation.spec.exit.any).toEqual(expect.arrayContaining([
      { type: 'stop_loss_pct', value: 8 },
      { type: 'take_profit_pct', value: 12 },
      { type: 'trailing_stop_pct', value: 6 },
    ]))
    expect(validation.spec.positionSizing).toEqual({ type: 'fixed_fraction', value: 0.3 })
  })

  it('accepts stop loss objects inside exit or-lists', async () => {
    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      name: '茅台RSI超跌放量反弹策略',
      version: '1.0',
      indicators: {
        rsi14: { indicator: 'rsi', period: 14 },
        vol_sma20: { indicator: 'volume_sma', period: 20 },
      },
      entry: {
        and: [
          { indicator: 'rsi14', op: '<', value: 35 },
          { indicator: 'volume', op: '>', value: { indicator: 'vol_sma20', multiplier: 1.5 } },
        ],
      },
      exit: {
        or: [
          { indicator: 'rsi14', op: '>', value: 60 },
          { stop_loss_pct: 8 },
        ],
      },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))

    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
    expect(validation.spec.exit.any.at(-1)).toEqual({ type: 'stop_loss_pct', value: 8 })
    expect(validation.errors).toEqual([])
  })

  it('accepts object-style agent custom strategy operands', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      name: '茅台RSI放量反转策略',
      version: 'v1',
      entry: {
        all: [
          { left: { indicator: 'rsi', period: 14 }, op: '<', right: 35 },
          {
            left: { indicator: 'volume_sma', period: 20 },
            op: '>',
            right: { indicator: 'volume_sma', period: 20, factor: 1.5 },
          },
        ],
      },
      exit: {
        any: [
          { left: { indicator: 'rsi', period: 14 }, op: '>', right: 60 },
        ],
      },
      stop_loss_pct: 8,
      positionSizing: 'fixed_fraction',
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated', version: 1 })
    expect(validation.accepted.join('\n')).toContain('rsi14')
    expect(validation.accepted.join('\n')).toContain('volume')
    expect(validation.spec.entry.all.at(-1).right).toEqual({ mul: ['vol20', 1.5] })
    expect(validation.spec.positionSizing).toEqual({ type: 'fixed_fraction' })
    expect(validation.spec.exit.any.at(-1)).toEqual({ type: 'stop_loss_pct', value: 8 })

    const backtest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec }, { basePath: '/tmp' } as any, '600519', 120))
    expect(backtest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested' })
  })

  it('accepts valueExpression and reference custom strategy variants', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const specs = [
      {
        name: 'value expression strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume_sma',
              period: 20,
              operator: '>',
              valueExpression: 'volume_sma_20 * 1.5',
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'reference strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume_sma',
              period: 20,
              operator: '>',
              reference: { indicator: 'volume_sma', period: 20 },
              scale: 1.5,
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'function expression strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              expression: 'volume_sma(20) * 1.5',
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'raw mul strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              left: 'volume',
              operator: '>',
              right: { mul: ['vol20', 1.5] },
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'value mul strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              value: { mul: ['volume_sma20', 1.5] },
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'string expression strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              value: '1.5 * volume_sma',
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'value map strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              value: { indicator: 'volume_sma', period: 20, multiplier: 1.5 },
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'sibling multiplier strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              value: { indicator: 'volume_sma', period: 20 },
              multiplier: 1.5,
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'object expression strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              expression: {
                left: 'volume',
                operator: '>',
                right: { indicator: 'volume_sma', period: 20, multiplier: 1.5 },
              },
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
      {
        name: 'reference indicator strategy',
        version: 'v1',
        entry: {
          conditions: [
            { indicator: 'rsi', period: 14, operator: '<', value: 35 },
            {
              indicator: 'volume',
              operator: '>',
              referenceIndicator: 'volume_sma',
              referencePeriod: 20,
              multiplier: 1.5,
            },
          ],
        },
        exit: {
          conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
          stop_loss_pct: 8,
        },
      },
    ]

    for (const strategySpec of specs) {
      const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
      expect(validation).toMatchObject({ action: 'custom_strategy_validate', status: 'validated' })
      expect(validation.spec.entry.all.at(-1).right).toEqual({ mul: ['vol20', 1.5] })
      expect(validation.spec.exit).toHaveProperty('any')
    }
  })

  it('rejects custom strategy comparison rules without right values', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = {
      name: 'broken strategy',
      version: 'v1',
      indicators: [{ id: 'rsi14', type: 'rsi', params: { period: 14 } }],
      entry: { all: [{ left: 'rsi14', op: '<', right: null }] },
      exit: { any: [{ left: 'rsi14', op: '>', right: 60 }] },
    }

    const validation = JSON.parse(await service.readAction('custom_strategy_validate', { strategySpec }, { basePath: '/tmp' } as any, '', 120))
    expect(validation.status).toBe('rejected')
    expect(validation.errors.join('\n')).toContain('has no executable right-hand value')
    expect(validation.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'rule_shape',
        path: 'entry.right',
        field: 'right',
        repairAction: 'fix_rule_shape',
        patchHint: expect.objectContaining({
          operation: 'set_rule_right',
          allowedRightKinds: expect.arrayContaining(['number', 'declared_indicator', 'builtin_series']),
          declaredRuleRefs: expect.arrayContaining(['rsi14']),
          valueExamples: expect.arrayContaining([50]),
        }),
      }),
    ]))
  })

  it('custom strategy backtest can use embedded strategySpec symbol', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    const getKline = vi.fn(async () => customStrategyBars())
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const strategySpec = { ...customStrategySpec(), symbol: '600519' }
    const backtest = JSON.parse(await service.readAction(
      'custom_strategy_backtest',
      { strategySpec, outOfSampleRatio: 0.5, walkForwardFolds: 3 },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(backtest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested', code: '600519' })
    expect(backtest.outOfSample).toMatchObject({
      mode: 'chronological_holdout',
      status: 'evaluated',
    })
    expect(backtest.outOfSample.train.metrics).toBeTruthy()
    expect(backtest.outOfSample.test.metrics).toBeTruthy()
    expect(backtest.walkForward).toMatchObject({
      mode: 'chronological_walk_forward',
      status: 'evaluated',
      effectiveFolds: 3,
    })
    expect(backtest.walkForward.folds).toHaveLength(3)
    expect(backtest.walkForward.stability.averageReturnPct).toEqual(expect.any(Number))
    expect(getKline).toHaveBeenCalledWith('600519', 'daily', 'qfq', undefined, 300)

    const universeSpec = { ...customStrategySpec(), universe: ['600519.SH'] }
    const universeBacktest = JSON.parse(await service.readAction('custom_strategy_backtest', { strategySpec: universeSpec }, { basePath: '/tmp' } as any, '', 120))
    expect(universeBacktest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested', code: '600519.SH' })
    expect(getKline).toHaveBeenCalledWith('600519', 'daily', 'qfq', undefined, 300)

    const inputSymbolBacktest = JSON.parse(await service.readAction(
      'custom_strategy_backtest',
      { strategySpec: customStrategySpec(), symbols: ['000858'] },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(inputSymbolBacktest).toMatchObject({ action: 'custom_strategy_backtest', status: 'backtested', code: '000858' })
    expect(getKline).toHaveBeenCalledWith('000858', 'daily', 'qfq', undefined, 300)
  })

  it('custom strategy rank returns governed portfolio evidence', async () => {
    const queryKline = vi.fn((_ctx: unknown, symbol: string) => relativeStrengthRows(symbol))
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = queryKline
      },
    }))
    const getKline = vi.fn()
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = JSON.parse(await service.readAction(
      'custom_strategy_rank',
      {
        strategySpec: customStrategySpec(),
        symbols: ['600519', '000858', '300750'],
        topN: 2,
        rankingMetric: 'relative_strength_pct',
        rebalanceInterval: 'monthly',
        maxPositionWeight: 0.4,
        detail: 'full',
      },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(output).toMatchObject({ action: 'custom_strategy_rank', status: 'ranked', rankedCount: 3 })
    expect(output.ranked).toHaveLength(3)
    expect(output.ranked[0].symbol).toBe('300750')
    expect(output.ranked[0].relativeStrength).toMatchObject({
      mode: 'candidate_return_rank',
      percentile: 100,
    })
    expect(typeof output.ranked[0].relativeStrength.returnPct).toBe('number')
    expect(output.portfolioEvidence).toMatchObject({ mode: 'equal_weight_selected_metrics', selectedCount: 2 })

    expect(output.portfolioEvidence.assumptions.rankingMetric).toBe('relative_strength_pct')
    expect(output.portfolioEvidence.assumptions.rebalanceInterval).toBe('monthly')
    expect(output.portfolioEvidence.assumptions.maxPositionWeight).toBe(0.4)
    expect(output.portfolioEvidence.correlationEvidence).toMatchObject({
      mode: 'close_return_pairwise_correlation',
      pairCount: 1,
    })
    expect(typeof output.portfolioEvidence.correlationEvidence.averagePairwiseCorrelation).toBe('number')
    expect(output.portfolioEvidence.portfolioRiskEvidence).toMatchObject({
      mode: 'equal_weight_return_series',
    })
    expect(typeof output.portfolioEvidence.portfolioRiskEvidence.portfolioReturnPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioRiskEvidence.portfolioMaxDrawdownPct).toBe('number')
    expect(output.portfolioEvidence.portfolioReturnQualityEvidence).toMatchObject({
      mode: 'portfolio_return_quality_v1',
    })
    expect(output.portfolioEvidence.portfolioReturnQualityEvidence.status).not.toBe('insufficient_data')
    expect(typeof output.portfolioEvidence.portfolioReturnQualityEvidence.annualizedReturnPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioReturnQualityEvidence.annualizedVolatilityPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioReturnQualityEvidence.positivePeriodCount).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioReturnQualityEvidence.negativePeriodCount).toBe('number')
    expect(output.portfolioEvidence.portfolioReturnQualityEvidence.tradeBoundary).toContain('analytical only')
    expect(output.portfolioEvidence.concentrationEvidence).toMatchObject({
      mode: 'portfolio_concentration_v1',
      selectedCount: 2,
      targetWeight: 0.4,
    })
    expect(typeof output.portfolioEvidence.concentrationEvidence.effectivePositionCount).toBe('number')
    expect(typeof output.portfolioEvidence.concentrationEvidence.herfindahlIndex).toBe('number')
    expect(output.portfolioEvidence.concentrationEvidence.tradeBoundary).toContain('does not authorize')
    expect(output.portfolioEvidence.portfolioStabilityEvidence).toMatchObject({
      mode: 'portfolio_cross_window_stability_v1',
    })
    expect(output.portfolioEvidence.portfolioStabilityEvidence.status).not.toBe('insufficient_data')
    expect(typeof output.portfolioEvidence.portfolioStabilityEvidence.bars).toBe('number')
    expect(output.portfolioEvidence.portfolioStabilityEvidence.windows).toHaveLength(3)
    expect(typeof output.portfolioEvidence.portfolioStabilityEvidence.returnDegradationPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioStabilityEvidence.drawdownIncreasePct).toBe('number')
    expect(output.portfolioEvidence.portfolioStabilityEvidence.tradeBoundary).toContain('evidence-only')
    expect(output.portfolioEvidence.portfolioRebalanceSimulation).toMatchObject({
      mode: 'portfolio_rebalance_simulation_v1',
      status: 'evidence_only',
      rebalanceInterval: 'monthly',
      intervalBars: 21,
    })
    expect(output.portfolioEvidence.portfolioRebalanceSimulation.selectedSymbols).toHaveLength(2)
    expect(typeof output.portfolioEvidence.portfolioRebalanceSimulation.rebalanceCount).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioRebalanceSimulation.averageTurnoverPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioRebalanceSimulation.grossSimulatedReturnPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioRebalanceSimulation.estimatedTransactionCostPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioRebalanceSimulation.simulatedReturnPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioRebalanceSimulation.simulatedMaxDrawdownPct).toBe('number')
    expect(output.portfolioEvidence.portfolioRebalanceSimulation.transactionCostEvidence).toMatchObject({
      mode: 'portfolio_turnover_cost_estimate_v1',
      costModel: expect.objectContaining({ source: 'strategySpec.cost' }),
    })
    expect(output.portfolioEvidence.portfolioRebalanceSimulation.transactionCostEvidence.netReturnPct)
      .toBe(output.portfolioEvidence.portfolioRebalanceSimulation.simulatedReturnPct)
    expect(output.portfolioEvidence.portfolioRebalanceSimulation.tradeBoundary).toContain('evidence-only')
    expect(output.portfolioEvidence.portfolioBacktestEvidence).toMatchObject({
      mode: 'equal_weight_selected_portfolio_backtest',
      status: 'evidence_only',
      rebalanceInterval: 'monthly',
    })
    expect(output.portfolioEvidence.portfolioBacktestEvidence.selectedSymbols).toHaveLength(2)
    expect(typeof output.portfolioEvidence.portfolioBacktestEvidence.portfolioReturnPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioBacktestEvidence.portfolioMaxDrawdownPct).toBe('number')
    expect(output.portfolioEvidence.portfolioBacktestEvidence.portfolioReturnQualityEvidence)
      .toEqual(output.portfolioEvidence.portfolioReturnQualityEvidence)
    expect(output.portfolioEvidence.portfolioBacktestEvidence.transactionCostEvidence).toMatchObject({
      mode: 'portfolio_static_allocation_cost_estimate_v1',
    })
    expect(typeof output.portfolioEvidence.portfolioBacktestEvidence.transactionCostEvidence.estimatedInitialCostPct).toBe('number')
    expect(output.portfolioEvidence.portfolioBacktestEvidence.tradeBoundary).toContain('Evidence only')
    expect(output.portfolioEvidence.portfolioScoringEvidence).toMatchObject({
      mode: 'portfolio_risk_adjusted_scoring_v1',
      scoringMethod: 'return_minus_drawdown_penalty',
      positionCapStatus: 'within_cap',
    })
    expect(output.portfolioEvidence.portfolioScoringEvidence.status).not.toBe('insufficient_data')
    expect(typeof output.portfolioEvidence.portfolioScoringEvidence.riskAdjustedScore).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioScoringEvidence.tradeCount).toBe('number')
    expect(output.portfolioEvidence.portfolioScoringEvidence.tradeBoundary).toContain('analytical only')
    expect(output.portfolioEvidence.portfolioDrawdownBudgetEvidence).toMatchObject({
      mode: 'portfolio_drawdown_budget_v1',
    })
    expect(['within_budget', 'violated', 'insufficient_data'])
      .toContain(output.portfolioEvidence.portfolioDrawdownBudgetEvidence.status)
    expect(typeof output.portfolioEvidence.portfolioDrawdownBudgetEvidence.allowedDrawdownPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioDrawdownBudgetEvidence.observedDrawdownPct).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioDrawdownBudgetEvidence.excessDrawdownPct).toBe('number')
    expect(output.portfolioEvidence.portfolioDrawdownBudgetEvidence.tradeBoundary).toContain('does not authorize')
    expect(output.portfolioEvidence.portfolioValidation).toMatchObject({
      mode: 'portfolio_rank_validation_v1',
      status: 'accepted_with_warnings',
      requestedCount: 3,
      evaluatedCount: 3,
      rankedCount: 3,
      failedCount: 0,
      selectedCount: 2,
      topN: 2,
      rankingMetric: 'relative_strength_pct',
      rebalanceInterval: 'monthly',
      concentrationStatus: output.portfolioEvidence.concentrationEvidence.status,
      drawdownBudgetStatus: output.portfolioEvidence.portfolioDrawdownBudgetEvidence.status,
    })
    expect(output.portfolioEvidence.portfolioValidation.drawdownBudgetEvidence)
      .toEqual(output.portfolioEvidence.portfolioDrawdownBudgetEvidence)
    expect(output.portfolioEvidence.portfolioValidation.tradeBoundary).toContain('evidence-only')
    expect(output.portfolioEvidence.portfolioValidation.dataCoverage).toMatchObject({
      mode: 'selected_symbol_coverage',
    })
    expect(output.portfolioEvidence.portfolioValidation.dataCoverage.symbols).toHaveLength(2)
    expect(typeof output.portfolioEvidence.portfolioValidation.dataCoverage.minBars).toBe('number')
    expect(typeof output.portfolioEvidence.portfolioValidation.dataCoverage.maxBars).toBe('number')
    expect(output.portfolioEvidence.aggregateMetrics.selectedSymbols).toHaveLength(2)
    expect(typeof output.portfolioEvidence.aggregateMetrics.expectedReturnPct).toBe('number')
    expect(typeof output.portfolioEvidence.aggregateMetrics.worstSingleDrawdownPct).toBe('number')
    expect(typeof output.portfolioEvidence.aggregateMetrics.portfolioMaxDrawdownPct).toBe('number')
    expect(output.portfolioEvidence.selectionEvidence).toMatchObject({
      mode: 'portfolio_rank_selection_v1',
      rankingMetric: 'relative_strength_pct',
      selectedCount: 2,
      targetWeight: 0.4,
    })
    expect(output.portfolioEvidence.selectionEvidence.selectedSymbols).toHaveLength(2)
    expect(output.portfolioEvidence.selectionEvidence.tradeBoundary).toContain('does not authorize')
    expect(output.portfolioEvidence.positionContributionEvidence).toMatchObject({
      mode: 'position_contribution_evidence_v1',
      targetWeight: 0.4,
      selectedCount: 2,
    })
    expect(output.portfolioEvidence.positionContributionEvidence.positions).toHaveLength(2)
    expect(output.portfolioEvidence.positionContributionEvidence.positions[0]).toMatchObject({
      symbol: '300750',
      rankingMetric: 'relative_strength_pct',
      relativeStrengthPercentile: 100,
    })
    expect(output.portfolioEvidence.positionContributionEvidence.positions[0].selectionEvidence.selectedForDraft).toBe(true)
    expect(output.portfolioEvidence.positionContributionEvidence.positions[0].weightEvidence.targetWeight).toBe(0.4)
    expect(typeof output.portfolioEvidence.positionContributionEvidence.positions[0].weightedReturnContributionPct).toBe('number')
    expect(typeof output.portfolioEvidence.positionContributionEvidence.positions[0].weightedDrawdownContributionPct).toBe('number')
    expect(output.portfolioEvidence.positionContributionEvidence.positions[0].dataCoverage.sufficient).toBe(true)
    expect(output.portfolioEvidence.positionContributionEvidence.tradeBoundary).toContain('does not authorize')
    expect(output.rebalanceDraft.aggregateMetrics).toEqual(output.portfolioEvidence.aggregateMetrics)
    expect(output.rebalanceDraft.correlationEvidence).toEqual(output.portfolioEvidence.correlationEvidence)
    expect(output.rebalanceDraft.portfolioRiskEvidence).toEqual(output.portfolioEvidence.portfolioRiskEvidence)
    expect(output.rebalanceDraft.portfolioReturnQualityEvidence).toEqual(output.portfolioEvidence.portfolioReturnQualityEvidence)
    expect(output.rebalanceDraft.concentrationEvidence).toEqual(output.portfolioEvidence.concentrationEvidence)
    expect(output.rebalanceDraft.portfolioStabilityEvidence).toEqual(output.portfolioEvidence.portfolioStabilityEvidence)
    expect(output.rebalanceDraft.portfolioRebalanceSimulation).toEqual(output.portfolioEvidence.portfolioRebalanceSimulation)
    expect(output.rebalanceDraft.portfolioBacktestEvidence).toEqual(output.portfolioEvidence.portfolioBacktestEvidence)
    expect(output.rebalanceDraft.portfolioScoringEvidence).toEqual(output.portfolioEvidence.portfolioScoringEvidence)
    expect(output.rebalanceDraft.portfolioDrawdownBudgetEvidence)
      .toEqual(output.portfolioEvidence.portfolioDrawdownBudgetEvidence)
    expect(output.rebalanceDraft.portfolioValidation).toEqual(output.portfolioEvidence.portfolioValidation)
    expect(output.rebalanceDraft.selectionEvidence).toEqual(output.portfolioEvidence.selectionEvidence)
    expect(output.rebalanceDraft.positionContributionEvidence).toEqual(output.portfolioEvidence.positionContributionEvidence)
    expect(output.rebalanceDraft.positions).toHaveLength(2)
    expect(output.rebalanceDraft.rebalanceInterval).toBe('monthly')
    expect(output.rebalanceDraft.maxPositionWeight).toBe(0.4)
    expect(output.rebalanceDraft.positions[0].targetWeight).toBe(0.4)
    expect(output.rebalanceDraft.positions[0].weightCapped).toBe(true)
    expect(output.rebalanceDraft.positions[0].selectionEvidence.selectionRule).toContain('rank <= topN')
    expect(output.rebalanceDraft.positions[0].weightEvidence.reason).toContain('equal weight')
    expect(output.rebalanceDraft.positions[0].contributionEvidence.weightedReturnContributionPct)
      .toBe(output.portfolioEvidence.positionContributionEvidence.positions[0].weightedReturnContributionPct)
    expect(output.rebalanceDraft.tradeBoundary).toContain('Do not place')
    expect(output.portfolioValidation).toEqual(output.portfolioEvidence.portfolioValidation)
    expect(output.portfolioBacktestEvidence).toEqual(output.portfolioEvidence.portfolioBacktestEvidence)
    expect(output.portfolioScoringEvidence).toEqual(output.portfolioEvidence.portfolioScoringEvidence)
    expect(output.portfolioDrawdownBudgetEvidence).toEqual(output.portfolioEvidence.portfolioDrawdownBudgetEvidence)
    expect(output.portfolioReturnQualityEvidence).toEqual(output.portfolioEvidence.portfolioReturnQualityEvidence)
    expect(output.concentrationEvidence).toEqual(output.portfolioEvidence.concentrationEvidence)
    expect(output.portfolioStabilityEvidence).toEqual(output.portfolioEvidence.portfolioStabilityEvidence)
    expect(output.portfolioRebalanceSimulation).toEqual(output.portfolioEvidence.portfolioRebalanceSimulation)
    expect(output.validationSummary).toEqual(expect.any(Object))
    expect(output.validationIssues).toEqual(expect.any(Array))
    expect(output.unsupportedDetails).toEqual(expect.any(Array))
    expect(output.dataRequirements).toEqual(expect.any(Object))
    expect(output.ranked[0].benchmarkEvidence).toEqual(expect.any(Object))
    expect(output.ranked[0].riskEvidence).toEqual(expect.any(Object))
    expect(output.ranked[0].selectionEvidence).toEqual(expect.any(Object))
    expect(output.ranked[0].weightEvidence).toEqual(expect.any(Object))
    expect(output.ranked[0].dataCoverage).toEqual(expect.any(Object))
    expect(output.ranked[0].assumptions).toEqual(expect.any(Object))
    expect(queryKline).toHaveBeenCalledTimes(3)
    expect(getKline).not.toHaveBeenCalled()

    const compactRank = JSON.parse(await service.readAction(
      'custom_strategy_rank',
      {
        strategySpec: customStrategySpec(),
        symbols: ['600519', '000858', '300750'],
        topN: 2,
        rankingMetric: 'relative_strength_pct',
        rebalanceInterval: 'monthly',
        maxPositionWeight: 0.4,
      },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))
    expect(compactRank.monitorAction).toMatchObject({
      tool: 'MonitorCreate',
      template: 'portfolio_rebalance_monitor',
      strategyId: compactRank.strategyId,
      readbackAction: { tool: 'MonitorList', strategyId: compactRank.strategyId },
    })
    expect(compactRank.monitorAction.boundary).toContain('Use MonitorCreate(template:"portfolio_rebalance_monitor")')
    expect(compactRank.monitorAction.boundary).toContain('Do not write raw monitor script')

    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-ranked-strategy-'))
    const saved = JSON.parse(await service.readAction(
      'custom_strategy_save',
      { strategySpec: customStrategySpec(), evidence: output },
      { basePath } as any,
      '',
      120,
    ))
    expect(saved).toMatchObject({ action: 'custom_strategy_save', status: 'ranked' })
    expect(saved.dataAndAssumptionSummary.portfolioEvidence).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.rebalanceDraft).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.portfolioValidation).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.portfolioScoringEvidence).toEqual(output.portfolioEvidence.portfolioScoringEvidence)
    expect(saved.dataAndAssumptionSummary.portfolioDrawdownBudgetEvidence)
      .toEqual(output.portfolioEvidence.portfolioDrawdownBudgetEvidence)
    expect(saved.dataAndAssumptionSummary.portfolioReturnQualityEvidence).toEqual(output.portfolioEvidence.portfolioReturnQualityEvidence)
    expect(saved.dataAndAssumptionSummary.concentrationEvidence).toEqual(output.portfolioEvidence.concentrationEvidence)
    expect(saved.dataAndAssumptionSummary.candidateFailureEvidence).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.rankedRowsEvidence[0].benchmarkEvidence).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.rankedRowsEvidence[0].selectionEvidence).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.rankedRowsEvidence[0].weightEvidence).toEqual(expect.any(Object))
    expect(saved.dataAndAssumptionSummary.rankedRowsEvidence[0].dataCoverage).toEqual(expect.any(Object))

    const rerankedByStrategyId = JSON.parse(await service.readAction(
      'custom_strategy_rank',
      {
        strategyId: saved.strategyId,
        symbols: ['600519', '000858', '300750'],
        topN: 2,
        rankingMetric: 'relative_strength_pct',
        rebalanceInterval: 'monthly',
        detail: 'full',
      },
      { basePath } as any,
      '',
      120,
    ))
    expect(rerankedByStrategyId).toMatchObject({
      action: 'custom_strategy_rank',
      status: 'ranked',
      rankedCount: 3,
    })
    expect(rerankedByStrategyId.portfolioEvidence).toMatchObject({
      mode: 'equal_weight_selected_metrics',
    })

    const listed = JSON.parse(await service.readAction(
      'custom_strategy_list',
      { detail: 'full', strategyIds: [saved.strategyId] },
      { basePath } as any,
      '',
      120,
    ))
    expect(listed.strategies[0].dataAndAssumptionSummary.portfolioReturnQualityEvidence)
      .toEqual(output.portfolioEvidence.portfolioReturnQualityEvidence)
    expect(listed.strategies[0].dataAndAssumptionSummary.portfolioScoringEvidence)
      .toEqual(output.portfolioEvidence.portfolioScoringEvidence)
    expect(listed.strategies[0].dataAndAssumptionSummary.portfolioDrawdownBudgetEvidence)
      .toEqual(output.portfolioEvidence.portfolioDrawdownBudgetEvidence)
    expect(listed.strategies[0].dataAndAssumptionSummary.concentrationEvidence)
      .toEqual(output.portfolioEvidence.concentrationEvidence)

    const savedRead = JSON.parse(await service.readAction(
      'custom_strategy_read',
      { strategyId: saved.strategyId },
      { basePath } as any,
      '',
      120,
    ))
    expect(savedRead).toMatchObject({
      action: 'custom_strategy_read',
      strategyId: saved.strategyId,
      runnable: false,
      readbackMode: 'portfolio_rank_readback',
      evidenceMode: 'portfolio_rank_evidence',
      monitorAction: {
        tool: 'MonitorCreate',
        template: 'portfolio_rebalance_monitor',
        strategyId: saved.strategyId,
        readbackAction: { tool: 'MonitorList', strategyId: saved.strategyId },
      },
    })
    expect(savedRead.monitorAction.boundary).toContain('Review-only portfolio rebalance monitor')
    expect(savedRead.monitorAction.boundary).toContain('must not create per-symbol strategy_signal monitors')
    expect(savedRead.portfolioEvidence).toEqual(expect.any(Object))
    expect(savedRead.rebalanceDraft).toEqual(expect.any(Object))

    const compared = JSON.parse(await service.readAction(
      'custom_strategy_compare',
      {},
      { basePath } as any,
      '',
      120,
    ))
    const comparedRow = compared.strategies.find((row: any) => row.strategyId === saved.strategyId)
    expect(comparedRow.portfolioReturnQualityEvidence.annualizedReturnPct)
      .toBe(output.portfolioEvidence.portfolioReturnQualityEvidence.annualizedReturnPct)
    expect(comparedRow.portfolioReturnQualityEvidence.sharpeRatio)
      .toBe(output.portfolioEvidence.portfolioReturnQualityEvidence.sharpeRatio)
    expect(comparedRow.portfolioScoringEvidence.riskAdjustedScore)
      .toBe(output.portfolioEvidence.portfolioScoringEvidence.riskAdjustedScore)
    expect(comparedRow.portfolioScoringEvidence.positionCapStatus).toBe('within_cap')
    expect(comparedRow.portfolioDrawdownBudgetEvidence.status)
      .toBe(output.portfolioEvidence.portfolioDrawdownBudgetEvidence.status)
    expect(comparedRow.portfolioDrawdownBudgetEvidence.observedDrawdownPct)
      .toBe(output.portfolioEvidence.portfolioDrawdownBudgetEvidence.observedDrawdownPct)
    expect(comparedRow.concentrationEvidence.effectivePositionCount)
      .toBe(output.portfolioEvidence.concentrationEvidence.effectivePositionCount)
    expect(comparedRow.concentrationEvidence.herfindahlIndex)
      .toBe(output.portfolioEvidence.concentrationEvidence.herfindahlIndex)

    const readback = JSON.parse(await service.readAction(
      'custom_strategy_run',
      { strategyId: saved.strategyId },
      { basePath } as any,
      '',
      120,
    ))
    expect(readback).toMatchObject({
      status: 'readback_only',
      savedStatus: 'ranked',
      runnable: false,
      readbackMode: 'portfolio_rank_readback',
      evidenceMode: 'portfolio_rank_evidence',
    })
    expect(readback.portfolioEvidence).toEqual(expect.any(Object))
    expect(readback.rebalanceDraft).toEqual(expect.any(Object))
    expect(readback.portfolioValidation).toEqual(expect.any(Object))
    expect(readback.portfolioBacktestEvidence).toEqual(expect.any(Object))
    expect(readback.portfolioScoringEvidence).toEqual(output.portfolioEvidence.portfolioScoringEvidence)
    expect(readback.portfolioDrawdownBudgetEvidence)
      .toEqual(output.portfolioEvidence.portfolioDrawdownBudgetEvidence)
    expect(readback.portfolioReturnQualityEvidence).toEqual(output.portfolioEvidence.portfolioReturnQualityEvidence)
    expect(readback.portfolioStabilityEvidence).toEqual(expect.any(Object))
    expect(readback.portfolioRebalanceSimulation).toEqual(expect.any(Object))
    expect(readback.concentrationEvidence).toEqual(output.portfolioEvidence.concentrationEvidence)
    expect(readback.candidateFailureEvidence).toEqual(expect.any(Object))
    expect(readback.rankedRowsEvidence).toEqual(expect.any(Array))
    expect(readback.selectedSymbols).toHaveLength(2)
    expect(readback.portfolioNextActions).toContain('create_monitor')
    expect(readback.portfolioNextActions).toContain('request_trade_preparation_after_confirmation')
    expect(readback.monitorAction).toMatchObject({
      tool: 'MonitorCreate',
      template: 'portfolio_rebalance_monitor',
      strategyId: saved.strategyId,
      readbackAction: { tool: 'MonitorList', strategyId: saved.strategyId },
    })
    expect(readback.tradeBoundary).toContain('no simulated or real orders')
  })

  it('custom strategy rank excludes insufficient-data candidates from executable ranked rows', async () => {
    const queryKline = vi.fn((_ctx: unknown, symbol: string) =>
      symbol === '300059'
        ? relativeStrengthRows(symbol).slice(0, 33)
        : relativeStrengthRows(symbol),
    )
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = queryKline
      },
    }))
    const getKline = vi.fn(async (symbol: string) =>
      symbol === '300059'
        ? relativeStrengthRows(symbol).slice(0, 33)
        : relativeStrengthRows(symbol),
    )
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline,
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = JSON.parse(await service.readAction(
      'custom_strategy_rank',
      {
        strategySpec: customStrategySpec(),
        symbols: ['600519', '000858', '300059'],
        topN: 3,
      },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(output).toMatchObject({ action: 'custom_strategy_rank', status: 'ranked', rankedCount: 2, failedCount: 1 })
    expect(output.ranked.map((row: any) => row.symbol)).not.toContain('300059')
    expect(output.excluded).toHaveLength(1)
    expect(output.excluded[0]).toMatchObject({ symbol: '300059', status: 'failed' })
    expect(output.excluded[0].error).toContain('insufficient data')
    expect(output.candidateFailureEvidence).toMatchObject({
      mode: 'candidate_failure_evidence',
      failedCount: 1,
    })
    expect(output.candidateFailureEvidence.nextAction).toContain('rerun only after')
    expect(output.candidateFailureEvidence.failures[0]).toMatchObject({
      symbol: '300059',
      status: 'failed',
    })
    expect(output.candidateFailureEvidence.failures[0].error).toContain('insufficient data')
    expect(output.allCandidates).toHaveLength(3)
  })

  it('custom strategy rank applies minScore as structured portfolio constraint', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn((_ctx: unknown, symbol: string) => relativeStrengthRows(symbol))
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async (_symbol: string) => relativeStrengthRows(_symbol)),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = JSON.parse(await service.readAction(
      'custom_strategy_rank',
      {
        strategySpec: customStrategySpec(),
        symbols: ['600519', '000858', '300750'],
        topN: 2,
        rankingMetric: 'relative_strength_pct',
        minScore: 9999,
      },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(output).toMatchObject({ action: 'custom_strategy_rank', status: 'no_ranked_symbols', rankedCount: 3 })
    expect(output.ranked).toHaveLength(3)
    expect(output.ranked[0].selectionEvidence.exclusionReason).toBe('score below minScore threshold')
    expect(output.portfolioEvidence.selectionEvidence).toMatchObject({
      minScore: 9999,
      eligibleCount: 0,
      selectedCount: 0,
    })
    expect(output.portfolioEvidence.portfolioValidation).toMatchObject({
      status: 'rejected',
      minScore: 9999,
      eligibleCount: 0,
    })
    expect(output.portfolioEvidence.portfolioValidation.warnings)
      .toContain('Score threshold excluded 3 ranked candidate(s) from the rebalance draft.')
    expect(output.rebalanceDraft.positions).toHaveLength(0)
  })

  it('custom strategy rank applies maxPairwiseCorrelation as structured portfolio constraint', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn((_ctx: unknown, symbol: string) => relativeStrengthRows(symbol))
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async (_symbol: string) => relativeStrengthRows(_symbol)),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    const output = JSON.parse(await service.readAction(
      'custom_strategy_rank',
      {
        strategySpec: customStrategySpec(),
        symbols: ['600519', '000858', '300750'],
        topN: 3,
        rankingMetric: 'relative_strength_pct',
        maxPairwiseCorrelation: 0.5,
      },
      { basePath: '/tmp' } as any,
      '',
      120,
    ))

    expect(output).toMatchObject({ action: 'custom_strategy_rank', status: 'ranked', rankedCount: 3 })
    expect(output.portfolioEvidence.selectionEvidence).toMatchObject({
      maxPairwiseCorrelation: 0.5,
      selectedCount: 1,
      correlationEligibleCount: 1,
    })
    expect(output.portfolioEvidence.selectionEvidence.correlationSkipped).toHaveLength(2)
    const skipped = output.ranked.find((row: any) =>
      row.selectionEvidence.exclusionReason === 'pairwise correlation above maxPairwiseCorrelation')
    expect(skipped.selectionEvidence.selectedForDraft).toBe(false)
    expect(skipped.selectionEvidence.correlationConstraintEvidence).toMatchObject({
      maxPairwiseCorrelation: 0.5,
    })
    expect(output.portfolioEvidence.portfolioValidation).toMatchObject({
      maxPairwiseCorrelation: 0.5,
      correlationEligibleCount: 1,
    })
    expect(output.portfolioEvidence.portfolioValidation.warnings)
      .toContain('Pairwise correlation cap excluded 2 eligible candidate(s) from the rebalance draft.')
    expect(output.rebalanceDraft.positions).toHaveLength(1)
  })

  it('custom strategy rank rejects fund StrategySpec boundary', async () => {
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        queryKline = vi.fn(() => [])
      },
    }))
    vi.doMock('../../src/agent/data/data-manager', () => ({
      getKline: vi.fn(async () => customStrategyBars()),
    }))

    const { BacktestMarketDataService } = await import('../../src/domain/market/services/backtest-market-data-service')
    const service = new BacktestMarketDataService()
    await expect(
      service.readAction(
        'custom_strategy_rank',
        { strategySpec: fundStrategySpec(), symbols: ['110011', '000009'] },
        { basePath: '/tmp' } as any,
        '',
        120,
      ),
    ).rejects.toThrow('stock StrategySpec only')
  })
})

function customStrategySpec() {
  return {
    id: 'custom_rsi_volume_rebound_v1',
    name: 'RSI volume rebound',
    version: 1,
    dataRequirements: { minBars: 40, adjust: 'none' },
    indicators: [
      { id: 'rsi5', type: 'rsi', params: { period: 5 } },
      { id: 'vol5', type: 'volume_sma', params: { period: 5 } },
    ],
    entry: {
      all: [
        { left: 'rsi5', op: '<', right: 65 },
        { left: 'volume', op: '>', right: { mul: ['vol5', 0.9] } },
      ],
    },
    exit: {
      any: [
        { left: 'rsi5', op: '>', right: 70 },
        { type: 'stop_loss_pct', value: 8 },
      ],
    },
    positionSizing: { type: 'fixed_fraction', value: 0.5 },
    cost: { commissionPct: 0.1, slippagePct: 0.05 },
  }
}

function fundStrategySpec() {
  return {
    id: 'fund_nav_observation_v1',
    name: '基金净值趋势定投观察',
    version: 1,
    assetClass: 'fund',
    market: 'fund',
    fundType: 'ordinary',
    dataRequirements: {
      dataClass: 'ordinary_fund_nav',
      requiredFields: ['nav', 'date'],
      minBars: 60,
    },
    indicators: [
      { id: 'navTrend', type: 'nav_trend', params: { period: 20 } },
      { id: 'drawdown', type: 'fund_drawdown', params: { period: 60 } },
      { id: 'maxDrawdown', type: 'fund_rolling_max_drawdown', params: { period: 60 } },
      { id: 'averageDrawdown', type: 'fund_average_drawdown', params: { period: 60 } },
      { id: 'ulcerIndex', type: 'fund_ulcer_index', params: { period: 60 } },
      { id: 'drawdownDuration', type: 'fund_drawdown_duration_bars', params: { period: 60 } },
      { id: 'volatility', type: 'fund_volatility', params: { period: 60 } },
      { id: 'downsideVolatility', type: 'fund_downside_volatility', params: { period: 60 } },
      { id: 'sharpe', type: 'fund_sharpe', params: { period: 60 } },
      { id: 'sortino', type: 'fund_sortino', params: { period: 60 } },
      { id: 'calmar', type: 'fund_calmar', params: { period: 60 } },
      { id: 'recoveryRatio', type: 'fund_recovery_ratio', params: { period: 60 } },
      { id: 'gainToPain', type: 'fund_gain_to_pain', params: { period: 60 } },
      { id: 'momentumAcceleration', type: 'fund_momentum_acceleration', params: { period: 20, lagPeriod: 20 } },
      { id: 'omega', type: 'fund_omega', params: { period: 60, thresholdReturn: 0 } },
      { id: 'tailRatio', type: 'fund_tail_ratio', params: { period: 60 } },
      { id: 'positivePeriods', type: 'fund_positive_period_ratio', params: { period: 60 } },
      { id: 'negativePeriods', type: 'fund_negative_period_ratio', params: { period: 60 } },
      { id: 'maxDownStreak', type: 'fund_max_consecutive_down_periods', params: { period: 60 } },
      { id: 'maxUpStreak', type: 'fund_max_consecutive_up_periods', params: { period: 60 } },
      { id: 'returnSkewness', type: 'fund_return_skewness', params: { period: 60 } },
      { id: 'returnKurtosis', type: 'fund_return_kurtosis', params: { period: 60 } },
      { id: 'valueAtRisk', type: 'fund_value_at_risk', params: { period: 60, confidence: 95 } },
      { id: 'conditionalValueAtRisk', type: 'fund_conditional_value_at_risk', params: { period: 60, confidence: 95 } },
      { id: 'cadenceDays', type: 'dca_interval', params: { period: 30 } },
    ],
    entry: {
      all: [
        { left: 'navTrend', op: '>', right: 0 },
        { left: 'drawdown', op: '<=', right: 15 },
      ],
    },
    exit: {
      any: [
        { left: 'drawdown', op: '>', right: 20 },
        { left: 'volatility', op: '>', right: 30 },
      ],
    },
    positionSizing: { type: 'fixed_fraction', value: 0.1 },
  }
}

function moneyFundStrategySpec() {
  return {
    id: 'money_fund_yield_watch_v1',
    name: '货币基金收益观察',
    version: 1,
    assetClass: 'fund',
    market: 'fund',
    fundType: 'money',
    dataRequirements: {
      dataClass: 'money_fund_yield',
      requiredFields: ['date', 'moneyYield', 'sevenDayYield'],
      minBars: 30,
    },
    indicators: [
      { id: 'sevenDayYield', type: 'seven_day_yield', source: 'yield', params: { period: 7 } },
      { id: 'moneyYield', type: 'money_yield', source: 'yield', params: { period: 7 } },
    ],
    entry: {
      all: [{ left: 'sevenDayYield', op: '>', right: 0.85 }],
    },
    exit: {
      any: [{ left: 'sevenDayYield', op: '<', right: 0.8 }],
    },
  }
}

function etfFundStrategySpec() {
  return {
    ...fundStrategySpec(),
    id: 'etf_nav_observation_v1',
    name: 'ETF 联接基金 NAV 观察',
    fundType: 'ETF联接',
    dataRequirements: {
      dataClass: 'etf_fund_nav',
      requiredFields: ['nav', 'date'],
      minBars: 60,
    },
  }
}

function fundObservationAliasSpec() {
  return {
    name: 'fund_dca_drawdown_observe',
    description: 'Fund DCA observation with NAV drawdown and NAV moving-average recovery.',
    frequency: 'daily',
    observation: {
      indicators: [
        {
          id: 'drawdown_pct20',
          type: 'drawdown_pct',
          source: 'nav',
          params: { period: 20 },
        },
        {
          id: 'sma20',
          type: 'sma',
          source: 'nav',
          params: { period: 20 },
        },
      ],
      entries: [
        {
          label: 'increase DCA',
          condition: {
            all: [
              { left: 'drawdown_pct20', op: '>=', right: 8 },
              { left: 'drawdown_pct20', op: '<', right: 15 },
            ],
          },
        },
        {
          label: 'pause DCA',
          action: 'pause_evaluate',
          condition: { left: 'drawdown_pct20', op: '>=', right: 15 },
        },
        {
          label: 'resume DCA',
          condition: { left: 'nav', op: '>', right: 'sma20' },
        },
      ],
    },
  }
}

function fundTopLevelSignalSpec() {
  return {
    name: '基金回撤趋势定投观察策略',
    description: 'Fund DCA observation with top-level structured signals.',
    assetClass: 'fund',
    market: 'fund',
    dataRequirements: {
      dataClass: 'ordinary_fund_nav',
      requiredFields: ['date', 'nav'],
      minBars: 60,
    },
    signals: [
      {
        type: 'fund_drawdown',
        period: 60,
        operator: '<',
        threshold: -0.1,
        name: '中期回撤超10%',
      },
      {
        type: 'nav_trend',
        period: 20,
        operator: '>',
        threshold: 0,
        name: '短期净值趋势向上',
      },
    ],
    observation: {
      name: '定投观察窗口',
      type: 'dca_window',
    },
  }
}

function fundOutputAliasSignalSpec() {
  return {
    name: 'fund_dca_drawdown_trend',
    description: 'Fund DCA observation using output aliases and object-form rule sides.',
    assetClass: 'fund',
    market: 'fund',
    dataRequirements: {
      fields: ['date', 'nav'],
      minimumBars: 120,
    },
    indicators: [
      { type: 'nav_trend', params: { period: 20 }, output: 'nav_trend_20' },
      { type: 'fund_drawdown', params: { period: 120 }, output: 'dd_120' },
    ],
    signals: [
      {
        name: 'deep_drawdown_add',
        category: 'dca_observation',
        condition: {
          left: { indicator: 'dd_120', field: 'value' },
          op: '>',
          right: { value: 0.1 },
        },
      },
      {
        name: 'trend_recovery',
        category: 'dca_observation',
        condition: {
          left: { indicator: 'nav_trend_20', field: 'value' },
          op: '>',
          right: { value: 0 },
        },
      },
    ],
  }
}

function sampleFundRows() {
  return Array.from({ length: 90 }, (_, index) => {
    const pullback = index % 9 === 0 ? -0.004 : 0
    const nav = 1 + index * 0.002 + (index % 7) * 0.0003 + pullback
    return {
      date: `2026-${String(index + 1).padStart(3, '0')}`,
      nav: Number(nav.toFixed(4)),
    }
  })
}

function sampleMoneyFundRows() {
  return Array.from({ length: 45 }, (_, index) => ({
    code: '000009',
    name: '易方达天天理财货币A',
    fundType: '货币基金',
    dataClass: 'money_fund_yield',
    date: `2026-${String(index + 1).padStart(3, '0')}`,
    moneyYield: Number((0.38 + index * 0.001).toFixed(4)),
    sevenDayYield: Number((0.86 + index * 0.0005).toFixed(4)),
  }))
}

function sampleEtfNavRows() {
  return Array.from({ length: 80 }, (_, index) => {
    const nav = 1.2 + index * 0.0015 + (index % 6) * 0.0002
    return {
      code: '159919',
      name: '沪深300ETF联接',
      fundType: 'ETF联接',
      dataClass: 'etf_fund_nav',
      date: `2026-${String(index + 1).padStart(3, '0')}`,
      nav: Number(nav.toFixed(4)),
    }
  })
}

function sampleFundComparisonRows() {
  return Array.from({ length: 90 }, (_, index) => {
    const date = `2026-${String(index + 1).padStart(3, '0')}`
    const stronger = 1 + index * 0.0025 + (index % 7) * 0.0002
    const steadier = 1 + index * 0.0012 + (index % 5) * 0.0001
    return [
      {
        code: '110011',
        name: '易方达中小盘',
        date,
        nav: Number(stronger.toFixed(4)),
      },
      {
        code: '000001',
        name: '华夏成长',
        date,
        nav: Number(steadier.toFixed(4)),
      },
    ]
  }).flat()
}

function customStrategyBars() {
  return Array.from({ length: 120 }, (_, index) => {
    const close = 100 + Math.sin(index / 4) * 6 + index * 0.05
    return {
      date: `2026-05-${String((index % 28) + 1).padStart(2, '0')}`,
      open: close - 0.6,
      high: close + 1,
      low: close - 1,
      close,
      volume: 5000 + (index % 9) * 800,
      amount: 100000 + index,
      changePct: 0.2,
      turnoverRate: 0.1,
    }
  })
}

function trailingStopBars() {
  return Array.from({ length: 80 }, (_, index) => {
    const close = index < 30 ? 100 + index : 130 - (index - 29) * 1.5
    return {
      date: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
      open: close - 0.4,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 100000 + index * 1000,
      amount: 1000000 + index,
      changePct: 0.2,
      turnoverRate: 1,
    }
  })
}

function relativeStrengthBars(symbol: string) {
  const text = String(symbol)
  const slope = text.includes('300750') ? 1.4 : text.includes('000858') ? 0.7 : 0.2
  return Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * slope
    return {
      date: `2026-04-${String((index % 28) + 1).padStart(2, '0')}`,
      open: close - 0.4,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 100000 + index * 1000,
      amount: 1000000 + index,
      changePct: 0.2,
      turnoverRate: 1,
    }
  })
}

function relativeStrengthRows(symbol: string) {
  return relativeStrengthBars(symbol).map((bar) => ({
    ...bar,
    change_pct: bar.changePct,
    turnover_rate: bar.turnoverRate,
  }))
}

function looseAgentStrategySpec() {
  return {
    name: '茅台RSI超跌放量策略',
    version: 'v1',
    entry: {
      conditions: [
        { indicator: 'rsi', period: 14, operator: '<', value: 35 },
        { indicator: 'volume_sma', period: 20, operator: '>', value: 1.5, reference: 'self' },
      ],
    },
    exit: {
      operator: 'OR',
      conditions: [{ indicator: 'rsi', period: 14, operator: '>', value: 60 }],
      stop_loss_pct: 8,
    },
    positionSizing: { method: 'full_capital' },
  }
}

function p0StrategyObservationSpec() {
  return {
    assetClass: 'stock',
    market: 'cn',
    name: 'SMA10_SMA30_RSI14_Trend',
    version: '1.0',
    dataRequirements: {
      adjust: 'qfq',
      barSource: 'eastmoney',
      timeframe: '1d',
    },
    observation: [
      { indicator: 'sma', inputs: { field: 'close' }, name: 'sma10', params: { period: 10 } },
      { indicator: 'sma', inputs: { field: 'close' }, name: 'sma30', params: { period: 30 } },
      { indicator: 'rsi', inputs: { field: 'close' }, name: 'rsi14', params: { period: 14 } },
    ],
    lifecycle: {
      entry: {
        action: 'buy_full',
        rules: [
          {
            all: [
              { left: 'sma10', op: '>', right: 'sma30' },
              { left: 'sma10', op: 'crosses_up', right: 'sma30' },
              { left: 'rsi14', op: '<', right: 70 },
            ],
          },
        ],
      },
      exit: {
        action: 'sell_full',
        rules: [
          {
            any: [
              { left: 'sma10', op: '<', right: 'sma30' },
              { left: 'sma10', op: 'crosses_down', right: 'sma30' },
            ],
          },
        ],
      },
    },
    output: { equityCurve: true, summary: true, trades: true },
  }
}
