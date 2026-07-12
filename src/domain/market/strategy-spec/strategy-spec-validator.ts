import {
  allowedIndicators,
  executableIndicators,
  fundIndicatorDefinition,
  fundStrategyIndicatorRegistry,
  fundStrategyIndicators,
  indicatorDefinition,
  indicatorRegistry,
  lookbackBarsFor,
  parseRegisteredIndicator,
} from './strategy-spec-registry'

type RuleGroup = { all?: Rule[]; any?: Rule[] }
type Rule =
  | { left: string; op: string; right: unknown }
  | { type: 'stop_loss_pct' | 'take_profit_pct' | 'trailing_stop_pct' | 'max_drawdown_stop_pct' | 'atr_stop_loss' | 'time_stop_bars'; value: number; period?: number }

const strategySupportedExitTypes = [
  'stop_loss_pct',
  'take_profit_pct',
  'trailing_stop_pct',
  'max_drawdown_stop_pct',
  'atr_stop_loss',
  'time_stop_bars',
] as const

export interface StrategySpecContract {
  id?: string
  name: string
  version?: number
  market?: string
  universe?: { type?: string; symbols?: string[] }
  dataRequirements?: { minBars?: number; adjust?: string; requiredFields?: string[] }
  indicators?: Array<{ id: string; type: string; source?: string; params?: Record<string, unknown> }>
  entry?: RuleGroup
  exit?: RuleGroup
  positionSizing?: { type?: string; value?: number; riskPct?: number; stopLossPct?: number; maxPositionPct?: number; initialFraction?: number; minTrades?: number; kellyScale?: number }
  risk?: Record<string, unknown>
  proxyFor?: unknown
  originalSignals?: unknown
  unsupportedOriginalSignals?: unknown
  proxyApproval?: unknown
  conditionDslIssues?: Array<Record<string, unknown>>
}

type LooseStrategySpec = StrategySpecContract & Record<string, unknown>

export interface StrategyValidationContract {
  action: 'custom_strategy_validate'
  status: 'validated' | 'rejected'
  strategyId: string
  version: number
  spec: StrategySpecContract
  accepted: string[]
  warnings: string[]
  errors: string[]
  unsupported: string[]
  unsupportedDetails?: UnsupportedDetail[]
  validationIssues?: ValidationIssue[]
  repairPlan?: RepairStep[]
  validationSummary?: ValidationSummary
  dataRequirements?: Record<string, unknown>
  suggestedActions?: Array<Record<string, unknown>>
  workflowAdvice: string
}

type ValidationSummary = {
  acceptedCount: number
  warningCount: number
  errorCount: number
  unsupportedCount: number
  canBacktest: boolean
  assetClass: string
  nextAction: string
}

type UnsupportedDetail = {
  category: string
  path: string
  field: string
  value: string
  message: string
  suggestion: string
  candidateTypes?: string[]
  candidateExitTypes?: string[]
  candidateExitCatalog?: Array<Record<string, unknown>>
}

type ValidationIssue = {
  category: string
  path: string
  field: string
  value: string
  message: string
  suggestion: string
  currentMinBars?: number
  requiredMinBars?: number
  requiredLookbackBars?: number
  allowedRightKinds?: string[]
  declaredRuleRefs?: string[]
  exampleNumericRight?: number
  exampleReferenceRight?: string
  allowedActions?: string[]
  grammar?: string
}

type RepairStep = {
  source: string
  category: string
  path: string
  field: string
  value: string
  message: string
  repairAction: string
  target: string
  patchHint: Record<string, unknown>
  blocking: boolean
  suggestion: string
}

export const allowedOps = new Set(['>', '>=', '<', '<=', '==', '!=', 'crosses_above', 'crosses_below'])

export function rejectedStrategySpec(
  strategyId: string,
  raw: StrategySpecContract | undefined,
  errors: string[],
): StrategyValidationContract {
  const validationIssues = errors.map((error) =>
    validationIssue(
      'schema',
      'strategySpec',
      'strategySpec',
      raw == null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw,
      error,
      'Provide strategySpec as a JSON object with name, indicators, entry, and exit fields.',
    ),
  )
  return {
    action: 'custom_strategy_validate',
    status: 'rejected',
    strategyId,
    version: raw?.version ?? 1,
    spec: { ...(raw ?? {}), id: strategyId, name: raw?.name ?? 'invalid custom strategy' },
    accepted: [],
    warnings: [],
    errors,
    unsupported: errors,
    validationIssues,
    repairPlan: repairPlan(validationIssues, []),
    validationSummary: validationSummary({
      status: 'rejected',
      accepted: [],
      warnings: [],
      errors,
      unsupported: errors,
      backtestable: false,
      assetClass: String(raw?.market ?? 'stock'),
    }),
    workflowAdvice: 'This validation failed. Ask for or construct a corrected StrategySpec; do not backtest or save this rejected spec.',
  }
}

