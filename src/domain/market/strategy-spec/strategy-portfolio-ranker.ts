import type { KlineBar } from '../../../agent/data/data-manager'
import { runCustomStrategyBacktest, validateStrategySpec } from './strategy-spec-engine'

export interface StrategyPortfolioCandidate {
  symbol: string
  bars: KlineBar[]
  dataEvidence: Record<string, unknown>
}

export function rankCustomStrategyPortfolio(input: {
  strategySpec: unknown
  candidates: StrategyPortfolioCandidate[]
  topN?: number
  rankingMetric?: string
  rebalanceInterval?: string
  maxPositionWeight?: number
  minScore?: number
  maxPairwiseCorrelation?: number
}): Record<string, unknown> {
  const { strategySpec, candidates } = input
  if (candidates.length < 2) {
    throw new Error('custom_strategy_rank requires at least two symbols for comparison')
  }
  const validation = validateStrategySpec(strategySpec)
  if (validation.status !== 'validated') {
    throw new Error(`custom strategy validation failed: ${validation.errors.join('; ')}`)
  }
  const validatedSpec = validation.spec as unknown as Record<string, unknown>
  const assetType = String(validatedSpec.assetType ?? validatedSpec.market ?? '').toLowerCase()
  if (assetType === 'fund') {
    throw new Error('custom_strategy_rank currently supports stock StrategySpec only; use custom_strategy_observe for fund observation evidence')
  }

  const rankingMetric = input.rankingMetric ?? 'score'
  const allRows: Array<Record<string, unknown>> = candidates.slice(0, 20).map((candidate) => {
    try {
      const result = runCustomStrategyBacktest(validation.spec, candidate.bars, candidate.symbol)
      const metrics = result.metrics as Record<string, unknown>
      const relativeStrength = relativeStrengthFor(candidate.bars)
      const dataCoverage = candidateDataCoverage(validatedSpec, candidate.dataEvidence, candidate.symbol)
      return {
        symbol: candidate.symbol,
        status: 'ranked',
        score: score(metrics, rankingMetric, relativeStrength),
        rankingMetric,
        relativeStrength,
        returnSeries: returnSeriesFor(candidate.bars),
        metrics,
        signals: result.signals,
        benchmarkEvidence: result.benchmarkEvidence,
        riskEvidence: result.riskEvidence,
        dataCoverage,
        assumptions: result.assumptions,
        dataEvidence: candidate.dataEvidence,
      }
    } catch (error) {
      return {
        symbol: candidate.symbol,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        dataEvidence: candidate.dataEvidence,
      }
    }
  }).sort((left, right) => Number(right.score ?? Number.NEGATIVE_INFINITY) - Number(left.score ?? Number.NEGATIVE_INFINITY))

  let rank = 1
  const rankedRows = allRows.filter((row) => row.status === 'ranked')
  const excludedRows = allRows.filter((row) => row.status !== 'ranked')
  for (const row of rankedRows) {
    row.rank = rank++
    if (isRecord(row.relativeStrength)) {
      row.relativeStrength = {
        ...row.relativeStrength,
        rank: row.rank,
        percentile: relativeStrengthPercentile(Number(row.rank), rankedRows.length),
      }
    }
  }
  const topN = Math.max(1, Math.min(Number(input.topN ?? 3), 10))
  const minScore = scoreThresholdFor(input.minScore)
  const eligibleRows = rankedRows.filter((row) => passesScoreThreshold(row, minScore))
  const maxPairwiseCorrelation = correlationCapFor(input.maxPairwiseCorrelation)
  const correlationSelection = selectWithCorrelationCap(eligibleRows, topN, maxPairwiseCorrelation)
  const selected = correlationSelection.selected
  const positionCap = positionCapFor(input.maxPositionWeight)
  const weight = selected.length ? round(Math.min(1 / selected.length, positionCap)) : 0
  const selectionEvidence = selectionEvidenceFor({
    rankedRows,
    selected,
    topN,
    rankingMetric,
    weight,
    positionCap,
    minScore,
    maxPairwiseCorrelation,
    correlationSkipped: correlationSelection.skipped,
  })
  const portfolioRiskEvidence = portfolioRiskEvidenceFor(selected, weight)
  const portfolioReturnQualityEvidence = portfolioReturnQualityEvidenceFor(selected, weight)
  const concentrationEvidence = portfolioConcentrationEvidenceFor(selected, weight, positionCap)
  const portfolioMetrics = portfolioMetricsFor(selected, portfolioRiskEvidence)
  const correlationEvidence = correlationEvidenceFor(selected)
  const portfolioStabilityEvidence = portfolioStabilityEvidenceFor(selected, weight)
  const rebalanceInterval = rebalanceIntervalFor(input.rebalanceInterval)
  const costModel = portfolioCostModelFor(validatedSpec)
  const portfolioRebalanceSimulation = portfolioRebalanceSimulationFor({
    selected,
    weight,
    rebalanceInterval,
    costModel,
  })
  const portfolioBacktestEvidence = portfolioBacktestEvidenceFor({
    selected,
    weight,
    rebalanceInterval,
    positionCap,
    costModel,
    portfolioRiskEvidence,
    portfolioReturnQualityEvidence,
    correlationEvidence,
  })
  const portfolioScoringEvidence = portfolioScoringEvidenceFor({
    spec: validatedSpec,
    selected,
    weight,
    positionCap,
    portfolioRiskEvidence,
    portfolioReturnQualityEvidence,
    concentrationEvidence,
    portfolioBacktestEvidence,
  })
  const portfolioDrawdownBudgetEvidence = portfolioDrawdownBudgetEvidenceFor({
    spec: validatedSpec,
    selected,
    portfolioRiskEvidence,
  })
  const portfolioValidation = portfolioValidationEvidenceFor({
    requestedCount: candidates.length,
    evaluatedCount: allRows.length,
    rankedCount: rankedRows.length,
    failedCount: excludedRows.length,
    selected,
    topN,
    rankingMetric,
    minScore,
    eligibleCount: eligibleRows.length,
    correlationEligibleCount: eligibleRows.length - correlationSelection.skipped.length,
    rebalanceInterval,
    positionCap,
    maxPairwiseCorrelation,
    weight,
    portfolioRiskEvidence,
    concentrationEvidence,
    correlationEvidence,
    portfolioBacktestEvidence,
    portfolioDrawdownBudgetEvidence,
  })
  const candidateFailureEvidence = candidateFailureEvidenceFor(excludedRows)
  const positionContributionEvidence = positionContributionEvidenceFor(selected, weight)

  return {
    action: 'custom_strategy_rank',
    status: selected.length ? 'ranked' : 'no_ranked_symbols',
    strategyId: validation.strategyId,
    version: validation.version,
    validationSummary: validation.validationSummary,
    validationIssues: validation.validationIssues ?? [],
    unsupportedDetails: validation.unsupportedDetails ?? [],
    dataRequirements: validation.dataRequirements,
    rankingMetric,
    candidateCount: candidates.length,
    rankedCount: rankedRows.length,
    failedCount: excludedRows.length,
    ranked: rankedRows,
    excluded: excludedRows,
    candidateFailureEvidence,
    allCandidates: allRows,
    portfolioEvidence: {
      mode: 'equal_weight_selected_metrics',
      selectedCount: selected.length,
      aggregateMetrics: portfolioMetrics,
      correlationEvidence,
      portfolioRiskEvidence,
      portfolioReturnQualityEvidence,
      concentrationEvidence,
      portfolioStabilityEvidence,
      portfolioRebalanceSimulation,
      portfolioBacktestEvidence,
      portfolioScoringEvidence,
      portfolioDrawdownBudgetEvidence,
      portfolioValidation,
      candidateFailureEvidence,
      selectionEvidence,
      positionContributionEvidence,
      assumptions: {
        weighting: 'equal_weight',
        rebalanceInterval,
        maxPositionWeight: positionCap,
        minScore,
        maxPairwiseCorrelation,
        maxDrawdownPct: portfolioDrawdownBudgetEvidence.allowedDrawdownPct,
        rankingMetric,
        correlationModel: correlationEvidence.mode,
        costModel,
        execution: 'not_executed',
      },
      riskNotes: [
        'Portfolio evidence is derived from selected single-symbol backtests; it is not an execution ledger.',
        'Transaction cost is estimated from StrategySpec cost assumptions; tax, liquidity impact, order fill, and live order state are not modelled in this draft.',
      ],
    },
    rebalanceDraft: {
      mode: 'equal_weight_top_n',
      topN: selected.length,
      rebalanceInterval,
      maxPositionWeight: positionCap,
      minScore,
      maxPairwiseCorrelation,
      aggregateMetrics: portfolioMetrics,
      correlationEvidence,
      portfolioRiskEvidence,
      portfolioReturnQualityEvidence,
      concentrationEvidence,
      portfolioStabilityEvidence,
      portfolioRebalanceSimulation,
      portfolioBacktestEvidence,
      portfolioScoringEvidence,
      portfolioDrawdownBudgetEvidence,
      portfolioValidation,
      candidateFailureEvidence,
      selectionEvidence,
      positionContributionEvidence,
      positions: selected.map((row) => ({
        symbol: row.symbol,
        targetWeight: weight,
        weightCapped: selected.length > 0 && positionCap < 1 / selected.length,
        basis: `${row.rankingMetric}=${row.score}`,
        selectionEvidence: row.selectionEvidence,
        weightEvidence: row.weightEvidence,
        contributionEvidence: positionContributionFor(row, weight),
      })),
      tradeBoundary: 'Ranking evidence only. Do not place simulated or real orders without explicit confirmation.',
    },
    portfolioValidation,
    portfolioBacktestEvidence,
    portfolioScoringEvidence,
    portfolioDrawdownBudgetEvidence,
    portfolioReturnQualityEvidence,
    concentrationEvidence,
    portfolioStabilityEvidence,
    portfolioRebalanceSimulation,
    selectionEvidence,
    validation,
    workflowAdvice: 'Use this as portfolio/ranking evidence. Save or monitor only after the user accepts the StrategySpec; trade preparation still requires separate sizing and confirmation.',
  }
}

