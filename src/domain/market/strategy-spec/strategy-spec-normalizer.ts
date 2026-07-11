import {
  allowedIndicators,
  fundStrategyIndicators,
  makeRef,
  parseIndicatorRef,
  parseRegisteredIndicator,
  type StrategyIndicatorRef,
} from './strategy-spec-registry'

type RuleGroup = { all?: Rule[]; any?: Rule[] }
type Rule =
  | { left: string; op: string; right: unknown }
  | { type: 'stop_loss_pct' | 'take_profit_pct' | 'trailing_stop_pct' | 'max_drawdown_stop_pct' | 'atr_stop_loss' | 'time_stop_bars'; value: number; period?: number }

export interface NormalizedStrategySpec {
  id?: string
  name: string
  version?: number
  market?: string
  universe?: { type?: string; symbols?: string[] }
  timeframe?: string
  dataRequirements?: { minBars?: number; adjust?: string; requiredFields?: string[] }
  indicators?: Array<{ id: string; type: string; source?: string; params?: Record<string, unknown> }>
  entry?: RuleGroup
  exit?: RuleGroup
  positionSizing?: { type?: string; value?: number; riskPct?: number; stopLossPct?: number; maxPositionPct?: number; initialFraction?: number; minTrades?: number; kellyScale?: number }
  risk?: Record<string, unknown>
  cost?: { commissionPct?: number; slippagePct?: number }
  notes?: string[]
}

type LooseStrategySpec = NormalizedStrategySpec & Record<string, unknown>

export function normalizeStrategySpec(input: NormalizedStrategySpec): NormalizedStrategySpec {
  const fundObservation = normalizeFundObservationSpec(input)
  if (fundObservation) return fundObservation

  const loose = input as LooseStrategySpec
  const name = String(input.name ?? 'custom strategy').trim()
  const version = numberOf(input.version, 1)
  const id = input.id || `custom_${slug(name)}_v${version}`
  const rawIndicators = normalizeRawIndicators(loose.indicators ?? loose.observation ?? loose.signals)
  const conditionDslIssues = collectConditionDslIssues(input)
  const indicators = (rawIndicators.length ? rawIndicators : indicatorsFromRules(input) ?? []).map((indicator) => {
    const source = indicator as Record<string, unknown>
    const ref = parseIndicatorRef(String(source.type ?? source.indicator ?? source.name ?? source.id ?? ''))
    const params: Record<string, unknown> = {
      ...(source.params && typeof source.params === 'object' && !Array.isArray(source.params) ? source.params as Record<string, unknown> : {}),
      ...((source.length != null || source.period != null) ? { period: numberOf(source.period ?? source.length, ref.period) } : {}),
    }
    const period = numberOf(params.period, ref.period)
    const rawName = String(source.name ?? '').trim()
    const explicitNameId = rawName && !parseRegisteredIndicator(rawName) ? rawName : undefined
    const idValue = String(source.id ?? source.output ?? source.alias ?? explicitNameId ?? makeRef(ref.type, period).id)
    if (ref.type === 'bollinger') {
      delete params.stdDev
      delete params.std_dev
      delete params.standardDeviation
    } else if (isBollingerBandComponentType(ref.type)) {
      const stdDevMultiplier = params.stdDevMultiplier ?? params.stdDev ?? params.std_dev ?? params.standardDeviation
      if (params.stdDevMultiplier == null && stdDevMultiplier != null) params.stdDevMultiplier = numberOf(stdDevMultiplier, 2)
      delete params.stdDev
      delete params.std_dev
      delete params.standardDeviation
    }
    if (isSupertrendComponentType(ref.type)) {
      const atrMultiplier = params.atrMultiplier ?? params.multiplier ?? params.factor ?? params.atr_factor
      if (params.atrMultiplier == null && atrMultiplier != null) params.atrMultiplier = numberOf(atrMultiplier, 3)
      delete params.multiplier
      delete params.factor
      delete params.atr_factor
    }
    if (ref.type === 'ma_distance_pct') {
      const maPeriod = params.maPeriod ?? params.ma_period ?? params.movingAveragePeriod
      if (params.period == null && maPeriod != null) params.period = numberOf(maPeriod, ref.period)
      delete params.maPeriod
      delete params.ma_period
      delete params.movingAveragePeriod
    }
    return {
      ...source,
      id: idValue,
      type: ref.type,
      source: typeof source.source === 'string' ? source.source : (ref.type === 'volume_sma' ? 'volume' : 'close'),
      params,
    }
  })
  const indicatorIds = new Set(indicators.map((indicator) => String(indicator.id)))
  return {
    ...input,
    id,
    name,
    version,
    timeframe: input.timeframe ?? '1d',
    dataRequirements: {
      minBars: numberOf(input.dataRequirements?.minBars, 120),
      adjust: input.dataRequirements?.adjust ?? 'none',
      requiredFields: input.dataRequirements?.requiredFields ?? ['open', 'high', 'low', 'close', 'volume'],
    },
    indicators,
    entry: normalizeRuleGroup(entrySource(input), [], indicatorIds),
    exit: normalizeRuleGroup(exitSource(input), ['stop_loss_pct', 'take_profit_pct', 'trailing_stop_pct', 'max_drawdown_stop_pct', 'atr_stop_loss', 'time_stop_bars'], indicatorIds),
    positionSizing: normalizeSizing(sizingSource(input)),
    cost: input.cost ?? { commissionPct: 0.1, slippagePct: 0.05 },
    notes: input.notes ?? [],
    ...(conditionDslIssues.length ? { conditionDslIssues } : {}),
  }
}

