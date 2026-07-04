import fs from 'node:fs'
import type { ToolContext } from '../../../agent/tool'
import type { StrategySpec, StrategyValidation } from './strategy-spec-engine'
import {
  ensureStrategyArtifactDirs,
  readableStrategyLibraryPath,
  strategyArtifactPaths,
  strategyItemPath,
} from './strategy-artifact-contract'

type StrategyRecord = {
  strategyId: string
  version: number
  status: 'validated' | 'backtested' | 'observed' | 'ranked' | 'evidence_attached' | string
  spec: StrategySpec & Record<string, unknown>
  validation: unknown
  evidence: unknown
  strategySpec: StrategySpec & Record<string, unknown>
  validationReport: unknown
  validationSummary: unknown
  validationIssues: unknown[]
  repairPlan: unknown[]
  unsupportedDetails: unknown[]
  dataRequirements: unknown
  backtestEvidence: unknown
  dataAndAssumptionSummary: Record<string, unknown>
  lifecycle: Record<string, unknown>
  updatedAt: string
}

export function saveCustomStrategyRecord(ctx: ToolContext, validation: StrategyValidation, evidence?: unknown): Record<string, unknown> {
  const existingRows = readStore(ctx)
  const existing = existingRows.find((row) => row.strategyId === validation.strategyId)
  const rows = existingRows.filter((row) => row.strategyId !== validation.strategyId)
  const spec = validation.spec as StrategySpec & Record<string, unknown>
  const incomingStatus = statusForEvidence(evidence)
  const status = strongerStatus(String(existing?.status ?? ''), incomingStatus)
  const effectiveEvidence = evidence ?? existing?.evidence
  const updatedAt = new Date().toISOString()
  const createdAt = createdAtOf(existing) ?? updatedAt
  const dataAndAssumptionSummary = summarizeDataAndAssumptions(spec, validation, effectiveEvidence)
  const evidencePayload = isRecord(effectiveEvidence) ? effectiveEvidence : {}
  const record: StrategyRecord = {
    strategyId: validation.strategyId,
    version: validation.version,
    status,
    spec,
    validation,
    evidence: effectiveEvidence ?? null,
    strategySpec: spec,
    validationReport: validation,
    validationSummary: evidencePayload.validationSummary ?? validation.validationSummary ?? null,
    validationIssues: Array.isArray(evidencePayload.validationIssues)
      ? evidencePayload.validationIssues
      : Array.isArray(validation.validationIssues)
        ? validation.validationIssues
        : [],
    repairPlan: Array.isArray(evidencePayload.repairPlan)
      ? evidencePayload.repairPlan
      : Array.isArray(validation.repairPlan)
        ? validation.repairPlan
        : [],
    unsupportedDetails: Array.isArray(evidencePayload.unsupportedDetails)
      ? evidencePayload.unsupportedDetails
      : Array.isArray(validation.unsupportedDetails)
        ? validation.unsupportedDetails
        : [],
    dataRequirements: evidencePayload.dataRequirements ?? validation.dataRequirements ?? null,
    backtestEvidence: backtestEvidenceFor(effectiveEvidence) ?? existing?.backtestEvidence ?? null,
    dataAndAssumptionSummary,
    lifecycle: {
      status,
      createdAt,
      updatedAt,
      runnable: status === 'backtested',
      nextActions: nextActionsForStatus(status),
    },
    updatedAt,
  }
  rows.push(record)
  writeStore(ctx, rows)
  const basePath = String(ctx.basePath ?? process.cwd())
  return {
    action: 'custom_strategy_save',
    artifactContract: 'strategy-library-v1',
    paths: strategyArtifactPaths(basePath),
    itemPath: strategyItemPath(basePath, validation.strategyId),
    ...record,
  }
}

function strongerStatus(existing: string, incoming: StrategyRecord['status']): StrategyRecord['status'] {
  return statusRank(incoming) >= statusRank(existing) ? incoming : existing
}

