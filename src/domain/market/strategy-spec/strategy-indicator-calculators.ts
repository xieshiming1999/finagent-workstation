import type { KlineBar } from '../../../agent/data/data-manager'

type IndicatorSpec = {
  id: string
  type: string
  source?: string
  params?: Record<string, unknown>
}

type IndicatorStrategySpec = {
  indicators?: IndicatorSpec[]
}

type IndicatorCalculator = (
  bars: KlineBar[],
  values: number[],
  period: number,
  params: Record<string, unknown> | undefined,
) => Array<number | null>

export function computeStrategyIndicators(
  spec: IndicatorStrategySpec,
  bars: KlineBar[],
): Record<string, Array<number | null>> {
  const out: Record<string, Array<number | null>> = {
    close: bars.map((bar) => bar.close),
    volume: bars.map((bar) => bar.volume),
    turnover_rate: bars.map((bar) => bar.turnoverRate ?? null),
  }
  for (const indicator of spec.indicators ?? []) {
    const period = Number(indicator.params?.period ?? 14)
    const values = bars.map((bar) => indicator.source === 'volume' ? bar.volume : bar.close)
    const calculator = indicatorCalculators[indicator.type] ?? smaCalculator
    out[indicator.id] = calculator(bars, values, period, indicator.params)
  }
  return out
}

const indicatorCalculators: Record<string, IndicatorCalculator> = {
  sma: smaCalculator,
  volume_sma: (bars, _values, period) => sma(bars.map((bar) => bar.volume), period),
  rsi: (_bars, values, period) => rsi(values, period),
  stochastic_rsi: (_bars, values, _period, params) => stochasticRsi(values, params),
  ema: (_bars, values, period) => ema(values, period),
  price_change_pct: (_bars, values, period) => priceChangePct(values, period),
  momentum_acceleration_pct: (_bars, values, _period, params) => momentumAccelerationPct(values, params),
  efficiency_ratio: (_bars, values, period) => efficiencyRatio(values, period),
  momentum_rank: (_bars, values, _period, params) => momentumRank(values, params),
  chande_momentum_oscillator: (_bars, values, period) => chandeMomentumOscillator(values, period),
  aroon_oscillator: (bars, _values, period) => aroonOscillator(bars, period),
  aroon_up: (bars, _values, period) => aroonComponent(bars, period, 'up'),
  aroon_down: (bars, _values, period) => aroonComponent(bars, period, 'down'),
  vortex_spread: (bars, _values, period) => vortexSpread(bars, period),
  rolling_volatility: (_bars, values, period) => rollingVolatility(values, period),
  donchian_width_pct: (bars, _values, period) => donchianWidthPct(bars, period),
  range_compression_ratio: (bars, _values, _period, params) => rangeCompressionRatio(bars, params),
  donchian_position_pct: (bars, _values, period) => donchianPositionPct(bars, period),
  keltner_width_pct: (bars, _values, _period, params) => keltnerWidthPct(bars, params),
  downside_volatility_pct: (_bars, values, period) => downsideVolatilityPct(values, period),
  sortino_ratio: (_bars, values, period) => sortinoRatio(values, period),
  sharpe_ratio: (_bars, values, period) => sharpeRatio(values, period),
  calmar_ratio: (_bars, values, period) => calmarRatio(values, period),
  ulcer_index: (_bars, values, period) => ulcerIndex(values, period),
  gain_to_pain_ratio: (_bars, values, period) => gainToPainRatio(values, period),
  positive_period_ratio: (_bars, values, period) => positivePeriodRatio(values, period),
  negative_period_ratio: (_bars, values, period) => negativePeriodRatio(values, period),
  max_consecutive_down_bars: (_bars, values, period) => maxConsecutiveBars(values, period, false),
  max_consecutive_up_bars: (_bars, values, period) => maxConsecutiveBars(values, period, true),
  return_skewness: (_bars, values, period) => returnSkewness(values, period),
  return_kurtosis: (_bars, values, period) => returnKurtosis(values, period),
  omega_ratio: (_bars, values, _period, params) => omegaRatio(values, params),
  tail_ratio: (_bars, values, _period, params) => tailRatio(values, params),
  value_at_risk_pct: (_bars, values, _period, params) => valueAtRiskPct(values, params),
  conditional_value_at_risk_pct: (_bars, values, _period, params) => conditionalValueAtRiskPct(values, params),
  volatility_regime: (_bars, values, _period, params) => volatilityRegime(values, params),
  volatility_percentile: (_bars, values, _period, params) => volatilityPercentile(values, params),
  ema_slope: (_bars, values, period) => emaSlope(values, period),
  moving_average_regime: (_bars, values, _period, params) => movingAverageRegime(values, params),
  kama_distance_pct: (_bars, values, _period, params) => kamaDistancePct(values, params),
  kama_slope_pct: (_bars, values, _period, params) => kamaSlopePct(values, params),
  linear_regression_slope_pct: (_bars, values, period) => linearRegressionSlopePct(values, period),
  linear_regression_r2: (_bars, values, period) => linearRegressionR2(values, period),
  ma_distance_pct: (_bars, values, period) => maDistancePct(values, period),
  price_zscore: (_bars, values, period) => priceZScore(values, period),
  bollinger_bandwidth: (_bars, values, period) => bollingerBandwidth(values, period),
  bollinger_percent_b: (_bars, values, _period, params) => bollingerPercentB(values, params),
  bollinger_band_distance_pct: (_bars, values, _period, params) => bollingerBandDistancePct(values, params),
  kdj: (bars, _values, period) => kdjK(bars, period),
  stochastic_d: (bars, _values, period) => kdjComponents(bars, period).d,
  stochastic_j: (bars, _values, period) => kdjComponents(bars, period).j,
  adx: (bars, _values, period) => adx(bars, period),
  dmi_plus: (bars, _values, period) => directionalMovement(bars, period, 'plus'),
  dmi_minus: (bars, _values, period) => directionalMovement(bars, period, 'minus'),
  dmi_spread: (bars, _values, period) => directionalMovement(bars, period, 'spread'),
  turnover_rate: (bars) => turnoverRate(bars),
  liquidity_ratio: (bars, _values, period) => liquidityRatio(bars, period),
  volume_zscore: (bars, _values, period) => volumeZScore(bars, period),
  volume_breakout: (bars, _values, period) => volumeBreakout(bars, period),
  volume_oscillator_pct: (bars, _values, _period, params) => volumeOscillatorPct(bars, params),
  volume_rate_of_change_pct: (bars, _values, period) => volumeRateOfChangePct(bars, period),
  volume_percentile: (bars, _values, period) => volumePercentile(bars, period),
  rolling_vwap: (bars, _values, period) => rollingVwap(bars, period),
  money_flow_index: (bars, _values, period) => moneyFlowIndex(bars, period),
  on_balance_volume: (bars) => onBalanceVolume(bars),
  volume_price_trend: (bars) => volumePriceTrend(bars),
  positive_volume_index: (bars) => volumeIndex(bars, true),
  negative_volume_index: (bars) => volumeIndex(bars, false),
  accumulation_distribution_line: (bars) => accumulationDistributionLine(bars),
  chaikin_money_flow: (bars, _values, period) => chaikinMoneyFlow(bars, period),
  force_index: (bars, _values, _period, params) => forceIndex(bars, params),
  ease_of_movement: (bars, _values, _period, params) => easeOfMovement(bars, params),
  vwap_distance_pct: (bars, _values, period) => vwapDistancePct(bars, period),
  ichimoku_cloud_position: (bars, _values, _period, params) => ichimokuCloudPosition(bars, params),
  parabolic_sar_direction: (bars, _values, _period, params) => parabolicSarDirection(bars, params),
  commodity_channel_index: (bars, _values, period) => commodityChannelIndex(bars, period),
  williams_r: (bars, _values, period) => williamsR(bars, period),
  drawdown_pct: (_bars, values, period) => drawdownPct(values, period),
  rolling_max_drawdown_pct: (_bars, values, period) => rollingMaxDrawdownPct(values, period),
  drawdown_duration_bars: (_bars, values, period) => drawdownDurationBars(values, period),
  distance_to_high_pct: (_bars, values, period) => distanceToHighPct(values, period),
  distance_to_low_pct: (_bars, values, period) => distanceToLowPct(values, period),
  breakout_pct: (_bars, values, period) => breakoutPct(values, period),
  breakdown_pct: (_bars, values, period) => breakdownPct(values, period),
  atr_pct: (bars, _values, period) => atrPct(bars, period),
  atr_stop_distance_pct: (bars, _values, _period, params) => atrStopDistancePct(bars, params),
  risk_reward_ratio: (bars, _values, _period, params) => riskRewardRatio(bars, params),
  intraday_range_pct: (bars) => intradayRangePct(bars),
  gap_pct: (bars) => gapPct(bars),
  close_location_pct: (bars) => closeLocationPct(bars),
  body_return_pct: (bars) => bodyReturnPct(bars),
  upper_shadow_pct: (bars) => upperShadowPct(bars),
  lower_shadow_pct: (bars) => lowerShadowPct(bars),
  shadow_balance_pct: (bars) => shadowBalancePct(bars),
  body_to_range_pct: (bars) => bodyToRangePct(bars),
  macd: (_bars, values, _period, params) => macdHistogram(values, params),
  ppo: (_bars, values, _period, params) => ppoHistogram(values, params),
  trix: (_bars, values, period) => trix(values, period),
  true_strength_index: (_bars, values, _period, params) => trueStrengthIndex(values, params),
  bollinger: (_bars, values, period) => bollingerZScore(values, period),
  atr: (bars, _values, period) => atr(bars, period),
  supertrend_direction: (bars, _values, _period, params) => supertrendComponents(bars, params).direction,
  supertrend_distance_pct: (bars, _values, _period, params) => supertrendComponents(bars, params).distancePct,
  chandelier_stop_distance_pct: (bars, _values, _period, params) => chandelierStopDistancePct(bars, params),
  highest: (_bars, values, period) => rollingExtreme(values, period, Math.max),
  lowest: (_bars, values, period) => rollingExtreme(values, period, Math.min),
}