function isBollingerBandComponentType(type: string): boolean {
  return type === 'bollinger_bandwidth' ||
    type === 'bollinger_percent_b' ||
    type === 'bollinger_band_distance_pct'
}

function isSupertrendComponentType(type: string): boolean {
  return type === 'supertrend_direction' || type === 'supertrend_distance_pct'
}

function normalizeFundObservationSpec(input: NormalizedStrategySpec): NormalizedStrategySpec | null {
  const loose = input as LooseStrategySpec
  const observation = loose.observation
  const explicitAssetClass = String(loose.assetClass ?? loose.asset_class ?? '').toLowerCase()
  const explicitMarket = String(input.market ?? '').toLowerCase()
  const explicitStock =
    explicitAssetClass.includes('stock') ||
    explicitAssetClass.includes('equity') ||
    explicitMarket === 'cn' ||
    explicitMarket.includes('stock')
  const isFund =
    !explicitStock && (
    explicitAssetClass.includes('fund') ||
    String(loose.type ?? '').toLowerCase().includes('fund') ||
    explicitMarket.includes('fund') ||
    (input.universe && String(input.universe.type ?? '').toLowerCase().includes('fund')) ||
    (observation != null && !Array.isArray(observation)))
  if (!isFund) return null
  const observationSource = observation && typeof observation === 'object' && !Array.isArray(observation)
    ? observation as Record<string, unknown>
    : {}
  const name = String(input.name ?? 'fund observation strategy').trim()
  const version = numberOf(input.version, 1)
  const id = input.id || `custom_${slug(name)}_v${version}`
  const rawIndicators = normalizeRawIndicators(input.indicators ?? observationSource.indicators ?? loose.signals)
  const indicators = normalizeFundIndicators(rawIndicators)
  const indicatorIds = new Set(indicators.map((indicator) => String(indicator.id)))
  const observationRules = [
    ...conditionRulesFromObservationList(loose.signals),
    ...conditionRulesFromObservationList(observationSource.entries),
    ...conditionRulesFromObservationList(observationSource.signals),
    ...conditionRulesFromObservationList(observationSource.rules),
  ]
  const entrySource = input.entry ?? loose.entryRule ?? loose.entryConditions ?? fundEntrySource(observationRules)
  const exitSource = input.exit ?? loose.exitRule ?? loose.exitConditions ?? fundExitSource(observationRules, indicators)
  return {
    ...input,
    id,
    name,
    version,
    assetClass: 'fund',
    market: input.market ?? 'fund',
    timeframe: input.timeframe ?? '1d',
    dataRequirements: {
      minBars: numberOf(input.dataRequirements?.minBars, 60),
      adjust: input.dataRequirements?.adjust ?? 'none',
      requiredFields: input.dataRequirements?.requiredFields ?? ['date', 'nav'],
      ...(input.dataRequirements ?? {}),
      dataClass: (input.dataRequirements as Record<string, unknown> | undefined)?.dataClass ?? 'ordinary_fund_nav',
    },
    indicators,
    entry: normalizeRuleGroup(entrySource, [], indicatorIds),
    exit: normalizeRuleGroup(exitSource, [], indicatorIds),
    positionSizing: normalizeSizing(input.positionSizing),
    cost: input.cost ?? { commissionPct: 0, slippagePct: 0 },
    notes: input.notes ?? [],
  } as NormalizedStrategySpec
}

function normalizeFundIndicators(raw: Array<Record<string, unknown>>): NonNullable<NormalizedStrategySpec['indicators']> {
  const out: NonNullable<NormalizedStrategySpec['indicators']> = []
  const seen = new Set<string>()
  for (const source of raw) {
    const mapped = fundIndicatorFromSource(source)
    if (!mapped || seen.has(mapped.id)) continue
    seen.add(mapped.id)
    out.push(mapped)
  }
  if (out.length === 0) {
    out.push(
      { id: 'navTrend20', type: 'nav_trend', source: 'nav', params: { period: 20 } },
      { id: 'fundDrawdown20', type: 'fund_drawdown', source: 'nav', params: { period: 20 } },
    )
  }
  return out
}