function statusRank(status: string): number {
  switch (status) {
    case 'backtested':
      return 4
    case 'ranked':
    case 'observed':
      return 3
    case 'evidence_attached':
      return 2
    case 'validated':
      return 1
    default:
      return 0
  }
}

function statusForEvidence(evidence: unknown): StrategyRecord['status'] {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return 'validated'
  const payload = evidence as Record<string, unknown>
  const action = String(payload.action ?? '')
  const status = String(payload.status ?? '')
  if (status === 'backtested') return 'backtested'
  if (status === 'observed') return 'observed'
  if (status === 'ranked') return 'ranked'
  switch (action) {
    case 'custom_strategy_backtest':
    case 'custom_strategy_run':
      return 'backtested'
    case 'custom_strategy_observe':
    case 'custom_strategy_fund_backtest':
      return 'observed'
    case 'custom_strategy_rank':
      return 'ranked'
    default:
      if (String(payload.signal ?? '').trim() || typeof payload.fundDrawdown20 === 'number' || typeof payload.navTrend20 === 'number') return 'observed'
      if (typeof payload.rankedCount === 'number' || payload.portfolioEvidence) return 'ranked'
      return 'evidence_attached'
  }
}

export function listCustomStrategyRecords(ctx: ToolContext): Record<string, unknown> {
  const rows = readStore(ctx)
  return {
    action: 'custom_strategy_list',
    count: rows.length,
    artifactContract: 'strategy-library-v1',
    paths: strategyArtifactPaths(String(ctx.basePath ?? process.cwd())),
    strategies: rows.map((row) => {
      const spec = row.strategySpec ?? row.spec
      const evidence = isRecord(row.backtestEvidence) ? row.backtestEvidence : isRecord(row.evidence) ? row.evidence : {}
      return {
        strategyId: row.strategyId,
        version: row.version,
        status: row.status,
        updatedAt: row.updatedAt,
        name: spec?.name,
        assetClass: spec?.assetClass ?? spec?.market ?? 'stock',
        symbols: symbolsOf(spec ?? {}),
        evidenceAction: evidence.action ?? null,
        validationSummary:
          row.validationSummary ??
          (isRecord(row.validationReport) ? row.validationReport.validationSummary : null) ??
          (isRecord(evidence) ? evidence.validationSummary : null),
        validationIssues:
          row.validationIssues ??
          (isRecord(row.validationReport) && Array.isArray(row.validationReport.validationIssues) ? row.validationReport.validationIssues : null) ??
          (isRecord(evidence) && Array.isArray(evidence.validationIssues) ? evidence.validationIssues : []),
        repairPlan:
          row.repairPlan ??
          (isRecord(row.validationReport) && Array.isArray(row.validationReport.repairPlan) ? row.validationReport.repairPlan : null) ??
          (isRecord(evidence) && Array.isArray(evidence.repairPlan) ? evidence.repairPlan : []),
        unsupportedDetails:
          row.unsupportedDetails ??
          (isRecord(row.validationReport) && Array.isArray(row.validationReport.unsupportedDetails) ? row.validationReport.unsupportedDetails : null) ??
          (isRecord(evidence) && Array.isArray(evidence.unsupportedDetails) ? evidence.unsupportedDetails : []),
        dataRequirements:
          row.dataRequirements ??
          (isRecord(row.validationReport) ? row.validationReport.dataRequirements : null) ??
          (isRecord(evidence) ? evidence.dataRequirements : null),
        dataAndAssumptionSummary: row.dataAndAssumptionSummary ?? {},
        lifecycle: row.lifecycle ?? {},
        itemPath: strategyItemPath(String(ctx.basePath ?? process.cwd()), String(row.strategyId)),
      }
    }),
  }
}