export const strategyIndicatorCalculatorTypes = new Set(Object.keys(indicatorCalculators))

function smaCalculator(_bars: KlineBar[], values: number[], period: number): Array<number | null> {
  return sma(values, period)
}

function turnoverRate(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => bar.turnoverRate ?? null)
}

function liquidityRatio(bars: KlineBar[], period: number): Array<number | null> {
  const volumes = bars.map((bar) => bar.volume)
  const average = sma(volumes, period)
  return bars.map((bar, index) => {
    const base = average[index]
    if (base == null || base === 0) return null
    return bar.volume / base
  })
}

function volumeZScore(bars: KlineBar[], period: number): Array<number | null> {
  return zScore(bars.map((bar) => bar.volume), period)
}

function volumeBreakout(bars: KlineBar[], period: number): Array<number | null> {
  const volumes = bars.map((bar) => bar.volume)
  const average = sma(volumes, period)
  return bars.map((bar, index) => {
    const base = average[index]
    if (base == null || base === 0) return null
    return bar.volume / base
  })
}

function volumeOscillatorPct(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawFast = Number(params?.fastPeriod ?? 12)
  const rawSlow = Number(params?.slowPeriod ?? 26)
  const fastPeriod = Number.isFinite(rawFast) && rawFast >= 1 ? Math.floor(rawFast) : 12
  const slowPeriod = Number.isFinite(rawSlow) && rawSlow >= 2 ? Math.floor(rawSlow) : 26
  const safeSlow = Math.max(fastPeriod + 1, slowPeriod)
  const volumes = bars.map((bar) => bar.volume)
  const fast = ema(volumes, fastPeriod)
  const slow = ema(volumes, safeSlow)
  return bars.map((_bar, index) => {
    const fastValue = fast[index]
    const slowValue = slow[index]
    if (fastValue == null || slowValue == null || slowValue === 0) return null
    return ((fastValue - slowValue) / slowValue) * 100
  })
}

function volumeRateOfChangePct(bars: KlineBar[], period: number): Array<number | null> {
  const volumes = bars.map((bar) => bar.volume)
  const safePeriod = Math.max(1, Math.floor(period))
  return bars.map((_bar, index) => {
    if (index < safePeriod) return null
    const previous = volumes[index - safePeriod]
    if (previous === 0) return null
    return ((volumes[index] - previous) / Math.abs(previous)) * 100
  })
}

function volumePercentile(bars: KlineBar[], period: number): Array<number | null> {
  const volumes = bars.map((bar) => bar.volume)
  const safePeriod = Math.max(2, Math.floor(period))
  return bars.map((_bar, index) => {
    if (index + 1 < safePeriod) return null
    const window = volumes.slice(index + 1 - safePeriod, index + 1)
    const current = volumes[index]
    const below = window.filter((value) => value < current).length
    const equal = window.filter((value) => value === current).length
    if (window.length <= 1) return null
    return ((below + ((equal - 1) / 2)) / (window.length - 1)) * 100
  })
}

function rollingVwap(bars: KlineBar[], period: number): Array<number | null> {
  return bars.map((_bar, index) => {
    if (index + 1 < period) return null
    let volumeSum = 0
    let weightedPriceSum = 0
    for (let i = index + 1 - period; i <= index; i++) {
      const typicalPrice = (bars[i].high + bars[i].low + bars[i].close) / 3
      volumeSum += bars[i].volume
      weightedPriceSum += typicalPrice * bars[i].volume
    }
    if (volumeSum === 0) return null
    return weightedPriceSum / volumeSum
  })
}

function moneyFlowIndex(bars: KlineBar[], period: number): Array<number | null> {
  const typicalPrices = bars.map((bar) => (bar.high + bar.low + bar.close) / 3)
  const rawFlows = bars.map((bar, index) => typicalPrices[index] * bar.volume)
  return bars.map((_bar, index) => {
    if (index < period) return null
    let positive = 0
    let negative = 0
    for (let i = index - period + 1; i <= index; i++) {
      if (typicalPrices[i] > typicalPrices[i - 1]) {
        positive += rawFlows[i]
      } else if (typicalPrices[i] < typicalPrices[i - 1]) {
        negative += rawFlows[i]
      }
    }
    if (positive === 0 && negative === 0) return 50
    if (negative === 0) return 100
    const ratio = positive / negative
    return 100 - (100 / (1 + ratio))
  })
}

function onBalanceVolume(bars: KlineBar[]): Array<number | null> {
  let running = 0
  return bars.map((bar, index) => {
    if (index === 0) return running
    if (bar.close > bars[index - 1].close) {
      running += bar.volume
    } else if (bar.close < bars[index - 1].close) {
      running -= bar.volume
    }
    return running
  })
}

function volumePriceTrend(bars: KlineBar[]): Array<number | null> {
  let running = 0
  return bars.map((bar, index) => {
    if (index === 0) return running
    const previousClose = bars[index - 1].close
    if (previousClose === 0) return running
    running += bar.volume * ((bar.close - previousClose) / previousClose)
    return running
  })
}

function volumeIndex(bars: KlineBar[], useIncreasingVolume: boolean): Array<number | null> {
  let running = 1000
  return bars.map((bar, index) => {
    if (index === 0) return running
    const previous = bars[index - 1]
    if (previous.close === 0) return running
    const volumeChanged = useIncreasingVolume
      ? bar.volume > previous.volume
      : bar.volume < previous.volume
    if (volumeChanged) {
      running += running * ((bar.close - previous.close) / previous.close)
    }
    return running
  })
}

function accumulationDistributionLine(bars: KlineBar[]): Array<number | null> {
  let running = 0
  return bars.map((bar) => {
    const range = bar.high - bar.low
    if (range === 0) return running
    const multiplier = ((bar.close - bar.low) - (bar.high - bar.close)) / range
    running += multiplier * bar.volume
    return running
  })
}