function fundIndicatorFromSource(source: Record<string, unknown>): NonNullable<NormalizedStrategySpec['indicators']>[number] | null {
  const rawType = String(source.type ?? source.indicator ?? source.name ?? source.id ?? '').trim()
  const rawSource = String(source.source ?? '').trim().toLowerCase()
  const period = numberOf(source.period ?? source.length ?? (source.params as Record<string, unknown> | undefined)?.period, 20)
  let type = rawType
  let remapped = false
  if (type === 'drawdown_pct' || type === 'drawdown' || type === 'rolling_drawdown') type = 'fund_drawdown'
  if (type !== rawType) remapped = true
  if ((type === 'sma' || type === 'ma' || type === 'moving_average') && (!rawSource || rawSource === 'nav')) {
    type = 'nav_trend'
    remapped = true
  }
  if (type === 'nav' || type === 'nav_sma') {
    type = 'nav_trend'
    remapped = true
  }
  if (!fundStrategyIndicators.has(type)) return null
  const defaultId = type === 'fund_drawdown'
    ? `fundDrawdown${period}`
    : type === 'nav_trend'
      ? `navTrend${period}`
      : `${type.replace(/_([a-z])/g, (_, char) => String(char).toUpperCase())}${period}`
  const explicitId = source.id ?? source.output ?? source.alias
  return {
    ...source,
    id: String(remapped ? defaultId : explicitId ?? defaultId),
    type,
    source: (source.source as string | undefined) ?? (type === 'money_yield' || type === 'seven_day_yield' ? 'yield' : 'nav'),
    params: {
      ...(source.params && typeof source.params === 'object' && !Array.isArray(source.params) ? source.params as Record<string, unknown> : {}),
      period,
    },
  }
}

function conditionRulesFromObservationList(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      label: item.label,
      action: item.action,
      weight: item.weight,
      ...(item.condition && typeof item.condition === 'object' && !Array.isArray(item.condition)
        ? item.condition as Record<string, unknown>
        : item),
    }))
}

function fundEntrySource(rules: Record<string, unknown>[]): RuleGroup {
  const candidates = rules.filter((rule) => !isFundExitObservation(rule))
  return { all: normalizeFundObservationRules(candidates.length ? candidates : rules.slice(0, 1)) }
}

function fundExitSource(
  rules: Record<string, unknown>[],
  indicators: NonNullable<NormalizedStrategySpec['indicators']> = [],
): RuleGroup {
  const candidates = rules.filter(isFundExitObservation)
  if (candidates.length) return { any: normalizeFundObservationRules(candidates) }
  const drawdown = indicators.find((indicator) => indicator.type === 'fund_drawdown')
  return { any: [{ left: drawdown?.id ?? 'fundDrawdown20', op: '>=', right: 15 }] }
}

function normalizeFundObservationRules(rules: Record<string, unknown>[]): Rule[] {
  return rules.flatMap((rule) => {
    if (Array.isArray(rule.all)) return rule.all.filter(isRecord).map(normalizeFundObservationRule)
    if (Array.isArray(rule.any)) return rule.any.filter(isRecord).map(normalizeFundObservationRule)
    return [normalizeFundObservationRule(rule)]
  })
}

function normalizeFundObservationRule(rule: Record<string, unknown>): Rule {
  const left = fundRuleSide(rule.left ?? rule.indicator ?? rule.type)
  const normalizedLeft = normalizeFundRuleLeft(left, numberOf(rule.period ?? (rule.params as Record<string, unknown> | undefined)?.period, 20))
  const rawRight = rule.right ?? rule.threshold ?? rule.value
  const right = normalizeFundRuleRight(normalizedLeft, rawRight, left)
  if (left === 'nav' && String(right).toLowerCase().startsWith('sma')) {
    return { left: 'navTrend20', op: String(rule.op ?? rule.operator ?? '>').trim() || '>', right: 0 }
  }
  return {
    left: normalizedLeft,
    op: normalizeFundRuleOp(normalizedLeft, String(rule.op ?? rule.operator ?? '').trim()),
    right: typeof right === 'string' && right.toLowerCase().startsWith('sma') ? 0 : right,
  }
}

function normalizeFundRuleOp(left: string, raw: string): string {
  const op = normalizeOperator(raw) || '>='
  return left.startsWith('fundDrawdown') && (op === '<' || op === '<=')
    ? '>='
    : op
}

function fundRuleSide(raw: unknown): string {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const source = raw as Record<string, unknown>
    return String(source.indicator ?? source.id ?? source.source ?? source.field ?? '').trim()
  }
  return String(raw ?? '').trim()
}

function normalizeFundRuleRight(left: string, raw: unknown, rawLeft = ''): unknown {
  const valueSource = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).value ?? (raw as Record<string, unknown>).threshold
    : raw
  const isDrawdown = left.startsWith('fundDrawdown') || /(^|_)dd($|_)|drawdown/i.test(rawLeft)
  if (!isDrawdown) return valueSource
  const value = numericValue(valueSource)
  if (value == null) return raw
  const absolute = Math.abs(value)
  return absolute > 0 && absolute <= 1 ? absolute * 100 : absolute
}

function normalizeFundRuleLeft(raw: string, period = 20): string {
  if (/^[a-z][a-z0-9_]*_\d+$/i.test(raw)) return raw
  if (/drawdown/i.test(raw)) return `fundDrawdown${period}`
  if (/navtrend|trend|sma|ma/i.test(raw)) return `navTrend${period}`
  if (fundStrategyIndicators.has(raw)) {
    return `${raw.replace(/_([a-z])/g, (_, char) => String(char).toUpperCase())}${period}`
  }
  return raw || 'navTrend20'
}

function isFundExitObservation(rule: Record<string, unknown>): boolean {
  const text = `${String(rule.label ?? '')} ${String(rule.action ?? '')}`.toLowerCase()
  return /pause|stop|exit|redeem|risk|暂停|赎回|退出|风控|止损/.test(text)
}