export function compareCustomStrategyRecords(
  ctx: ToolContext,
  strategyIds: string[] = [],
): Record<string, unknown> {
  const requested = Array.from(new Set(strategyIds.map((value) => String(value).trim()).filter(Boolean)))
  const rows = readStore(ctx)
    .filter((row) => requested.length === 0 || requested.includes(String(row.strategyId)))
    .map(comparisonRow)
  const missing = requested.filter((id) => !rows.some((row) => row.strategyId === id))
  return {
    action: 'custom_strategy_compare',
    artifactContract: 'strategy-library-v1',
    paths: strategyArtifactPaths(String(ctx.basePath ?? process.cwd())),
    requestedStrategyIds: requested,
    count: rows.length,
    missingStrategyIds: missing,
    strategies: rows,
    bestBy: bestBy(rows),
    comparisonNotes: [
      'Comparison uses saved artifact evidence only; it does not rerun backtests or fetch new data.',
      'Trade preparation still requires explicit confirmation and post-action readback.',
    ],
  }
}

export function loadCustomStrategyRecord(ctx: ToolContext, strategyId: string): StrategyRecord {
  const row = findCustomStrategyRecord(ctx, strategyId)
  if (!row) throw new Error(`custom strategy not found: ${strategyId}`)
  return row
}

export function loadRunnableCustomStrategyRecord(ctx: ToolContext, strategyId: string): StrategyRecord {
  const row = loadCustomStrategyRecord(ctx, strategyId)
  if (row.status !== 'backtested') {
    throw new Error(`custom strategy ${strategyId} is not runnable; status=${row.status}. Run custom_strategy_backtest and save backtested evidence first.`)
  }
  return row
}

export function loadRunnableCustomStrategySpec(ctx: ToolContext, strategyId: string): StrategySpec {
  return loadRunnableCustomStrategyRecord(ctx, strategyId).spec
}

export function savedCustomStrategyRecordSymbol(ctx: ToolContext, strategyId: string): string | null {
  const row = findCustomStrategyRecord(ctx, strategyId)
  const spec = row?.strategySpec ?? row?.spec
  if (!spec) return null
  if (typeof spec.symbol === 'string' && spec.symbol.trim()) return spec.symbol.trim()
  if (typeof spec.code === 'string' && spec.code.trim()) return spec.code.trim()
  if (typeof spec.fundCode === 'string' && spec.fundCode.trim()) return spec.fundCode.trim()
  const symbols = spec.symbols
  if (Array.isArray(symbols) && symbols.length > 0) return String(symbols[0]).trim()
  const codes = spec.codes
  if (Array.isArray(codes) && codes.length > 0) return String(codes[0]).trim()
  const universe = spec.universe
  if (Array.isArray(universe) && universe.length > 0) return String(universe[0]).trim()
  if (universe && typeof universe === 'object') {
    const universeSymbols = (universe as { symbols?: unknown[] }).symbols
    if (Array.isArray(universeSymbols) && universeSymbols.length > 0) {
      return String(universeSymbols[0]).trim()
    }
  }
  return null
}

function findCustomStrategyRecord(ctx: ToolContext, strategyId: string): StrategyRecord | null {
  return readStore(ctx).find((item) => item.strategyId === strategyId || (item.strategySpec ?? item.spec)?.id === strategyId) ?? null
}

function createdAtOf(record: StrategyRecord | undefined): string | null {
  if (!record) return null
  const lifecycle = record.lifecycle && typeof record.lifecycle === 'object' && !Array.isArray(record.lifecycle)
    ? record.lifecycle as Record<string, unknown>
    : {}
  const createdAt = String(lifecycle.createdAt ?? '').trim()
  if (createdAt) return createdAt
  const updatedAt = String(record.updatedAt ?? '').trim()
  return updatedAt || null
}

function backtestEvidenceFor(evidence: unknown): unknown {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null
  const payload = evidence as Record<string, unknown>
  const action = String(payload.action ?? '')
  const status = String(payload.status ?? '')
  return action === 'custom_strategy_backtest' || action === 'custom_strategy_run' || status === 'backtested'
    ? evidence
    : null
}

