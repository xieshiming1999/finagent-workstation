import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  readableStrategyLibraryPath,
  strategyArtifactPaths,
} from '../domain/market/strategy-spec/strategy-artifact-contract'
export {
  buildStrategyLibraryActionPrompt,
  monitorTemplateForStrategy,
  type StrategyAction,
  type StrategyMonitorTemplate,
} from '../domain/market/strategy-spec/strategy-action-contract'

export type StrategyType =
  | 'stock_strategy'
  | 'fund_strategy'
  | 'portfolio_strategy'
  | 'etf_market_strategy'
  | 'unknown_strategy'

export interface StrategyLibraryResponse {
  ok: boolean
  path: string
  paths?: ReturnType<typeof strategyArtifactPaths>
  artifactContract?: string
  count: number
  modified?: string
  strategies: unknown[]
  error?: string
}

export interface StrategyLibraryItem {
  strategyId: string
  name: string
  status: string
  assetClass: string
  strategyType: StrategyType
  symbols: string[]
  updatedAt: string
  evidenceAction: string
  runnable: boolean
}

export function readStrategyLibrary(basePath: string): StrategyLibraryResponse {
  const file = readableStrategyLibraryPath(basePath)
  if (!existsSync(file)) {
    return { ok: true, path: file, paths: strategyArtifactPaths(basePath), artifactContract: 'strategy-library-v1', count: 0, strategies: [] }
  }

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const strategies = Array.isArray(parsed) ? parsed : []
    return {
      ok: true,
      path: file,
      paths: strategyArtifactPaths(basePath),
      artifactContract: 'strategy-library-v1',
      count: strategies.length,
      modified: statSync(file).mtime.toISOString(),
      strategies,
    }
  } catch (error) {
    return {
      ok: false,
      path: file,
      paths: strategyArtifactPaths(basePath),
      artifactContract: 'strategy-library-v1',
      count: 0,
      strategies: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function normalizeStrategyLibraryItems(payload: StrategyLibraryResponse): StrategyLibraryItem[] {
  return payload.strategies
    .map(normalizeStrategyRecord)
    .filter((row): row is StrategyLibraryItem => Boolean(row))
}

export function findStrategyLibraryItem(
  payload: StrategyLibraryResponse,
  strategyId?: string,
): StrategyLibraryItem | null {
  const items = normalizeStrategyLibraryItems(payload)
  const requested = String(strategyId ?? '').trim()
  if (requested) {
    return items.find((item) => item.strategyId === requested) ?? null
  }
  return items[0] ?? null
}

function normalizeStrategyRecord(value: unknown): StrategyLibraryItem | null {
  const row = asRecord(value)
  const spec = firstRecord(row.strategySpec, row.spec)
  const evidence = firstRecord(row.backtestEvidence, row.evidence)
  const summary = asRecord(row.dataAndAssumptionSummary)
  const strategyId = stringValue(row.strategyId) || stringValue(spec.id)
  if (!strategyId) return null
  const symbols = extractSymbols(spec, row)
  const status = stringValue(row.status) || 'unknown'
  const assetClass = stringValue(row.assetClass) || stringValue(spec.assetClass) || stringValue(spec.market) || inferAssetClass(symbols)
  const evidenceAction = stringValue(row.evidenceAction) || stringValue(evidence.action)
  return {
    strategyId,
    name: stringValue(row.name) || stringValue(spec.name) || strategyId,
    status,
    assetClass,
    strategyType: normalizeStrategyType(row.strategyType) ?? inferStrategyType({
      row,
      spec,
      evidence,
      summary,
      status,
      assetClass,
      evidenceAction,
      symbols,
    }),
    symbols,
    updatedAt: stringValue(row.updatedAt),
    evidenceAction,
    runnable: status === 'backtested',
  }
}

function normalizeStrategyType(value: unknown): StrategyType | null {
  const text = stringValue(value)
  if (
    text === 'stock_strategy' ||
    text === 'fund_strategy' ||
    text === 'portfolio_strategy' ||
    text === 'etf_market_strategy' ||
    text === 'unknown_strategy'
  ) {
    return text
  }
  return null
}

function inferStrategyType(input: {
  row: Record<string, unknown>
  spec: Record<string, unknown>
  evidence: Record<string, unknown>
  summary: Record<string, unknown>
  status: string
  assetClass: string
  evidenceAction: string
  symbols: string[]
}): StrategyType {
  const assetClass = input.assetClass.toLowerCase()
  const evidenceAction = input.evidenceAction
  if (
    input.status === 'ranked' ||
    evidenceAction === 'custom_strategy_rank' ||
    hasAnyRecord(input.summary, ['portfolioEvidence', 'rebalanceDraft', 'portfolioValidation']) ||
    hasAnyRecord(input.evidence, ['portfolioEvidence', 'rebalanceDraft', 'portfolioValidation'])
  ) {
    return 'portfolio_strategy'
  }
  const pricingBasis = stringValue(asRecord(input.summary.fundRiskEvidence).pricingBasis).toLowerCase()
  const specType = stringValue(input.spec.type).toLowerCase()
  if (
    assetClass === 'etf' ||
    assetClass === 'listed_fund' ||
    pricingBasis === 'listed_fund' ||
    pricingBasis === 'etf' ||
    specType === 'etf_market_strategy'
  ) {
    return 'etf_market_strategy'
  }
  if (
    assetClass === 'fund' ||
    evidenceAction === 'custom_strategy_observe' ||
    evidenceAction === 'custom_strategy_fund_backtest' ||
    hasAnyRecord(input.summary, ['fundCoverageEvidence', 'fundRiskEvidence'])
  ) {
    return 'fund_strategy'
  }
  if (assetClass === 'stock' || input.symbols.some((symbol) => /^[0-9]{6}$/.test(symbol))) {
    return 'stock_strategy'
  }
  return 'unknown_strategy'
}

function hasAnyRecord(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => Object.keys(asRecord(record[key])).length > 0)
}

function extractSymbols(spec: Record<string, unknown>, row: Record<string, unknown> = {}): string[] {
  const values: string[] = []
  if (Array.isArray(row.symbols)) values.push(...row.symbols.map(stringValue).filter(Boolean))
  for (const key of ['symbol', 'code']) {
    const value = stringValue(spec[key])
    if (value) values.push(value)
  }
  for (const key of ['symbols', 'codes']) {
    const list = spec[key]
    if (Array.isArray(list)) values.push(...list.map(stringValue).filter(Boolean))
  }
  const universe = asRecord(spec.universe)
  if (Array.isArray(universe.symbols)) values.push(...universe.symbols.map(stringValue).filter(Boolean))
  return Array.from(new Set(values))
}

function inferAssetClass(symbols: string[]): string {
  if (symbols.some((symbol) => /^[0-9]{6}$/.test(symbol))) return 'stock'
  return 'unknown'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value)
    if (Object.keys(record).length > 0) return record
  }
  return {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