function selectionEvidenceFor(input: {
  rankedRows: Array<Record<string, unknown>>
  selected: Array<Record<string, unknown>>
  topN: number
  rankingMetric: string
  weight: number
  positionCap: number
  minScore: number | null
  maxPairwiseCorrelation: number | null
  correlationSkipped: Array<Record<string, unknown>>
}): Record<string, unknown> {
  const selectedSymbols = new Set(input.selected.map((row) => String(row.symbol)))
  const correlationSkippedBySymbol = new Map(input.correlationSkipped.map((row) => [String(row.symbol), row]))
  for (const row of input.rankedRows) {
    const selectedForDraft = selectedSymbols.has(String(row.symbol))
    const belowThreshold = input.minScore != null && num(row.score) < input.minScore
    const correlationSkip = correlationSkippedBySymbol.get(String(row.symbol))
    row.selectionEvidence = {
      mode: 'portfolio_rank_selection_v1',
      rankingMetric: input.rankingMetric,
      rank: row.rank,
      score: row.score,
      minScore: input.minScore,
      maxPairwiseCorrelation: input.maxPairwiseCorrelation,
      topN: input.topN,
      selectedForDraft,
      selectionRule: 'rank <= topN after successful StrategySpec backtest, score threshold, and optional pairwise correlation cap',
      exclusionReason: selectedForDraft
        ? null
        : belowThreshold
          ? 'score below minScore threshold'
          : correlationSkip
            ? 'pairwise correlation above maxPairwiseCorrelation'
            : 'rank below selected topN',
      correlationConstraintEvidence: correlationSkip
        ? {
            mode: 'portfolio_correlation_constraint_v1',
            maxPairwiseCorrelation: input.maxPairwiseCorrelation,
            maxObservedCorrelation: correlationSkip.maxObservedCorrelation,
            matchedSymbol: correlationSkip.matchedSymbol,
          }
        : null,
    }
    row.weightEvidence = selectedForDraft
      ? positionWeightEvidenceFor(row, input.weight)
      : {
          mode: 'portfolio_equal_weight_v1',
          targetWeight: 0,
          selectedForDraft: false,
          reason: 'not selected for the rebalance draft',
        }
  }
  return {
    mode: 'portfolio_rank_selection_v1',
    rankingMetric: input.rankingMetric,
    topN: input.topN,
    minScore: input.minScore,
    maxPairwiseCorrelation: input.maxPairwiseCorrelation,
    selectedSymbols: input.selected.map((row) => row.symbol),
    selectedCount: input.selected.length,
    eligibleCount: input.rankedRows.filter((row) => passesScoreThreshold(row, input.minScore)).length,
    correlationEligibleCount: input.rankedRows.filter((row) => passesScoreThreshold(row, input.minScore)).length - input.correlationSkipped.length,
    correlationSkipped: input.correlationSkipped,
    weighting: 'equal_weight_with_position_cap',
    targetWeight: input.weight,
    maxPositionWeight: input.positionCap,
    tradeBoundary: 'Selection evidence is ranking/readback evidence only; it does not authorize simulated or real orders.',
  }
}