function chaikinMoneyFlow(bars: KlineBar[], period: number): Array<number | null> {
  const moneyFlowVolumes = bars.map((bar) => {
    const range = bar.high - bar.low
    if (range === 0) return 0
    const multiplier = ((bar.close - bar.low) - (bar.high - bar.close)) / range
    return multiplier * bar.volume
  })
  return bars.map((_bar, index) => {
    if (index + 1 < period) return null
    const start = index + 1 - period
    const volumeSum = bars.slice(start, index + 1).reduce((sum, item) => sum + item.volume, 0)
    if (volumeSum === 0) return null
    const flowSum = moneyFlowVolumes.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    return flowSum / volumeSum
  })
}

function forceIndex(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawSmoothing = Number(params?.smoothingPeriod ?? params?.period ?? 13)
  const smoothingPeriod = Number.isFinite(rawSmoothing) && rawSmoothing >= 1 ? Math.floor(rawSmoothing) : 13
  const raw = bars.map((bar, index) => index === 0 ? 0 : (bar.close - bars[index - 1].close) * bar.volume)
  return ema(raw, Math.max(1, smoothingPeriod))
}

function easeOfMovement(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 14)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 14
  const rawDivisor = Number(params?.volumeDivisor ?? 1_000_000)
  const volumeDivisor = Number.isFinite(rawDivisor) && rawDivisor > 0 ? rawDivisor : 1_000_000
  const raw = bars.map((bar, index) => {
    if (index === 0) return null
    const currentMidpoint = (bar.high + bar.low) / 2
    const previousMidpoint = (bars[index - 1].high + bars[index - 1].low) / 2
    const range = bar.high - bar.low
    if (range === 0) return null
    const boxRatio = (bar.volume / volumeDivisor) / range
    if (!Number.isFinite(boxRatio) || boxRatio === 0) return null
    return (currentMidpoint - previousMidpoint) / boxRatio
  })
  return smaNullable(raw, Math.max(1, period))
}

function vwapDistancePct(bars: KlineBar[], period: number): Array<number | null> {
  return bars.map((bar, index) => {
    if (index + 1 < period) return null
    let volumeSum = 0
    let weightedPriceSum = 0
    for (let i = index + 1 - period; i <= index; i++) {
      const typicalPrice = (bars[i].high + bars[i].low + bars[i].close) / 3
      volumeSum += bars[i].volume
      weightedPriceSum += typicalPrice * bars[i].volume
    }
    if (volumeSum === 0) return null
    const vwap = weightedPriceSum / volumeSum
    if (vwap === 0) return null
    return ((bar.close - vwap) / vwap) * 100
  })
}

function ichimokuCloudPosition(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawConversion = Number(params?.conversionPeriod ?? 9)
  const conversionPeriod = Number.isFinite(rawConversion) && rawConversion >= 1 ? Math.floor(rawConversion) : 9
  const rawBase = Number(params?.basePeriod ?? 26)
  const basePeriod = Number.isFinite(rawBase) && rawBase >= 2 ? Math.floor(rawBase) : 26
  const rawSpanB = Number(params?.spanBPeriod ?? 52)
  const spanBPeriod = Number.isFinite(rawSpanB) && rawSpanB >= 3 ? Math.floor(rawSpanB) : 52
  const required = Math.max(conversionPeriod, basePeriod, spanBPeriod)
  return bars.map((bar, index) => {
    if (index + 1 < required) return null
    const conversion = highLowMidpoint(bars, index, conversionPeriod)
    const base = highLowMidpoint(bars, index, basePeriod)
    const spanB = highLowMidpoint(bars, index, spanBPeriod)
    if (conversion == null || base == null || spanB == null) return null
    const spanA = (conversion + base) / 2
    const cloudTop = Math.max(spanA, spanB)
    const cloudBottom = Math.min(spanA, spanB)
    if (bar.close > cloudTop) return 1
    if (bar.close < cloudBottom) return -1
    return 0
  })
}

function highLowMidpoint(bars: KlineBar[], index: number, period: number): number | null {
  if (index + 1 < period) return null
  const window = bars.slice(index + 1 - period, index + 1)
  return (Math.max(...window.map((bar) => bar.high)) + Math.min(...window.map((bar) => bar.low))) / 2
}

function parabolicSarDirection(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const out: Array<number | null> = Array(bars.length).fill(null)
  if (bars.length < 2) return out
  const rawStep = Number(params?.acceleration ?? 0.02)
  const step = Number.isFinite(rawStep) && rawStep >= 0.001 ? rawStep : 0.02
  const rawMaxStep = Number(params?.maxAcceleration ?? 0.2)
  const maxStep = Math.max(step, Number.isFinite(rawMaxStep) && rawMaxStep >= 0.01 ? rawMaxStep : 0.2)
  let uptrend = bars[1].close >= bars[0].close
  let sar = uptrend ? bars[0].low : bars[0].high
  let extreme = uptrend ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low)
  let acceleration = step
  out[1] = bars[1].close >= sar ? 1 : -1

  for (let index = 2; index < bars.length; index++) {
    sar += acceleration * (extreme - sar)
    if (uptrend) {
      sar = Math.min(sar, bars[index - 1].low, bars[index - 2].low)
      if (bars[index].low < sar) {
        uptrend = false
        sar = extreme
        extreme = bars[index].low
        acceleration = step
      } else if (bars[index].high > extreme) {
        extreme = bars[index].high
        acceleration = Math.min(maxStep, acceleration + step)
      }
    } else {
      sar = Math.max(sar, bars[index - 1].high, bars[index - 2].high)
      if (bars[index].high > sar) {
        uptrend = true
        sar = extreme
        extreme = bars[index].high
        acceleration = step
      } else if (bars[index].low < extreme) {
        extreme = bars[index].low
        acceleration = Math.min(maxStep, acceleration + step)
      }
    }
    out[index] = bars[index].close >= sar ? 1 : -1
  }
  return out
}

function commodityChannelIndex(bars: KlineBar[], period: number): Array<number | null> {
  const typicalPrices = bars.map((bar) => (bar.high + bar.low + bar.close) / 3)
  return bars.map((_bar, index) => {
    if (index + 1 < period) return null
    const window = typicalPrices.slice(index + 1 - period, index + 1)
    const average = window.reduce((a, b) => a + b, 0) / period
    const meanDeviation = window.reduce((sum, value) => sum + Math.abs(value - average), 0) / period
    if (meanDeviation === 0) return 0
    return (typicalPrices[index] - average) / (0.015 * meanDeviation)
  })
}

function williamsR(bars: KlineBar[], period: number): Array<number | null> {
  return bars.map((bar, index) => {
    if (index + 1 < period) return null
    const window = bars.slice(index + 1 - period, index + 1)
    const highestHigh = Math.max(...window.map((item) => item.high))
    const lowestLow = Math.min(...window.map((item) => item.low))
    const range = highestHigh - lowestLow
    if (range === 0) return 0
    return ((highestHigh - bar.close) / range) * -100
  })
}

function rangeCompressionRatio(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 20)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 20
  const rawBaselinePeriod = Number(params?.baselinePeriod ?? 60)
  const baselinePeriod = Math.max(
    period,
    Number.isFinite(rawBaselinePeriod) && rawBaselinePeriod >= 2 ? Math.floor(rawBaselinePeriod) : 60,
  )
  const current = donchianWidthPct(bars, period)
  const baseline = donchianWidthPct(bars, baselinePeriod)
  return bars.map((_bar, index) => {
    const currentValue = current[index]
    const baselineValue = baseline[index]
    if (currentValue == null || baselineValue == null || baselineValue === 0) return null
    return currentValue / baselineValue
  })
}

function drawdownPct(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index + 1 < period) return null
    const high = Math.max(...values.slice(index + 1 - period, index + 1))
    if (high === 0) return null
    return ((value - high) / high) * 100
  })
}