export function validateStockStrategySpec(spec: StrategySpecContract): StrategyValidationContract {
  const accepted: string[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const unsupported: string[] = []
  const unsupportedDetails: UnsupportedDetail[] = []
  const validationIssues: ValidationIssue[] = []
  const indicatorRequirements: Record<string, unknown> = {}
  const allowedRuleRefs = new Set(['close', 'volume', 'turnover_rate'])
  let requiredLookbackBars = 0
  validateProxyStrategyApproval(spec, errors, unsupported, unsupportedDetails, validationIssues)
  validateConditionDslIssues(spec, errors, unsupported, unsupportedDetails, validationIssues)

  if (!spec.name) {
    const message = 'name is required'
    errors.push(message)
    validationIssues.push(validationIssue('schema', 'name', 'name', String(spec.name ?? ''), message, 'Provide a non-empty StrategySpec name.'))
  }
  if (!spec.indicators || spec.indicators.length === 0) {
    const message = 'at least one indicator is required'
    errors.push(message)
    validationIssues.push(validationIssue('schema', 'indicators', 'indicators', '[]', message, 'Declare at least one supported indicator.'))
  }
  for (const [index, indicator] of (spec.indicators ?? []).entries()) {
    if (!indicator.id) {
      const message = 'indicator.id is required'
      errors.push(message)
      validationIssues.push(validationIssue(
        'schema',
        `indicators[${index}].id`,
        'id',
        String(indicator.id ?? ''),
        message,
        'Set a stable indicator id and reference that id from entry/exit rules.',
      ))
    }
    if (!allowedIndicators.has(indicator.type)) {
      const message = `unsupported indicator "${indicator.type}"`
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('indicator', indicator.id ? `indicators.${indicator.id}` : `indicators.${indicator.type}`, 'type', indicator.type, message))
    }
    else {
      accepted.push(`indicator:${indicator.id}:${indicator.type}`)
      if (indicator.id) allowedRuleRefs.add(indicator.id)
      const definition = indicatorDefinition(indicator.type)
      if (definition) {
        const parameterSchema = parameterSchemaForDefinition(definition)
        requiredLookbackBars = Math.max(requiredLookbackBars, lookbackBarsFor(definition))
        indicatorRequirements[indicator.id || indicator.type] = {
          type: indicator.type,
          category: definition.category ?? 'technical',
          requiredFields: definition.requiredFields ?? ['close'],
          defaultPeriod: definition.defaultPeriod,
          lookbackBars: lookbackBarsFor(definition),
          parameterSchema,
        }
        validateIndicatorParameters(indicator.id || indicator.type, indicator.type, indicator.params, parameterSchema, errors, validationIssues)
      }
    }
    if (!executableIndicators.has(indicator.type)) {
      const message = `indicator "${indicator.type}" is known but not executable in v1 custom backtest`
      warnings.push(message)
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('indicator', indicator.id ? `indicators.${indicator.id}` : `indicators.${indicator.type}`, 'type', indicator.type, message))
    }
  }

  validateRuleGroup(spec.entry, 'entry', errors, warnings, accepted, unsupported, unsupportedDetails, validationIssues, allowedRuleRefs)
  validateRuleGroup(spec.exit, 'exit', errors, warnings, accepted, unsupported, unsupportedDetails, validationIssues, allowedRuleRefs)

  const sizing = spec.positionSizing?.type ?? 'full_capital'
  if (!['full_capital', 'fixed_fraction', 'risk_per_trade', 'kelly_fraction'].includes(sizing)) {
    const message = `unsupported positionSizing.type "${sizing}"`
    errors.push(message)
    unsupported.push(message)
    unsupportedDetails.push(unsupportedDetail('positionSizing', 'positionSizing.type', 'type', sizing, message))
  }
  if (sizing === 'full_capital') accepted.push('positionSizing:full_capital')
  if (sizing === 'fixed_fraction') {
    const value = spec.positionSizing?.value
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1)) {
      const message = 'positionSizing.value must be > 0 and <= 1'
      errors.push(message)
      validationIssues.push(validationIssue(
        'positionSizing',
        'positionSizing.value',
        'value',
        String(spec.positionSizing?.value),
        message,
        'Set fixed_fraction positionSizing.value within (0, 1].',
      ))
    }
    accepted.push('positionSizing:fixed_fraction')
  }
  if (sizing === 'risk_per_trade') {
    const riskPct = spec.positionSizing?.riskPct
    const stopLossPct = spec.positionSizing?.stopLossPct
    const maxPositionPct = spec.positionSizing?.maxPositionPct
    if (typeof riskPct !== 'number' || !Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 0.05) {
      const message = 'positionSizing.riskPct must be > 0 and <= 0.05'
      errors.push(message)
      validationIssues.push(validationIssue(
        'positionSizing',
        'positionSizing.riskPct',
        'riskPct',
        String(spec.positionSizing?.riskPct),
        message,
        'Set riskPct to a decimal value within (0, 0.05].',
      ))
    }
    if (typeof stopLossPct !== 'number' || !Number.isFinite(stopLossPct) || stopLossPct <= 0 || stopLossPct > 100) {
      const message = 'positionSizing.stopLossPct must be > 0 and <= 100'
      errors.push(message)
      validationIssues.push(validationIssue(
        'positionSizing',
        'positionSizing.stopLossPct',
        'stopLossPct',
        String(spec.positionSizing?.stopLossPct),
        message,
        'Set stopLossPct within (0, 100].',
      ))
    }
    if (maxPositionPct != null && (typeof maxPositionPct !== 'number' || !Number.isFinite(maxPositionPct) || maxPositionPct <= 0 || maxPositionPct > 1)) {
      const message = 'positionSizing.maxPositionPct must be > 0 and <= 1'
      errors.push(message)
      validationIssues.push(validationIssue(
        'positionSizing',
        'positionSizing.maxPositionPct',
        'maxPositionPct',
        String(spec.positionSizing?.maxPositionPct),
        message,
        'Set maxPositionPct within (0, 1].',
      ))
    }
    accepted.push('positionSizing:risk_per_trade')
  }
  if (sizing === 'kelly_fraction') {
    const initialFraction = spec.positionSizing?.initialFraction
    const maxPositionPct = spec.positionSizing?.maxPositionPct
    const minTrades = spec.positionSizing?.minTrades
    const kellyScale = spec.positionSizing?.kellyScale
    if (initialFraction != null && (typeof initialFraction !== 'number' || !Number.isFinite(initialFraction) || initialFraction <= 0 || initialFraction > 1)) {
      const message = 'positionSizing.initialFraction must be > 0 and <= 1'
      errors.push(message)
      validationIssues.push(validationIssue('positionSizing', 'positionSizing.initialFraction', 'initialFraction', String(initialFraction), message, 'Set initialFraction within (0, 1].'))
    }
    if (maxPositionPct != null && (typeof maxPositionPct !== 'number' || !Number.isFinite(maxPositionPct) || maxPositionPct <= 0 || maxPositionPct > 1)) {
      const message = 'positionSizing.maxPositionPct must be > 0 and <= 1'
      errors.push(message)
      validationIssues.push(validationIssue('positionSizing', 'positionSizing.maxPositionPct', 'maxPositionPct', String(maxPositionPct), message, 'Set maxPositionPct within (0, 1].'))
    }
    if (minTrades != null && (typeof minTrades !== 'number' || !Number.isFinite(minTrades) || minTrades < 1 || minTrades > 1000)) {
      const message = 'positionSizing.minTrades must be >= 1 and <= 1000'
      errors.push(message)
      validationIssues.push(validationIssue('positionSizing', 'positionSizing.minTrades', 'minTrades', String(minTrades), message, 'Set minTrades to a bounded positive integer.'))
    }
    if (kellyScale != null && (typeof kellyScale !== 'number' || !Number.isFinite(kellyScale) || kellyScale <= 0 || kellyScale > 1)) {
      const message = 'positionSizing.kellyScale must be > 0 and <= 1'
      errors.push(message)
      validationIssues.push(validationIssue('positionSizing', 'positionSizing.kellyScale', 'kellyScale', String(kellyScale), message, 'Use a fractional Kelly scale within (0, 1], for example 0.5.'))
    }
    accepted.push('positionSizing:kelly_fraction')
  }
  validateRisk(spec.risk, errors, validationIssues)
  validateExitValues(spec.exit, errors, validationIssues)
  const minBars = spec.dataRequirements?.minBars ?? 120
  if (!Number.isFinite(minBars) || minBars < 30) {
    const message = 'dataRequirements.minBars must be >= 30'
    errors.push(message)
    validationIssues.push(validationIssue(
      'dataRequirements',
      'dataRequirements.minBars',
      'minBars',
      String(minBars),
      message,
      'Set dataRequirements.minBars to at least 30.',
      { currentMinBars: Number(minBars), requiredMinBars: 30 },
    ))
  }
  if (requiredLookbackBars > 0 && minBars < requiredLookbackBars) {
    const message = `dataRequirements.minBars must be >= required indicator lookbackBars ${requiredLookbackBars}`
    errors.push(message)
    validationIssues.push(validationIssue(
      'dataRequirements',
      'dataRequirements.minBars',
      'minBars',
      String(minBars),
      message,
      `Increase dataRequirements.minBars to at least ${requiredLookbackBars}, or remove indicators that require a longer lookback window.`,
      {
        currentMinBars: Number(minBars),
        requiredMinBars: requiredLookbackBars,
        requiredLookbackBars,
      },
    ))
  }
  const suggestedActions = errors.length === 0
    ? [{
      action: 'custom_strategy_backtest',
      symbols: strategySpecSymbols(spec),
      strategySpec: spec,
      boundary: 'Use this full strategySpec for an unsaved strategy. strategyId alone is valid only after custom_strategy_save or custom_strategy_run readback.',
    }]
    : []

  return {
    action: 'custom_strategy_validate',
    status: errors.length === 0 ? 'validated' : 'rejected',
    strategyId: spec.id!,
    version: spec.version!,
    spec,
    accepted,
    warnings,
    errors,
    unsupported,
    unsupportedDetails,
    validationIssues,
    repairPlan: repairPlan(validationIssues, unsupportedDetails),
    validationSummary: validationSummary({
      status: errors.length === 0 ? 'validated' : 'rejected',
      accepted,
      warnings,
      errors,
      unsupported,
      backtestable: errors.length === 0,
      assetClass: 'stock',
    }),
    dataRequirements: {
      indicators: indicatorRequirements,
      minBars,
      requiredLookbackBars,
    },
    suggestedActions,
    workflowAdvice: errors.length === 0
      ? 'If the user asked to validate only or not save, answer now from this validation result. Do not call custom_strategy_backtest, custom_strategy_save, query_kline, query_technical_indicator, Script, or other tools unless the user explicitly asks for backtest, save, or extra market evidence.'
      : 'This validation failed. Report the unsupported executable parts directly. Do not replace them with proxy indicators, and do not call custom_strategy_backtest or custom_strategy_save unless the user explicitly asks for a separate proxy redesign.',
  }
}