function summarizeDataAndAssumptions(
  spec: StrategySpec & Record<string, unknown>,
  validation: StrategyValidation,
  evidence: unknown,
): Record<string, unknown> {
  const payload = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence as Record<string, unknown> : {}
  const dataEvidence = payload.dataEvidence && typeof payload.dataEvidence === 'object' && !Array.isArray(payload.dataEvidence)
    ? payload.dataEvidence as Record<string, unknown>
    : {}
  const dataCoverage = payload.dataCoverage && typeof payload.dataCoverage === 'object' && !Array.isArray(payload.dataCoverage)
    ? payload.dataCoverage as Record<string, unknown>
    : {}
  const fundCategoryEvidence = payload.fundCategoryEvidence && typeof payload.fundCategoryEvidence === 'object' && !Array.isArray(payload.fundCategoryEvidence)
    ? payload.fundCategoryEvidence as Record<string, unknown>
    : null
  const fundCoverageEvidence = payload.fundCoverageEvidence && typeof payload.fundCoverageEvidence === 'object' && !Array.isArray(payload.fundCoverageEvidence)
    ? payload.fundCoverageEvidence as Record<string, unknown>
    : null
  const fundRiskEvidence = payload.fundRiskEvidence && typeof payload.fundRiskEvidence === 'object' && !Array.isArray(payload.fundRiskEvidence)
    ? payload.fundRiskEvidence as Record<string, unknown>
    : null
  const riskRewardEvidence = isRecord(payload.riskRewardEvidence) ? payload.riskRewardEvidence : null
  const fundPeriodEvidence = isRecord(payload.periodEvidence) ? payload.periodEvidence : null
  const fundRuleEvidence = isRecord(payload.ruleEvidence) ? payload.ruleEvidence : null
  const portfolioEvidence = isRecord(payload.portfolioEvidence) ? payload.portfolioEvidence : null
  const rebalanceDraft = isRecord(payload.rebalanceDraft) ? payload.rebalanceDraft : null
  const portfolioValidation = isRecord(payload.portfolioValidation) ? payload.portfolioValidation : null
  const portfolioBacktestEvidence = isRecord(payload.portfolioBacktestEvidence) ? payload.portfolioBacktestEvidence : null
  const portfolioScoringEvidence = isRecord(payload.portfolioScoringEvidence) ? payload.portfolioScoringEvidence : null
  const portfolioDrawdownBudgetEvidence = isRecord(payload.portfolioDrawdownBudgetEvidence) ? payload.portfolioDrawdownBudgetEvidence : null
  const portfolioReturnQualityEvidence = isRecord(payload.portfolioReturnQualityEvidence) ? payload.portfolioReturnQualityEvidence : null
  const concentrationEvidence = isRecord(payload.concentrationEvidence) ? payload.concentrationEvidence : null
  const portfolioStabilityEvidence = isRecord(payload.portfolioStabilityEvidence) ? payload.portfolioStabilityEvidence : null
  const portfolioRebalanceSimulation = isRecord(payload.portfolioRebalanceSimulation) ? payload.portfolioRebalanceSimulation : null
  const candidateFailureEvidence = isRecord(payload.candidateFailureEvidence) ? payload.candidateFailureEvidence : null
  const cost = spec.cost && typeof spec.cost === 'object' && !Array.isArray(spec.cost) ? spec.cost as Record<string, unknown> : {}
  const risk = spec.risk && typeof spec.risk === 'object' && !Array.isArray(spec.risk) ? spec.risk as Record<string, unknown> : {}
  const positionSizing = spec.positionSizing && typeof spec.positionSizing === 'object' && !Array.isArray(spec.positionSizing)
    ? spec.positionSizing as Record<string, unknown>
    : {}
  return {
    assetClass: spec.assetClass ?? spec.market ?? 'stock',
    symbols: symbolsOf(spec),
    dataRequirements:
      spec.dataRequirements ??
      ((validation as unknown as Record<string, unknown>).dataRequirements ?? null),
    dataEvidence,
    dataCoverage,
    ...(fundCategoryEvidence ? { fundCategoryEvidence } : {}),
    ...(fundCoverageEvidence ? { fundCoverageEvidence } : {}),
    ...(fundRiskEvidence ? { fundRiskEvidence } : {}),
    ...(riskRewardEvidence ? { riskRewardEvidence } : {}),
    ...(fundPeriodEvidence ? { periodEvidence: fundPeriodEvidence } : {}),
    ...(fundRuleEvidence ? { ruleEvidence: fundRuleEvidence } : {}),
    ...(portfolioEvidence ? { portfolioEvidence } : {}),
    ...(rebalanceDraft ? { rebalanceDraft } : {}),
    ...(portfolioValidation ? { portfolioValidation } : {}),
    ...(portfolioBacktestEvidence ? { portfolioBacktestEvidence } : {}),
    ...(portfolioScoringEvidence ? { portfolioScoringEvidence } : {}),
    ...(portfolioDrawdownBudgetEvidence ? { portfolioDrawdownBudgetEvidence } : {}),
    ...(portfolioReturnQualityEvidence ? { portfolioReturnQualityEvidence } : {}),
    ...(concentrationEvidence ? { concentrationEvidence } : {}),
    ...(portfolioStabilityEvidence ? { portfolioStabilityEvidence } : {}),
    ...(portfolioRebalanceSimulation ? { portfolioRebalanceSimulation } : {}),
    ...(candidateFailureEvidence ? { candidateFailureEvidence } : {}),
    ...(Array.isArray(payload.ranked) ? { rankedRowsEvidence: rankedRowsEvidence(payload.ranked) } : {}),
    feesAndSlippage: {
      commissionPct: cost.commissionPct ?? cost.commission_pct ?? null,
      slippagePct: cost.slippagePct ?? cost.slippage_pct ?? null,
    },
    risk,
    positionSizing,
    tradeBoundary: 'saved strategy artifact only; trade execution requires explicit confirmation and post-action readback',
  }
}