function rollingMaxDrawdownPct(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < period) return null
    const window = values.slice(index + 1 - period, index + 1)
    let high = window[0]
    let maxDrawdown = 0
    for (const value of window) {
      high = Math.max(high, value)
      if (high === 0) return null
      maxDrawdown = Math.min(maxDrawdown, ((value - high) / high) * 100)
    }
    return maxDrawdown
  })
}

function drawdownDurationBars(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < period) return null
    const start = index + 1 - period
    let highIndex = start
    let high = values[start]
    for (let i = start + 1; i <= index; i++) {
      if (values[i] >= high) {
        high = values[i]
        highIndex = i
      }
    }
    return index - highIndex
  })
}

function distanceToHighPct(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index + 1 < period) return null
    const high = Math.max(...values.slice(index + 1 - period, index + 1))
    if (high === 0) return null
    return ((high - value) / high) * 100
  })
}

function distanceToLowPct(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index + 1 < period) return null
    const low = Math.min(...values.slice(index + 1 - period, index + 1))
    if (low === 0) return null
    return ((value - low) / Math.abs(low)) * 100
  })
}

function breakoutPct(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index < period) return null
    const previousHigh = Math.max(...values.slice(index - period, index))
    if (previousHigh === 0) return null
    return ((value - previousHigh) / previousHigh) * 100
  })
}

function breakdownPct(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index < period) return null
    const previousLow = Math.min(...values.slice(index - period, index))
    if (previousLow === 0) return null
    return ((previousLow - value) / Math.abs(previousLow)) * 100
  })
}

function atrPct(bars: KlineBar[], period: number): Array<number | null> {
  const values = atr(bars, period)
  return values.map((value, index) => {
    const close = bars[index].close
    if (value == null || close === 0) return null
    return (value / close) * 100
  })
}

function atrStopDistancePct(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 14)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 14
  const rawMultiplier = Number(params?.atrMultiplier ?? 2)
  const multiplier = Number.isFinite(rawMultiplier) ? rawMultiplier : 2
  const values = atr(bars, period)
  return values.map((value, index) => {
    const close = bars[index].close
    if (value == null || close === 0) return null
    return ((value * multiplier) / close) * 100
  })
}

function riskRewardRatio(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawTargetPeriod = Number(params?.targetPeriod ?? 20)
  const targetPeriod = Number.isFinite(rawTargetPeriod) && rawTargetPeriod >= 1 ? Math.floor(rawTargetPeriod) : 20
  const rawAtrPeriod = Number(params?.atrPeriod ?? 14)
  const atrPeriod = Number.isFinite(rawAtrPeriod) && rawAtrPeriod >= 1 ? Math.floor(rawAtrPeriod) : 14
  const rawMultiplier = Number(params?.atrMultiplier ?? 2)
  const multiplier = Number.isFinite(rawMultiplier) ? Math.max(0, rawMultiplier) : 2
  const values = atr(bars, atrPeriod)
  return bars.map((bar, index) => {
    if (index + 1 < targetPeriod) return null
    const atrValue = values[index]
    if (atrValue == null || atrValue === 0 || multiplier === 0) return null
    const targetHigh = Math.max(...bars.slice(index + 1 - targetPeriod, index + 1).map((item) => item.high))
    const reward = Math.max(0, targetHigh - bar.close)
    const risk = atrValue * multiplier
    return risk === 0 ? null : reward / risk
  })
}

function intradayRangePct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    if (bar.close === 0) return null
    return ((bar.high - bar.low) / bar.close) * 100
  })
}

function gapPct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar, index) => {
    if (index === 0) return null
    const previousClose = bars[index - 1].close
    if (previousClose === 0) return null
    return ((bar.open - previousClose) / previousClose) * 100
  })
}

function closeLocationPct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    const range = bar.high - bar.low
    if (range === 0) return null
    return ((bar.close - bar.low) / range) * 100
  })
}

function bodyReturnPct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    if (bar.open === 0) return null
    return ((bar.close - bar.open) / bar.open) * 100
  })
}

function upperShadowPct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    if (bar.close === 0) return null
    const bodyTop = Math.max(bar.open, bar.close)
    return ((bar.high - bodyTop) / bar.close) * 100
  })
}

function lowerShadowPct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    if (bar.close === 0) return null
    const bodyBottom = Math.min(bar.open, bar.close)
    return ((bodyBottom - bar.low) / bar.close) * 100
  })
}

function shadowBalancePct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    if (bar.close === 0) return null
    const bodyTop = Math.max(bar.open, bar.close)
    const bodyBottom = Math.min(bar.open, bar.close)
    const upper = bar.high - bodyTop
    const lower = bodyBottom - bar.low
    return ((lower - upper) / bar.close) * 100
  })
}

function bodyToRangePct(bars: KlineBar[]): Array<number | null> {
  return bars.map((bar) => {
    const range = bar.high - bar.low
    if (range === 0) return null
    return (Math.abs(bar.close - bar.open) / range) * 100
  })
}

function sma(values: number[], period: number): Array<number | null> {
  return values.map((_, index) => index + 1 < period ? null : values.slice(index + 1 - period, index + 1).reduce((a, b) => a + b, 0) / period)
}

function smaNullable(values: Array<number | null>, period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < period) return null
    const window = values.slice(index + 1 - period, index + 1).filter((item): item is number => item != null)
    if (window.length < period) return null
    return window.reduce((a, b) => a + b, 0) / period
  })
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (period <= 0) return out
  const multiplier = 2 / (period + 1)
  let previous: number | null = null
  for (let index = 0; index < values.length; index++) {
    if (index + 1 < period) continue
    if (previous == null) {
      previous = values.slice(index + 1 - period, index + 1).reduce((a, b) => a + b, 0) / period
    } else {
      previous = values[index] * multiplier + previous * (1 - multiplier)
    }
    out[index] = previous
  }
  return out
}

function priceChangePct(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index < period || values[index - period] === 0) return null
    return ((value - values[index - period]) / values[index - period]) * 100
  })
}

function momentumAccelerationPct(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 20)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 20
  const rawLagPeriod = Number(params?.lagPeriod ?? period)
  const lagPeriod = Number.isFinite(rawLagPeriod) && rawLagPeriod >= 1 ? Math.floor(rawLagPeriod) : period
  const returns = priceChangePct(values, period)
  return values.map((_value, index) => {
    const current = returns[index]
    const previousIndex = index - lagPeriod
    if (current == null || previousIndex < 0) return null
    const previous = returns[previousIndex]
    if (previous == null) return null
    return current - previous
  })
}

function efficiencyRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < period) return null
    const start = index + 1 - period
    const netChange = Math.abs(values[index] - values[start])
    let totalMovement = 0
    for (let i = start + 1; i <= index; i++) {
      totalMovement += Math.abs(values[i] - values[i - 1])
    }
    if (totalMovement === 0) return 0
    return netChange / totalMovement
  })
}

function chandeMomentumOscillator(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index < period) return null
    let gains = 0
    let losses = 0
    for (let i = index - period + 1; i <= index; i++) {
      const change = values[i] - values[i - 1]
      if (change > 0) {
        gains += change
      } else {
        losses += Math.abs(change)
      }
    }
    const total = gains + losses
    if (total === 0) return 0
    return (100 * (gains - losses)) / total
  })
}

function aroonOscillator(bars: KlineBar[], period: number): Array<number | null> {
  const up = aroonComponent(bars, period, 'up')
  const down = aroonComponent(bars, period, 'down')
  return bars.map((_bar, index) => {
    const upValue = up[index]
    const downValue = down[index]
    if (upValue == null || downValue == null) return null
    return upValue - downValue
  })
}