function positionContributionEvidenceFor(
  selected: Array<Record<string, unknown>>,
  weight: number,
): Record<string, unknown> {
  return {
    mode: 'position_contribution_evidence_v1',
    weighting: 'equal_weight',
    targetWeight: weight,
    selectedCount: selected.length,
    positions: selected.map((row) => positionContributionFor(row, weight)),
    tradeBoundary: 'Position contribution evidence explains ranking and weight basis only; it does not authorize order placement.',
  }
}

function positionContributionFor(row: Record<string, unknown>, weight: number): Record<string, unknown> {
  const metrics = isRecord(row.metrics) ? row.metrics : {}
  const relativeStrength = isRecord(row.relativeStrength) ? row.relativeStrength : {}
  const dataCoverage = isRecord(row.dataCoverage) ? row.dataCoverage : {}
  return {
    symbol: row.symbol,
    rank: row.rank,
    targetWeight: weight,
    rankingMetric: row.rankingMetric,
    score: row.score,
    selectionEvidence: row.selectionEvidence,
    weightEvidence: row.weightEvidence ?? positionWeightEvidenceFor(row, weight),
    weightedReturnContributionPct: round(num(metrics.totalReturnPct) * weight),
    weightedDrawdownContributionPct: round(num(metrics.maxDrawdownPct) * weight),
    relativeStrengthPercentile: relativeStrength.percentile,
    relativeStrengthReturnPct: relativeStrength.returnPct,
    tradeCount: metrics.tradeCount,
    sharpeRatio: metrics.sharpeRatio,
    dataCoverage: {
      source: dataCoverage.source,
      cacheStatus: dataCoverage.cacheStatus,
      rows: dataCoverage.rows,
      requiredBars: dataCoverage.requiredBars,
      sufficient: dataCoverage.sufficient,
      actualStartDate: dataCoverage.actualStartDate,
      actualEndDate: dataCoverage.actualEndDate,
    },
  }
}

function positionWeightEvidenceFor(row: Record<string, unknown>, weight: number): Record<string, unknown> {
  return {
    mode: 'portfolio_equal_weight_v1',
    rankingMetric: row.rankingMetric,
    score: row.score,
    rank: row.rank,
    targetWeight: weight,
    reason: 'equal weight among selected ranked symbols after position cap',
  }
}

