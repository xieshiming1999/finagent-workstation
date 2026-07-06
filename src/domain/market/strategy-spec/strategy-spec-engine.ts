import type { ToolContext } from '../../../agent/tool'
import type { KlineBar } from '../../../agent/data/data-manager'
import { runValidatedStrategySpecBacktest } from './strategy-backtest-runner'
import {
  compareCustomStrategyRecords,
  listCustomStrategyRecords,
  loadCustomStrategyRecord,
  loadRunnableCustomStrategySpec,
  saveCustomStrategyRecord,
  savedCustomStrategyRecordSymbol,
} from './strategy-lifecycle-store'
import {
  executableIndicators,
  fundStrategyIndicatorCatalog,
  fundIndicatorCatalogByCategory,
  fundIndicatorHelpCatalog,
  indicatorCatalogByCategory,
  indicatorHelpCatalog,
} from './strategy-spec-registry'
import { normalizeStrategySpec } from './strategy-spec-normalizer'
import {
  allowedOps,
  isFundStrategySpec,
  rejectedStrategySpec,
  validateFundStrategySpec,
  validateStockStrategySpec,
} from './strategy-spec-validator'

type RuleGroup = { all?: Rule[]; any?: Rule[] }
type Rule =
  | { left: string; op: string; right: unknown }
  | { type: 'stop_loss_pct' | 'take_profit_pct' | 'trailing_stop_pct' | 'max_drawdown_stop_pct' | 'atr_stop_loss' | 'time_stop_bars'; value: number; period?: number }