function indicatorsFromRules(input: NormalizedStrategySpec): NormalizedStrategySpec['indicators'] {
  const loose = input as LooseStrategySpec
  const seen = new Set<string>()
  const indicators: NonNullable<NormalizedStrategySpec['indicators']> = []
  for (const group of [entrySource(input), exitSource(input)] as unknown[]) {
    for (const raw of looseConditionList(group)) {
      if (!raw || typeof raw !== 'object') continue
      const condition = raw as Record<string, unknown>
      for (const ref of indicatorRefs(condition)) {
        const type = ref.type
        if (!allowedIndicators.has(type) || seen.has(ref.id)) continue
        seen.add(ref.id)
        indicators.push({
          id: ref.id,
          type,
          source: type === 'volume_sma' ? 'volume' : 'close',
          params: { period: ref.period },
        })
      }
    }
  }
  return indicators
}

function normalizeRuleGroup(raw: unknown, extraStops: string[] = [], indicatorIds = new Set<string>()): RuleGroup | undefined {
  if (Array.isArray(raw)) raw = { all: raw }
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const explicit = (Array.isArray(source.all) ? source.all : undefined) ??
    (Array.isArray(source.any) ? source.any : undefined) ??
    (Array.isArray(source.and) ? source.and : undefined) ??
    (Array.isArray(source.or) ? source.or : undefined) ??
    (Array.isArray(source.rules) ? flattenNestedRules(source.rules) : undefined)
  const rules: Rule[] = []
  if (explicit) {
    rules.push(
      ...explicit
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => normalizeExplicitRule(item, indicatorIds)),
    )
  } else {
    for (const rawRule of looseConditionList(source)) {
      if (!rawRule || typeof rawRule !== 'object') continue
      const condition = rawRule as Record<string, unknown>
      const leftRef = leftIndicatorRef(condition)
      const indicator = leftRef.type
      const op = operatorFromRule(condition)
      if (!indicator || !op) continue
      rules.push({
        left: normalizedRuleLeft(condition, leftRef, indicatorIds),
        op,
        right: indicator === 'volume_sma' ? volumeComparisonRight(leftRef, condition, indicatorIds) : rightValue(condition, indicatorIds),
      })
    }
  }
  for (const type of extraStops) {
    const value = numericValue(source[type])
    if (value != null) rules.push({ type: type as 'stop_loss_pct' | 'take_profit_pct' | 'trailing_stop_pct' | 'max_drawdown_stop_pct' | 'atr_stop_loss' | 'time_stop_bars', value })
  }
  if (rules.length === 0) return raw as RuleGroup
  return isAnyRuleGroup(source) ? { any: rules } : { all: rules }
}

function isAnyRuleGroup(source: Record<string, unknown>): boolean {
  if (Array.isArray(source.any) || Array.isArray(source.or)) return true
  if (Array.isArray(source.rules) && source.rules.some((item) =>
    !!item && typeof item === 'object' && !Array.isArray(item) && Array.isArray((item as Record<string, unknown>).any),
  )) return true
  const op = String(source.operator ?? source.op ?? source.logic ?? '').trim().toLowerCase()
  return op === 'or' || op === 'any' || op === '||' || op === '任一'
}

function normalizeExplicitRule(rule: Record<string, unknown>, indicatorIds = new Set<string>()): Rule {
  if ('type' in rule && isStopRuleType(rule.type)) return rule as Rule
  for (const key of ['stop_loss_pct', 'take_profit_pct', 'trailing_stop_pct', 'max_drawdown_stop_pct', 'atr_stop_loss', 'time_stop_bars']) {
    const value = numericValue(rule[key])
    if (value != null) return { type: key as 'stop_loss_pct' | 'take_profit_pct' | 'trailing_stop_pct' | 'max_drawdown_stop_pct' | 'atr_stop_loss' | 'time_stop_bars', value }
  }
  const leftRef = leftIndicatorRef(rule)
  const indicator = leftRef.type
  const op = operatorFromRule(rule)
  const { type: _type, ...comparisonRule } = rule
  return {
    ...(comparisonRule as Record<string, unknown>),
    left: normalizedRuleLeft(rule, leftRef, indicatorIds),
    op,
    right: indicator === 'volume_sma' ? volumeComparisonRight(leftRef, rule, indicatorIds) : rightValue(rule, indicatorIds),
  } as Rule
}

function flattenNestedRules(raw: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (Array.isArray(source.all)) {
      out.push(...source.all.filter(isRecord))
      continue
    }
    if (Array.isArray(source.any)) {
      out.push(...source.any.filter(isRecord))
      continue
    }
    out.push(source)
  }
  return out
}

function normalizeOperator(raw: string): string {
  const op = raw.trim()
  if (op === 'crosses_up' || op === 'cross_up' || op === 'crosses over') return 'crosses_above'
  if (op === 'crosses_down' || op === 'cross_down' || op === 'crosses under') return 'crosses_below'
  return op
}

function operatorFromRule(rule: Record<string, unknown>): string {
  const typeOperator = !isStopRuleType(rule.type) ? rule.type : undefined
  const direct = normalizeOperator(String(rule.operator ?? rule.op ?? typeOperator ?? '').trim())
  if (direct) return direct
  for (const key of Object.keys(rule)) {
    const normalized = normalizeOperatorKey(key)
    if (normalized) return normalized
  }
  return ''
}