function candidateDataCoverage(
  spec: Record<string, unknown>,
  evidence: Record<string, unknown>,
  symbol: string,
): Record<string, unknown> {
  const dataRequirements = spec.dataRequirements &&
    typeof spec.dataRequirements === 'object' &&
    !Array.isArray(spec.dataRequirements)
    ? spec.dataRequirements as Record<string, unknown>
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

function portfolioValidationEvidenceFor(input: {
  requestedCount: number
  evaluatedCount: number
  rankedCount: number
  failedCount: number
  selected: Array<Record<string, unknown>>
  topN: number
  rankingMetric: string
  minScore: number | null
  eligibleCount: number
  correlationEligibleCount: number
  rebalanceInterval: string
  positionCap: number
  maxPairwiseCorrelation: number | null
  weight: number
  portfolioRiskEvidence: Record<string, unknown>
  concentrationEvidence: Record<string, unknown>
  correlationEvidence: Record<string, unknown>
  portfolioBacktestEvidence: Record<string, unknown>
  portfolioDrawdownBudgetEvidence: Record<string, unknown>
}): Record<string, unknown> {
  const warnings: string[] = []
  if (!input.selected.length) {
    warnings.push('No ranked symbol was selected; portfolio evidence is not reusable.')
  }
  if (input.rankedCount < 2) {
    warnings.push('Fewer than two symbols produced ranked evidence.')
  }
  if (input.minScore != null && input.selected.length < input.topN) {
    warnings.push(`Score threshold excluded ${input.rankedCount - input.eligibleCount} ranked candidate(s) from the rebalance draft.`)
  }
  if (input.maxPairwiseCorrelation != null && input.correlationEligibleCount < input.eligibleCount) {
    warnings.push(`Pairwise correlation cap excluded ${input.eligibleCount - input.correlationEligibleCount} eligible candidate(s) from the rebalance draft.`)
  }
  if (input.failedCount > 0) {
    warnings.push(`${input.failedCount} candidate(s) failed validation/backtest and were excluded.`)
  }
  if (num(input.portfolioRiskEvidence.residualCashWeight) > 0) {
    warnings.push('Position cap leaves residual cash in the equal-weight draft.')
  }
  if (input.concentrationEvidence.status === 'concentrated') {
    warnings.push('Selected draft is concentrated; review effective position count and max position weight before trade preparation.')
  }
  if (input.correlationEvidence.mode !== 'close_return_pairwise_correlation') {
    warnings.push('Pairwise correlation evidence is incomplete.')
  }
  if (input.portfolioDrawdownBudgetEvidence.status === 'violated') {
    warnings.push('Portfolio drawdown budget is violated; review StrategySpec.risk.maxDrawdownPct before trade preparation.')
  }
  const bars = input.selected
    .map((row) => isRecord(row.relativeStrength) ? num(row.relativeStrength.lookbackBars) : 0)
    .filter((value) => value > 0)
  return {
    mode: 'portfolio_rank_validation_v1',
    status: !input.selected.length ? 'rejected' : warnings.length ? 'accepted_with_warnings' : 'accepted',
    minSymbolsRequired: 2,
    requestedCount: input.requestedCount,
    evaluatedCount: input.evaluatedCount,
    rankedCount: input.rankedCount,
    failedCount: input.failedCount,
    selectedCount: input.selected.length,
    eligibleCount: input.eligibleCount,
    correlationEligibleCount: input.correlationEligibleCount,
    topN: input.topN,
    rankingMetric: input.rankingMetric,
    minScore: input.minScore,
    maxPairwiseCorrelation: input.maxPairwiseCorrelation,
    rebalanceInterval: input.rebalanceInterval,
    maxPositionWeight: input.positionCap,
    targetWeight: input.weight,
    warnings,
    dataCoverage: {
      mode: 'selected_symbol_coverage',
      minBars: bars.length ? Math.min(...bars) : 0,
      maxBars: bars.length ? Math.max(...bars) : 0,
      symbols: input.selected.map((row) => ({
        symbol: row.symbol,
        rank: row.rank,
        score: row.score,
        lookbackBars: isRecord(row.relativeStrength) ? row.relativeStrength.lookbackBars : undefined,
        start: isRecord(row.relativeStrength) ? row.relativeStrength.start : undefined,
        end: isRecord(row.relativeStrength) ? row.relativeStrength.end : undefined,
        dataEvidence: row.dataEvidence,
      })),
    },
    portfolioBacktestStatus: input.portfolioBacktestEvidence.status,
    concentrationStatus: input.concentrationEvidence.status,
    drawdownBudgetStatus: input.portfolioDrawdownBudgetEvidence.status,
    drawdownBudgetEvidence: input.portfolioDrawdownBudgetEvidence,
    tradeBoundary: 'Portfolio validation is evidence-only. It does not authorize simulated or real order placement.',
  }
}

function candidateFailureEvidenceFor(excludedRows: Array<Record<string, unknown>>): Record<string, unknown> {
  const failures = excludedRows.map((row) => ({
    symbol: row.symbol,
    status: row.status,
    error: row.error,
    dataEvidence: row.dataEvidence,
  }))
  return {
    mode: 'candidate_failure_evidence',
    failedCount: failures.length,
    failures,
    nextAction: failures.length
      ? 'Inspect failed symbols and their dataEvidence; rerun only after data coverage or StrategySpec requirements are corrected.'
      : 'none',
  }
}

function rebalanceIntervalFor(value: unknown): string {
  const normalized = String(value ?? 'single-period-draft').trim().toLowerCase().replace(/_/g, '-')
  const allowed = new Set(['single-period-draft', 'weekly', 'monthly', 'quarterly'])
  return allowed.has(normalized) ? normalized : 'single-period-draft'
}

function positionCapFor(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 1
  return round(Math.max(0.01, Math.min(numeric, 1)))
}

function scoreThresholdFor(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return round(numeric)
}

function correlationCapFor(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return round(Math.max(0, Math.min(numeric, 1)))
}

function passesScoreThreshold(row: Record<string, unknown>, minScore: number | null): boolean {
  if (minScore == null) return true
  return num(row.score) >= minScore
}

function selectWithCorrelationCap(
  eligibleRows: Array<Record<string, unknown>>,
  topN: number,
  maxPairwiseCorrelation: number | null,
): { selected: Array<Record<string, unknown>>, skipped: Array<Record<string, unknown>> } {
  const selected: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []
  for (const candidate of eligibleRows) {
    if (selected.length >= topN) break
    const violation = correlationViolationFor(candidate, selected, maxPairwiseCorrelation)
    if (violation) {
      skipped.push({ symbol: candidate.symbol, ...violation })
      continue
    }
    selected.push(candidate)
  }
  return { selected, skipped }
}

function correlationViolationFor(
  candidate: Record<string, unknown>,
  selected: Array<Record<string, unknown>>,
  maxPairwiseCorrelation: number | null,
): Record<string, unknown> | null {
  if (maxPairwiseCorrelation == null || !selected.length) return null
  const candidateSeries = Array.isArray(candidate.returnSeries)
    ? candidate.returnSeries.filter((value): value is number => typeof value === 'number')
    : []
  if (candidateSeries.length < 2) return null
  for (const row of selected) {
    const selectedSeries = Array.isArray(row.returnSeries)
      ? row.returnSeries.filter((value): value is number => typeof value === 'number')
      : []
    if (selectedSeries.length < 2) continue
    const value = correlation(candidateSeries, selectedSeries)
    if (value == null) continue
    const absolute = Math.abs(value)
    if (absolute > maxPairwiseCorrelation) {
      return {
        mode: 'portfolio_correlation_constraint_v1',
        maxPairwiseCorrelation,
        maxObservedCorrelation: round(absolute),
        rawCorrelation: round(value),
        matchedSymbol: row.symbol,
      }
    }
  }
  return null
}

function returnSeriesFor(bars: KlineBar[]): number[] {
  const out: number[] = []
  for (let index = 1; index < bars.length; index++) {
    const previous = bars[index - 1].close
    if (previous === 0) continue
    out.push((bars[index].close - previous) / previous)
  }
  return out
}

function correlationEvidenceFor(selected: Array<Record<string, unknown>>): Record<string, unknown> {
  const series = selected
    .map((row) => Array.isArray(row.returnSeries) ? row.returnSeries.filter((value): value is number => typeof value === 'number') : [])
    .filter((values) => values.length >= 2)
  if (series.length < 2) {
    return { mode: 'not_enough_series', pairCount: 0, averagePairwiseCorrelation: null }
  }
  const pairs: number[] = []
  for (let left = 0; left < series.length; left++) {
    for (let right = left + 1; right < series.length; right++) {
      const value = correlation(series[left], series[right])
      if (value != null) pairs.push(value)
    }
  }
  if (!pairs.length) {
    return { mode: 'insufficient_variance', pairCount: 0, averagePairwiseCorrelation: null }
  }
  return {
    mode: 'close_return_pairwise_correlation',
    pairCount: pairs.length,
    averagePairwiseCorrelation: round(pairs.reduce((sum, value) => sum + value, 0) / pairs.length),
  }
}

function portfolioRiskEvidenceFor(selected: Array<Record<string, unknown>>, weight: number): Record<string, unknown> {
  const aligned = alignedPortfolioReturnSeriesFor(selected, weight)
  const returns = aligned.series
  if (!returns.length || weight <= 0) {
    return {
      mode: 'not_enough_series',
      portfolioReturnPct: 0,
      portfolioMaxDrawdownPct: 0,
      bars: 0,
      residualCashWeight: 1,
    }
  }
  if (returns.length < 2) {
    return {
      mode: 'not_enough_series',
      portfolioReturnPct: 0,
      portfolioMaxDrawdownPct: 0,
      bars: returns.length,
      residualCashWeight: aligned.residualCashWeight,
    }
  }
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const periodReturn of returns) {
    equity *= 1 + periodReturn
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
  }
  return {
    mode: 'equal_weight_return_series',
    portfolioReturnPct: round((equity - 1) * 100),
    portfolioMaxDrawdownPct: round(maxDrawdown * 100),
    bars: returns.length,
    residualCashWeight: aligned.residualCashWeight,
  }
}