export interface StrategySpec {
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

export interface StrategyValidation {
  action: 'custom_strategy_validate'
  status: 'validated' | 'rejected'
  strategyId: string
  version: number
  spec: StrategySpec
  accepted: string[]
  warnings: string[]
  errors: string[]
  unsupported: string[]
  unsupportedDetails?: Array<Record<string, unknown>>
  validationIssues?: Array<Record<string, unknown>>
  repairPlan?: Array<Record<string, unknown>>
  validationSummary?: Record<string, unknown>
  dataRequirements?: Record<string, unknown>
  workflowAdvice: string
}

function wantsDetailedCatalog(input: Record<string, unknown> = {}): boolean {
  const detail = String(input.detail ?? input.mode ?? '').toLowerCase()
  return input.includeCatalog === true ||
    input.full === true ||
    detail === 'catalog' ||
    detail === 'full' ||
    detail === 'detailed'
}

export function customStrategyHelp(input: Record<string, unknown> = {}): string {
  const groupedIndicatorCatalog = indicatorCatalogByCategory()
  const includeCatalog = wantsDetailedCatalog(input)
  const stockIndicatorTypes = [...executableIndicators].sort()
  const preferredStockPreview = [
    'sma',
    'ema',
    'rsi',
    'macd',
    'bollinger_percent_b',
    'atr_pct',
    'volume_breakout',
    'money_flow_index',
    'rolling_volatility',
    'sharpe_ratio',
    'value_at_risk_pct',
    'true_strength_index',
  ]
  const stockIndicatorPreview = [
    ...preferredStockPreview.filter((indicator) => executableIndicators.has(indicator)),
    ...stockIndicatorTypes.filter((indicator) => !preferredStockPreview.includes(indicator)).slice(0, 12),
  ]
  const stockIndicatorPreviewSet = new Set(stockIndicatorPreview)
  const stockIndicatorPreviewCatalog = indicatorHelpCatalog
    .filter((indicator) => stockIndicatorPreviewSet.has(String(indicator.type)))
    .map((indicator) => ({
      type: indicator.type,
      category: indicator.category,
      requiredFields: indicator.requiredFields,
      parameterSchema: indicator.parameterSchema,
    }))
  const preferredFundPreview = [
    'nav_trend',
    'rolling_return',
    'fund_drawdown',
    'fund_volatility',
    'fund_sharpe',
    'fund_gain_to_pain',
    'fund_value_at_risk',
    'money_yield',
    'seven_day_yield',
    'dca_interval',
  ]
  const fundIndicatorSet = new Set<string>(fundStrategyIndicatorCatalog)
  const fundIndicatorPreview = [
    ...preferredFundPreview.filter((indicator) => fundIndicatorSet.has(indicator)),
    ...fundStrategyIndicatorCatalog.filter((indicator) => !preferredFundPreview.includes(indicator)).slice(0, 14),
  ]
  const fundIndicatorPreviewSet = new Set(fundIndicatorPreview)
  const fundIndicatorPreviewCatalog = fundIndicatorHelpCatalog
    .filter((indicator) => fundIndicatorPreviewSet.has(String(indicator.type)))
    .map((indicator) => ({
      type: indicator.type,
      category: indicator.category,
      source: indicator.source,
      requiredFields: indicator.requiredFields,
      parameterSchema: indicator.parameterSchema,
    }))
  const text = [
    'Custom StrategySpec v1 actions:',
    '- custom_strategy_validate: validate structured strategySpec without running a backtest',
    '- custom_strategy_backtest: validate and run a sandboxed backtest',
    '- custom_strategy_observe: evaluate fund-only observation StrategySpec with structured fundRows',
    '- custom_strategy_rank: validate a stock StrategySpec across symbols[] and return top-N ranking/rebalance evidence',
    '- custom_strategy_save: save only a validated/backtested StrategySpec',
    '- custom_strategy_list: list saved custom strategies',
    '- custom_strategy_run: run a saved custom strategy by strategyId',
    '',
    `Executable v1 supports ${stockIndicatorTypes.length} stock indicators across categories ${Object.keys(groupedIndicatorCatalog).sort().join(', ')}. Preview: ${stockIndicatorPreview.join(', ')}. Use detail:"catalog" only when the full indicator catalog is needed.`,
    `Fund StrategySpec requires assetClass:"fund" or market:"fund". It supports ${fundStrategyIndicatorCatalog.length} fund indicators across categories ${Object.keys(fundIndicatorCatalogByCategory()).sort().join(', ')}. Preview: ${fundIndicatorPreview.join(', ')}. Use custom_strategy_observe for current fund signal evidence and custom_strategy_fund_backtest for NAV/yield period evidence. Provide fundRows from query_fund_nav or query_fund_money_yield. Do not send fund specs to custom_strategy_backtest.`,
    'Output contract: custom_strategy_validate returns validationSummary, repairPlan, validationIssues, unsupported, unsupportedDetails, and dataRequirements; use those structured fields to revise or stop instead of parsing prose.',
    'Output contract: custom_strategy_backtest returns metrics/signals/trades plus lifecycleAdvice, benchmarkEvidence, riskEvidence, riskRewardEvidence, dataEvidence, dataCoverage, assumptions, outOfSample, and walkForward when requested. lifecycleAdvice.saveable=true means status:"backtested" is valid evidence for custom_strategy_save, even when metrics.tradeCount is 0. benchmarkEvidence is same-window buy-and-hold close-to-close reference evidence, not an executable trade simulation. riskRewardEvidence summarizes completed-trade payoff, profit factor, expectancy, and best/worst trade; it is not a trade guarantee. dataCoverage includes rows, requiredBars, sufficient, source/cache, actual date window, and dataRequirements.',
    'Output contract: custom_strategy_rank returns ranked rows with per-candidate benchmark/risk/data coverage evidence plus validationSummary, validationIssues, unsupportedDetails, dataRequirements, portfolioEvidence, rebalanceDraft, portfolioBacktestEvidence, portfolioScoringEvidence, portfolioDrawdownBudgetEvidence, portfolioReturnQualityEvidence, concentrationEvidence, portfolioStabilityEvidence, portfolioValidation, and candidateFailureEvidence. It is evidence-only and never places orders.',
    'Output contract: custom_strategy_observe returns fund observation evidence such as dcaObservation, monitorDraft, comparisonEvidence, fundRiskEvidence, and fundCoverageEvidence. custom_strategy_fund_backtest returns NAV/yield period evidence and fund tradeBoundary, not stock K-line backtest.',
    'Output contract: custom_strategy_save and custom_strategy_list expose validationSummary, validationIssues, repairPlan, unsupportedDetails, dataRequirements, dataAndAssumptionSummary, and lifecycle at the artifact/list-row level; use those fields before opening nested validationReport or backtestEvidence.',
    'Output contract: custom_strategy_run returns runnable backtest evidence only for saved backtested stock strategies, including validationSummary, validationIssues, repairPlan, unsupportedDetails, dataRequirements, benchmarkEvidence, dataCoverage, and lifecycle; non-runnable saved artifacts return readback_only with lifecycleIssue, validationIssues, repairPlan, evidenceAction, dataAndAssumptionSummary, and lifecycle.',
    'Proxy contract: if a supported StrategySpec is a replacement for unsupported original signals, declare proxyFor and unsupportedOriginalSignals. The validator rejects proxy StrategySpec validation/backtest/save until proxyApproval:{approved:true} is present from explicit user approval.',
    'Stock StrategySpec example: {"name":"low_risk_pullback","market":"cn","universe":{"type":"single","symbols":["600519"]},"dataRequirements":{"minBars":120,"adjust":"none","requiredFields":["open","high","low","close","volume"]},"indicators":[{"id":"ema20","type":"ema","source":"close","params":{"period":20}},{"id":"ema60","type":"ema","source":"close","params":{"period":60}},{"id":"rsi14","type":"rsi","source":"close","params":{"period":14}},{"id":"atrPct14","type":"atr_pct","source":"close","params":{"period":14}}],"entry":{"all":[{"left":"ema20","op":">","right":{"mul":["ema60",1]}},{"left":"rsi14","op":"<=","right":60},{"left":"atrPct14","op":"<=","right":3}]},"exit":{"any":[{"type":"stop_loss_pct","value":6},{"type":"take_profit_pct","value":12},{"type":"atr_stop_loss","value":2,"period":14},{"type":"trailing_stop_pct","value":8}]},"positionSizing":{"type":"fixed_fraction","value":0.2}}',
    'Fund ordinary NAV example: {"name":"fund_nav_dca","assetClass":"fund","market":"fund","dataRequirements":{"dataClass":"ordinary_fund_nav","requiredFields":["date","nav"],"minBars":60},"indicators":[{"id":"navTrend20","type":"nav_trend","source":"nav","params":{"period":20}},{"id":"fundDrawdown20","type":"fund_drawdown","source":"nav","params":{"period":20}}],"entry":{"all":[{"left":"fundDrawdown20","op":">=","right":8},{"left":"fundDrawdown20","op":"<","right":15}]},"exit":{"any":[{"left":"fundDrawdown20","op":">=","right":15}]}}',
    'Money fund example: {"name":"money_yield_watch","assetClass":"fund","market":"fund","fundType":"money","dataRequirements":{"dataClass":"money_fund_yield","requiredFields":["date","moneyYield","sevenDayYield"],"minBars":30},"indicators":[{"id":"sevenDayYield","type":"seven_day_yield","source":"yield","params":{"period":7}},{"id":"moneyYield","type":"money_yield","source":"yield","params":{"period":7}}],"entry":{"all":[{"left":"sevenDayYield","op":">","right":0.85}]},"exit":{"any":[{"left":"sevenDayYield","op":"<","right":0.8}]}}',
    `Indicator catalog categories: ${Object.keys(groupedIndicatorCatalog).sort().join(', ')}. Full catalog is omitted by default; call custom_strategy_help with detail:"catalog" when needed.`,
    'Unsupported parts such as news sentiment, main-fund intraday tape, arbitrary code, options legs, and broker execution are rejected or returned as non-executable notes.',
  ].join('\n')
  const payload: Record<string, unknown> = {
    action: 'custom_strategy_help',
    detail: includeCatalog ? 'catalog' : 'summary',
    supportedActions: [
      'custom_strategy_validate',
      'custom_strategy_backtest',
      'custom_strategy_observe',
      'custom_strategy_fund_backtest',
      'custom_strategy_rank',
      'custom_strategy_save',
      'custom_strategy_list',
      'custom_strategy_compare',
      'custom_strategy_run',
    ],
    executableV1: {
      indicatorCount: stockIndicatorTypes.length,
      indicatorsPreview: stockIndicatorPreview,
      indicatorPreviewCatalog: stockIndicatorPreviewCatalog,
      indicatorCategories: Object.keys(groupedIndicatorCatalog).sort(),
      catalogRequest: {
        action: 'custom_strategy_help',
        detail: 'catalog',
        fields: ['executableV1.indicators', 'executableV1.indicatorCatalog', 'executableV1.indicatorCatalogByCategory'],
      },
      stockExample: {
        name: 'low_risk_pullback',
        market: 'cn',
        universe: { type: 'single', symbols: ['600519'] },
        dataRequirements: {
          minBars: 120,
          adjust: 'none',
          requiredFields: ['open', 'high', 'low', 'close', 'volume'],
        },
        indicators: [
          { id: 'ema20', type: 'ema', source: 'close', params: { period: 20 } },
          { id: 'ema60', type: 'ema', source: 'close', params: { period: 60 } },
          { id: 'rsi14', type: 'rsi', source: 'close', params: { period: 14 } },
          { id: 'atrPct14', type: 'atr_pct', source: 'close', params: { period: 14 } },
        ],
        entry: {
          all: [
            { left: 'ema20', op: '>', right: { mul: ['ema60', 1] } },
            { left: 'rsi14', op: '<=', right: 60 },
            { left: 'atrPct14', op: '<=', right: 3 },
          ],
        },
        exit: {
          any: [
            { type: 'stop_loss_pct', value: 6 },
            { type: 'take_profit_pct', value: 12 },
            { type: 'atr_stop_loss', value: 2, period: 14 },
            { type: 'trailing_stop_pct', value: 8 },
          ],
        },
        positionSizing: { type: 'fixed_fraction', value: 0.2 },
      },
      operators: ['>', '>=', '<', '<=', 'crosses_above', 'crosses_below'],
      exits: ['stop_loss_pct', 'take_profit_pct', 'trailing_stop_pct', 'max_drawdown_stop_pct', 'atr_stop_loss', 'time_stop_bars'],
      positionSizing: ['full_capital', 'fixed_fraction', 'risk_per_trade', 'kelly_fraction'],
      rankingMetrics: ['score', 'total_return_pct', 'sharpe_ratio', 'max_drawdown_pct', 'trade_count', 'relative_strength_pct', 'rps'],
      rebalanceIntervals: ['weekly', 'monthly', 'quarterly'],
      portfolioDraftControls: ['rebalanceInterval', 'maxPositionWeight', 'minScore', 'maxPairwiseCorrelation'],
    },
    fundObservationV1: {
      requires: ['assetClass:fund', 'market:fund', 'fundRows'],
      actions: ['custom_strategy_observe', 'custom_strategy_fund_backtest'],
      indicatorCount: fundStrategyIndicatorCatalog.length,
      indicatorsPreview: fundIndicatorPreview,
      indicatorPreviewCatalog: fundIndicatorPreviewCatalog,
      indicatorCategories: Object.keys(fundIndicatorCatalogByCategory()),
      catalogRequest: {
        action: 'custom_strategy_help',
        detail: 'catalog',
        fields: ['fundObservationV1.indicators', 'fundObservationV1.indicatorCatalog', 'fundObservationV1.indicatorCatalogByCategory'],
      },
      ordinaryFundExample: {
        name: 'fund_nav_dca',
        assetClass: 'fund',
        market: 'fund',
        dataRequirements: {
          dataClass: 'ordinary_fund_nav',
          requiredFields: ['date', 'nav'],
          minBars: 60,
        },
        indicators: [
          { id: 'navTrend20', type: 'nav_trend', source: 'nav', params: { period: 20 } },
          { id: 'fundDrawdown20', type: 'fund_drawdown', source: 'nav', params: { period: 20 } },
        ],
        entry: { all: [{ left: 'fundDrawdown20', op: '>=', right: 8 }, { left: 'fundDrawdown20', op: '<', right: 15 }] },
        exit: { any: [{ left: 'fundDrawdown20', op: '>=', right: 15 }] },
      },
      moneyFundExample: {
        name: 'money_yield_watch',
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
        entry: { all: [{ left: 'sevenDayYield', op: '>', right: 0.85 }] },
        exit: { any: [{ left: 'sevenDayYield', op: '<', right: 0.8 }] },
      },
      boundary: 'Fund StrategySpec is observation/period-evidence only. Do not call custom_strategy_backtest for fund specs.',
    },
    inputContracts: {
      custom_strategy_validate: {
        requiredFields: ['strategySpec'],
        optionalFields: [
          {
            name: 'proxyApproval',
            type: 'object',
            default: null,
            purpose:
              'explicit approval object required only when validating a proxy StrategySpec for unsupported original signals',
          },
        ],
        boundary:
          'Validation is read-only. Use structured status, validationSummary, repairPlan, validationIssues, unsupported, and unsupportedDetails to revise or stop.',
      },
      custom_strategy_backtest: {
        requiredFields: ['strategySpec'],
        symbolFields: ['code', 'symbol', 'symbols[0]', 'strategySpec.universe.symbols[0]'],
        optionalFields: [
          {
            name: 'period',
            type: 'string',
            default: '1y',
            purpose: 'historical K-line window requested from governed data',
          },
          {
            name: 'outOfSampleRatio',
            type: 'number',
            aliases: ['validationSplit', 'holdoutRatio'],
            default: null,
            min: 0,
            max: 0.8,
            purpose: 'chronological holdout ratio for out-of-sample evidence',
          },
          {
            name: 'walkForwardFolds',
            type: 'integer',
            aliases: ['walkForward_folds', 'stabilityFolds'],
            default: null,
            min: 2,
            purpose: 'number of walk-forward stability folds',
          },
        ],
        boundary:
          'Backtest is stock StrategySpec only. Fund specs use custom_strategy_observe or custom_strategy_fund_backtest.',
      },
      custom_strategy_observe: {
        requiredFields: ['strategySpec', 'fundRows'],
        optionalFields: [
          {
            name: 'code',
            type: 'string',
            default: null,
            purpose:
              'fund code used to resolve local NAV or money-yield rows when fundRows is omitted by the tool caller',
          },
        ],
        boundary:
          'Fund observation is evidence-only and cannot execute subscription, redemption, stock backtest, or trade actions.',
      },
      custom_strategy_fund_backtest: {
        requiredFields: ['strategySpec', 'fundRows'],
        optionalFields: [
          {
            name: 'code',
            type: 'string',
            default: null,
            purpose:
              'fund code used to resolve local NAV or money-yield rows when fundRows is omitted by the tool caller',
          },
        ],
        boundary:
          'Fund period evidence uses NAV/yield rows and does not become stock K-line backtest evidence.',
      },
      custom_strategy_rank: {
        requiredFields: ['strategySpec', 'symbols'],
        optionalFields: [
          {
            name: 'topN',
            type: 'integer',
            default: 3,
            min: 1,
            max: 10,
            purpose: 'number of ranked candidates allowed into the draft',
          },
          {
            name: 'rankingMetric',
            type: 'enum',
            default: 'score',
            values: ['score', 'total_return_pct', 'sharpe_ratio', 'max_drawdown_pct', 'trade_count', 'relative_strength_pct', 'rps'],
            purpose: 'candidate ordering metric',
          },
          {
            name: 'rebalanceInterval',
            type: 'enum',
            default: 'single_period_draft',
            values: ['single_period_draft', 'weekly', 'monthly', 'quarterly'],
            purpose: 'evidence-only rebalance simulation cadence',
          },
          {
            name: 'maxPositionWeight',
            type: 'number',
            default: 1,
            min: 0.01,
            max: 1,
            purpose: 'position cap for the equal-weight draft',
          },
          {
            name: 'minScore',
            type: 'number',
            default: null,
            purpose: 'minimum score required to enter the draft',
          },
          {
            name: 'maxPairwiseCorrelation',
            type: 'number',
            default: null,
            min: 0,
            max: 1,
            purpose: 'absolute close-return correlation cap for selected candidates',
          },
        ],
        selectionEvidenceFields: ['selectedForDraft', 'exclusionReason', 'minScore', 'maxPairwiseCorrelation', 'correlationConstraintEvidence'],
        boundary: 'custom_strategy_rank input controls only shape evidence and rebalance drafts; they do not authorize watchlist writes, simulated trades, or real orders.',
      },
      custom_strategy_save: {
        requiredFields: ['strategySpec'],
        optionalFields: [
          {
            name: 'evidence',
            type: 'object',
            default: null,
            purpose:
              'validated/backtested/observed/ranked evidence returned by a prior custom strategy action',
          },
        ],
        boundary:
          'Save stores a strategy artifact only. It must not create watchlist entries, monitor jobs, simulated trades, or real orders.',
      },
      custom_strategy_run: {
        requiredFields: ['strategyId'],
        symbolFields: ['code', 'symbol', 'symbols[0]', 'saved strategy symbol'],
        optionalFields: [
          {
            name: 'period',
            type: 'string',
            default: '1y',
            purpose: 'historical K-line window for rerun evidence',
          },
        ],
        boundary:
          'Run only reuses a saved runnable stock strategy artifact. Non-runnable artifacts return readback_only lifecycle evidence.',
      },
    },
    outputContracts: {
      custom_strategy_validate: {
        coreFields: ['status', 'validationSummary', 'repairPlan', 'validationIssues', 'unsupported', 'unsupportedDetails', 'dataRequirements'],
        repairPlanFields: ['category', 'path', 'field', 'repairAction', 'target', 'patchHint', 'blocking'],
        nextAction: 'Use validationSummary.nextAction, repairPlan, validationIssues, and unsupportedDetails to revise or stop; do not parse prose errors.',
      },
      custom_strategy_backtest: {
        coreFields: [
          'metrics',
          'signals',
          'trades',
          'lifecycleAdvice',
          'validationSummary',
          'validationIssues',
          'repairPlan',
          'unsupportedDetails',
          'dataRequirements',
          'benchmarkEvidence',
          'riskEvidence',
          'riskRewardEvidence',
          'dataEvidence',
          'dataCoverage',
          'assumptions',
          'outOfSample',
          'walkForward',
        ],
        'lifecycleAdvice':
          'If saveable is true and the user requested save/rerun lifecycle verification, call custom_strategy_save with this backtest evidence, then custom_strategy_run by strategyId. Zero completed trades is an evidence boundary, not a validation failure.',
        dataCoverage: ['symbol', 'source', 'cacheStatus', 'rows', 'requiredBars', 'sufficient', 'actualStartDate', 'actualEndDate', 'dataRequirements'],
      },
      custom_strategy_rank: {
        coreFields: ['ranked', 'portfolioEvidence', 'rebalanceDraft', 'validationSummary', 'validationIssues', 'unsupportedDetails', 'dataRequirements', 'portfolioBacktestEvidence', 'portfolioScoringEvidence', 'portfolioDrawdownBudgetEvidence', 'portfolioReturnQualityEvidence', 'concentrationEvidence', 'portfolioStabilityEvidence', 'portfolioValidation', 'candidateFailureEvidence', 'selectionEvidence', 'positionContributionEvidence', 'transactionCostEvidence'],
        portfolioRebalanceSimulationFields: ['grossSimulatedReturnPct', 'estimatedTransactionCostPct', 'simulatedReturnPct', 'transactionCostEvidence'],
        portfolioBacktestEvidenceFields: ['transactionCostEvidence'],
        rankedRowFields: ['symbol', 'rank', 'score', 'metrics', 'signals', 'benchmarkEvidence', 'riskEvidence', 'selectionEvidence', 'weightEvidence', 'dataCoverage', 'assumptions', 'dataEvidence'],
        boundary: 'Ranking and rebalance evidence are evidence-only; they do not place orders.',
      },
      custom_strategy_observe: {
        coreFields: ['observation', 'dcaObservation', 'monitorDraft', 'comparisonEvidence', 'fundRiskEvidence', 'fundCoverageEvidence'],
        boundary: 'Fund observation evidence is not stock backtest evidence and does not execute subscription, redemption, or trade actions.',
      },
      custom_strategy_fund_backtest: {
        coreFields: ['periodEvidence', 'fundRiskEvidence', 'fundCoverageEvidence', 'ruleEvidence', 'tradeBoundary'],
        boundary: 'Fund period evidence uses NAV/yield rows, not stock K-line signals.',
      },
      custom_strategy_save: {
        coreFields: [
          'artifactContract',
          'paths',
          'itemPath',
          'strategyId',
          'status',
          'strategySpec',
          'validationReport',
          'validationSummary',
          'validationIssues',
          'repairPlan',
          'unsupportedDetails',
          'dataRequirements',
          'backtestEvidence',
          'dataAndAssumptionSummary',
          'lifecycle',
        ],
        dataAndAssumptionSummaryFields: [
          'dataEvidence',
          'dataCoverage',
          'fundCategoryEvidence',
          'fundCoverageEvidence',
          'fundRiskEvidence',
          'periodEvidence',
          'ruleEvidence',
          'portfolioEvidence',
          'rebalanceDraft',
          'portfolioValidation',
          'portfolioBacktestEvidence',
          'portfolioScoringEvidence',
          'portfolioDrawdownBudgetEvidence',
          'portfolioReturnQualityEvidence',
          'portfolioStabilityEvidence',
          'portfolioRebalanceSimulation',
          'concentrationEvidence',
          'candidateFailureEvidence',
          'rankedRowsEvidence',
        ],
        boundary: 'Saved strategy artifacts are reusable evidence; trade execution still requires explicit confirmation.',
      },
      custom_strategy_list: {
        topFields: [
          'artifactContract',
          'paths',
          'count',
          'strategies',
        ],
        rowFields: [
          'itemPath',
          'strategyId',
          'status',
          'assetClass',
          'symbols',
          'evidenceAction',
          'validationSummary',
          'validationIssues',
          'repairPlan',
          'unsupportedDetails',
          'dataRequirements',
          'dataAndAssumptionSummary',
          'lifecycle',
        ],
        dataAndAssumptionSummaryFields: [
          'dataEvidence',
          'dataCoverage',
          'fundCategoryEvidence',
          'fundCoverageEvidence',
          'fundRiskEvidence',
          'periodEvidence',
          'ruleEvidence',
          'portfolioEvidence',
          'rebalanceDraft',
          'portfolioValidation',
          'portfolioBacktestEvidence',
          'portfolioScoringEvidence',
          'portfolioDrawdownBudgetEvidence',
          'portfolioReturnQualityEvidence',
          'portfolioStabilityEvidence',
          'portfolioRebalanceSimulation',
          'concentrationEvidence',
          'candidateFailureEvidence',
          'rankedRowsEvidence',
        ],
      },
      custom_strategy_compare: {
        topFields: [
          'artifactContract',
          'paths',
          'count',
          'requestedStrategyIds',
          'missingStrategyIds',
          'strategies',
          'bestBy',
          'comparisonNotes',
        ],
        rowFields: [
          'strategyId',
          'name',
          'status',
          'strategyType',
          'assetClass',
          'symbols',
          'runnable',
          'evidenceAction',
          'validationIssueCount',
          'repairStepCount',
          'unsupportedCount',
          'metrics',
          'portfolioMetrics',
          'portfolioScoringEvidence',
          'portfolioDrawdownBudgetEvidence',
          'dataCoverage',
          'score',
          'tradeBoundary',
        ],
        boundary: 'Comparison reads saved artifacts only; it does not rerun, fetch data, or authorize trades.',
      },
      custom_strategy_run: {
        runnableBacktestedFields: [
          'metrics',
          'signals',
          'validationSummary',
          'validationIssues',
          'repairPlan',
          'unsupportedDetails',
          'dataRequirements',
          'benchmarkEvidence',
          'dataCoverage',
          'lifecycle',
        ],
        readbackOnlyFields: [
          'lifecycleIssue',
          'validationIssues',
          'repairPlan',
          'evidenceAction',
          'dataAndAssumptionSummary',
          'portfolioEvidence',
          'rebalanceDraft',
          'portfolioValidation',
          'portfolioBacktestEvidence',
          'portfolioScoringEvidence',
          'portfolioDrawdownBudgetEvidence',
          'portfolioReturnQualityEvidence',
          'portfolioStabilityEvidence',
          'portfolioRebalanceSimulation',
          'concentrationEvidence',
          'lifecycle',
        ],
      },
    },
    unsupportedV1: [
      'arbitrary code',
      'news sentiment as executable signal',
      'main-fund intraday tape as executable signal',
      'multi-leg/options strategies',
      'broker execution',
    ],
    proxyContract: {
      markerFields: ['proxyFor', 'originalSignals', 'unsupportedOriginalSignals', 'proxyApproval'],
      approvalRequired: true,
      approvalShape: { proxyApproval: { approved: true } },
      boundary: 'A proxy StrategySpec is a separate redesigned strategy. Do not validate, backtest, or save it as the original unsupported strategy without explicit user approval.',
    },
    text,
  }
  if (includeCatalog) {
    const executableV1 = payload.executableV1 as Record<string, unknown>
    executableV1.indicators = stockIndicatorTypes
    executableV1.indicatorCatalog = indicatorHelpCatalog
    executableV1.indicatorCatalogByCategory = groupedIndicatorCatalog
    const fundObservationV1 = payload.fundObservationV1 as Record<string, unknown>
    fundObservationV1.indicators = fundStrategyIndicatorCatalog
    fundObservationV1.indicatorCatalog = fundIndicatorHelpCatalog
    fundObservationV1.indicatorCatalogByCategory = fundIndicatorCatalogByCategory()
  } else {
    payload.text = [
      'Custom StrategySpec v1 compact help.',
      'Use custom_strategy_validate before custom_strategy_backtest.',
      'Use detail:"catalog" only when an uncommon indicator is not in the preview.',
      'Use custom_strategy_save only with validated/backtested/observed/ranked evidence.',
    ].join(' ')
    payload.inputContracts = {
      custom_strategy_validate: {
        requiredFields: ['strategySpec'],
        boundary: 'Read-only validation; revise or stop from structured validationSummary/repairPlan/unsupportedDetails.',
      },
      custom_strategy_backtest: {
        requiredFields: ['strategySpec'],
        symbolFields: ['code', 'symbol', 'symbols[0]', 'strategySpec.universe.symbols[0]'],
        optionalFields: ['period', 'outOfSampleRatio', 'walkForwardFolds'],
        boundary: 'Stock StrategySpec only. Fund specs use custom_strategy_observe or custom_strategy_fund_backtest.',
      },
      custom_strategy_save: {
        requiredFields: ['strategySpec'],
        optionalFields: ['evidence'],
        boundary: 'Save stores a strategy artifact only; it does not trade or create monitors.',
      },
    }
    payload.outputContracts = {
      custom_strategy_validate: {
        coreFields: ['status', 'validationSummary', 'repairPlan', 'validationIssues', 'unsupported', 'unsupportedDetails', 'dataRequirements'],
      },
      custom_strategy_backtest: {
        coreFields: ['status', 'metrics', 'signals', 'trades', 'lifecycleAdvice', 'dataCoverage', 'assumptions', 'outOfSample', 'walkForward'],
        lifecycleAdvice: 'saveable=true means the result can be saved; zero trades is an evidence boundary, not validation failure.',
      },
      custom_strategy_save: {
        coreFields: ['strategyId', 'status', 'strategySpec', 'validationReport', 'backtestEvidence', 'dataAndAssumptionSummary', 'lifecycle'],
      },
    }
  }
  return JSON.stringify(payload, null, 2)
}

export function validateStrategySpec(raw: unknown): StrategyValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return rejectedStrategySpec('custom_invalid', raw as StrategySpec, ['strategySpec object is required']) as StrategyValidation
  }
  const spec = normalizeStrategySpec(raw as StrategySpec) as StrategySpec
  if (isFundStrategySpec(spec)) return validateFundStrategySpec(spec) as StrategyValidation
  return validateStockStrategySpec(spec) as StrategyValidation
}