function validateConditionDslIssues(
  spec: StrategySpecContract,
  errors: string[],
  unsupported: string[],
  unsupportedDetails: UnsupportedDetail[],
  validationIssues: ValidationIssue[],
) {
  const issues = Array.isArray(spec.conditionDslIssues) ? spec.conditionDslIssues : []
  for (const issue of issues) {
    const index = Number(issue.index ?? 0)
    const field = String(issue.field ?? 'condition')
    const value = String(issue.value ?? '')
    const message = String(issue.message ?? 'invalid conditionDslV1 rule')
    errors.push(message)
    unsupported.push(message)
    validationIssues.push(validationIssue(
      'condition_dsl',
      `rules[${Number.isFinite(index) ? index : 0}].${field}`,
      field,
      value,
      message,
      'Use canonical entry/exit groups, or request custom_strategy_help detail:"catalog" fields:["executableV1.conditionDslV1"] and revise rules[] to the supported mini-contract.',
      {
        allowedActions: ['entry', 'exit', 'buy', 'sell', 'long', 'close'],
        grammar: '<series-or-indicator-id> (< | <= | > | >= | crosses_above | crosses_below) (<series-or-indicator-id> | number)',
      },
    ))
    unsupportedDetails.push(unsupportedDetail(
      'condition_dsl',
      `rules[${Number.isFinite(index) ? index : 0}].${field}`,
      field,
      value,
      message,
    ))
  }
}

function strategySpecSymbols(spec: StrategySpecContract): string[] {
  const loose = spec as LooseStrategySpec
  const direct = String(loose.symbol ?? loose.code ?? '').trim()
  if (direct) return [direct]
  if (Array.isArray(loose.symbols)) {
    const symbols = loose.symbols.map((item) => String(item).trim()).filter(Boolean)
    if (symbols.length) return symbols
  }
  if (spec.universe && Array.isArray(spec.universe.symbols)) {
    const symbols = spec.universe.symbols.map((item) => String(item).trim()).filter(Boolean)
    if (symbols.length) return symbols
  }
  return []
}

