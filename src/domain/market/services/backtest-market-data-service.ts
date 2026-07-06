import type { ToolContext } from '../../../agent/tool'
import type * as dm from '../../../agent/data/data-manager'
import {
  BUILTIN_STRATEGIES,
  bollStrategy,
  emaCrossStrategy,
  formatBacktestResult,
  macdStrategy,
  rsiStrategy,
  runBacktest,
  type BacktestResult,
  type StrategyFn,
} from '../../../agent/data/backtest'
import { cartesian } from '../../../agent/tools/market-data-utils'
import {
  customStrategyHelp,
  compareCustomStrategies,
  listCustomStrategies,
  loadCustomStrategy,
  readCustomStrategy,
  runCustomStrategyBacktest,
  saveCustomStrategy,
  savedCustomStrategySymbol,
  validateStrategySpec,
} from '../strategy-spec/strategy-spec-engine'
import { backtestFundStrategySpec, observeFundStrategySpec } from '../strategy-spec/strategy-fund-observer'
import { rankCustomStrategyPortfolio } from '../strategy-spec/strategy-portfolio-ranker'
import { LocalMarketDataRepository } from '../repositories/local-market-data-repository'

export class BacktestMarketDataService {
  private readonly repository = new LocalMarketDataRepository()

  async readAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    switch (action) {
      case 'backtest':
        return this.readBacktest(ctx, code, input, limit)
      case 'backtest_enhanced':
        if (code.includes(',') || Array.isArray(input.symbols) || Array.isArray(input.codes)) {
          return this.readBacktestBatch(code, input)
        }
        return this.readBacktestEnhanced(code, input, limit)
      case 'backtest_composite':
        return this.readBacktestComposite(code, input, limit)
      case 'backtest_batch':
        return this.readBacktestBatch(code, input)
      case 'optimize_params':
        return this.readOptimizeParams(ctx, code, input, limit)
      case 'custom_strategy_help':
        return customStrategyHelp(input)
      case 'custom_strategy_validate':
        return JSON.stringify(validateStrategySpec(input.strategySpec), null, 2)
      case 'custom_strategy_backtest':
        return this.readCustomStrategyBacktest(ctx, code, input, limit)
      case 'custom_strategy_observe':
        return this.readCustomStrategyObserve(ctx, code, input, limit)
      case 'custom_strategy_fund_backtest':
        return this.readCustomStrategyFundBacktest(ctx, code, input, limit)
      case 'custom_strategy_rank':
        return this.readCustomStrategyRank(ctx, code, input, limit)
      case 'custom_strategy_save':
        return this.readCustomStrategySave(ctx, input)
      case 'custom_strategy_list':
        return JSON.stringify(listCustomStrategies(ctx), null, 2)
      case 'custom_strategy_compare':
        return JSON.stringify(compareCustomStrategies(ctx, strategyIdsOf(input)), null, 2)
      case 'custom_strategy_run':
        return this.readCustomStrategyRun(ctx, code, input, limit)
      default:
        throw new Error(`Unsupported backtest action: ${action}`)
    }
  }

  private async readBacktest(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    if (!code) {
      throw new Error('code required for backtest. Example: MarketData(action: "backtest", code: "600519", strategy: "rsi")')
    }
    const strategy = normalizeBacktestStrategy(input.strategy ?? input.type ?? 'rsi')
    const backtestLimit = Math.max(limit, normalizeBacktestWindowLimit(input.period), 500)
    const { bars, evidence } = await this.loadBarsPreferLocal(ctx, code, backtestLimit)
    if (bars.length < 30) {
      return `Not enough data for backtest (${bars.length} bars). Use DataStore(action: "fetch", type: "kline", code: "${code}", start: "2020-01-01") to download history first.`
    }

    const fn = strategyFactoryFor(strategy, input)
    if (!fn) {
      throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.keys(BUILTIN_STRATEGIES).join(', ')}`)
    }

    return JSON.stringify(backtestResultEnvelope(code, bars, runBacktest(bars, fn, strategy), evidence), null, 2)
  }

  private async readBacktestEnhanced(
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    if (!code) {
      throw new Error('code required. Example: MarketData(action:"backtest_enhanced", code:"600519", strategy:"rsi", stopLoss:8)')
    }
    const strategy = normalizeBacktestStrategy(input.strategy ?? 'rsi')
    const bars = await this.fetchBars(code, Math.max(limit, 300))
    if (bars.length < 30) return `Not enough data (${bars.length} bars)`

    const fn = BUILTIN_STRATEGIES[strategy]
    if (!fn) {
      throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.keys(BUILTIN_STRATEGIES).join(', ')}`)
    }

    const result = runBacktest(bars, fn, strategy)
    const enhanced = {
      ...JSON.parse(formatBacktestResult(result).replace(/^[^\{]*/, '').replace(/[^\}]*$/, '') || '{}'),
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      positionSizing: input.positionSizing ?? 'fullCapital',
    }
    return JSON.stringify(enhanced, null, 2)
  }

  private async readBacktestComposite(
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    if (!code) {
      throw new Error('code required. Example: MarketData(action:"backtest_composite", code:"600519", strategies:["rsi","macd"])')
    }
    const strategies = Array.isArray(input.strategies)
      ? input.strategies.filter((value): value is string => typeof value === 'string')
      : ['rsi', 'macd']
    const normalizedStrategies = strategies.map(normalizeBacktestStrategy)
    const bars = await this.fetchBars(code, Math.max(limit, 300))
    if (bars.length < 30) return `Not enough data (${bars.length} bars)`

    const results: Record<string, string> = {}
    for (const strategy of normalizedStrategies) {
      const fn = BUILTIN_STRATEGIES[strategy]
      if (fn) results[strategy] = formatBacktestResult(runBacktest(bars, fn, strategy))
    }
    return JSON.stringify(
      {
        action: 'backtest_composite',
        code,
        mode: input.mode ?? 'majority',
        strategies: Object.keys(results),
        results,
      },
      null,
      2,
    )
  }

  private async readBacktestBatch(
    code: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const symbols = Array.isArray(input.symbols)
      ? input.symbols.filter((value): value is string => typeof value === 'string')
      : code
        ? code.split(',').map((value) => value.trim()).filter(Boolean)
        : []
    if (symbols.length === 0) {
      throw new Error('symbols required. Example: MarketData(action:"backtest_batch", symbols:["600519","000858"])')
    }

    const strategy = normalizeBacktestStrategy(input.strategy ?? 'rsi')
    const fn = BUILTIN_STRATEGIES[strategy]
    if (!fn) {
      throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.keys(BUILTIN_STRATEGIES).join(', ')}`)
    }

    const results: Array<Record<string, unknown>> = []
    for (const symbol of symbols.slice(0, 10)) {
      const bars = await this.fetchBars(symbol, 300)
      if (bars.length >= 30) {
        const result = runBacktest(bars, fn, strategy)
        results.push({
          symbol,
          totalReturn: `${result.totalReturn.toFixed(2)}%`,
          trades: result.trades.length,
          maxDrawdown: `${result.maxDrawdown.toFixed(2)}%`,
          sharpe: result.sharpeRatio.toFixed(2),
        })
      }
    }

    return JSON.stringify(
      { action: 'backtest_batch', strategy, count: results.length, results },
      null,
      2,
    )
  }

  private async readOptimizeParams(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    if (!code) {
      throw new Error('code + strategy + paramGrid required. Example: MarketData(action:"optimize_params", code:"600519", strategy:"rsi", paramGrid:{"oversold":[25,30,35]})')
    }
    const strategy = normalizeBacktestStrategy(input.strategy ?? 'rsi')
    const paramGrid = (input.paramGrid ?? {}) as Record<string, number[]>
    if (Object.keys(paramGrid).length === 0) {
      throw new Error('paramGrid required. Example: {"oversold":[25,30,35],"period":[10,14,20]}')
    }
    const requestedLimit = Math.max(limit, normalizeBacktestWindowLimit(input.period), 300)
    const { bars } = await this.loadBarsPreferLocal(ctx, code, requestedLimit)
    if (bars.length < 30) return `Not enough data (${bars.length} bars)`
    const actualStartDate = bars[0]?.date ?? null
    const actualEndDate = bars[bars.length - 1]?.date ?? null

    const results: Array<Record<string, unknown>> = []
    const keys = Object.keys(paramGrid)
    const values = Object.values(paramGrid)
    const combos = cartesian(values)
    for (const combo of combos.slice(0, 50)) {
      const params: Record<string, number> = {}
      keys.forEach((key, index) => {
        params[key] = combo[index]
      })
      const fn = strategyFactoryFor(strategy, params)
      if (!fn) continue
      const result = runBacktest(bars, fn, strategy)
      results.push({
        params,
        totalReturn: `${result.totalReturn.toFixed(2)}%`,
        maxDrawdown: `${(result.maxDrawdown * 100).toFixed(2)}%`,
        trades: result.trades.length,
        sharpe: result.sharpeRatio.toFixed(2),
      })
    }
    results.sort((left, right) => parseFloat(String(right.totalReturn)) - parseFloat(String(left.totalReturn)))
    if (results.length === 0) {
      throw new Error(`No optimizer combinations could be evaluated for strategy "${strategy}". Check paramGrid keys and values.`)
    }
    return JSON.stringify(
      {
        action: 'optimize_params',
        code,
        strategy,
        requestedPeriod: input.period ?? null,
        requestedLimit,
        requestedStartDate: input.start ?? input.startDate ?? null,
        requestedEndDate: input.end ?? input.endDate ?? null,
        actualStartDate,
        actualEndDate,
        actualBars: bars.length,
        tested: results.length,
        best: results.slice(0, 5),
        parameterStability: parameterStabilityEvidence(results.slice(0, 5)),
      },
      null,
      2,
    )
  }

  private async readCustomStrategyBacktest(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    const spec = input.strategySpec
    const resolvedCode = code || firstInputSymbol(input) || firstStrategySpecSymbol(spec)
    if (!resolvedCode) {
      throw new Error('code required. Example: MarketData(action:"custom_strategy_backtest", code:"600519", strategySpec:{...})')
    }
    if (!spec) throw new Error('strategySpec required for custom_strategy_backtest')
    const loaded = await this.loadBarsPreferLocal(ctx, resolvedCode, Math.max(limit, 300))
    const result = runCustomStrategyBacktest(spec, loaded.bars, resolvedCode, {
      outOfSampleRatio: outOfSampleRatio(input),
      walkForwardFolds: walkForwardFolds(input),
    })
    return JSON.stringify({
      ...result,
      dataEvidence: loaded.evidence,
      dataCoverage: strategyDataCoverage(spec, loaded.evidence, resolvedCode),
    }, null, 2)
  }

  private readCustomStrategyObserve(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): string {
    if (!input.strategySpec) throw new Error('strategySpec required for custom_strategy_observe')
    return JSON.stringify(observeFundStrategySpec(input.strategySpec, this.resolveFundRows(ctx, code, input, limit)), null, 2)
  }

  private readCustomStrategyFundBacktest(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): string {
    if (!input.strategySpec) throw new Error('strategySpec required for custom_strategy_fund_backtest')
    return JSON.stringify(backtestFundStrategySpec(input.strategySpec, this.resolveFundRows(ctx, code, input, limit)), null, 2)
  }

  private async readCustomStrategyRank(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    const symbols = Array.isArray(input.symbols)
      ? input.symbols.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : code
        ? code.split(',').map((value) => value.trim()).filter(Boolean)
        : []
    if (symbols.length < 2) {
      throw new Error('symbols required. Example: MarketData(action:"custom_strategy_rank", symbols:["600519","000858","300750"], strategySpec:{...}, topN:2)')
    }
    if (!input.strategySpec) throw new Error('strategySpec required for custom_strategy_rank')
    const candidates = []
    for (const symbol of symbols.slice(0, 20)) {
      const loaded = await this.loadBarsPreferLocal(ctx, symbol, Math.max(limit, 300))
      candidates.push({
        symbol,
        bars: loaded.bars,
        dataEvidence: loaded.evidence,
      })
    }
    return JSON.stringify(
      rankCustomStrategyPortfolio({
        strategySpec: input.strategySpec,
        candidates,
        topN: Number(input.topN ?? 3),
        rankingMetric: String(input.rankingMetric ?? 'score'),
        rebalanceInterval: String(input.rebalanceInterval ?? input.rebalance_interval ?? 'single_period_draft'),
        maxPositionWeight: Number(input.maxPositionWeight ?? input.max_position_weight ?? Number.NaN),
        minScore: Number(input.minScore ?? input.min_score ?? Number.NaN),
        maxPairwiseCorrelation: Number(input.maxPairwiseCorrelation ?? input.max_pairwise_correlation ?? Number.NaN),
      }),
      null,
      2,
    )
  }

  private async readCustomStrategySave(
    ctx: ToolContext,
    input: Record<string, unknown>,
  ): Promise<string> {
    const spec = input.strategySpec
    if (!spec || typeof spec !== 'object') throw new Error('strategySpec required for custom_strategy_save')
    const record = saveCustomStrategy(ctx, spec as any, input.evidence)
    return JSON.stringify(record, null, 2)
  }

  private async readCustomStrategyRun(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<string> {
    const strategyId = String(input.strategyId ?? '').trim()
    if (!strategyId) throw new Error('strategyId required for custom_strategy_run')
    let record
    try {
      record = readCustomStrategy(ctx, strategyId)
    } catch (error) {
      return JSON.stringify(savedStrategyReadback(ctx, strategyId, error instanceof Error ? error.message : String(error)), null, 2)
    }
    if (!isRunnableBacktestedStrategyRecord(record)) {
      return JSON.stringify(savedStrategyReadback(ctx, strategyId, `saved strategy status ${String(record.status)} is not runnable`), null, 2)
    }
    const resolvedCode = code || savedCustomStrategySymbol(ctx, strategyId)
    if (!resolvedCode) return JSON.stringify(savedStrategyReadback(ctx, strategyId, 'code-unavailable'), null, 2)
    const spec = loadCustomStrategy(ctx, strategyId)
    const loaded = await this.loadBarsPreferLocal(ctx, resolvedCode, Math.max(limit, 300))
    const result = runCustomStrategyBacktest(spec, loaded.bars, resolvedCode)
    return JSON.stringify({
      ...result,
      action: 'custom_strategy_run',
      repairPlan: Array.isArray(record.repairPlan) ? record.repairPlan : [],
      dataEvidence: loaded.evidence,
      dataCoverage: strategyDataCoverage(spec, loaded.evidence, resolvedCode),
    }, null, 2)
  }

  private resolveFundRows(
    ctx: ToolContext,
    code: string,
    input: Record<string, unknown>,
    limit: number,
  ): unknown {
    if (Array.isArray(input.fundRows) && input.fundRows.some((row) => row && typeof row === 'object' && !Array.isArray(row))) {
      return input.fundRows
    }
    const resolvedCode = code || firstStrategySpecFundSymbol(input.strategySpec)
    if (!resolvedCode) return input.fundRows
    return this.repository.queryFundRows(ctx, resolvedCode, Math.max(limit, 120))
  }

  private async loadBarsPreferLocal(
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<{ bars: dm.KlineBar[]; evidence: Record<string, unknown> }> {
    const normalizedCode = normalizeAShareCode(code)
    const localRows = this.repository.queryKline(ctx, normalizedCode, { limit })
    if (localRows.length >= 100) {
      const bars = localRows.map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume ?? 0,
        amount: row.amount ?? 0,
        changePct: row.change_pct ?? null,
        turnoverRate: row.turnover_rate ?? null,
      }))
      return {
        bars,
        evidence: {
          source: 'local kline_daily',
          cacheStatus: 'local-hit',
          rows: bars.length,
          startDate: bars[0]?.date ?? null,
          endDate: bars.at(-1)?.date ?? null,
        },
      }
    }
    const bars = await this.fetchBars(normalizedCode, limit)
    return {
      bars,
      evidence: {
        source: 'provider fetch',
        cacheStatus: localRows.length > 0 ? 'partial-local-then-fetch' : 'local-miss-then-fetch',
        localRows: localRows.length,
        rows: bars.length,
        startDate: bars[0]?.date ?? null,
        endDate: bars.at(-1)?.date ?? null,
      },
    }
  }

  private async fetchBars(code: string, limit: number): Promise<dm.KlineBar[]> {
    const dmModule = await import('../../../agent/data/data-manager')
    return dmModule.getKline(code, 'daily', 'qfq', undefined, limit)
  }
}

function backtestResultEnvelope(
  code: string,
  bars: dm.KlineBar[],
  result: BacktestResult,
  dataEvidence: Record<string, unknown>,
): Record<string, unknown> {
  return {
    contract: 'strategy-backtest-result-v1',
    action: 'backtest',
    code,
    strategy: result.strategy,
    sample: {
      bars: bars.length,
      startDate: bars[0]?.date ?? null,
      endDate: bars.at(-1)?.date ?? null,
    },
    metrics: {
      totalReturnPct: result.totalReturn * 100,
      annualizedReturnPct: result.annualizedReturn * 100,
      maxDrawdownPct: result.maxDrawdown * 100,
      sharpeRatio: result.sharpeRatio,
      winRatePct: result.winRate * 100,
      profitFactor: result.profitFactor,
      tradeCount: result.tradeCount,
    },
    trades: result.trades,
    dataEvidence,
  }
}

function normalizeAShareCode(code: string): string {
  const trimmed = String(code ?? '').trim().toUpperCase()
  const suffixRemoved = trimmed.replace(/\.\w+$/, '')
  return suffixRemoved.replace(/^(SH|SZ)/, '')
}

function normalizeBacktestStrategy(value: unknown): string {
  const strategy = String(value ?? 'rsi').trim().toLowerCase()
  if (strategy === 'boll' || strategy === 'bbands' || strategy === 'bollinger_bands') {
    return 'bollinger'
  }
  return strategy
}

function normalizeBacktestWindowLimit(value: unknown): number {
  if (value == null || String(value).trim() === '') return 0
  const raw = String(value).trim().toLowerCase()
  if (raw === 'daily' || raw === 'day') return 0
  const aliases: Record<string, number> = {
    '1m': 22,
    '3m': 66,
    '6m': 126,
    '1y': 252,
    '1yr': 252,
    '1year': 252,
    '2y': 504,
    '2yr': 504,
    '2year': 504,
    '3y': 756,
    '3yr': 756,
    '3year': 756,
    '5y': 1260,
    '5yr': 1260,
    '5year': 1260,
  }
  const limit = aliases[raw]
  if (limit != null) return limit
  throw new Error(
    `Unsupported backtest period/window "${String(value)}". Use daily, 1m, 3m, 6m, 1y, 2y, 3y, or 5y. Do not put strategy names or optimizer fields in period.`,
  )
}

function strategyFactoryFor(strategy: string, input: Record<string, unknown>): StrategyFn | undefined {
  switch (strategy) {
    case 'rsi':
      return rsiStrategy(
        numberParam(input.oversold, 30),
        numberParam(input.overbought, 70),
        numberParam(input.period, 14),
      )
    case 'macd':
      return macdStrategy(
        numberParam(input.fast, 12),
        numberParam(input.slow, 26),
      )
    case 'bollinger':
      return bollStrategy(
        numberParam(input.period, 20),
        numberParam(input.multiplier ?? input.mult, 2),
      )
    case 'ema_cross':
      return emaCrossStrategy(
        numberParam(input.fast, 5),
        numberParam(input.slow, 20),
      )
    case 'ma_golden_cross':
      return BUILTIN_STRATEGIES.ma_golden_cross
    case 'volume_breakout':
      return BUILTIN_STRATEGIES.volume_breakout
    case 'dual_thrust':
      return BUILTIN_STRATEGIES.dual_thrust
    case 'adx_emerging':
      return BUILTIN_STRATEGIES.adx_emerging
    case 'mean_reversion':
      return BUILTIN_STRATEGIES.mean_reversion
    case 'turtle_breakout':
      return BUILTIN_STRATEGIES.turtle_breakout
    case 'supertrend':
    case 'donchian':
    case 'kdj':
      return BUILTIN_STRATEGIES[strategy]
    default:
      return BUILTIN_STRATEGIES[strategy]
  }
}

function numberParam(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function outOfSampleRatio(input: Record<string, unknown>): number | undefined {
  const requested = input.outOfSampleRatio ?? input.validationSplit ?? input.holdoutRatio
  const ratio = typeof requested === 'number' ? requested : Number(requested)
  return Number.isFinite(ratio) ? ratio : undefined
}

function walkForwardFolds(input: Record<string, unknown>): number | undefined {
  const requested = input.walkForwardFolds ?? input.walkForward_folds ?? input.stabilityFolds
  const folds = typeof requested === 'number' ? requested : Number(requested)
  if (Number.isFinite(folds)) return Math.floor(folds)
  if (input.walkForward === true || input.parameterStability === true) return 3
  return undefined
}

function parameterStabilityEvidence(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  if (rows.length === 0) return { status: 'skipped', reason: 'no optimizer results available' }
  const returns = rows.map((row) => numericPct(row.totalReturn))
  const bestReturn = returns[0] ?? 0
  const tolerance = Math.abs(bestReturn) * 0.1
  const nearBestCount = returns.filter((value) => Math.abs(bestReturn - value) <= tolerance).length
  const averageReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.length <= 1
    ? 0
    : returns.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / (returns.length - 1)
  const spread = parameterSpread(rows)
  const stabilityClass = parameterStabilityClass(rows.length, nearBestCount, spread)
  return {
    status: 'evaluated',
    basis: 'top optimizer results',
    topResultCount: rows.length,
    bestReturnPct: round(bestReturn),
    nearBestCountWithin10Pct: nearBestCount,
    topReturnStdDevPct: round(Math.sqrt(variance)),
    parameterSpread: spread,
    testedParameterKeys: Object.keys(spread).sort(),
    stabilityClass,
    decisionBoundary: 'Optimizer evidence is in-sample only. Use stable as a research signal, fragile as overfit risk, and inconclusive as insufficient grid evidence.',
    interpretation: nearBestCount >= 2
      ? 'top parameters have nearby alternatives in the tested grid'
      : 'best parameter is isolated in the tested grid; treat as higher overfit risk',
  }
}

function parameterStabilityClass(rowCount: number, nearBestCount: number, spread: Record<string, { min: number; max: number }>): string {
  if (rowCount < 3 || Object.keys(spread).length === 0) return 'inconclusive'
  return nearBestCount >= 2 ? 'stable' : 'fragile'
}

function parameterSpread(rows: Array<Record<string, unknown>>): Record<string, { min: number; max: number }> {
  const spread: Record<string, { min: number; max: number }> = {}
  for (const row of rows) {
    const params = row.params
    if (!params || typeof params !== 'object' || Array.isArray(params)) continue
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      const current = spread[key] ?? { min: n, max: n }
      current.min = Math.min(current.min, n)
      current.max = Math.max(current.max, n)
      spread[key] = current
    }
  }
  return spread
}

function numericPct(value: unknown): number {
  if (typeof value === 'number') return value
  const parsed = Number(String(value ?? '').replace('%', ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function firstStrategySpecSymbol(spec: unknown): string {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ''
  const source = spec as Record<string, unknown>
  const singleSymbol = String(source.symbol ?? '').trim()
  if (singleSymbol) return singleSymbol
  if (Array.isArray(source.symbols) && source.symbols.length > 0) {
    return String(source.symbols[0] ?? '').trim()
  }
  const universe = source.universe
  if (Array.isArray(universe) && universe.length > 0) {
    return String(universe[0] ?? '').trim()
  }
  if (universe && typeof universe === 'object' && !Array.isArray(universe)) {
    const symbols = (universe as Record<string, unknown>).symbols
    if (Array.isArray(symbols) && symbols.length > 0) {
      return String(symbols[0] ?? '').trim()
    }
  }
  return ''
}

function firstInputSymbol(input: Record<string, unknown>): string {
  const direct = input.symbol ?? input.code
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number') return String(direct).trim()
  if (Array.isArray(input.symbols) && input.symbols.length > 0) {
    return String(input.symbols[0] ?? '').trim()
  }
  return ''
}

function firstStrategySpecFundSymbol(spec: unknown): string {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ''
  const source = spec as Record<string, unknown>
  const direct = source.fundCode ?? source.code ?? source.symbol
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number') return String(direct).trim()
  const universe = source.universe
  if (universe && typeof universe === 'object' && !Array.isArray(universe)) {
    const symbols = (universe as Record<string, unknown>).symbols
    if (Array.isArray(symbols) && symbols.length > 0) return String(symbols[0] ?? '').trim()
  }
  const name = String(source.name ?? source.id ?? '').trim()
  const match = name.match(/(?:^|_)(\d{6})(?:_|$)/)
  return match?.[1] ?? ''
}

function strategyDataCoverage(
  spec: unknown,
  evidence: Record<string, unknown>,
  symbol: string,
): Record<string, unknown> {
  const rawSpec = spec && typeof spec === 'object' && !Array.isArray(spec)
    ? spec as Record<string, unknown>
    : {}
  const dataRequirements = rawSpec.dataRequirements &&
    typeof rawSpec.dataRequirements === 'object' &&
    !Array.isArray(rawSpec.dataRequirements)
    ? rawSpec.dataRequirements as Record<string, unknown>
    : {}
  const rows = Number(evidence.rows ?? 0)
  const requiredBars = Number(dataRequirements.minBars ?? 120)
  return {
    mode: 'strategy_backtest_kline_coverage',
    symbol,
    source: evidence.source ?? null,
    cacheStatus: evidence.cacheStatus ?? null,
    rows,
    requiredBars,
    sufficient: rows >= requiredBars,
    actualStartDate: evidence.startDate ?? null,
    actualEndDate: evidence.endDate ?? null,
    dataRequirements,
  }
}

function strategyIdsOf(input: Record<string, unknown>): string[] {
  const value = input.strategyIds ?? input.strategy_ids
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

function savedStrategyReadback(ctx: ToolContext, strategyId: string, reason: string): Record<string, unknown> {
  const record = readCustomStrategy(ctx, strategyId)
  const dataAndAssumptionSummary = asRecord(record.dataAndAssumptionSummary) ?? {}
  const lifecycleIssue = {
    category: 'lifecycle',
    path: 'strategyId',
    field: 'status',
    value: String(record.status),
    message: reason,
    suggestion: 'Use this readback evidence directly, or create/save a backtested stock StrategySpec before requesting executable rerun.',
  }
  return {
    action: 'custom_strategy_run',
    strategyId,
    status: 'readback_only',
    runnable: false,
    reason,
    savedStatus: record.status,
    spec: record.spec,
    validation: record.validation,
    evidence: record.evidence,
    evidenceAction: record.evidence && typeof record.evidence === 'object' && !Array.isArray(record.evidence)
      ? (record.evidence as Record<string, unknown>).action ?? null
      : null,
    dataAndAssumptionSummary,
    lifecycle: record.lifecycle ?? {},
    lifecycleIssue,
    validationIssues: [lifecycleIssue],
    repairPlan: Array.isArray(record.repairPlan) ? record.repairPlan : [],
    workflowAdvice: 'This saved strategy is not a runnable stock backtest artifact. Use this readback evidence directly, or create/save a backtested stock StrategySpec before requesting executable rerun.',
    ...portfolioRankReadbackFields(dataAndAssumptionSummary),
  }
}

function portfolioRankReadbackFields(summary: Record<string, unknown>): Record<string, unknown> {
  const portfolioEvidence = asRecord(summary.portfolioEvidence)
  const rebalanceDraft = asRecord(summary.rebalanceDraft)
  if (!portfolioEvidence && !rebalanceDraft) return {}
  const validation = asRecord(summary.portfolioValidation) ?? asRecord(portfolioEvidence?.portfolioValidation)
  const backtestEvidence = asRecord(summary.portfolioBacktestEvidence) ?? asRecord(portfolioEvidence?.portfolioBacktestEvidence)
  const stabilityEvidence = asRecord(summary.portfolioStabilityEvidence) ?? asRecord(portfolioEvidence?.portfolioStabilityEvidence)
  const rebalanceSimulation = asRecord(summary.portfolioRebalanceSimulation) ?? asRecord(portfolioEvidence?.portfolioRebalanceSimulation)
  const returnQualityEvidence =
    asRecord(summary.portfolioReturnQualityEvidence) ??
    asRecord(portfolioEvidence?.portfolioReturnQualityEvidence) ??
    asRecord(rebalanceDraft?.portfolioReturnQualityEvidence)
  const scoringEvidence =
    asRecord(summary.portfolioScoringEvidence) ??
    asRecord(portfolioEvidence?.portfolioScoringEvidence) ??
    asRecord(rebalanceDraft?.portfolioScoringEvidence)
  const drawdownBudgetEvidence =
    asRecord(summary.portfolioDrawdownBudgetEvidence) ??
    asRecord(portfolioEvidence?.portfolioDrawdownBudgetEvidence) ??
    asRecord(rebalanceDraft?.portfolioDrawdownBudgetEvidence)
  const concentrationEvidence =
    asRecord(summary.concentrationEvidence) ??
    asRecord(portfolioEvidence?.concentrationEvidence) ??
    asRecord(rebalanceDraft?.concentrationEvidence)
  const positions = Array.isArray(rebalanceDraft?.positions) ? rebalanceDraft.positions : []
  const selectedSymbols = positions
    .map((position) => asRecord(position)?.symbol)
    .map((symbol) => String(symbol ?? '').trim())
    .filter(Boolean)
  return {
    readbackMode: 'portfolio_rank_readback',
    evidenceMode: 'portfolio_rank_evidence',
    ...(selectedSymbols.length > 0 ? { selectedSymbols } : {}),
    ...(portfolioEvidence ? { portfolioEvidence } : {}),
    ...(rebalanceDraft ? { rebalanceDraft } : {}),
    ...(validation ? { portfolioValidation: validation } : {}),
    ...(backtestEvidence ? { portfolioBacktestEvidence: backtestEvidence } : {}),
    ...(scoringEvidence ? { portfolioScoringEvidence: scoringEvidence } : {}),
    ...(drawdownBudgetEvidence ? { portfolioDrawdownBudgetEvidence: drawdownBudgetEvidence } : {}),
    ...(returnQualityEvidence ? { portfolioReturnQualityEvidence: returnQualityEvidence } : {}),
    ...(stabilityEvidence ? { portfolioStabilityEvidence: stabilityEvidence } : {}),
    ...(rebalanceSimulation ? { portfolioRebalanceSimulation: rebalanceSimulation } : {}),
    ...(concentrationEvidence ? { concentrationEvidence } : {}),
    ...(summary.candidateFailureEvidence ? { candidateFailureEvidence: summary.candidateFailureEvidence } : {}),
    ...(summary.rankedRowsEvidence ? { rankedRowsEvidence: summary.rankedRowsEvidence } : {}),
    portfolioNextActions: [
      'read_evidence',
      'create_monitor',
      'request_trade_preparation_after_confirmation',
    ],
    tradeBoundary: 'Portfolio rank readback only; no simulated or real orders without explicit confirmation, separate sizing, and non-writing preview.',
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isRunnableBacktestedStrategyRecord(record: Record<string, unknown>): boolean {
  if (record.status === 'backtested') return true
  const backtestEvidence = record.backtestEvidence &&
    typeof record.backtestEvidence === 'object' &&
    !Array.isArray(record.backtestEvidence)
    ? record.backtestEvidence as Record<string, unknown>
    : null
  const evidence = record.evidence &&
    typeof record.evidence === 'object' &&
    !Array.isArray(record.evidence)
    ? record.evidence as Record<string, unknown>
    : null
  return backtestEvidence?.status === 'backtested' || evidence?.status === 'backtested'
}