function aroonComponent(bars: KlineBar[], period: number, component: 'up' | 'down'): Array<number | null> {
  return bars.map((_bar, index) => {
    if (index + 1 < period) return null
    const start = index + 1 - period
    let highestIndex = start
    let lowestIndex = start
    for (let i = start + 1; i <= index; i++) {
      if (bars[i].high >= bars[highestIndex].high) highestIndex = i
      if (bars[i].low <= bars[lowestIndex].low) lowestIndex = i
    }
    const periodsSinceHigh = index - highestIndex
    const periodsSinceLow = index - lowestIndex
    const aroonUp = (100 * (period - periodsSinceHigh)) / period
    const aroonDown = (100 * (period - periodsSinceLow)) / period
    return component === 'down' ? aroonDown : aroonUp
  })
}

function vortexSpread(bars: KlineBar[], period: number): Array<number | null> {
  return bars.map((_bar, index) => {
    if (index < period || period <= 0) return null
    let plusMovement = 0
    let minusMovement = 0
    let trueRange = 0
    for (let i = index - period + 1; i <= index; i++) {
      const current = bars[i]
      const previous = bars[i - 1]
      plusMovement += Math.abs(current.high - previous.low)
      minusMovement += Math.abs(current.low - previous.high)
      trueRange += Math.max(
        current.high - current.low,
        Math.max(
          Math.abs(current.high - previous.close),
          Math.abs(current.low - previous.close),
        ),
      )
    }
    if (trueRange === 0) return 0
    return plusMovement / trueRange - minusMovement / trueRange
  })
}

function donchianWidthPct(bars: KlineBar[], period: number): Array<number | null> {
  return bars.map((bar, index) => {
    if (index + 1 < period) return null
    const window = bars.slice(index + 1 - period, index + 1)
    const highestHigh = Math.max(...window.map((item) => item.high))
    const lowestLow = Math.min(...window.map((item) => item.low))
    if (bar.close === 0) return null
    return ((highestHigh - lowestLow) / bar.close) * 100
  })
}

function donchianPositionPct(bars: KlineBar[], period: number): Array<number | null> {
  return bars.map((bar, index) => {
    if (index + 1 < period) return null
    const window = bars.slice(index + 1 - period, index + 1)
    const highestHigh = Math.max(...window.map((item) => item.high))
    const lowestLow = Math.min(...window.map((item) => item.low))
    const range = highestHigh - lowestLow
    if (range === 0) return null
    return ((bar.close - lowestLow) / range) * 100
  })
}

function keltnerWidthPct(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 20)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 20
  const rawAtrPeriod = Number(params?.atrPeriod ?? period)
  const atrPeriod = Number.isFinite(rawAtrPeriod) && rawAtrPeriod >= 1 ? Math.floor(rawAtrPeriod) : period
  const rawMultiplier = Number(params?.atrMultiplier ?? 2)
  const multiplier = Number.isFinite(rawMultiplier) ? rawMultiplier : 2
  const centerline = ema(bars.map((bar) => bar.close), Math.max(1, period))
  const atrValues = atr(bars, Math.max(1, atrPeriod))
  return bars.map((_bar, index) => {
    const center = centerline[index]
    const atrValue = atrValues[index]
    if (center == null || atrValue == null || center === 0) return null
    return ((2 * multiplier * atrValue) / center) * 100
  })
}

function stochasticRsi(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawRsi = Number(params?.rsiPeriod ?? params?.period ?? 14)
  const rsiPeriod = Number.isFinite(rawRsi) && rawRsi >= 1 ? Math.floor(rawRsi) : 14
  const rawStochastic = Number(params?.stochasticPeriod ?? params?.lookbackPeriod ?? params?.period ?? 14)
  const stochasticPeriod = Number.isFinite(rawStochastic) && rawStochastic >= 1 ? Math.floor(rawStochastic) : 14
  const rsiValues = rsi(values, Math.max(1, rsiPeriod))
  return values.map((_value, index) => {
    if (index + 1 < stochasticPeriod) return null
    const window = rsiValues
      .slice(Math.max(0, index + 1 - stochasticPeriod), index + 1)
      .filter((item): item is number => item != null)
    const current = rsiValues[index]
    if (current == null || window.length < stochasticPeriod) return null
    const low = Math.min(...window)
    const high = Math.max(...window)
    const range = high - low
    if (range === 0) return 50
    return ((current - low) / range) * 100
  })
}

function momentumRank(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawMomentum = Number(params?.period ?? 20)
  const momentumPeriod = Number.isFinite(rawMomentum) && rawMomentum >= 1 ? Math.floor(rawMomentum) : 20
  const rawRank = Number(params?.rankPeriod ?? 60)
  const rankPeriod = Number.isFinite(rawRank) && rawRank >= 2 ? Math.floor(rawRank) : 60
  const returns = priceChangePct(values, momentumPeriod)
  return returns.map((current, index) => {
    if (current == null || index + 1 < rankPeriod) return null
    const window = returns
      .slice(Math.max(0, index + 1 - rankPeriod), index + 1)
      .filter((item): item is number => item != null)
    if (window.length < Math.max(2, rankPeriod - momentumPeriod)) return null
    const belowOrEqual = window.filter((item) => item <= current).length
    return (belowOrEqual / window.length) * 100
  })
}

function rollingVolatility(values: number[], period: number): Array<number | null> {
  return values.map((_, index) => {
    if (index < period) return null
    const returns: number[] = []
    for (let i = index - period + 1; i <= index; i++) {
      if (values[i - 1] === 0) return null
      returns.push((values[i] - values[i - 1]) / values[i - 1])
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / returns.length
    return Math.sqrt(variance) * Math.sqrt(252) * 100
  })
}

function downsideVolatilityPct(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index < period) return null
    const returns: number[] = []
    for (let i = index - period + 1; i <= index; i++) {
      if (values[i - 1] === 0) return null
      const dailyReturn = (values[i] - values[i - 1]) / values[i - 1]
      returns.push(Math.min(0, dailyReturn))
    }
    const downsideVariance = returns.reduce((sum, item) => sum + item ** 2, 0) / returns.length
    return Math.sqrt(downsideVariance) * Math.sqrt(252) * 100
  })
}

function sortinoRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index < period) return null
    const returns: number[] = []
    const downsideReturns: number[] = []
    for (let i = index - period + 1; i <= index; i++) {
      if (values[i - 1] === 0) return null
      const dailyReturn = (values[i] - values[i - 1]) / values[i - 1]
      returns.push(dailyReturn)
      downsideReturns.push(Math.min(0, dailyReturn))
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const downsideVariance = downsideReturns.reduce((sum, item) => sum + item ** 2, 0) / downsideReturns.length
    if (downsideVariance === 0) return 0
    return (mean / Math.sqrt(downsideVariance)) * Math.sqrt(252)
  })
}

function sharpeRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index < period) return null
    const returns: number[] = []
    for (let i = index - period + 1; i <= index; i++) {
      if (values[i - 1] === 0) return null
      returns.push((values[i] - values[i - 1]) / values[i - 1])
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / returns.length
    if (variance === 0) return 0
    return (mean / Math.sqrt(variance)) * Math.sqrt(252)
  })
}

function calmarRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < period) return null
    const window = values.slice(index + 1 - period, index + 1)
    const start = window[0]
    if (start === 0) return null
    const periodReturnPct = ((window[window.length - 1] - start) / start) * 100
    let high = window[0]
    let maxDrawdownPct = 0
    for (const value of window) {
      high = Math.max(high, value)
      if (high === 0) return null
      maxDrawdownPct = Math.min(maxDrawdownPct, ((value - high) / high) * 100)
    }
    if (maxDrawdownPct === 0) return 0
    return periodReturnPct / Math.abs(maxDrawdownPct)
  })
}

function ulcerIndex(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < period) return null
    const window = values.slice(index + 1 - period, index + 1)
    let high = window[0]
    let squaredDrawdownSum = 0
    for (const value of window) {
      high = Math.max(high, value)
      if (high === 0) return null
      const drawdownPct = Math.min(0, ((value - high) / high) * 100)
      squaredDrawdownSum += drawdownPct * drawdownPct
    }
    return Math.sqrt(squaredDrawdownSum / window.length)
  })
}

function gainToPainRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    const gains = returns.filter((item) => item > 0).reduce((sum, item) => sum + item, 0)
    const pain = returns.filter((item) => item < 0).reduce((sum, item) => sum + Math.abs(item), 0)
    if (pain === 0) return gains === 0 ? 0 : gains
    return gains / pain
  })
}

function positivePeriodRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    const positives = returns.filter((item) => item > 0).length
    return (positives / returns.length) * 100
  })
}

function negativePeriodRatio(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    const negatives = returns.filter((item) => item < 0).length
    return (negatives / returns.length) * 100
  })
}

function maxConsecutiveBars(values: number[], period: number, rising: boolean): Array<number | null> {
  return values.map((_value, index) => {
    if (index < period) return null
    let currentStreak = 0
    let maxStreak = 0
    for (let i = index - period + 1; i <= index; i++) {
      const inStreak = rising ? values[i] > values[i - 1] : values[i] < values[i - 1]
      if (inStreak) {
        currentStreak += 1
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 0
      }
    }
    return maxStreak
  })
}

function returnSkewness(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns || returns.length < 3) return null
    const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length
    const variance = returns.reduce((sum, item) => sum + Math.pow(item - mean, 2), 0) / returns.length
    if (variance === 0) return 0
    const stdev = Math.sqrt(variance)
    const skew = returns.reduce((sum, item) => sum + Math.pow((item - mean) / stdev, 3), 0)
    return skew / returns.length
  })
}

function returnKurtosis(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns || returns.length < 4) return null
    const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length
    const variance = returns.reduce((sum, item) => sum + Math.pow(item - mean, 2), 0) / returns.length
    if (variance === 0) return 0
    const stdev = Math.sqrt(variance)
    const kurtosis = returns.reduce((sum, item) => sum + Math.pow((item - mean) / stdev, 4), 0)
    return kurtosis / returns.length - 3
  })
}

function omegaRatio(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 20)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 2 ? Math.floor(rawPeriod) : 20
  const threshold = Number(params?.thresholdReturn ?? 0) / 100
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    let gains = 0
    let shortfall = 0
    for (const item of returns) {
      const excess = item - threshold
      if (excess >= 0) gains += excess
      else shortfall += Math.abs(excess)
    }
    if (shortfall === 0) return gains === 0 ? 0 : gains
    return gains / shortfall
  })
}

function tailRatio(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 60)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 5 ? Math.floor(rawPeriod) : 60
  const upper = Math.max(50, Math.min(Number(params?.upperPercentile ?? 95), 100))
  const lower = Math.max(0, Math.min(Number(params?.lowerPercentile ?? 5), 50))
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    const upperTail = percentile(returns, upper)
    const lowerTail = percentile(returns, lower)
    if (upperTail == null || lowerTail == null || lowerTail === 0) return null
    return upperTail / Math.abs(lowerTail)
  })
}

function valueAtRiskPct(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 60)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 5 ? Math.floor(rawPeriod) : 60
  const confidence = Math.max(50, Math.min(Number(params?.confidence ?? 95), 99.9))
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    const cutoff = percentile(returns, 100 - confidence)
    if (cutoff == null) return null
    return Math.max(0, -cutoff * 100)
  })
}

function conditionalValueAtRiskPct(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 60)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 5 ? Math.floor(rawPeriod) : 60
  const confidence = Math.max(50, Math.min(Number(params?.confidence ?? 95), 99.9))
  return values.map((_value, index) => {
    const returns = windowReturns(values, period, index)
    if (!returns) return null
    const cutoff = percentile(returns, 100 - confidence)
    if (cutoff == null) return null
    const losses = returns.filter((item) => item <= cutoff)
    if (losses.length === 0) return Math.max(0, -cutoff * 100)
    const meanTail = losses.reduce((sum, item) => sum + item, 0) / losses.length
    return Math.max(0, -meanTail * 100)
  })
}

function windowReturns(values: number[], period: number, index: number): number[] | null {
  if (period < 1 || index < period) return null
  const returns: number[] = []
  for (let i = index - period + 1; i <= index; i++) {
    if (values[i - 1] === 0) return null
    returns.push((values[i] - values[i - 1]) / values[i - 1])
  }
  return returns
}

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 1) return sorted[0]
  const bounded = Math.max(0, Math.min(percentileValue, 100))
  const position = (bounded / 100) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  const fraction = position - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction
}

function volatilityRegime(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawShort = Number(params?.shortPeriod ?? params?.period ?? 20)
  const shortPeriod = Number.isFinite(rawShort) && rawShort > 1 ? Math.floor(rawShort) : 20
  const rawBaseline = Number(params?.baselinePeriod ?? params?.longPeriod ?? Math.max(shortPeriod * 3, shortPeriod + 1))
  const baselinePeriod = Number.isFinite(rawBaseline) && rawBaseline > shortPeriod
    ? Math.floor(rawBaseline)
    : Math.max(shortPeriod * 3, shortPeriod + 1)
  const shortVol = rollingVolatility(values, Math.max(2, shortPeriod))
  const baselineVol = rollingVolatility(values, Math.max(Math.max(3, baselinePeriod), shortPeriod + 1))
  return values.map((_, index) => {
    const current = shortVol[index]
    const baseline = baselineVol[index]
    if (current == null || baseline == null || baseline === 0) return null
    if (current >= baseline * 1.2) return 1
    if (current <= baseline * 0.8) return -1
    return 0
  })
}

function volatilityPercentile(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 20)
  const rawBaseline = Number(params?.baselinePeriod ?? 60)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 2 ? Math.floor(rawPeriod) : 20
  const baselinePeriod = Number.isFinite(rawBaseline) && rawBaseline >= 3 ? Math.floor(rawBaseline) : 60
  const safeBaseline = Math.max(Math.max(3, baselinePeriod), period + 1)
  const volatility = rollingVolatility(values, period)
  return values.map((_value, index) => {
    const current = volatility[index]
    if (current == null || index + 1 < safeBaseline) return null
    const window = volatility.slice(index + 1 - safeBaseline, index + 1).filter((value): value is number => value != null)
    if (window.length < safeBaseline) return null
    const belowOrEqual = window.filter((item) => item <= current).length
    return (belowOrEqual / window.length) * 100
  })
}

function emaSlope(values: number[], period: number): Array<number | null> {
  const emaValues = ema(values, period)
  return values.map((_, index) => {
    const current = emaValues[index]
    const previous = index > 0 ? emaValues[index - 1] : null
    if (current == null || previous == null || previous === 0) return null
    return ((current - previous) / previous) * 100
  })
}

function movingAverageRegime(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawFast = Number(params?.fastPeriod ?? params?.fast ?? 20)
  const rawSlow = Number(params?.slowPeriod ?? params?.slow ?? 50)
  const fastInput = Number.isFinite(rawFast) && rawFast > 0 ? rawFast : 20
  const slowInput = Number.isFinite(rawSlow) && rawSlow > 0 ? rawSlow : 50
  const fast = Math.min(fastInput, slowInput)
  const slow = Math.max(fastInput, slowInput)
  const fastMa = sma(values, fast)
  const slowMa = sma(values, slow)
  return values.map((close, index) => {
    const fastValue = fastMa[index]
    const slowValue = slowMa[index]
    if (fastValue == null || slowValue == null) return null
    if (close > fastValue && fastValue > slowValue) return 1
    if (close < fastValue && fastValue < slowValue) return -1
    return 0
  })
}

function kamaDistancePct(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const kamaValues = kama(values, params)
  return values.map((value, index) => {
    const base = kamaValues[index]
    if (base == null || base === 0) return null
    return ((value - base) / base) * 100
  })
}

function kamaSlopePct(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const kamaValues = kama(values, params)
  return kamaValues.map((value, index) => {
    if (index === 0 || value == null || kamaValues[index - 1] == null) return null
    const previous = kamaValues[index - 1]
    if (previous == null || previous === 0) return null
    return ((value - previous) / previous) * 100
  })
}