export function validateFundStrategySpec(spec: StrategySpecContract): StrategyValidationContract & Record<string, unknown> {
  const accepted: string[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const unsupported: string[] = []
  const unsupportedDetails: UnsupportedDetail[] = []
  const validationIssues: ValidationIssue[] = []
  const allowedRuleRefs = new Set(['nav', 'money_yield', 'seven_day_yield'])
  validateProxyStrategyApproval(spec, errors, unsupported, unsupportedDetails, validationIssues)
  if (!spec.name) {
    const message = 'name is required'
    errors.push(message)
    validationIssues.push(validationIssue('schema', 'name', 'name', String(spec.name ?? ''), message, 'Provide a non-empty fund StrategySpec name.'))
  }
  if (!spec.indicators || spec.indicators.length === 0) {
    const message = 'at least one fund indicator is required'
    errors.push(message)
    validationIssues.push(validationIssue(
      'schema',
      'indicators',
      'indicators',
      '[]',
      message,
      'Declare at least one fund-specific indicator from custom_strategy_help.fundObservationV1.indicatorCatalog, such as nav_trend, rolling_return, fund_drawdown, fund_ulcer_index, fund_drawdown_duration_bars, fund_sharpe, fund_gain_to_pain, fund_momentum_acceleration, fund_return_skewness, fund_value_at_risk, money_yield, or seven_day_yield.',
    ))
  }
  for (const [index, indicator] of (spec.indicators ?? []).entries()) {
    if (!indicator.id) {
      const message = 'indicator.id is required'
      errors.push(message)
      validationIssues.push(validationIssue(
        'schema',
        `indicators[${index}].id`,
        'id',
        String(indicator.id ?? ''),
        message,
        'Set a stable fund indicator id and reference that id from entry/exit rules.',
      ))
    }
    if (!fundStrategyIndicators.has(indicator.type)) {
      const message = `unsupported fund indicator "${indicator.type}"; use fund-specific indicators from custom_strategy_help.fundObservationV1.indicatorCatalog, such as nav_trend, rolling_return, fund_drawdown, fund_ulcer_index, fund_drawdown_duration_bars, fund_volatility, fund_sharpe, fund_sortino, fund_calmar, fund_gain_to_pain, fund_momentum_acceleration, fund_omega, fund_tail_ratio, fund_positive_period_ratio, fund_negative_period_ratio, fund_return_skewness, fund_return_kurtosis, fund_value_at_risk, fund_conditional_value_at_risk, money_yield, seven_day_yield, or dca_interval`
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('fund_indicator', indicator.id ? `indicators.${indicator.id}` : `indicators.${indicator.type}`, 'type', indicator.type, message))
    } else {
      accepted.push(`fund_indicator:${indicator.id}:${indicator.type}`)
      if (indicator.id) allowedRuleRefs.add(indicator.id)
    }
  }
  validateRuleGroup(spec.entry, 'entry', errors, warnings, accepted, unsupported, unsupportedDetails, validationIssues, allowedRuleRefs)
  validateRuleGroup(spec.exit, 'exit', errors, warnings, accepted, unsupported, unsupportedDetails, validationIssues, allowedRuleRefs)
  const loose = spec as LooseStrategySpec
  const looseRequirements = (spec.dataRequirements ?? {}) as Record<string, unknown>
  const dataClass = String(looseRequirements.dataClass ?? loose.dataClass ?? '').trim()
  if (!dataClass) {
    warnings.push('fund dataRequirements.dataClass should declare ordinary_fund_nav, money_fund_yield, etf_nav, or listed_fund_quote')
  }
  const fundCategory = normalizeFundCategoryValue(loose.fundCategory ?? loose.fundType ?? looseRequirements.fundCategory ?? looseRequirements.fundType)
  const indicatorTypes = new Set((spec.indicators ?? []).map((indicator) => indicator.type))
  const indicatorRequirements = (spec.indicators ?? [])
    .map(fundIndicatorRequirement)
    .filter((item): item is Record<string, unknown> => item != null)
  if ((fundCategory === 'money' || dataClass === 'money_fund_yield') && !indicatorTypes.has('money_yield') && !indicatorTypes.has('seven_day_yield')) {
    errors.push('money fund StrategySpec must use money_yield or seven_day_yield, not ordinary NAV-only indicators')
  }
  if (fundCategory !== 'money' &&
    (indicatorTypes.has('money_yield') || indicatorTypes.has('seven_day_yield')) &&
    dataClass !== 'money_fund_yield') {
    warnings.push('money_yield/seven_day_yield require money-fund yield evidence; ordinary fund NAV evidence is not enough')
  }
  return {
    action: 'custom_strategy_validate',
    status: errors.length === 0 ? 'validated' : 'rejected',
    strategyId: spec.id!,
    version: spec.version!,
    assetClass: 'fund',
    backtestable: false,
    spec,
    accepted,
    warnings,
    errors,
    unsupported,
    unsupportedDetails,
    validationIssues,
    repairPlan: repairPlan(validationIssues, unsupportedDetails),
    validationSummary: validationSummary({
      status: errors.length === 0 ? 'validated' : 'rejected',
      accepted,
      warnings,
      errors,
      unsupported,
      backtestable: false,
      assetClass: 'fund',
    }),
    dataRequirements: {
      indicators: indicatorRequirements,
      ordinaryFund: ['query_fund_nav', 'query_fund_performance'],
      moneyFund: ['query_fund_money_yield'],
      holdings: ['query_fund_holding'],
    },
    workflowAdvice: errors.length === 0
      ? 'This fund StrategySpec is validated as observation/research contract only. Do not call custom_strategy_backtest. Gather fund-specific evidence with query_fund_nav, query_fund_money_yield, query_fund_performance, or query_fund_holding before monitoring or trade preparation.'
      : 'This fund StrategySpec validation failed. Report the fund-specific unsupported parts directly; do not replace fund rules with stock K-line, RSI, volume, or price indicators.',
  }
}

function fundIndicatorRequirement(indicator: NonNullable<StrategySpecContract['indicators']>[number]): Record<string, unknown> | null {
  const definition = fundIndicatorDefinition(indicator.type)
  if (!definition) return null
  return {
    id: indicator.id || indicator.type,
    type: indicator.type,
    category: definition.category,
    source: definition.source,
    requiredFields: definition.requiredFields,
    scoreDirection: definition.scoreDirection ?? 1,
    parameterSchema: definition.parameterSchema ?? [{ name: 'period', type: 'integer', default: definition.defaultPeriod, min: 1 }],
    readbacks: fundReadbacksForDefinition(definition),
  }
}

function fundReadbacksForDefinition(definition: ReturnType<typeof fundIndicatorDefinition>): string[] {
  if (!definition) return []
  if (definition.category === 'money_fund_yield') return ['query_fund_money_yield']
  if (definition.source === 'nav') return ['query_fund_nav']
  return ['query_fund_nav', 'query_fund_money_yield']
}

function normalizeFundCategoryValue(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return ''
  if (value === 'money' || value.includes('货币') || value.includes('money') || value.includes('monetary') || value.includes('现金')) return 'money'
  if (value === 'etf' || value.includes('etf')) return 'etf'
  if (value === 'backend' || value.includes('后端')) return 'backend'
  if (value === 'bond' || value.includes('债')) return 'bond'
  if (value === 'index' || value.includes('指数')) return 'index'
  return value
}

export function isFundStrategySpec(spec: StrategySpecContract): boolean {
  const loose = spec as LooseStrategySpec
  const market = String(spec.market ?? '').toLowerCase()
  const assetClass = String(loose.assetClass ?? loose.asset_class ?? loose.type ?? '').toLowerCase()
  const universe = spec.universe
  const universeType = universe && typeof universe === 'object' && !Array.isArray(universe)
    ? String(universe.type ?? '').toLowerCase()
    : ''
  return market === 'fund' ||
    market === 'funds' ||
    assetClass === 'fund' ||
    assetClass === 'funds' ||
    universeType === 'fund' ||
    universeType === 'funds'
}

function validationSummary(input: {
  status: 'validated' | 'rejected'
  accepted: string[]
  warnings: string[]
  errors: string[]
  unsupported: string[]
  backtestable: boolean
  assetClass: string
}): ValidationSummary {
  const assetClass = input.assetClass.trim() || 'stock'
  return {
    acceptedCount: input.accepted.length,
    warningCount: input.warnings.length,
    errorCount: input.errors.length,
    unsupportedCount: input.unsupported.length,
    canBacktest: input.backtestable && input.errors.length === 0,
    assetClass,
    nextAction: validationNextAction({
      status: input.status,
      backtestable: input.backtestable,
      assetClass,
      errorCount: input.errors.length,
      unsupportedCount: input.unsupported.length,
    }),
  }
}