function portfolioDrawdownBudgetEvidenceFor(input: {
  spec: Record<string, unknown>
  selected: Array<Record<string, unknown>>
  portfolioRiskEvidence: Record<string, unknown>
}): Record<string, unknown> {
  const risk = isRecord(input.spec.risk) ? input.spec.risk : {}
  const configured = positiveNum(risk.maxDrawdownPct)
  const allowedDrawdownPct = configured ?? 20
  const observedDrawdownPct = num(input.portfolioRiskEvidence.portfolioMaxDrawdownPct)
  const excessDrawdownPct = Math.max(0, observedDrawdownPct - allowedDrawdownPct)
  const status = !input.selected.length
    ? 'insufficient_data'
    : excessDrawdownPct > 0
      ? 'violated'
      : 'within_budget'
  return {
    mode: 'portfolio_drawdown_budget_v1',
    status,
    selectedCount: input.selected.length,
    allowedDrawdownPct: round(allowedDrawdownPct),
    observedDrawdownPct: round(observedDrawdownPct),
    excessDrawdownPct: round(excessDrawdownPct),
    policySource: configured == null ? 'default:20' : 'StrategySpec.risk.maxDrawdownPct',
    sourceEvidence: {
      portfolioRiskEvidence: 'portfolioMaxDrawdownPct',
      riskPolicy: 'StrategySpec.risk.maxDrawdownPct or default 20',
    },
    tradeBoundary: 'Drawdown budget evidence is portfolio-risk evidence only; it does not authorize simulated or real orders.',
  }
}

function alignedPortfolioReturnSeriesFor(
  selected: Array<Record<string, unknown>>,
  weight: number,
): { series: number[]; bars: number; residualCashWeight: number } {
  const series = selected
    .map((row) => Array.isArray(row.returnSeries) ? row.returnSeries.filter((value): value is number => typeof value === 'number') : [])
    .filter((values) => values.length > 0)
  if (!series.length || weight <= 0) {
    return {
      series: [],
      bars: 0,
      residualCashWeight: 1,
    }
  }
  const length = Math.min(...series.map((values) => values.length))
  const returns: number[] = []
  for (let index = 0; index < length; index++) {
    let periodReturn = 0
    for (const values of series) {
      periodReturn += values[values.length - length + index] * weight
    }
    returns.push(periodReturn)
  }
  return {
    series: returns,
    bars: length,
    residualCashWeight: round(1 - Math.min(1, weight * series.length)),
  }
}

function portfolioReturnQualityEvidenceFor(
  selected: Array<Record<string, unknown>>,
  weight: number,
): Record<string, unknown> {
  const aligned = alignedPortfolioReturnSeriesFor(selected, weight)
  const returns = aligned.series
  if (returns.length < 2) {
    return {
      mode: 'portfolio_return_quality_v1',
      status: 'insufficient_data',
      bars: returns.length,
      residualCashWeight: aligned.residualCashWeight,
      warnings: ['At least two aligned portfolio return bars are required for return-quality evidence.'],
      tradeBoundary: 'Portfolio return-quality evidence is analytical only; it does not authorize simulated or real orders.',
    }
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / returns.length
  const downside = returns.filter((value) => value < 0).map((value) => value * value)
  const downsideDeviation = downside.length
    ? Math.sqrt(downside.reduce((sum, value) => sum + value, 0) / returns.length)
    : 0
  const grossGain = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const grossLoss = returns.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0)
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const value of returns) {
    equity *= 1 + value
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
  }
  const annualFactor = 252
  const annualizedReturn = Math.pow(equity, annualFactor / returns.length) - 1
  const annualizedVolatility = Math.sqrt(variance) * Math.sqrt(annualFactor)
  const warnings: string[] = []
  if (grossLoss === 0) warnings.push('No losing portfolio periods; gain-to-pain is reported as null.')
  if (downsideDeviation === 0) warnings.push('No downside deviation; Sortino ratio is reported as null.')
  if (maxDrawdown === 0) warnings.push('No portfolio drawdown; Calmar ratio is reported as null.')
  return {
    mode: 'portfolio_return_quality_v1',
    status: warnings.length ? 'complete_with_warnings' : 'complete',
    bars: returns.length,
    annualizedReturnPct: round(annualizedReturn * 100),
    annualizedVolatilityPct: round(annualizedVolatility * 100),
    sharpeRatio: annualizedVolatility === 0 ? null : round(annualizedReturn / annualizedVolatility),
    sortinoRatio: downsideDeviation === 0 ? null : round(annualizedReturn / (downsideDeviation * Math.sqrt(annualFactor))),
    calmarRatio: maxDrawdown === 0 ? null : round(annualizedReturn / maxDrawdown),
    gainToPainRatio: grossLoss === 0 ? null : round(grossGain / grossLoss),
    positivePeriodCount: returns.filter((value) => value > 0).length,
    negativePeriodCount: returns.filter((value) => value < 0).length,
    residualCashWeight: aligned.residualCashWeight,
    warnings,
    tradeBoundary: 'Portfolio return-quality evidence is analytical only; it does not authorize simulated or real orders.',
  }
}