function rankedRowsEvidence(rows: unknown[]): Array<Record<string, unknown>> {
  return rows
    .filter(isRecord)
    .slice(0, 5)
    .map((row) => ({
      symbol: row.symbol,
      rank: row.rank,
      score: row.score,
      rankingMetric: row.rankingMetric,
      metrics: row.metrics,
      signals: row.signals,
      benchmarkEvidence: row.benchmarkEvidence,
      riskEvidence: row.riskEvidence,
      riskRewardEvidence: row.riskRewardEvidence,
      selectionEvidence: row.selectionEvidence,
      weightEvidence: row.weightEvidence,
      dataCoverage: row.dataCoverage,
      dataEvidence: row.dataEvidence,
    }))
}

function symbolsOf(spec: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['symbol', 'code', 'fundCode']) {
    const value = String(spec[key] ?? '').trim()
    if (value) out.push(value)
  }
  for (const key of ['symbols', 'codes']) {
    const value = spec[key]
    if (Array.isArray(value)) out.push(...value.map((item) => String(item).trim()).filter(Boolean))
  }
  const universe = spec.universe
  if (Array.isArray(universe)) out.push(...universe.map((item) => String(item).trim()).filter(Boolean))
  if (universe && typeof universe === 'object' && Array.isArray((universe as { symbols?: unknown }).symbols)) {
    out.push(...((universe as { symbols: unknown[] }).symbols).map((item) => String(item).trim()).filter(Boolean))
  }
  return Array.from(new Set(out))
}