function validationNextAction(input: {
  status: 'validated' | 'rejected'
  backtestable: boolean
  assetClass: string
  errorCount: number
  unsupportedCount: number
}): string {
  if (input.status !== 'validated' || input.errorCount > 0 || input.unsupportedCount > 0) {
    return 'revise_strategy_spec'
  }
  if (input.assetClass === 'fund') return 'gather_fund_evidence_or_observe'
  if (input.backtestable) return 'custom_strategy_backtest_or_answer_validation_only'
  return 'answer_validation_only'
}

function validateRisk(risk: Record<string, unknown> | undefined, errors: string[], validationIssues: ValidationIssue[]) {
  if (!risk) return
  for (const key of ['maxPositionPct', 'maxExposurePct', 'maxLossPerTradePct']) {
    if (!(key in risk)) continue
    const value = risk[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
      const message = `risk.${key} must be > 0 and <= 1`
      errors.push(message)
      validationIssues.push(validationIssue(
        'risk',
        `risk.${key}`,
        key,
        String(value),
        message,
        `Set risk.${key} to a decimal value within (0, 1].`,
      ))
    }
  }
}

function validateProxyStrategyApproval(
  spec: StrategySpecContract,
  errors: string[],
  unsupported: string[],
  unsupportedDetails: UnsupportedDetail[],
  validationIssues: ValidationIssue[],
) {
  if (!declaresProxyStrategy(spec)) return
  if (hasExplicitProxyApproval(spec.proxyApproval)) return
  const message = 'proxy StrategySpec requires explicit structured user approval before validation/backtest/save'
  errors.push(message)
  unsupported.push(message)
  unsupportedDetails.push(unsupportedDetail('proxy_strategy', 'proxyApproval', 'proxyApproval', String(spec.proxyApproval ?? ''), message))
  validationIssues.push(validationIssue(
    'proxy_strategy',
    'proxyApproval',
    'proxyApproval',
    String(spec.proxyApproval ?? ''),
    message,
    'First report the unsupported original signals and ask the user to approve a separate proxy redesign. If approved, include proxyFor, unsupportedOriginalSignals, and proxyApproval:{approved:true}.',
  ))
}

function declaresProxyStrategy(spec: StrategySpecContract): boolean {
  return spec.proxyFor != null || spec.originalSignals != null || spec.unsupportedOriginalSignals != null || spec.proxyApproval != null
}

function hasExplicitProxyApproval(raw: unknown): boolean {
  if (raw === true) return true
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const approval = raw as Record<string, unknown>
  return approval.approved === true || approval.status === 'approved' || approval.confirmationState === 'accepted'
}

function parameterSchemaForDefinition(definition: NonNullable<ReturnType<typeof indicatorDefinition>>): Array<Record<string, unknown>> {
  if (definition.parameterSchema) return definition.parameterSchema
  if (definition.usesPeriodParameter === false) return []
  return [{ name: 'period', type: 'integer', default: definition.defaultPeriod, min: 1 }]
}

function validateIndicatorParameters(
  id: string,
  type: string,
  params: Record<string, unknown> | undefined,
  schema: Array<Record<string, unknown>>,
  errors: string[],
  validationIssues: ValidationIssue[],
) {
  const input = params ?? {}
  const allowed = new Set(schema.map((item) => String(item.name ?? '')).filter(Boolean))
  for (const key of Object.keys(input)) {
    if (allowed.size > 0 && !allowed.has(key)) {
      const message = `indicator.${id} params.${key} is not supported for ${type}`
      errors.push(message)
      validationIssues.push(validationIssue(
        'indicator_params',
        `indicators.${id}.params.${key}`,
        key,
        String(input[key]),
        message,
        `Remove this parameter or replace it with a parameter declared in dataRequirements.indicators.${id}.parameterSchema.`,
      ))
    }
  }
  for (const item of schema) {
    const name = String(item.name ?? '')
    if (!name || !(name in input)) continue
    const kind = String(item.type ?? 'number')
    const value = Number(input[name])
    if (!Number.isFinite(value)) {
      const message = `indicator.${id} params.${name} must be ${kind}`
      errors.push(message)
      validationIssues.push(validationIssue(
        'indicator_params',
        `indicators.${id}.params.${name}`,
        name,
        String(input[name]),
        message,
        `Use a numeric ${kind} value for this parameter.`,
      ))
      continue
    }
    if (kind === 'integer' && !Number.isInteger(value)) {
      const message = `indicator.${id} params.${name} must be integer`
      errors.push(message)
      validationIssues.push(validationIssue(
        'indicator_params',
        `indicators.${id}.params.${name}`,
        name,
        String(input[name]),
        message,
        'Use an integer value for this parameter.',
      ))
    }
    const min = item.min == null ? undefined : Number(item.min)
    if (min != null && Number.isFinite(min) && value < min) {
      const message = `indicator.${id} params.${name} must be >= ${min}`
      errors.push(message)
      validationIssues.push(validationIssue(
        'indicator_params',
        `indicators.${id}.params.${name}`,
        name,
        String(input[name]),
        message,
        `Set this parameter to at least ${min}.`,
      ))
    }
    const max = item.max == null ? undefined : Number(item.max)
    if (max != null && Number.isFinite(max) && value > max) {
      const message = `indicator.${id} params.${name} must be <= ${max}`
      errors.push(message)
      validationIssues.push(validationIssue(
        'indicator_params',
        `indicators.${id}.params.${name}`,
        name,
        String(input[name]),
        message,
        `Set this parameter to no more than ${max}.`,
      ))
    }
  }
}

function validateExitValues(group: RuleGroup | undefined, errors: string[], validationIssues: ValidationIssue[]) {
  if (!group) return
  for (const rule of [...(group.all ?? []), ...(group.any ?? [])]) {
    if (!('type' in rule)) continue
    if (!['stop_loss_pct', 'take_profit_pct', 'trailing_stop_pct', 'max_drawdown_stop_pct', 'atr_stop_loss', 'time_stop_bars'].includes(rule.type)) continue
    if (rule.type === 'time_stop_bars') {
      if (typeof rule.value !== 'number' || !Number.isFinite(rule.value) || rule.value <= 0 || rule.value > 1000) {
        const message = `${rule.type} value must be > 0 and <= 1000`
        errors.push(message)
        validationIssues.push(validationIssue(
          'exit_value',
          `exit.${rule.type}.value`,
          'value',
          String(rule.value),
          message,
          `Set ${rule.type} value within (0, 1000].`,
        ))
      }
      continue
    }
    if (typeof rule.value !== 'number' || !Number.isFinite(rule.value) || rule.value <= 0 || rule.value > 100) {
      const message = `${rule.type} value must be > 0 and <= 100`
      errors.push(message)
      validationIssues.push(validationIssue(
        'exit_value',
        `exit.${rule.type}.value`,
        'value',
        String(rule.value),
        message,
        `Set ${rule.type} value within (0, 100].`,
      ))
    }
  }
}