function isStopRuleType(raw: unknown): boolean {
  return [
    'stop_loss_pct',
    'take_profit_pct',
    'trailing_stop_pct',
    'max_drawdown_stop_pct',
    'atr_stop_loss',
    'time_stop_bars',
  ].includes(String(raw ?? ''))
}

function normalizeOperatorKey(raw: string): string {
  const compact = raw.replace(/[,\s，]/g, '')
  if (['>', '>=', '<', '<=', '==', '!='].includes(compact)) return compact
  const lower = raw.trim().toLowerCase().replace(/[_\s-]+/g, '_')
  if (lower === 'crosses_up' || lower === 'cross_up' || lower === 'crosses_above') return 'crosses_above'
  if (lower === 'crosses_down' || lower === 'cross_down' || lower === 'crosses_below') return 'crosses_below'
  return ''
}

function normalizedRuleLeft(rule: Record<string, unknown>, leftRef: StrategyIndicatorRef, indicatorIds: Set<string>): string {
  if (rule.left && typeof rule.left === 'object' && !Array.isArray(rule.left)) {
    if (leftRef.type === 'volume' || leftRef.type === 'volume_sma') return 'volume'
    return leftRef.id
  }
  const rawLeft = String(rule.left ?? rule.lhs ?? rule.indicator ?? '').trim()
  if (indicatorIds.has(rawLeft)) return rawLeft
  if (leftRef.type === 'volume' || leftRef.type === 'volume_sma') return 'volume'
  if (/^close_?\d*$/i.test(rawLeft)) return 'close'
  if (rawLeft && rawLeft !== 'close' && !parseRegisteredIndicator(rawLeft)) return rawLeft
  return leftRef.id
}

function looseConditionList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const source = raw as Record<string, unknown>
  const out: unknown[] = []
  if ('left' in source || 'indicator' in source) out.push(source)
  for (const key of ['conditions', 'rules', 'all', 'any', 'and', 'or']) {
    const value = source[key]
    if (Array.isArray(value)) out.push(...value)
  }
  return out
}

function normalizeRawIndicators(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, Record<string, unknown>] => !!entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1]))
      .map(([id, value]) => ({ id, ...value }))
  }
  return []
}

function normalizeSizing(raw: NormalizedStrategySpec['positionSizing'] | unknown): NormalizedStrategySpec['positionSizing'] {
  if (typeof raw === 'string') return { type: normalizeSizingType(raw) }
  if (!raw || typeof raw !== 'object') return { type: 'full_capital' }
  const source = raw as Record<string, unknown>
  const type = normalizeSizingType(String(source.type ?? source.method ?? 'full_capital'))
  const value = numericValue(source.value) ?? numericValue(source.fraction)
  const riskPct = numericValue(source.riskPct) ?? numericValue(source.risk_per_trade_pct) ?? numericValue(source.riskPerTradePct)
  const stopLossPct = numericValue(source.stopLossPct) ?? numericValue(source.stop_loss_pct)
  const maxPositionPct = numericValue(source.maxPositionPct) ?? numericValue(source.max_position_pct)
  const initialFraction = numericValue(source.initialFraction) ?? numericValue(source.initial_fraction) ?? numericValue(source.fallbackFraction) ?? numericValue(source.fallback_fraction)
  const minTrades = numericValue(source.minTrades) ?? numericValue(source.min_trades)
  const kellyScale = numericValue(source.kellyScale) ?? numericValue(source.kelly_scale)
  return {
    ...(source as NormalizedStrategySpec['positionSizing']),
    type,
    ...(value != null ? { value } : {}),
    ...(riskPct != null ? { riskPct } : {}),
    ...(stopLossPct != null ? { stopLossPct } : {}),
    ...(maxPositionPct != null ? { maxPositionPct } : {}),
    ...(initialFraction != null ? { initialFraction } : {}),
    ...(minTrades != null ? { minTrades } : {}),
    ...(kellyScale != null ? { kellyScale } : {}),
  }
}

function indicatorRefs(rule: Record<string, unknown>): StrategyIndicatorRef[] {
  const refs = [leftIndicatorRef(rule)]
  if (rule.indicator2 != null || rule.params2 != null || rule.period2 != null) {
    refs.push(refFromObject({
      indicator: rule.indicator2,
      params: rule.params2,
      period: rule.period2,
      length: rule.length2,
    }))
  }
  if (rule.reference && typeof rule.reference === 'object') refs.push(refFromObject(rule.reference as Record<string, unknown>))
  if (rule.referenceIndicator != null || rule.referencePeriod != null) {
    refs.push(refFromObject({
      indicator: rule.referenceIndicator ?? rule.reference,
      period: rule.referencePeriod ?? rule.period,
    }))
  }
  if (rule.value && typeof rule.value === 'object') refs.push(...refsFromRightObject(rule.value as Record<string, unknown>))
  if (rule.right && typeof rule.right === 'object') refs.push(...refsFromRightObject(rule.right as Record<string, unknown>))
  if (rule.expression && typeof rule.expression === 'object') {
    refs.push(...indicatorRefs(rule.expression as Record<string, unknown>))
  }
  const expression = `${String(rule.valueExpression ?? '')} ${String(rule.expression ?? '')} ${String(rule.value ?? '')}`
  const match = expression.match(/volume_sma(?:[_ ]?|\()?(\d+)?\)?/)
  if (match) refs.push(makeRef('volume_sma', Number(match[1]) || 20))
  return refs
}

