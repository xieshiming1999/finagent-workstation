import fs from 'node:fs'
import type { ToolContext } from '../../../agent/tool'
import type { StrategySpec, StrategyValidation } from './strategy-spec-engine'
import {
  ensureStrategyArtifactDirs,
  readableStrategyLibraryPath,
  strategyArtifactPaths,
  strategyItemPath,
} from './strategy-artifact-contract'
import { normalizeStrategySpec } from './strategy-spec-normalizer'
import {
  isFundStrategySpec,
  validateFundStrategySpec,
  validateStockStrategySpec,
  type StrategyValidationContract,
} from './strategy-spec-validator'

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

export type StrategyListOptions = {
  limit?: number
  detail?: 'summary' | 'full'
  strategyIds?: string[]
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

export function listCustomStrategyRecords(ctx: ToolContext, options: StrategyListOptions = {}): Record<string, unknown> {
  const rows = readStore(ctx)
  const requestedIds = new Set((options.strategyIds ?? []).map((id) => String(id).trim()).filter(Boolean))
  const limit = clampListLimit(options.limit)
  const detail = options.detail ?? 'summary'
  const allStrategies = rows.map((row) => {
    const spec = row.strategySpec ?? row.spec
    const savedValidation = validateSavedStrategySpec(spec)
    const evidence = isRecord(row.backtestEvidence) ? row.backtestEvidence : isRecord(row.evidence) ? row.evidence : {}
    const validationIssues = savedValidation?.validationIssues ??
      row.validationIssues ??
      (isRecord(row.validationReport) && Array.isArray(row.validationReport.validationIssues) ? row.validationReport.validationIssues : null) ??
      (isRecord(evidence) && Array.isArray(evidence.validationIssues) ? evidence.validationIssues : [])
    const repairPlan = savedValidation?.repairPlan ??
      row.repairPlan ??
      (isRecord(row.validationReport) && Array.isArray(row.validationReport.repairPlan) ? row.validationReport.repairPlan : null) ??
      (isRecord(evidence) && Array.isArray(evidence.repairPlan) ? evidence.repairPlan : [])
    const unsupportedDetails = savedValidation?.unsupportedDetails ??
      row.unsupportedDetails ??
      (isRecord(row.validationReport) && Array.isArray(row.validationReport.unsupportedDetails) ? row.validationReport.unsupportedDetails : null) ??
      (isRecord(evidence) && Array.isArray(evidence.unsupportedDetails) ? evidence.unsupportedDetails : [])
    const lifecycle = effectiveLifecycle(row, savedValidation)
    return {
      strategyId: row.strategyId,
      version: row.version,
      status: effectiveStatus(row, savedValidation),
      savedStatus: row.status,
      updatedAt: row.updatedAt,
      name: spec?.name,
      assetClass: spec?.assetClass ?? spec?.market ?? 'stock',
      symbols: symbolsOf(spec ?? {}),
      evidenceAction: evidence.action ?? null,
      validationSummary:
        savedValidation?.validationSummary ??
        row.validationSummary ??
        (isRecord(row.validationReport) ? row.validationReport.validationSummary : null) ??
        (isRecord(evidence) ? evidence.validationSummary : null),
      validationIssues,
      repairPlan,
      unsupportedDetails,
      dataRequirements:
        savedValidation?.dataRequirements ??
        row.dataRequirements ??
        (isRecord(row.validationReport) ? row.validationReport.dataRequirements : null) ??
        (isRecord(evidence) ? evidence.dataRequirements : null),
      dataAndAssumptionSummary: row.dataAndAssumptionSummary ?? {},
      lifecycle,
      itemPath: strategyItemPath(String(ctx.basePath ?? process.cwd()), String(row.strategyId)),
    }
  }).sort(strategyListSort)
  const filtered = requestedIds.size > 0
    ? allStrategies.filter((row) => requestedIds.has(String(row.strategyId)))
    : allStrategies
  const selected = filtered.slice(0, limit)
  const strategies = detail === 'full' ? selected : selected.map(compactStrategyListRow)
  const runnableRows = allStrategies
    .filter((row) => isRecord(row.lifecycle) && row.lifecycle.runnable === true)
    .slice(0, Math.min(limit, 8))
    .map(compactStrategyListRow)
  return {
    action: 'custom_strategy_list',
    detail,
    count: rows.length,
    returned: strategies.length,
    limit,
    hasMore: filtered.length > selected.length,
    requestedStrategyIds: Array.from(requestedIds),
    missingStrategyIds: Array.from(requestedIds).filter((id) => !allStrategies.some((row) => row.strategyId === id)),
    runnableCount: allStrategies.filter((row) => isRecord(row.lifecycle) && row.lifecycle.runnable === true).length,
    invalidCount: allStrategies.filter((row) => row.status === 'invalid').length,
    artifactContract: 'strategy-library-v1',
    ...(detail === 'full' ? { paths: strategyArtifactPaths(String(ctx.basePath ?? process.cwd())) } : {}),
    runnableStrategies: runnableRows,
    strategies,
    nextActions: [
      'Use custom_strategy_run with strategyId for executable readback.',
      'Use custom_strategy_compare with strategyIds for saved evidence comparison.',
      'Use custom_strategy_list with detail:"full" and strategyIds only when a full row is needed.',
    ],
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
  const row = loadRunnableCustomStrategyRecord(ctx, strategyId)
  return row.strategySpec ?? row.spec
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
  const savedValidation = validateSavedStrategySpec(spec)
  const lifecycle = effectiveLifecycle(row, savedValidation)
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
    status: effectiveStatus(row, savedValidation),
    savedStatus: row.status,
    strategyType: strategyTypeOf(row.status, spec, evidenceAction, summary),
    assetClass: spec.assetClass ?? spec.market ?? 'stock',
    symbols: symbolsOf(spec),
    runnable: lifecycle.runnable === true,
    updatedAt: row.updatedAt,
    evidenceAction: evidenceAction || null,
    validationIssueCount: Array.isArray(savedValidation?.validationIssues) ? savedValidation.validationIssues.length : Array.isArray(row.validationIssues) ? row.validationIssues.length : 0,
    repairStepCount: Array.isArray(savedValidation?.repairPlan) ? savedValidation.repairPlan.length : Array.isArray(row.repairPlan) ? row.repairPlan.length : 0,
    unsupportedCount: Array.isArray(savedValidation?.unsupportedDetails) ? savedValidation.unsupportedDetails.length : Array.isArray(row.unsupportedDetails) ? row.unsupportedDetails.length : 0,
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

function validateSavedStrategySpec(spec: unknown): StrategyValidationContract | null {
  if (!isRecord(spec)) return null
  const contractSpec = spec as unknown as StrategySpec
  const rawValidation = isFundStrategySpec(contractSpec)
    ? validateFundStrategySpec(spec as unknown as StrategySpec)
    : validateStockStrategySpec(spec as unknown as StrategySpec)
  if (rawValidation.status === 'rejected') return rawValidation
  const normalized = normalizeStrategySpec(spec as unknown as StrategySpec) as StrategySpec & Record<string, unknown>
  return isFundStrategySpec(normalized)
    ? validateFundStrategySpec(normalized)
    : validateStockStrategySpec(normalized)
}

function strategyListSort(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftLifecycle = isRecord(left.lifecycle) ? left.lifecycle : {}
  const rightLifecycle = isRecord(right.lifecycle) ? right.lifecycle : {}
  const leftRunnable = leftLifecycle.runnable === true ? 1 : 0
  const rightRunnable = rightLifecycle.runnable === true ? 1 : 0
  if (leftRunnable !== rightRunnable) return rightRunnable - leftRunnable
  const leftInvalid = left.status === 'invalid' ? 1 : 0
  const rightInvalid = right.status === 'invalid' ? 1 : 0
  if (leftInvalid !== rightInvalid) return leftInvalid - rightInvalid
  return Date.parse(String(right.updatedAt ?? '')) - Date.parse(String(left.updatedAt ?? ''))
}

function compactStrategyListRow(row: Record<string, unknown>): Record<string, unknown> {
  const lifecycle = isRecord(row.lifecycle) ? row.lifecycle : {}
  const validationIssues = Array.isArray(row.validationIssues) ? row.validationIssues : []
  const repairPlan = Array.isArray(row.repairPlan) ? row.repairPlan : []
  const unsupportedDetails = Array.isArray(row.unsupportedDetails) ? row.unsupportedDetails : []
  const dataSummary = compactDataAndAssumptionSummary(row.dataAndAssumptionSummary)
  return {
    strategyId: row.strategyId,
    version: row.version,
    status: row.status,
    savedStatus: row.savedStatus,
    updatedAt: row.updatedAt,
    name: row.name,
    assetClass: row.assetClass,
    symbols: row.symbols,
    evidenceAction: row.evidenceAction,
    runnable: lifecycle.runnable === true,
    lifecycleStatus: lifecycle.status ?? row.status,
    lifecycleIssue: lifecycle.lifecycleIssue ?? null,
    validationSummary: row.validationSummary ?? null,
    validationIssueCount: validationIssues.length,
    repairStepCount: repairPlan.length,
    unsupportedCount: unsupportedDetails.length,
    dataRequirements: row.dataRequirements ?? null,
    dataAndAssumptionSummary: dataSummary,
  }
}

function compactDataAndAssumptionSummary(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const dataCoverage = isRecord(value.dataCoverage) ? value.dataCoverage : null
  const dataEvidence = isRecord(value.dataEvidence) ? value.dataEvidence : null
  const fundCategoryEvidence = isRecord(value.fundCategoryEvidence) ? value.fundCategoryEvidence : null
  const portfolioEvidence = isRecord(value.portfolioEvidence) ? value.portfolioEvidence : null
  const riskRewardEvidence = isRecord(value.riskRewardEvidence) ? value.riskRewardEvidence : null
  return {
    assetClass: value.assetClass ?? null,
    symbols: value.symbols ?? null,
    ...(dataCoverage
      ? {
          dataCoverage: {
            symbol: dataCoverage.symbol ?? null,
            source: dataCoverage.source ?? null,
            rows: dataCoverage.rows ?? dataCoverage.actualRows ?? null,
            sufficient: dataCoverage.sufficient ?? null,
            actualStartDate: dataCoverage.actualStartDate ?? null,
            actualEndDate: dataCoverage.actualEndDate ?? null,
          },
        }
      : {}),
    ...(dataEvidence
      ? {
          dataEvidence: {
            source: dataEvidence.source ?? null,
            cacheStatus: dataEvidence.cacheStatus ?? null,
            fetchedAt: dataEvidence.fetchedAt ?? null,
            sourceDataTime: dataEvidence.sourceDataTime ?? null,
          },
        }
      : {}),
    ...(fundCategoryEvidence ? { fundCategoryEvidence } : {}),
    ...(portfolioEvidence
      ? {
          portfolioEvidence: {
            selectedSymbols: portfolioEvidence.selectedSymbols ?? null,
            portfolioReturnPct: portfolioEvidence.portfolioReturnPct ?? null,
            portfolioMaxDrawdownPct: portfolioEvidence.portfolioMaxDrawdownPct ?? null,
          },
        }
      : {}),
    ...(riskRewardEvidence
      ? {
          riskRewardEvidence: {
            profitFactor: riskRewardEvidence.profitFactor ?? null,
            payoffRatio: riskRewardEvidence.payoffRatio ?? null,
            expectancyPct: riskRewardEvidence.expectancyPct ?? null,
          },
        }
      : {}),
  }
}

function clampListLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 8
  return Math.max(1, Math.min(50, Math.trunc(numeric)))
}

function effectiveStatus(row: StrategyRecord, validation: StrategyValidationContract | null): string {
  if (validation?.status === 'rejected') return 'invalid'
  return row.status
}

function effectiveLifecycle(row: StrategyRecord, validation: StrategyValidationContract | null): Record<string, unknown> {
  const base = isRecord(row.lifecycle) ? row.lifecycle : {}
  const status = effectiveStatus(row, validation)
  const runnable = status === 'backtested' && validation?.status !== 'rejected'
  return {
    ...base,
    status,
    savedStatus: row.status,
    runnable,
    ...(validation?.status === 'rejected'
      ? {
          lifecycleIssue: {
            category: 'validation',
            path: 'strategySpec',
            field: 'strategySpec',
            value: row.strategyId,
            message: validation.errors.join('; '),
            suggestion: 'Repair and save a validated StrategySpec before requesting executable rerun.',
          },
          nextActions: ['read_saved_evidence', 'repair_strategy_spec'],
        }
      : {}),
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