function comparisonRow(row: StrategyRecord): Record<string, unknown> {
  const spec = row.strategySpec ?? row.spec ?? {}
  const lifecycle = isRecord(row.lifecycle) ? row.lifecycle : {}
  const summary = isRecord(row.dataAndAssumptionSummary) ? row.dataAndAssumptionSummary : {}
  const evidence = isRecord(row.backtestEvidence) ? row.backtestEvidence : isRecord(row.evidence) ? row.evidence : {}
  const metrics = isRecord(evidence.metrics) ? evidence.metrics : {}
  const riskReward = isRecord(summary.riskRewardEvidence)
    ? summary.riskRewardEvidence
    : isRecord(evidence.riskRewardEvidence)
      ? evidence.riskRewardEvidence
      : {}
  const portfolioEvidence = isRecord(summary.portfolioEvidence)
    ? summary.portfolioEvidence
    : isRecord(evidence.portfolioEvidence)
      ? evidence.portfolioEvidence
      : null
  const portfolioMetrics = isRecord(portfolioEvidence?.aggregateMetrics)
    ? portfolioEvidence.aggregateMetrics as Record<string, unknown>
    : {}
  const concentrationEvidence = isRecord(summary.concentrationEvidence)
    ? summary.concentrationEvidence
    : isRecord(portfolioEvidence?.concentrationEvidence)
      ? portfolioEvidence.concentrationEvidence as Record<string, unknown>
      : isRecord(evidence.concentrationEvidence)
        ? evidence.concentrationEvidence
        : {}
  const portfolioReturnQualityEvidence = isRecord(summary.portfolioReturnQualityEvidence)
    ? summary.portfolioReturnQualityEvidence
    : isRecord(portfolioEvidence?.portfolioReturnQualityEvidence)
      ? portfolioEvidence.portfolioReturnQualityEvidence as Record<string, unknown>
      : isRecord(evidence.portfolioReturnQualityEvidence)
        ? evidence.portfolioReturnQualityEvidence
        : {}
  const portfolioScoringEvidence = isRecord(summary.portfolioScoringEvidence)
    ? summary.portfolioScoringEvidence
    : isRecord(portfolioEvidence?.portfolioScoringEvidence)
      ? portfolioEvidence.portfolioScoringEvidence as Record<string, unknown>
      : isRecord(evidence.portfolioScoringEvidence)
        ? evidence.portfolioScoringEvidence
        : {}
  const portfolioDrawdownBudgetEvidence = isRecord(summary.portfolioDrawdownBudgetEvidence)
    ? summary.portfolioDrawdownBudgetEvidence
    : isRecord(portfolioEvidence?.portfolioDrawdownBudgetEvidence)
      ? portfolioEvidence.portfolioDrawdownBudgetEvidence as Record<string, unknown>
      : isRecord(evidence.portfolioDrawdownBudgetEvidence)
        ? evidence.portfolioDrawdownBudgetEvidence
        : {}
  const dataCoverage = isRecord(summary.dataCoverage)
    ? summary.dataCoverage
    : isRecord(evidence.dataCoverage)
      ? evidence.dataCoverage
      : {}
  const evidenceAction = String(evidence.action ?? '').trim()
  return {
    strategyId: row.strategyId,
    name: spec.name,
    status: row.status,
    strategyType: strategyTypeOf(row.status, spec, evidenceAction, summary),
    assetClass: spec.assetClass ?? spec.market ?? 'stock',
    symbols: symbolsOf(spec),
    runnable: lifecycle.runnable === true,
    updatedAt: row.updatedAt,
    evidenceAction: evidenceAction || null,
    validationIssueCount: Array.isArray(row.validationIssues) ? row.validationIssues.length : 0,
    repairStepCount: Array.isArray(row.repairPlan) ? row.repairPlan.length : 0,
    unsupportedCount: Array.isArray(row.unsupportedDetails) ? row.unsupportedDetails.length : 0,
    metrics: {
      totalReturnPct: metrics.totalReturnPct,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdownPct: metrics.maxDrawdownPct,
      tradeCount: metrics.tradeCount,
      profitFactor: metrics.profitFactor ?? riskReward.profitFactor,
      expectancyPct: metrics.expectancyPct ?? riskReward.expectancyPct,
    },
    portfolioMetrics: {
      selectedSymbols: portfolioMetrics.selectedSymbols,
      portfolioReturnPct: portfolioMetrics.portfolioReturnPct,
      portfolioMaxDrawdownPct: portfolioMetrics.portfolioMaxDrawdownPct,
      averageSharpeRatio: portfolioMetrics.averageSharpeRatio,
      completedTradeCount: portfolioMetrics.completedTradeCount,
    },
    concentrationEvidence: {
      status: concentrationEvidence.status,
      effectivePositionCount: concentrationEvidence.effectivePositionCount,
      herfindahlIndex: concentrationEvidence.herfindahlIndex,
      residualCashWeight: concentrationEvidence.residualCashWeight,
      maxSinglePositionWeight: concentrationEvidence.maxSinglePositionWeight,
    },
    portfolioReturnQualityEvidence: {
      status: portfolioReturnQualityEvidence.status,
      annualizedReturnPct: portfolioReturnQualityEvidence.annualizedReturnPct,
      annualizedVolatilityPct: portfolioReturnQualityEvidence.annualizedVolatilityPct,
      sharpeRatio: portfolioReturnQualityEvidence.sharpeRatio,
      sortinoRatio: portfolioReturnQualityEvidence.sortinoRatio,
      calmarRatio: portfolioReturnQualityEvidence.calmarRatio,
      gainToPainRatio: portfolioReturnQualityEvidence.gainToPainRatio,
    },
    portfolioScoringEvidence: {
      status: portfolioScoringEvidence.status,
      scoringMethod: portfolioScoringEvidence.scoringMethod,
      riskAdjustedScore: portfolioScoringEvidence.riskAdjustedScore,
      tradeCount: portfolioScoringEvidence.tradeCount,
      positionCapStatus: portfolioScoringEvidence.positionCapStatus,
      disqualificationReasons: portfolioScoringEvidence.disqualificationReasons,
    },
    portfolioDrawdownBudgetEvidence: {
      status: portfolioDrawdownBudgetEvidence.status,
      allowedDrawdownPct: portfolioDrawdownBudgetEvidence.allowedDrawdownPct,
      observedDrawdownPct: portfolioDrawdownBudgetEvidence.observedDrawdownPct,
      excessDrawdownPct: portfolioDrawdownBudgetEvidence.excessDrawdownPct,
      policySource: portfolioDrawdownBudgetEvidence.policySource,
    },
    dataCoverage: {
      rows: dataCoverage.rows,
      requiredBars: dataCoverage.requiredBars,
      sufficient: dataCoverage.sufficient,
      source: dataCoverage.source,
      cacheStatus: dataCoverage.cacheStatus,
      actualStartDate: dataCoverage.actualStartDate,
      actualEndDate: dataCoverage.actualEndDate,
    },
    score: comparisonScore(metrics, riskReward, portfolioMetrics),
    tradeBoundary: 'Saved strategy comparison is evidence-only; it does not authorize simulated or real order placement.',
  }
}