function leftIndicatorRef(rule: Record<string, unknown>): StrategyIndicatorRef {
  if (rule.left && typeof rule.left === 'object') return refFromObject(rule.left as Record<string, unknown>)
  const parsed = parseIndicatorRef(String(rule.indicator ?? rule.left ?? rule.lhs ?? rule.ref ?? '').trim())
  const params = rule.params && typeof rule.params === 'object' && !Array.isArray(rule.params)
    ? rule.params as Record<string, unknown>
    : {}
  const period = numberOf(rule.period ?? rule.length ?? params.period, parsed.period)
  return makeRef(parsed.type, period)
}

function refFromObject(raw: Record<string, unknown>): StrategyIndicatorRef {
  const parsed = parseIndicatorRef(String(raw.indicator ?? raw.type ?? raw.left ?? raw.field ?? raw.ref ?? raw.name ?? raw.id ?? '').trim())
  const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
    ? raw.params as Record<string, unknown>
    : {}
  const period = numberOf(raw.period ?? raw.length ?? params.period, parsed.period)
  return makeRef(parsed.type, period)
}

function refsFromRightObject(raw: Record<string, unknown>): StrategyIndicatorRef[] {
  if (Array.isArray(raw.mul)) {
    const [left] = raw.mul
    if (typeof left === 'string') return [parseIndicatorRef(left)]
    return []
  }
  return [refFromObject(raw)]
}

function rightValue(condition: Record<string, unknown>, indicatorIds = new Set<string>()): unknown {
  if (typeof condition.rhs === 'string') {
    if (indicatorIds.has(condition.rhs)) return condition.rhs
    const ref = parseIndicatorRef(condition.rhs)
    if (allowedIndicators.has(ref.type) || indicatorIds.has(ref.id)) return ref.id
  }
  if (condition.indicator2 != null || condition.params2 != null || condition.period2 != null) {
    const ref = refFromObject({
      indicator: condition.indicator2,
      params: condition.params2,
      period: condition.period2,
      length: condition.length2,
    })
    return ref.id
  }
  if (condition.reference && typeof condition.reference === 'object') {
    const ref = refFromObject(condition.reference as Record<string, unknown>)
    return { mul: [ref.id, numericValue(condition.scale) ?? numericValue(condition.multiplier) ?? 1] }
  }
  if (condition.referenceIndicator != null || condition.referencePeriod != null) {
    const ref = refFromObject({
      indicator: condition.referenceIndicator ?? condition.reference,
      period: condition.referencePeriod ?? condition.period,
    })
    return { mul: [ref.id, numericValue(condition.scale) ?? numericValue(condition.multiplier) ?? 1] }
  }
  if (condition.value && typeof condition.value === 'object') {
    const value = condition.value as Record<string, unknown>
    if (Array.isArray(value.mul)) return normalizeMulRight(value, indicatorIds)
    const ref = refFromObject(value)
    return { mul: [ref.id, numericValue(value.scale) ?? numericValue(value.multiplier) ?? numericValue(value.factor) ?? numericValue(condition.scale) ?? numericValue(condition.multiplier) ?? numericValue(condition.factor) ?? 1] }
  }
  if (typeof condition.value === 'string') {
    const ref = parseIndicatorRef(condition.value)
    if (ref.type === 'volume_sma') {
      return { mul: [ref.id, numericValue(condition.scale) ?? numericValue(condition.multiplier) ?? numericValue(condition.factor) ?? 1] }
    }
    if (allowedIndicators.has(ref.type) || indicatorIds.has(ref.id)) return ref.id
  }
  if (condition.right && typeof condition.right === 'object' && !('mul' in condition.right)) {
    const right = condition.right as Record<string, unknown>
    const ref = refFromObject(right)
    return { mul: [ref.id, numericValue(right.scale) ?? numericValue(right.multiplier) ?? numericValue(right.factor) ?? numericValue(right.value) ?? 1] }
  }
  if (condition.right && typeof condition.right === 'object' && 'mul' in condition.right) {
    return normalizeMulRight(condition.right as Record<string, unknown>, indicatorIds)
  }
  if (condition.expression && typeof condition.expression === 'object') {
    return rightValue(condition.expression as Record<string, unknown>, indicatorIds)
  }
  const expression = `${String(condition.valueExpression ?? '')} ${String(condition.expression ?? '')}`
  const match = expression.match(/volume_sma(?:[_ ]?|\()?(\d+)?\)?\s*\*\s*([0-9.]+)/)
  if (match) return { mul: [`vol${Number(match[1]) || 20}`, Number(match[2]) || 1] }
  const valueExpression = String(condition.value ?? '')
  const valueFirst = valueExpression.match(/([0-9.]+)\s*\*\s*volume_sma(?:[_ ]?|\()?(\d+)?\)?/)
  if (valueFirst) return { mul: [`vol${Number(valueFirst[2]) || 20}`, Number(valueFirst[1]) || 1] }
  const smaOnly = valueExpression.trim().match(/^volume_sma(?:[_ ]?|\()?(\d+)?\)?$/)
  if (smaOnly) return { mul: [`vol${Number(smaOnly[1]) || 20}`, 1] }
  return numericValue(condition.value) ?? condition.right
}