function kama(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const erPeriod = Math.max(2, positiveInteger(params?.erPeriod ?? params?.period, 10))
  const fastPeriod = Math.max(1, positiveInteger(params?.fastPeriod ?? params?.fast, 2))
  const slowPeriod = Math.max(fastPeriod + 1, positiveInteger(params?.slowPeriod ?? params?.slow, 30))
  const fastSc = 2 / (fastPeriod + 1)
  const slowSc = 2 / (slowPeriod + 1)
  const out: Array<number | null> = Array(values.length).fill(null)
  let previous: number | null = null
  for (let index = 0; index < values.length; index++) {
    if (index < erPeriod) continue
    if (previous == null) {
      previous = values.slice(index - erPeriod, index + 1).reduce((sum, item) => sum + item, 0) / (erPeriod + 1)
    } else {
      const change = Math.abs(values[index] - values[index - erPeriod])
      let volatility = 0
      for (let i = index - erPeriod + 1; i <= index; i++) {
        volatility += Math.abs(values[i] - values[i - 1])
      }
      const efficiency = volatility === 0 ? 0 : change / volatility
      const smoothing = (efficiency * (fastSc - slowSc) + slowSc) ** 2
      previous += smoothing * (values[index] - previous)
    }
    out[index] = previous
  }
  return out
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value ?? fallback)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function linearRegressionSlopePct(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => {
    const stats = linearRegressionStats(values, index, period)
    if (!stats || stats.intercept === 0) return null
    return (stats.slope / stats.intercept) * 100
  })
}

function linearRegressionR2(values: number[], period: number): Array<number | null> {
  return values.map((_value, index) => linearRegressionStats(values, index, period)?.rSquared ?? null)
}

function linearRegressionStats(
  values: number[],
  index: number,
  period: number,
): { slope: number, intercept: number, rSquared: number } | null {
  if (period < 2 || index + 1 < period) return null
  const start = index + 1 - period
  const meanX = (period - 1) / 2
  let meanY = 0
  for (let i = 0; i < period; i++) meanY += values[start + i]
  meanY /= period

  let sumXX = 0
  let sumXY = 0
  let totalSS = 0
  for (let i = 0; i < period; i++) {
    const x = i
    const y = values[start + i]
    const dx = x - meanX
    const dy = y - meanY
    sumXX += dx * dx
    sumXY += dx * dy
    totalSS += dy * dy
  }
  if (sumXX === 0) return null
  const slope = sumXY / sumXX
  const intercept = meanY - slope * meanX
  let residualSS = 0
  for (let i = 0; i < period; i++) {
    const fitted = intercept + slope * i
    const residual = values[start + i] - fitted
    residualSS += residual * residual
  }
  const rawR2 = totalSS === 0 ? 1 : 1 - (residualSS / totalSS)
  return { slope, intercept, rSquared: Math.min(1, Math.max(0, rawR2)) }
}

function maDistancePct(values: number[], period: number): Array<number | null> {
  const average = sma(values, period)
  return values.map((value, index) => {
    const base = average[index]
    if (base == null || base === 0) return null
    return ((value - base) / base) * 100
  })
}

function priceZScore(values: number[], period: number): Array<number | null> {
  return zScore(values, period)
}

function zScore(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    if (index + 1 < period) return null
    const window = values.slice(index + 1 - period, index + 1)
    const mean = window.reduce((a, b) => a + b, 0) / period
    const variance = window.reduce((sum, item) => sum + (item - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    return std > 0 ? (value - mean) / std : 0
  })
}

function bollingerBandwidth(values: number[], period: number): Array<number | null> {
  return bollingerBandValue(values, { period }, (_value, bands) => {
    if (bands.middle === 0) return null
    return ((bands.upper - bands.lower) / bands.middle) * 100
  })
}

function bollingerPercentB(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  return bollingerBandValue(values, params, (value, bands) => {
    const width = bands.upper - bands.lower
    if (width === 0) return 50
    return ((value - bands.lower) / width) * 100
  })
}

function bollingerBandDistancePct(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  return bollingerBandValue(values, params, (value, bands) => {
    if (value === 0) return null
    if (value > bands.upper) return ((value - bands.upper) / value) * 100
    if (value < bands.lower) return ((value - bands.lower) / value) * 100
    return 0
  })
}

type BollingerBands = {
  middle: number
  upper: number
  lower: number
}

function bollingerBandValue(
  values: number[],
  params: Record<string, unknown> | undefined,
  compute: (value: number, bands: BollingerBands) => number | null,
): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 20)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 20
  const rawMultiplier = Number(params?.stdDevMultiplier ?? params?.stdDev ?? 2)
  const multiplier = Number.isFinite(rawMultiplier) ? Math.max(0, rawMultiplier) : 2
  return values.map((value, index) => {
    const bands = bollingerBandsAt(values, index, period, multiplier)
    if (!bands) return null
    return compute(value, bands)
  })
}

function bollingerBandsAt(values: number[], index: number, period: number, multiplier: number): BollingerBands | null {
  if (index + 1 < period) return null
  const window = values.slice(index + 1 - period, index + 1)
  const mean = window.reduce((a, b) => a + b, 0) / period
  const variance = window.reduce((sum, item) => sum + (item - mean) ** 2, 0) / period
  const std = Math.sqrt(variance)
  return {
    middle: mean,
    upper: mean + multiplier * std,
    lower: mean - multiplier * std,
  }
}

function kdjK(bars: KlineBar[], period: number): Array<number | null> {
  return kdjComponents(bars, period).k
}

function kdjComponents(bars: KlineBar[], period: number): {
  k: Array<number | null>
  d: Array<number | null>
  j: Array<number | null>
} {
  const out: Array<number | null> = Array(bars.length).fill(null)
  const dValues: Array<number | null> = Array(bars.length).fill(null)
  const jValues: Array<number | null> = Array(bars.length).fill(null)
  let k = 50
  let d = 50
  for (let index = 0; index < bars.length; index++) {
    if (index + 1 < period) continue
    const window = bars.slice(index + 1 - period, index + 1)
    const highestHigh = Math.max(...window.map((bar) => bar.high))
    const lowestLow = Math.min(...window.map((bar) => bar.low))
    const rsv = highestHigh === lowestLow ? 50 : ((bars[index].close - lowestLow) / (highestHigh - lowestLow)) * 100
    k = (2 / 3) * k + (1 / 3) * rsv
    d = (2 / 3) * d + (1 / 3) * k
    out[index] = k
    dValues[index] = d
    jValues[index] = 3 * k - 2 * d
  }
  return { k: out, d: dValues, j: jValues }
}

function adx(bars: KlineBar[], period: number): Array<number | null> {
  const plusDi = directionalMovement(bars, period, 'plus')
  const minusDi = directionalMovement(bars, period, 'minus')
  const dx = bars.map((_bar, index) => {
    const plus = plusDi[index]
    const minus = minusDi[index]
    if (plus == null || minus == null) return null
    const sum = plus + minus
    if (sum === 0) return null
    return (Math.abs(plus - minus) / sum) * 100
  })
  return smaNullable(dx, period)
}

function directionalMovement(bars: KlineBar[], period: number, mode: 'plus' | 'minus' | 'spread'): Array<number | null> {
  const plusDm = Array(bars.length).fill(0)
  const minusDm = Array(bars.length).fill(0)
  const trueRange = Array(bars.length).fill(0)
  for (let index = 1; index < bars.length; index++) {
    const upMove = bars[index].high - bars[index - 1].high
    const downMove = bars[index - 1].low - bars[index].low
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0
    trueRange[index] = Math.max(
      bars[index].high - bars[index].low,
      Math.abs(bars[index].high - bars[index - 1].close),
      Math.abs(bars[index].low - bars[index - 1].close),
    )
  }
  const smoothedPlus = sma(plusDm, period)
  const smoothedMinus = sma(minusDm, period)
  const smoothedTr = sma(trueRange, period)
  return bars.map((_, index) => {
    const tr = smoothedTr[index]
    if (tr == null || tr === 0) return null
    const plusDi = ((smoothedPlus[index] ?? 0) / tr) * 100
    const minusDi = ((smoothedMinus[index] ?? 0) / tr) * 100
    if (mode === 'minus') return minusDi
    if (mode === 'spread') return plusDi - minusDi
    return plusDi
  })
}