function portfolioScoringEvidenceFor(input: {
  spec: Record<string, unknown>
  selected: Array<Record<string, unknown>>
  weight: number
  positionCap: number
  portfolioRiskEvidence: Record<string, unknown>
  portfolioReturnQualityEvidence: Record<string, unknown>
  concentrationEvidence: Record<string, unknown>
  portfolioBacktestEvidence: Record<string, unknown>
}): Record<string, unknown> {
  const risk = isRecord(input.spec.risk) ? input.spec.risk : {}
  const returnPct = num(input.portfolioRiskEvidence.portfolioReturnPct)
  const drawdownPct = num(input.portfolioRiskEvidence.portfolioMaxDrawdownPct)
  const allowedDrawdownPct = positiveNum(risk.maxDrawdownPct) ?? 20
  const drawdownPenaltyPct = Math.max(0, drawdownPct - allowedDrawdownPct)
  const maxObservedPositionWeight = input.selected.length ? input.weight : 0
  const tradeCount = input.selected.reduce((sum, row) => {
    const metrics = isRecord(row.metrics) ? row.metrics : {}
    return sum + Math.round(num(metrics.tradeCount))
  }, 0)
  const disqualificationReasons: string[] = []
  if (maxObservedPositionWeight > input.positionCap + 0.000001) {
    disqualificationReasons.push('max_position_weight_exceeded')
  }
  if (drawdownPct > allowedDrawdownPct) {
    disqualificationReasons.push('max_drawdown_exceeded')
  }
  const warnings: string[] = []
  if (!input.selected.length) warnings.push('No selected symbols; portfolio scoring cannot rank an empty draft.')
  if (tradeCount === 0) warnings.push('No completed trades across selected candidate backtests.')
  if (num(input.concentrationEvidence.residualCashWeight) > 0) warnings.push('Position cap leaves residual cash outside selected symbols.')
  const qualityStatus = String(input.portfolioReturnQualityEvidence.status ?? '')
  if (qualityStatus && qualityStatus !== 'complete') warnings.push(`Return-quality evidence status is ${qualityStatus}.`)
  const status = !input.selected.length || input.portfolioBacktestEvidence.status === 'no_selected_symbols'
    ? 'insufficient_data'
    : disqualificationReasons.length
      ? 'disqualified'
      : warnings.length
        ? 'accepted_with_warnings'
        : 'accepted'
  return {
    mode: 'portfolio_risk_adjusted_scoring_v1',
    status,
    scoringMethod: 'return_minus_drawdown_penalty',
    selectedCount: input.selected.length,
    tradeCount,
    returnPct: round(returnPct),
    maxDrawdownPct: round(drawdownPct),
    allowedDrawdownPct: round(allowedDrawdownPct),
    drawdownPenaltyPct: round(drawdownPenaltyPct),
    riskAdjustedScore: input.selected.length ? round(returnPct - drawdownPenaltyPct) : null,
    maxPositionWeight: input.positionCap,
    maxObservedPositionWeight: round(maxObservedPositionWeight),
    positionCapStatus: maxObservedPositionWeight <= input.positionCap + 0.000001 ? 'within_cap' : 'violated',
    disqualificationReasons,
    warnings,
    sourceEvidence: {
      portfolioRiskEvidence: 'portfolioReturnPct/portfolioMaxDrawdownPct',
      portfolioReturnQualityEvidence: qualityStatus,
      portfolioBacktestEvidence: input.portfolioBacktestEvidence.status,
      riskPolicy: 'StrategySpec.risk.maxDrawdownPct or default 20',
    },
    tradeBoundary: 'Portfolio scoring evidence is analytical only; it does not authorize simulated or real orders.',
  }
}

function portfolioConcentrationEvidenceFor(
  selected: Array<Record<string, unknown>>,
  weight: number,
  positionCap: number,
): Record<string, unknown> {
  if (!selected.length || weight <= 0) {
    return {
      mode: 'portfolio_concentration_v1',
      status: 'insufficient_data',
      selectedCount: selected.length,
      maxPositionWeight: positionCap,
      targetWeight: weight,
      effectivePositionCount: 0,
      herfindahlIndex: null,
      residualCashWeight: 1,
      warnings: ['No selected positions are available for concentration evidence.'],
      tradeBoundary: 'Concentration evidence is portfolio-risk evidence only; it does not authorize order placement.',
    }
  }
  const investedWeight = Math.min(1, weight * selected.length)
  const residualCashWeight = round(1 - investedWeight)
  const weights = [
    ...selected.map(() => weight),
    ...(residualCashWeight > 0 ? [residualCashWeight] : []),
  ]
  const herfindahl = weights.reduce((sum, item) => sum + item * item, 0)
  const effectivePositionCount = herfindahl <= 0 ? 0 : 1 / herfindahl
  const warnings: string[] = []
  if (selected.length < 3) warnings.push('Selected draft has fewer than three symbols.')
  if (weight >= 0.5) warnings.push('Single-symbol target weight is at least 50%.')
  if (residualCashWeight > 0) warnings.push('Position cap leaves residual cash outside selected symbols.')
  return {
    mode: 'portfolio_concentration_v1',
    status: warnings.length ? 'concentrated' : 'diversified_evidence',
    selectedCount: selected.length,
    selectedSymbols: selected.map((row) => row.symbol),
    targetWeight: weight,
    maxPositionWeight: positionCap,
    investedWeight: round(investedWeight),
    residualCashWeight,
    herfindahlIndex: round(herfindahl),
    effectivePositionCount: round(effectivePositionCount),
    maxSinglePositionWeight: round(weight),
    warnings,
    tradeBoundary: 'Concentration evidence is portfolio-risk evidence only; it does not authorize order placement.',
  }
}

function portfolioStabilityEvidenceFor(selected: Array<Record<string, unknown>>, weight: number): Record<string, unknown> {
  const series = selected
    .map((row) => Array.isArray(row.returnSeries) ? row.returnSeries.filter((value): value is number => typeof value === 'number') : [])
    .filter((values) => values.length > 0)
  if (!series.length || weight <= 0) {
    return {
      mode: 'portfolio_cross_window_stability_v1',
      status: 'insufficient_data',
      windows: [],
      warnings: ['No selected return series available for stability check.'],
      tradeBoundary: 'Portfolio stability is evidence-only and does not authorize rebalance or order placement.',
    }
  }
  const length = Math.min(...series.map((values) => values.length))
  if (length < 4) {
    return {
      mode: 'portfolio_cross_window_stability_v1',
      status: 'insufficient_data',
      bars: length,
      windows: [],
      warnings: ['At least four aligned return bars are required for cross-window stability evidence.'],
      tradeBoundary: 'Portfolio stability is evidence-only and does not authorize rebalance or order placement.',
    }
  }
  const aligned = series.map((values) => values.slice(values.length - length))
  const split = Math.floor(length / 2)
  const first = portfolioWindowMetricsFor(aligned, weight, 0, split, 'first_half')
  const second = portfolioWindowMetricsFor(aligned, weight, split, length, 'second_half')
  const full = portfolioWindowMetricsFor(aligned, weight, 0, length, 'full')
  const returnDegradationPct = round(num(second.returnPct) - num(first.returnPct))
  const drawdownIncreasePct = round(num(second.maxDrawdownPct) - num(first.maxDrawdownPct))
  const warnings: string[] = []
  if (returnDegradationPct < -10) {
    warnings.push('Second-window return is more than 10 percentage points below the first window.')
  }
  if (drawdownIncreasePct > 5) {
    warnings.push('Second-window drawdown is more than 5 percentage points higher than the first window.')
  }
  if (selected.length < 3) {
    warnings.push('Stability evidence is based on fewer than three selected symbols.')
  }
  return {
    mode: 'portfolio_cross_window_stability_v1',
    status: warnings.length ? 'unstable_evidence' : 'stable_evidence',
    bars: length,
    split: {
      method: 'chronological_half_split',
      firstWindowBars: split,
      secondWindowBars: length - split,
    },
    windows: [first, second, full],
    returnDegradationPct,
    drawdownIncreasePct,
    warnings,
    tradeBoundary: 'Portfolio stability is evidence-only and does not authorize rebalance or order placement.',
  }
}