function normalizeMulRight(raw: Record<string, unknown>, indicatorIds = new Set<string>()): unknown {
  if (!Array.isArray(raw.mul)) return raw
  const [left, right] = raw.mul
  const normalizedLeft = typeof left === 'string'
    ? (indicatorIds.has(left) ? left : parseIndicatorRef(left).id)
    : left
  const normalizedRight = numericValue(right) ?? right
  return { mul: [normalizedLeft, normalizedRight] }
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
}

function volumeComparisonRight(ref: { id: string }, condition: Record<string, unknown>, indicatorIds = new Set<string>()): unknown {
  if (
    (condition.reference && typeof condition.reference === 'object') ||
    condition.referenceIndicator != null ||
    condition.referencePeriod != null ||
    (condition.value && typeof condition.value === 'object') ||
    (condition.right && typeof condition.right === 'object') ||
    (condition.expression && typeof condition.expression === 'object') ||
    `${String(condition.valueExpression ?? '')} ${String(condition.expression ?? '')}`.trim()
  ) {
    return rightValue(condition, indicatorIds)
  }
  return { mul: [ref.id, numericValue(condition.value) ?? 1] }
}

function rulesDslSource(input: NormalizedStrategySpec, mode: 'entry' | 'exit'): unknown {
  const rawInput = input as unknown as Record<string, unknown>
  const rules = Array.isArray(rawInput.rules) ? rawInput.rules : []
  const selected = rules
    .filter(isRecord)
    .filter((rule) => ruleActionMode(rule) === mode)
    .flatMap((rule) => conditionRulesFromDsl(String(rule.condition ?? rule.expression ?? '')))
  if (!selected.length) return undefined
  const rawLogic = String((rules.find(isRecord) as Record<string, unknown> | undefined)?.logic ?? '').toLowerCase()
  const hasAny = mode === 'exit' || selected.some((rule) => rule.logic === 'or') || rawLogic === 'or' || rawLogic === 'any'
  const cleaned = selected.map(({ logic: _logic, ...rule }) => rule)
  return hasAny ? { any: cleaned } : { all: cleaned }
}

function collectConditionDslIssues(input: NormalizedStrategySpec): Array<Record<string, unknown>> {
  const rawInput = input as unknown as Record<string, unknown>
  const rules = Array.isArray(rawInput.rules) ? rawInput.rules : []
  const issues: Array<Record<string, unknown>> = []
  rules.forEach((raw, index) => {
    if (!isRecord(raw)) {
      issues.push({ index, field: 'rules', message: 'conditionDslV1 rule must be an object.' })
      return
    }
    const mode = ruleActionMode(raw)
    if (!mode) {
      issues.push({
        index,
        field: 'action',
        value: raw.action ?? raw.side ?? raw.type,
        message: 'conditionDslV1 action must be one of entry, exit, buy, sell, long, or close.',
      })
    }
    const condition = String(raw.condition ?? raw.expression ?? '')
    if (!condition.trim()) {
      issues.push({ index, field: 'condition', value: condition, message: 'conditionDslV1 condition is required.' })
      return
    }
    if (conditionRulesFromDsl(condition).length === 0) {
      issues.push({
        index,
        field: 'condition',
        value: condition,
        message: 'conditionDslV1 condition must be simple comparisons joined only by and/or.',
      })
    }
  })
  return issues
}

function ruleActionMode(rule: Record<string, unknown>): 'entry' | 'exit' | '' {
  const action = String(rule.action ?? rule.side ?? rule.type ?? '').trim().toLowerCase()
  if (action === 'entry' || action === 'exit') return action
  if (action === 'buy' || action === 'long') return 'entry'
  if (action === 'sell' || action === 'close') return 'exit'
  return ''
}

function conditionRulesFromDsl(raw: string): Array<Record<string, unknown> & { logic?: 'and' | 'or' }> {
  if (!raw.trim()) return []
  const parts = raw
    .split(/\s+(and|or|&&|\|\|)\s+/i)
    .filter((part) => part.trim())
  const out: Array<Record<string, unknown> & { logic?: 'and' | 'or' }> = []
  let nextLogic: 'and' | 'or' = 'and'
  for (const part of parts) {
    const token = part.trim()
    if (/^(and|&&)$/i.test(token)) {
      nextLogic = 'and'
      continue
    }
    if (/^(or|\|\|)$/i.test(token)) {
      nextLogic = 'or'
      continue
    }
    const parsed = parseDslComparison(token)
    if (!parsed) return []
    out.push({ ...parsed, logic: nextLogic })
  }
  return out
}

function parseDslComparison(raw: string): Record<string, unknown> | null {
  const match = raw.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*|close|volume)\s*(crosses_above|crosses_below|>=|<=|>|<)\s*([a-zA-Z_][a-zA-Z0-9_]*|[0-9]+(?:\.[0-9]+)?)$/)
  if (!match) return null
  const [, left, operator, right] = match
  const numericRight = numericValue(right)
  return {
    left,
    operator: normalizeOperator(operator),
    value: numericRight ?? right,
  }
}