function validateRuleGroup(
  group: RuleGroup | undefined,
  label: string,
  errors: string[],
  warnings: string[],
  accepted: string[],
  unsupported: string[],
  unsupportedDetails: UnsupportedDetail[],
  validationIssues: ValidationIssue[],
  allowedRuleRefs: Set<string>,
) {
  if (!group) {
    const message = `${label} rule group is required`
    errors.push(message)
    validationIssues.push(validationIssue(
      'rule_shape',
      label,
      label,
      'null',
      message,
      `Provide a ${label} rule group with all[] or any[] executable rules.`,
    ))
    return
  }
  const rules = group.all ?? group.any ?? []
  if (!Array.isArray(rules) || rules.length === 0) {
    const message = `${label} rule group must contain all[] or any[] rules`
    errors.push(message)
    validationIssues.push(validationIssue(
      'rule_shape',
      label,
      'rules',
      '[]',
      message,
      `Add at least one comparison rule to ${label}.all[] or ${label}.any[].`,
    ))
    return
  }
  for (const rule of rules) {
    if ('type' in rule) {
      if (!strategySupportedExitTypes.includes(rule.type as (typeof strategySupportedExitTypes)[number])) {
        const message = `unsupported ${label} exit type "${rule.type}"`
        errors.push(message)
        unsupported.push(message)
        unsupportedDetails.push(unsupportedDetail('exit_type', `${label}.type`, 'type', String(rule.type), message))
      } else accepted.push(`${label}:${rule.type}`)
      continue
    }
    if (!rule.left || !String(rule.left).trim()) {
      const message = `${label} rule.left is required`
      errors.push(message)
      validationIssues.push(validationIssue(
        'rule_shape',
        `${label}.left`,
        'left',
        String(rule.left ?? ''),
        message,
        'Set rule.left to an indicator id or built-in series declared in StrategySpec.',
      ))
    } else if (!isAllowedRuleRef(rule.left, allowedRuleRefs)) {
      const message = `${label} rule source "${rule.left}" is not declared in StrategySpec indicators or built-in series`
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('rule_source', `${label}.left`, 'left', String(rule.left), message))
    }
    if (!allowedOps.has(rule.op)) {
      const message = `unsupported ${label} operator "${rule.op}"`
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('operator', `${label}.op`, 'op', String(rule.op), message))
    }
    else accepted.push(`${label}:${rule.left}:${rule.op}`)
    if (rule.right == null) {
      const message = `${label} rule "${rule.left}" has no executable right-hand value`
      errors.push(message)
      validationIssues.push(validationIssue(
        'rule_shape',
        `${label}.right`,
        'right',
        'null',
        message,
        'Set rule.right to a number or declared indicator/source reference.',
        {
          allowedRightKinds: ['number', 'declared_indicator', 'builtin_series'],
          declaredRuleRefs: [...allowedRuleRefs].sort(),
          exampleNumericRight: 50,
          exampleReferenceRight: 'close',
        },
      ))
    }
    else validateRuleRightReferences(rule.right, label, rule.left, errors, unsupported, unsupportedDetails, allowedRuleRefs)
    if (String(rule.left).includes('news') || String(rule.left).includes('sentiment') || String(rule.left).includes('盘口') || String(rule.left).includes('资金')) {
      warnings.push(`${label} rule "${rule.left}" is not executable in v1 custom backtest`)
      const message = `unsupported executable rule source "${rule.left}"`
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('rule_source', `${label}.left`, 'left', String(rule.left), message))
    }
  }
}

function validateRuleRightReferences(
  value: unknown,
  label: string,
  left: string,
  errors: string[],
  unsupported: string[],
  unsupportedDetails: UnsupportedDetail[],
  allowedRuleRefs: Set<string>,
) {
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value === 'string') {
    if (value.trim() && Number.isFinite(Number(value))) return
    if (!isAllowedRuleRef(value, allowedRuleRefs)) {
      const message = `${label} rule "${left}" right source "${value}" is not declared in StrategySpec indicators or built-in series`
      errors.push(message)
      unsupported.push(message)
      unsupportedDetails.push(unsupportedDetail('rule_source', `${label}.right`, 'right', value, message))
    }
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'mul' in value) {
    const mul = (value as { mul?: unknown }).mul
    if (Array.isArray(mul) && mul.length > 0) {
      const source = String(mul[0])
      if (Number.isFinite(Number(source))) return
      if (!isAllowedRuleRef(source, allowedRuleRefs)) {
        const message = `${label} rule "${left}" right source "${source}" is not declared in StrategySpec indicators or built-in series`
        errors.push(message)
        unsupported.push(message)
        unsupportedDetails.push(unsupportedDetail('rule_source', `${label}.right`, 'right', source, message))
      }
    }
  }
}

function unsupportedDetail(category: string, path: string, field: string, value: string, message: string): UnsupportedDetail {
  return {
    category,
    path,
    field,
    value,
    message,
    suggestion: unsupportedSuggestion(category),
    ...(category === 'indicator' ? { candidateTypes: candidateStrategyIndicatorTypes(value) } : {}),
    ...(category === 'fund_indicator' ? { candidateTypes: candidateFundIndicatorTypes(value) } : {}),
    ...(category === 'exit_type' ? { candidateExitTypes: [...strategySupportedExitTypes], candidateExitCatalog: candidateExitCatalog() } : {}),
  }
}

function validationIssue(
  category: string,
  path: string,
  field: string,
  value: string,
  message: string,
  suggestion: string,
  metadata: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { category, path, field, value, message, suggestion, ...metadata }
}

function repairPlan(validationIssues: ValidationIssue[], unsupportedDetails: UnsupportedDetail[]): RepairStep[] {
  const steps: RepairStep[] = []
  const seen = new Set<string>()
  const addStep = (item: ValidationIssue | UnsupportedDetail, source: string) => {
    const key = `${source}|${item.category}|${item.path}|${item.field}|${item.value}`
    if (seen.has(key)) return
    seen.add(key)
    steps.push({
      source,
      category: item.category,
      path: item.path,
      field: item.field,
      value: item.value,
      message: item.message,
      repairAction: repairActionForCategory(item.category),
      target: repairTargetForCategory(item.category),
      patchHint: repairPatchHintForItem(item.category, item),
      blocking: true,
      suggestion: item.suggestion || unsupportedSuggestion(item.category),
    })
  }
  validationIssues.forEach((item) => addStep(item, 'validationIssues'))
  unsupportedDetails.forEach((item) => addStep(item, 'unsupportedDetails'))
  return steps
}