function macdHistogram(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const fast = Number(params?.fastPeriod ?? params?.fast ?? 12)
  const slow = Number(params?.slowPeriod ?? params?.slow ?? 26)
  const signal = Number(params?.signalPeriod ?? params?.signal ?? 9)
  const fastEma = ema(values, fast)
  const slowEma = ema(values, slow)
  const macdLine = values.map((_, index) => {
    const fastValue = fastEma[index]
    const slowValue = slowEma[index]
    return fastValue == null || slowValue == null ? null : fastValue - slowValue
  })
  const signalLine = emaNullable(macdLine, signal)
  return macdLine.map((value, index) => value == null || signalLine[index] == null ? null : value - signalLine[index]!)
}

function ppoHistogram(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const fast = Number(params?.fastPeriod ?? params?.fast ?? 12)
  const slow = Number(params?.slowPeriod ?? params?.slow ?? 26)
  const signal = Number(params?.signalPeriod ?? params?.signal ?? 9)
  const fastEma = ema(values, fast)
  const slowEma = ema(values, slow)
  const ppoLine = values.map((_value, index) => {
    if (fastEma[index] == null || slowEma[index] == null || slowEma[index] === 0) return null
    return ((fastEma[index]! - slowEma[index]!) / slowEma[index]!) * 100
  })
  const signalLine = emaNullable(ppoLine, signal)
  return ppoLine.map((value, index) => value == null || signalLine[index] == null ? null : value - signalLine[index]!)
}

function trix(values: number[], period: number): Array<number | null> {
  const first = ema(values, period)
  const second = emaNullable(first, period)
  const third = emaNullable(second, period)
  return values.map((_value, index) => {
    if (index === 0) return null
    const current = third[index]
    const previous = third[index - 1]
    if (current == null || previous == null || previous === 0) return null
    return ((current - previous) / previous) * 100
  })
}

function trueStrengthIndex(values: number[], params: Record<string, unknown> | undefined): Array<number | null> {
  const longPeriod = Number(params?.longPeriod ?? params?.long ?? 25)
  const shortPeriod = Number(params?.shortPeriod ?? params?.short ?? 13)
  const momentum = values.map((value, index) => index === 0 ? null : value - values[index - 1])
  const absMomentum = momentum.map((value) => value == null ? null : Math.abs(value))
  const smoothedMomentum = emaNullable(emaNullable(momentum, longPeriod), shortPeriod)
  const smoothedAbsMomentum = emaNullable(emaNullable(absMomentum, longPeriod), shortPeriod)
  return values.map((_value, index) => {
    const numerator = smoothedMomentum[index]
    const denominator = smoothedAbsMomentum[index]
    if (numerator == null || denominator == null || denominator === 0) return null
    return (numerator / denominator) * 100
  })
}

function bollingerZScore(values: number[], period: number): Array<number | null> {
  return values.map((value, index) => {
    const bands = bollingerBandsAt(values, index, Math.max(1, period), 1)
    if (!bands) return null
    const std = bands.upper - bands.middle
    return std > 0 ? (value - bands.middle) / std : 0
  })
}

function atr(bars: KlineBar[], period: number): Array<number | null> {
  const trueRanges = bars.map((bar, index) => {
    const previousClose = index > 0 ? bars[index - 1].close : bar.close
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
  })
  return sma(trueRanges, period)
}

function chandelierStopDistancePct(bars: KlineBar[], params: Record<string, unknown> | undefined): Array<number | null> {
  const rawPeriod = Number(params?.period ?? 22)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 22
  const rawAtrPeriod = Number(params?.atrPeriod ?? period)
  const atrPeriod = Number.isFinite(rawAtrPeriod) && rawAtrPeriod >= 1 ? Math.floor(rawAtrPeriod) : period
  const rawMultiplier = Number(params?.atrMultiplier ?? 3)
  const multiplier = Number.isFinite(rawMultiplier) ? rawMultiplier : 3
  const atrValues = atr(bars, atrPeriod)
  return bars.map((bar, index) => {
    if (index + 1 < period) return null
    const atrValue = atrValues[index]
    if (atrValue == null || bar.close === 0) return null
    const highestHigh = Math.max(...bars.slice(index + 1 - period, index + 1).map((item) => item.high))
    const stop = highestHigh - multiplier * atrValue
    return ((bar.close - stop) / bar.close) * 100
  })
}

function supertrendComponents(bars: KlineBar[], params: Record<string, unknown> | undefined): {
  direction: Array<number | null>
  distancePct: Array<number | null>
} {
  const rawPeriod = Number(params?.period ?? 10)
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 1 ? Math.floor(rawPeriod) : 10
  const rawMultiplier = Number(params?.atrMultiplier ?? 3)
  const multiplier = Number.isFinite(rawMultiplier) ? rawMultiplier : 3
  const atrValues = atr(bars, period)
  const direction: Array<number | null> = Array(bars.length).fill(null)
  const distancePct: Array<number | null> = Array(bars.length).fill(null)
  let upperBand: number | null = null
  let lowerBand: number | null = null
  let trendLine: number | null = null
  let trend = 1
  for (let index = 0; index < bars.length; index++) {
    const atrValue = atrValues[index]
    if (atrValue == null) continue
    const bar = bars[index]
    const midpoint = (bar.high + bar.low) / 2
    const basicUpper = midpoint + multiplier * atrValue
    const basicLower = midpoint - multiplier * atrValue
    if (upperBand == null || lowerBand == null || index === 0) {
      upperBand = basicUpper
      lowerBand = basicLower
    } else {
      const previousClose = bars[index - 1].close
      upperBand = basicUpper < upperBand || previousClose > upperBand ? basicUpper : upperBand
      lowerBand = basicLower > lowerBand || previousClose < lowerBand ? basicLower : lowerBand
    }
    if (trendLine == null) {
      trend = bar.close >= lowerBand ? 1 : -1
    } else if (trendLine === upperBand) {
      trend = bar.close > upperBand ? 1 : -1
    } else {
      trend = bar.close < lowerBand ? -1 : 1
    }
    trendLine = trend === 1 ? lowerBand : upperBand
    direction[index] = trend
    distancePct[index] = bar.close === 0 ? null : ((bar.close - trendLine) / bar.close) * 100
  }
  return { direction, distancePct }
}

function rollingExtreme(values: number[], period: number, fn: (...values: number[]) => number): Array<number | null> {
  return values.map((_, index) => index + 1 < period ? null : fn(...values.slice(index + 1 - period, index + 1)))
}

function emaNullable(values: Array<number | null>, period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (period <= 0) return out
  const multiplier = 2 / (period + 1)
  let previous: number | null = null
  const seeded: number[] = []
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (value == null) continue
    if (previous == null) {
      seeded.push(value)
      if (seeded.length < period) continue
      previous = seeded.slice(seeded.length - period).reduce((a, b) => a + b, 0) / period
    } else {
      previous = value * multiplier + previous * (1 - multiplier)
    }
    out[index] = previous
  }
  return out
}

function rsi(values: number[], period: number): Array<number | null> {
  return values.map((_, index) => {
    if (index < period) return null
    let gains = 0
    let losses = 0
    for (let i = index - period + 1; i <= index; i++) {
      const change = values[i] - values[i - 1]
      if (change >= 0) gains += change
      else losses -= change
    }
    if (losses === 0) return 100
    const rs = gains / losses
    return 100 - 100 / (1 + rs)
  })
}