function exitSource(input: NormalizedStrategySpec): unknown {
  const rawInput = input as unknown as Record<string, unknown>
  const lifecycle = rawInput.lifecycle && typeof rawInput.lifecycle === 'object' && !Array.isArray(rawInput.lifecycle)
    ? rawInput.lifecycle as Record<string, unknown>
    : {}
  const rawExitBase = input.exit ?? rawInput.exits ?? rawInput.exitSignals ?? rawInput.exitRules ?? rawInput.exitRule ?? rawInput.exitConditions ?? lifecycle.exit
  const rawExitDsl = rulesDslSource(input, 'exit')
  const rawExit = rawExitBase == null && rawExitDsl != null
    ? rawExitDsl
    : rawExitBase && typeof rawExitBase === 'object' && !Array.isArray(rawExitBase) && rawExitDsl && typeof rawExitDsl === 'object' && !Array.isArray(rawExitDsl)
      ? { ...(rawExitDsl as Record<string, unknown>), ...(rawExitBase as Record<string, unknown>) }
      : rawExitBase
  const exit = Array.isArray(rawExit)
    ? { any: rawExit } as Record<string, unknown>
    : rawExit && typeof rawExit === 'object'
      ? { ...(rawExit as Record<string, unknown>) }
      : {}
  if (rawInput.stopLossPct != null && exit.stop_loss_pct == null) exit.stop_loss_pct = rawInput.stopLossPct
  if (rawInput.takeProfitPct != null && exit.take_profit_pct == null) exit.take_profit_pct = rawInput.takeProfitPct
  if (rawInput.trailingStopPct != null && exit.trailing_stop_pct == null) exit.trailing_stop_pct = rawInput.trailingStopPct
  if (rawInput.maxDrawdownStopPct != null && exit.max_drawdown_stop_pct == null) exit.max_drawdown_stop_pct = rawInput.maxDrawdownStopPct
  if (rawInput.atrStopLoss != null && exit.atr_stop_loss == null) exit.atr_stop_loss = rawInput.atrStopLoss
  if (rawInput.atrStopLossMultiplier != null && exit.atr_stop_loss == null) exit.atr_stop_loss = rawInput.atrStopLossMultiplier
  if (rawInput.timeStopBars != null && exit.time_stop_bars == null) exit.time_stop_bars = rawInput.timeStopBars
  for (const key of ['stop_loss_pct', 'take_profit_pct', 'trailing_stop_pct', 'max_drawdown_stop_pct', 'atr_stop_loss', 'time_stop_bars']) {
    if (rawInput[key] != null && exit[key] == null) exit[key] = rawInput[key]
  }
  if (
    (exit.stop_loss_pct != null || exit.take_profit_pct != null || exit.trailing_stop_pct != null || exit.max_drawdown_stop_pct != null || exit.atr_stop_loss != null || exit.time_stop_bars != null) &&
    exit.operator == null &&
    exit.op == null &&
    exit.logic == null &&
    !Array.isArray(exit.all) &&
    !Array.isArray(exit.any) &&
    !Array.isArray(exit.or)
  ) {
    exit.operator = 'or'
  }
  return Object.keys(exit).length ? exit : rawExit
}

function entrySource(input: NormalizedStrategySpec): unknown {
  const rawInput = input as unknown as Record<string, unknown>
  const lifecycle = rawInput.lifecycle && typeof rawInput.lifecycle === 'object' && !Array.isArray(rawInput.lifecycle)
    ? rawInput.lifecycle as Record<string, unknown>
    : {}
  const signals = rawInput.signals && typeof rawInput.signals === 'object' && !Array.isArray(rawInput.signals)
    ? rawInput.signals as Record<string, unknown>
    : {}
  return input.entry ?? signals.entry ?? rawInput.entrySignals ?? rawInput.entryRules ?? rawInput.entryRule ?? rawInput.entryConditions ?? lifecycle.entry ?? rulesDslSource(input, 'entry')
}

function sizingSource(input: NormalizedStrategySpec): unknown {
  const rawInput = input as unknown as Record<string, unknown>
  if (input.positionSizing != null) {
    if (typeof input.positionSizing === 'string') {
      const fixedFraction = numericValue(rawInput.fixedFraction ?? rawInput.fixed_fraction ?? rawInput.positionFraction ?? rawInput.position_fraction)
      return fixedFraction == null
        ? input.positionSizing
        : { type: input.positionSizing, value: fixedFraction }
    }
    return input.positionSizing
  }
  const fixedFraction = numericValue(rawInput.fixedFraction ?? rawInput.fixed_fraction ?? rawInput.positionFraction ?? rawInput.position_fraction)
  if (fixedFraction != null) return { type: 'fixed_fraction', value: fixedFraction }
  return undefined
}

function normalizeSizingType(raw: string): string {
  return raw
    .replace('fullCapital', 'full_capital')
    .replace('fixedFraction', 'fixed_fraction')
    .replace('riskPerTrade', 'risk_per_trade')
    .replace('kellyFraction', 'kelly_fraction')
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'strategy'
}

function numberOf(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const match = raw.match(/\d+(\.\d+)?/)
    if (match) {
      const parsed = Number(match[0])
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return fallback
}

function numericValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