function portfolioRebalanceSimulationFor(input: {
  selected: Array<Record<string, unknown>>
  weight: number
  rebalanceInterval: string
  costModel: Record<string, unknown>
}): Record<string, unknown> {
  const series = input.selected
    .map((row) => Array.isArray(row.returnSeries) ? row.returnSeries.filter((value): value is number => typeof value === 'number') : [])
    .filter((values) => values.length > 0)
  const selectedSymbols = input.selected.map((row) => String(row.symbol ?? '').trim()).filter(Boolean)
  if (!series.length || !selectedSymbols.length || input.weight <= 0) {
    return {
      mode: 'portfolio_rebalance_simulation_v1',
      status: 'insufficient_data',
      selectedSymbols,
      warnings: ['No selected return series available for portfolio rebalance simulation.'],
      tradeBoundary: 'Rebalance simulation is evidence-only and does not authorize portfolio writes or orders.',
    }
  }
  const length = Math.min(...series.map((values) => values.length))
  if (length < 2) {
    return {
      mode: 'portfolio_rebalance_simulation_v1',
      status: 'insufficient_data',
      selectedSymbols,
      bars: length,
      warnings: ['At least two aligned return bars are required for portfolio rebalance simulation.'],
      tradeBoundary: 'Rebalance simulation is evidence-only and does not authorize portfolio writes or orders.',
    }
  }
  const aligned = series.map((values) => values.slice(values.length - length))
  const intervalBars = rebalanceIntervalBarsFor(input.rebalanceInterval)
  const residualCashWeight = 1 - Math.min(1, input.weight * aligned.length)
  const positions = Array.from({ length: aligned.length }, () => input.weight)
  let cash = residualCashWeight
  let total = 1
  let peak = 1
  let maxDrawdown = 0
  let rebalanceCount = 0
  let turnover = 0
  let oneWayTurnoverTotal = Math.min(1, input.weight * aligned.length)
  for (let index = 0; index < length; index++) {
    for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
      positions[positionIndex] *= 1 + aligned[positionIndex][index]
    }
    total = cash + positions.reduce((sum, value) => sum + value, 0)
    peak = Math.max(peak, total)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - total) / peak : 0)
    const shouldRebalance = intervalBars > 0 && index < length - 1 && (index + 1) % intervalBars === 0
    if (!shouldRebalance) continue
    let oneWayTurnover = 0
    for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
      const target = total * input.weight
      oneWayTurnover += Math.abs(target - positions[positionIndex])
      positions[positionIndex] = target
    }
    cash = total * residualCashWeight
    if (total > 0) {
      const turnoverRatio = oneWayTurnover / total
      turnover += turnoverRatio / 2
      oneWayTurnoverTotal += turnoverRatio
    }
    rebalanceCount += 1
  }
  const costRatePct = num(input.costModel.totalCostRatePct)
  const estimatedCostPct = round(oneWayTurnoverTotal * costRatePct)
  const grossReturnPct = round((total - 1) * 100)
  const warnings: string[] = []
  if (intervalBars === 0) {
    warnings.push('No periodic rebalance was simulated for single-period draft.')
  }
  if (residualCashWeight > 0) {
    warnings.push('Position cap leaves residual cash outside selected symbols.')
  }
  return {
    mode: 'portfolio_rebalance_simulation_v1',
    status: 'evidence_only',
    selectedSymbols,
    rebalanceInterval: input.rebalanceInterval,
    intervalBars,
    bars: length,
    targetWeight: input.weight,
    residualCashWeight: round(residualCashWeight),
    rebalanceCount,
    averageTurnoverPct: rebalanceCount === 0 ? 0 : round((turnover / rebalanceCount) * 100),
    grossSimulatedReturnPct: grossReturnPct,
    estimatedTransactionCostPct: estimatedCostPct,
    simulatedReturnPct: round(grossReturnPct - estimatedCostPct),
    simulatedMaxDrawdownPct: round(maxDrawdown * 100),
    transactionCostEvidence: {
      mode: 'portfolio_turnover_cost_estimate_v1',
      costModel: input.costModel,
      initialInvestedWeight: round(Math.min(1, input.weight * aligned.length)),
      oneWayTurnoverTotal: round(oneWayTurnoverTotal),
      estimatedCostPct,
      grossReturnPct,
      netReturnPct: round(grossReturnPct - estimatedCostPct),
    },
    warnings,
    assumptions: [
      'Static selected-symbol set from custom_strategy_rank.',
      'Equal target weight with residual cash from position cap.',
      'Transaction cost is estimated from StrategySpec commissionPct and slippagePct; tax, liquidity impact, order fill, and external portfolio state are not modelled.',
    ],
    tradeBoundary: 'Rebalance simulation is evidence-only and does not authorize portfolio writes or orders.',
  }
}

function rebalanceIntervalBarsFor(interval: string): number {
  switch (interval) {
    case 'weekly':
      return 5
    case 'monthly':
      return 21
    case 'quarterly':
      return 63
    case 'single-period-draft':
    default:
      return 0
  }
}

function portfolioWindowMetricsFor(
  aligned: number[][],
  weight: number,
  start: number,
  end: number,
  label: string,
): Record<string, unknown> {
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (let index = start; index < end; index++) {
    let periodReturn = 0
    for (const values of aligned) {
      periodReturn += values[index] * weight
    }
    equity *= 1 + periodReturn
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
  }
  return {
    label,
    bars: end - start,
    returnPct: round((equity - 1) * 100),
    maxDrawdownPct: round(maxDrawdown * 100),
  }
}