export function runCustomStrategyBacktest(
  raw: unknown,
  bars: KlineBar[],
  code: string,
  options: { outOfSampleRatio?: number; walkForwardFolds?: number } = {},
): Record<string, unknown> {
  const validation = validateStrategySpec(raw)
  if (validation.status !== 'validated') {
    throw new Error(`custom strategy validation failed: ${validation.errors.join('; ')}`)
  }
  const spec = validation.spec
  if (isFundStrategySpec(spec)) {
    throw new Error('custom fund StrategySpec is validation/observation-only in this runtime; use query_fund_nav, query_fund_money_yield, query_fund_performance, and fund-specific evidence before a fund backtest engine is available.')
  }
  return runValidatedStrategySpecBacktest(validation, spec, bars, code, options)
}

export function saveCustomStrategy(ctx: ToolContext, spec: StrategySpec, evidence?: unknown): Record<string, unknown> {
  const validation = validateStrategySpec(spec)
  if (validation.status !== 'validated') throw new Error(`custom strategy validation failed: ${validation.errors.join('; ')}`)
  return saveCustomStrategyRecord(ctx, validation, evidence)
}

export function listCustomStrategies(ctx: ToolContext): Record<string, unknown> {
  return listCustomStrategyRecords(ctx)
}

export function compareCustomStrategies(ctx: ToolContext, strategyIds: string[] = []): Record<string, unknown> {
  return compareCustomStrategyRecords(ctx, strategyIds)
}

export function loadCustomStrategy(ctx: ToolContext, strategyId: string): StrategySpec {
  return loadRunnableCustomStrategySpec(ctx, strategyId)
}

export function readCustomStrategy(ctx: ToolContext, strategyId: string): Record<string, unknown> {
  return loadCustomStrategyRecord(ctx, strategyId)
}

export function savedCustomStrategySymbol(ctx: ToolContext, strategyId: string): string | null {
  return savedCustomStrategyRecordSymbol(ctx, strategyId)
}