function strategyTypeOf(
  status: string,
  spec: Record<string, unknown>,
  evidenceAction: string,
  summary: Record<string, unknown>,
): string {
  const assetClass = String(spec.assetClass ?? spec.market ?? '').toLowerCase()
  if (status === 'ranked' || evidenceAction === 'custom_strategy_rank' || summary.portfolioEvidence) return 'portfolio_strategy'
  if (assetClass === 'fund' || evidenceAction === 'custom_strategy_observe' || evidenceAction === 'custom_strategy_fund_backtest') return 'fund_strategy'
  return 'stock_strategy'
}

function bestBy(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    score: bestRow(rows, 'score', true),
    totalReturnPct: bestMetric(rows, 'metrics', 'totalReturnPct', true),
    sharpeRatio: bestMetric(rows, 'metrics', 'sharpeRatio', true),
    maxDrawdownPct: bestMetric(rows, 'metrics', 'maxDrawdownPct', false),
    portfolioReturnPct: bestMetric(rows, 'portfolioMetrics', 'portfolioReturnPct', true),
    portfolioRiskAdjustedScore: bestMetric(rows, 'portfolioScoringEvidence', 'riskAdjustedScore', true),
  }
}

function bestMetric(
  rows: Array<Record<string, unknown>>,
  group: string,
  key: string,
  higherIsBetter: boolean,
): Record<string, unknown> | null {
  const enriched: Array<{ strategyId: unknown, value: number }> = rows
    .map((row) => {
      const value = isRecord(row[group]) ? num(row[group][key]) : null
      return value == null ? null : { strategyId: row.strategyId, value }
    })
    .filter((row): row is { strategyId: unknown, value: number } => row != null)
  if (!enriched.length) return null
  enriched.sort((left, right) => higherIsBetter ? right.value - left.value : left.value - right.value)
  return enriched[0]
}