function portfolioBacktestEvidenceFor(input: {
  selected: Array<Record<string, unknown>>
  weight: number
  rebalanceInterval: string
  positionCap: number
  costModel: Record<string, unknown>
  portfolioRiskEvidence: Record<string, unknown>
  portfolioReturnQualityEvidence: Record<string, unknown>
  correlationEvidence: Record<string, unknown>
}): Record<string, unknown> {
  const symbols = input.selected.map((row) => String(row.symbol ?? '').trim()).filter(Boolean)
  const relativeStrengthRows = input.selected
    .map((row) => isRecord(row.relativeStrength) ? row.relativeStrength : null)
    .filter((row): row is Record<string, unknown> => Boolean(row))
  const starts = relativeStrengthRows.map((row) => String(row.start ?? '').trim()).filter(Boolean)
  const ends = relativeStrengthRows.map((row) => String(row.end ?? '').trim()).filter(Boolean)
  return {
    mode: 'equal_weight_selected_portfolio_backtest',
    status: symbols.length ? 'evidence_only' : 'no_selected_symbols',
    selectedSymbols: symbols,
    selectedCount: symbols.length,
    weighting: 'equal_weight',
    targetWeight: input.weight,
    maxPositionWeight: input.positionCap,
    rebalanceInterval: input.rebalanceInterval,
    start: starts.length ? starts.reduce((left, right) => left > right ? left : right) : null,
    end: ends.length ? ends.reduce((left, right) => left < right ? left : right) : null,
    portfolioReturnPct: input.portfolioRiskEvidence.portfolioReturnPct,
    portfolioMaxDrawdownPct: input.portfolioRiskEvidence.portfolioMaxDrawdownPct,
    portfolioReturnQualityEvidence: input.portfolioReturnQualityEvidence,
    bars: input.portfolioRiskEvidence.bars,
    residualCashWeight: input.portfolioRiskEvidence.residualCashWeight,
    transactionCostEvidence: {
      mode: 'portfolio_static_allocation_cost_estimate_v1',
      costModel: input.costModel,
      initialInvestedWeight: round(Math.min(1, input.weight * symbols.length)),
      estimatedInitialCostPct: round(Math.min(1, input.weight * symbols.length) * num(input.costModel.totalCostRatePct)),
      boundary: 'Static portfolio evidence estimates initial allocation cost only; interval rebalance cost is reported in portfolioRebalanceSimulation.',
    },
    correlationEvidence: input.correlationEvidence,
    dataEvidence: input.selected.map((row) => ({
      symbol: row.symbol,
      dataEvidence: row.dataEvidence,
    })),
    assumptions: [
      'Selected-symbol equal-weight return series only.',
      'Transaction cost is estimated from StrategySpec cost assumptions; tax, liquidity impact, order fill, and external portfolio state are not modelled.',
      'Use for watchlist/monitor/trade-preparation evidence; do not treat as execution or rebalance approval.',
    ],
    tradeBoundary: 'Evidence only. Simulated or real portfolio changes require separate sizing, user confirmation, execution, and readback.',
  }
}

function portfolioCostModelFor(spec: Record<string, unknown>): Record<string, unknown> {
  const cost = isRecord(spec.cost) ? spec.cost : {}
  const commissionPct = num(cost.commissionPct)
  const slippagePct = num(cost.slippagePct)
  return {
    mode: 'strategy_spec_cost_assumption',
    commissionPct: round(commissionPct),
    slippagePct: round(slippagePct),
    totalCostRatePct: round(commissionPct + slippagePct),
    source: 'strategySpec.cost',
    taxPct: null,
    liquidityImpact: 'not_modelled',
  }
}

function correlation(left: number[], right: number[]): number | null {
  const length = Math.min(left.length, right.length)
  if (length < 2) return null
  const leftTail = left.slice(left.length - length)
  const rightTail = right.slice(right.length - length)
  const leftMean = leftTail.reduce((sum, value) => sum + value, 0) / length
  const rightMean = rightTail.reduce((sum, value) => sum + value, 0) / length
  let covariance = 0
  let leftVariance = 0
  let rightVariance = 0
  for (let index = 0; index < length; index++) {
    const leftDiff = leftTail[index] - leftMean
    const rightDiff = rightTail[index] - rightMean
    covariance += leftDiff * rightDiff
    leftVariance += leftDiff * leftDiff
    rightVariance += rightDiff * rightDiff
  }
  if (leftVariance === 0 || rightVariance === 0) return null
  return covariance / Math.sqrt(leftVariance * rightVariance)
}

function score(metrics: Record<string, unknown>, rankingMetric: string, relativeStrength: Record<string, unknown>): number {
  const totalReturn = num(metrics.totalReturnPct)
  const sharpe = num(metrics.sharpeRatio)
  const drawdown = num(metrics.maxDrawdownPct)
  const trades = num(metrics.tradeCount)
  const relativeReturn = num(relativeStrength.returnPct)
  switch (rankingMetric) {
    case 'relative_strength_pct':
    case 'rps':
      return round(relativeReturn)
    case 'total_return_pct':
      return round(totalReturn)
    case 'sharpe_ratio':
      return round(sharpe)
    case 'max_drawdown_pct':
      return round(-drawdown)
    case 'trade_count':
      return round(trades)
    case 'score':
    default:
      return round(totalReturn + sharpe * 5 - drawdown * 0.5)
  }
}

function relativeStrengthFor(bars: KlineBar[]): Record<string, unknown> {
  if (bars.length < 2 || bars[0].close === 0) {
    return { mode: 'candidate_return_rank', lookbackBars: bars.length, returnPct: null }
  }
  const first = bars[0]
  const last = bars.at(-1)!
  return {
    mode: 'candidate_return_rank',
    lookbackBars: bars.length,
    start: first.date,
    end: last.date,
    returnPct: round(((last.close - first.close) / first.close) * 100),
  }
}

function relativeStrengthPercentile(rank: number, count: number): number {
  if (count <= 1) return 100
  return round(((count - rank) / (count - 1)) * 100)
}

function portfolioMetricsFor(
  selected: Array<Record<string, unknown>>,
  portfolioRiskEvidence: Record<string, unknown>,
): Record<string, unknown> {
  if (!selected.length) {
    return {
      selectedSymbols: [],
      expectedReturnPct: 0,
      worstSingleDrawdownPct: 0,
      averageSharpeRatio: 0,
      completedTradeCount: 0,
      portfolioReturnPct: 0,
      portfolioMaxDrawdownPct: 0,
    }
  }
  const metrics = selected.map((row) => row.metrics as Record<string, unknown> | undefined ?? {})
  return {
    selectedSymbols: selected.map((row) => row.symbol),
    expectedReturnPct: round(metrics.reduce((sum, item) => sum + num(item.totalReturnPct), 0) / selected.length),
    worstSingleDrawdownPct: round(Math.max(...metrics.map((item) => num(item.maxDrawdownPct)))),
    averageSharpeRatio: round(metrics.reduce((sum, item) => sum + num(item.sharpeRatio), 0) / selected.length),
    completedTradeCount: metrics.reduce((sum, item) => sum + num(item.tradeCount), 0),
    portfolioReturnPct: portfolioRiskEvidence.portfolioReturnPct,
    portfolioMaxDrawdownPct: portfolioRiskEvidence.portfolioMaxDrawdownPct,
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function positiveNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