function repairActionForCategory(category: string): string {
  switch (category) {
    case 'indicator':
    case 'fund_indicator':
      return 'replace_with_supported_indicator'
    case 'rule_source':
      return 'declare_source_or_use_builtin_series'
    case 'operator':
      return 'use_supported_operator'
    case 'exit_type':
      return 'use_supported_exit_type'
    case 'positionSizing':
      return 'use_supported_position_sizing'
    case 'proxy_strategy':
      return 'request_explicit_proxy_approval'
    case 'indicator_params':
      return 'fix_indicator_parameter'
    case 'rule_shape':
      return 'fix_rule_shape'
    case 'condition_dsl':
      return 'fix_condition_dsl'
    case 'dataRequirements':
      return 'fix_data_requirements'
    case 'risk':
      return 'fix_risk_constraint'
    case 'exit_value':
      return 'fix_exit_value'
    case 'schema':
      return 'fix_strategy_schema'
    default:
      return 'revise_strategy_spec_field'
  }
}

function repairTargetForCategory(category: string): string {
  switch (category) {
    case 'indicator':
    case 'fund_indicator':
    case 'indicator_params':
      return 'strategySpec.indicators'
    case 'rule_source':
    case 'operator':
    case 'rule_shape':
    case 'condition_dsl':
      return 'strategySpec.entry_or_exit'
    case 'exit_type':
    case 'exit_value':
      return 'strategySpec.exit'
    case 'positionSizing':
      return 'strategySpec.positionSizing'
    case 'proxy_strategy':
      return 'strategySpec.proxyApproval'
    case 'dataRequirements':
      return 'strategySpec.dataRequirements'
    case 'risk':
      return 'strategySpec.risk'
    case 'schema':
      return 'strategySpec'
    default:
      return 'strategySpec'
  }
}

function repairPatchHintForCategory(category: string): Record<string, unknown> {
  switch (category) {
    case 'indicator':
      return {
        operation: 'replace_indicator_type',
        catalog: 'custom_strategy_help.executableV1.indicatorCatalog',
      }
    case 'fund_indicator':
      return {
        operation: 'replace_fund_indicator_type',
        catalog: 'custom_strategy_help.fundObservationV1.indicatorCatalog',
      }
    case 'rule_source':
      return {
        operation: 'declare_indicator_or_use_builtin_series',
        builtInSeries: ['close', 'volume', 'turnover_rate'],
      }
    case 'operator':
      return {
        operation: 'replace_operator',
        allowed: ['>', '>=', '<', '<=', '==', '!=', 'crosses_above', 'crosses_below'],
      }
    case 'exit_type':
      return {
        operation: 'replace_exit_type',
        allowed: ['stop_loss_pct', 'take_profit_pct', 'trailing_stop_pct', 'max_drawdown_stop_pct', 'atr_stop_loss', 'time_stop_bars'],
      }
    case 'positionSizing':
      return {
        operation: 'replace_position_sizing_type',
        allowed: ['full_capital', 'fixed_fraction', 'risk_per_trade', 'kelly_fraction'],
      }
    case 'proxy_strategy':
      return {
        operation: 'request_explicit_user_approval',
        requiredField: 'proxyApproval.approved',
        requiredValue: true,
      }
    case 'indicator_params':
      return {
        operation: 'conform_params_to_parameter_schema',
        schemaSource: 'dataRequirements.indicators.<id>.parameterSchema',
      }
    case 'rule_shape':
      return {
        operation: 'provide_rule_group',
        allowedGroups: ['all', 'any'],
      }
    case 'condition_dsl':
      return {
        operation: 'revise_condition_dsl_or_use_canonical_rule_group',
        catalog: 'custom_strategy_help.executableV1.conditionDslV1',
        allowedActions: ['entry', 'exit', 'buy', 'sell', 'long', 'close'],
        grammar: '<series-or-indicator-id> (< | <= | > | >= | == | != | crosses_above | crosses_below) (<series-or-indicator-id> | number)',
      }
    case 'dataRequirements':
      return {
        operation: 'adjust_data_requirements',
        fields: ['minBars', 'requiredFields', 'adjust'],
      }
    case 'risk':
      return {
        operation: 'adjust_risk_bounds',
        range: '(0, 1]',
      }
    case 'exit_value':
      return {
        operation: 'adjust_exit_value',
        range: '(0, 100] or time_stop_bars (0, 1000]',
      }
    case 'schema':
      return {
        operation: 'provide_strategy_spec_object',
        requiredFields: ['name', 'indicators', 'entry', 'exit'],
      }
    default:
      return { operation: 'revise_field' }
  }
}

function repairPatchHintForItem(category: string, item: ValidationIssue | UnsupportedDetail): Record<string, unknown> {
  const base: Record<string, unknown> = { ...repairPatchHintForCategory(category) }
  if (item.path) base.path = item.path
  if (item.field) base.field = item.field
  if (item.value) base.currentValue = item.value
  if (category === 'rule_shape' && item.field === 'right') {
    const validationItem = item as ValidationIssue
    if (Array.isArray(validationItem.allowedRightKinds)) base.allowedRightKinds = validationItem.allowedRightKinds
    if (Array.isArray(validationItem.declaredRuleRefs)) base.declaredRuleRefs = validationItem.declaredRuleRefs
    base.operation = 'set_rule_right'
    base.valueExamples = [validationItem.exampleNumericRight ?? 50, validationItem.exampleReferenceRight ?? 'close']
  }
  if (category === 'indicator') {
    const candidates = candidateStrategyIndicatorTypes(item.value)
    base.candidateTypes = candidates
    base.candidateCatalog = candidateStrategyIndicatorCatalog(candidates)
  }
  if (category === 'fund_indicator') {
    const candidates = candidateFundIndicatorTypes(item.value)
    base.candidateTypes = candidates
    base.candidateCatalog = candidateFundIndicatorCatalog(candidates)
  }
  if (category === 'exit_type') {
    base.candidateExitTypes = [...strategySupportedExitTypes]
    base.candidateExitCatalog = candidateExitCatalog()
  }
  if (category === 'indicator_params') {
    const match = item.path.match(/^indicators\.([^.]+)\.params\.([^.]+)$/)
    if (match) {
      const indicatorId = match[1]
      const parameterName = match[2]
      base.indicatorId = indicatorId
      base.parameterName = parameterName
      base.schemaSource = `dataRequirements.indicators.${indicatorId}.parameterSchema`
    }
  }
  if (category === 'dataRequirements' && item.field === 'minBars') {
    const currentMinBars = 'currentMinBars' in item ? item.currentMinBars : undefined
    const requiredMinBars = 'requiredMinBars' in item ? item.requiredMinBars : undefined
    const requiredLookbackBars = 'requiredLookbackBars' in item ? item.requiredLookbackBars : undefined
    base.operation = 'set_min_bars'
    if (typeof currentMinBars === 'number') base.currentMinBars = currentMinBars
    if (typeof requiredMinBars === 'number') {
      base.requiredMinBars = requiredMinBars
      base.targetValue = requiredMinBars
    }
    if (typeof requiredLookbackBars === 'number') base.requiredLookbackBars = requiredLookbackBars
  }
  return base
}