function bestRow(
  rows: Array<Record<string, unknown>>,
  key: string,
  higherIsBetter: boolean,
): Record<string, unknown> | null {
  const enriched: Array<{ strategyId: unknown, value: number }> = rows
    .map((row) => {
      const value = num(row[key])
      return value == null ? null : { strategyId: row.strategyId, value }
    })
    .filter((row): row is { strategyId: unknown, value: number } => row != null)
  if (!enriched.length) return null
  enriched.sort((left, right) => higherIsBetter ? right.value - left.value : left.value - right.value)
  return enriched[0]
}

function comparisonScore(
  metrics: Record<string, unknown>,
  riskReward: Record<string, unknown>,
  portfolioMetrics: Record<string, unknown>,
): number | null {
  const portfolioReturn = num(portfolioMetrics.portfolioReturnPct)
  const portfolioDrawdown = num(portfolioMetrics.portfolioMaxDrawdownPct)
  if (portfolioReturn != null || portfolioDrawdown != null) {
    return round((portfolioReturn ?? 0) - (portfolioDrawdown ?? 0) * 0.5)
  }
  const totalReturn = num(metrics.totalReturnPct)
  const sharpe = num(metrics.sharpeRatio)
  const drawdown = num(metrics.maxDrawdownPct)
  const expectancy = num(metrics.expectancyPct) ?? num(riskReward.expectancyPct)
  if (totalReturn == null && sharpe == null && drawdown == null && expectancy == null) return null
  return round((totalReturn ?? 0) + (sharpe ?? 0) * 5 - (drawdown ?? 0) * 0.5 + (expectancy ?? 0))
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function nextActionsForStatus(status: StrategyRecord['status']): string[] {
  switch (status) {
    case 'backtested':
      return ['custom_strategy_run', 'custom_strategy_observe', 'create_monitor']
    case 'observed':
    case 'ranked':
    case 'evidence_attached':
      return ['read_evidence', 'create_monitor']
    default:
      return ['custom_strategy_backtest', 'custom_strategy_observe']
  }
}

function storePath(ctx: ToolContext): string {
  return readableStrategyLibraryPath(String(ctx.basePath ?? process.cwd()))
}

function readStore(ctx: ToolContext): StrategyRecord[] {
  const file = storePath(ctx)
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeStore(ctx: ToolContext, rows: StrategyRecord[]) {
  const basePath = String(ctx.basePath ?? process.cwd())
  const paths = ensureStrategyArtifactDirs(basePath)
  const file = paths.libraryPath
  fs.writeFileSync(file, JSON.stringify(rows, null, 2))
  for (const row of rows) {
    fs.writeFileSync(strategyItemPath(basePath, row.strategyId), JSON.stringify(row, null, 2))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