function candidateStrategyIndicatorTypes(value: string): string[] {
  const scored = indicatorRegistry
    .map((definition) => ({
      type: definition.type,
      score: candidateScore(value, [
        definition.type,
        ...(definition.aliases ?? []),
        definition.category ?? '',
      ]),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.type.localeCompare(right.type))
  const result = Array.from(new Set(scored.map((item) => item.type))).slice(0, 5)
  return result.length > 0 ? result : ['sma', 'ema', 'rsi', 'macd', 'atr']
}

function candidateFundIndicatorTypes(value: string): string[] {
  const scored = fundStrategyIndicatorRegistry
    .map((definition) => ({
      type: definition.type,
      score: candidateScore(value, [
        definition.type,
        definition.category,
        definition.source,
      ]),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.type.localeCompare(right.type))
  const result = Array.from(new Set(scored.map((item) => item.type))).slice(0, 5)
  return result.length > 0 ? result : ['nav_trend', 'rolling_return', 'fund_drawdown', 'fund_sharpe']
}

function candidateStrategyIndicatorCatalog(candidates: string[]): Array<Record<string, unknown>> {
  return candidates
    .map((type) => indicatorDefinition(type))
    .filter((definition): definition is NonNullable<ReturnType<typeof indicatorDefinition>> => definition != null)
    .map((definition) => ({
      type: definition.type,
      category: definition.category ?? 'technical',
      defaultPeriod: definition.defaultPeriod,
      lookbackBars: lookbackBarsFor(definition),
      requiredFields: definition.requiredFields ?? ['close'],
      executable: definition.executable !== false,
      parameterSchema: parameterSchemaForDefinition(definition),
      ...(definition.description ? { description: definition.description } : {}),
    }))
}

function candidateFundIndicatorCatalog(candidates: string[]): Array<Record<string, unknown>> {
  return candidates
    .map((type) => fundIndicatorDefinition(type))
    .filter((definition): definition is NonNullable<ReturnType<typeof fundIndicatorDefinition>> => definition != null)
    .map((definition) => ({
      type: definition.type,
      category: definition.category,
      source: definition.source,
      defaultPeriod: definition.defaultPeriod,
      requiredFields: definition.requiredFields,
      scoreDirection: definition.scoreDirection ?? 1,
      executable: true,
      parameterSchema: definition.parameterSchema ?? [{ name: 'period', type: 'integer', default: definition.defaultPeriod, min: 1 }],
      ...(definition.description ? { description: definition.description } : {}),
    }))
}

function candidateExitCatalog(): Array<Record<string, unknown>> {
  return [
    {
      type: 'stop_loss_pct',
      valueField: 'value',
      valueUnit: 'percent',
      description: 'Exit when price falls by the configured percent from entry.',
    },
    {
      type: 'take_profit_pct',
      valueField: 'value',
      valueUnit: 'percent',
      description: 'Exit when price rises by the configured percent from entry.',
    },
    {
      type: 'trailing_stop_pct',
      valueField: 'value',
      valueUnit: 'percent',
      description: 'Exit when price retreats from the high-water mark by the configured percent.',
    },
    {
      type: 'max_drawdown_stop_pct',
      valueField: 'value',
      valueUnit: 'percent',
      description: 'Exit when open-position drawdown reaches the configured percent.',
    },
    {
      type: 'atr_stop_loss',
      valueField: 'value',
      valueUnit: 'atr_multiple',
      optionalFields: ['period'],
      description: 'Exit when price falls by the configured ATR multiple from entry.',
    },
    {
      type: 'time_stop_bars',
      valueField: 'value',
      valueUnit: 'bars',
      description: 'Exit after the configured maximum holding bars.',
    },
  ]
}

function candidateScore(value: string, candidates: string[]): number {
  const text = candidateToken(value)
  if (!text) return 0
  let best = 0
  for (const candidate of candidates) {
    const normalized = candidateToken(candidate)
    if (!normalized) continue
    if (normalized === text) best = Math.max(best, 100)
    if (normalized.includes(text) || text.includes(normalized)) best = Math.max(best, 80)
    for (const part of text.split('_')) {
      if (part.length >= 3 && normalized.includes(part)) best = Math.max(best, 30)
    }
  }
  return best
}

function candidateToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_')
}

function unsupportedSuggestion(category: string): string {
  switch (category) {
    case 'indicator':
      return 'Replace with an executable StrategySpec indicator from custom_strategy_help, or keep the signal outside executable backtest evidence.'
    case 'fund_indicator':
      return 'Use a fund-specific indicator from custom_strategy_help.fundObservationV1.indicatorCatalog.'
    case 'rule_source':
      return 'Declare the referenced source as a StrategySpec indicator or use a built-in series such as close, volume, or turnover_rate.'
    case 'operator':
      return 'Use one of >, >=, <, <=, ==, !=, crosses_above, or crosses_below.'
    case 'exit_type':
      return 'Use stop_loss_pct, take_profit_pct, trailing_stop_pct, max_drawdown_stop_pct, atr_stop_loss, or time_stop_bars.'
    case 'positionSizing':
      return 'Use full_capital, fixed_fraction, risk_per_trade, or kelly_fraction.'
    case 'proxy_strategy':
      return 'A proxy StrategySpec is a separate strategy. Validate/backtest/save it only after explicit structured approval.'
    case 'condition_dsl':
      return 'Use canonical entry/exit rule groups, or request custom_strategy_help detail:"catalog" fields:["executableV1.conditionDslV1"] and revise the structured DSL fields.'
    default:
      return 'Revise this StrategySpec field according to custom_strategy_help before validating again.'
  }
}

function isAllowedRuleRef(value: string, declaredRefs: Set<string>): boolean {
  const text = value.trim()
  if (!text) return false
  if (declaredRefs.has(text)) return true
  if (/^close(?:_?\d+)?$/.test(text)) return true
  if (text === 'volume' || text === 'turnover_rate') return true
  const registered = parseRegisteredIndicator(text)
  return registered != null
}
