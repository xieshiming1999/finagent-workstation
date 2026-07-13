import { createHash } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { ArtifactRegistry, type ArtifactRecord } from '../../../agent/artifact-registry'

interface StrategyRunMessage {
  toolUses?: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  toolResult?: {
    toolUseId: string
    content: string
    isError: boolean
  }
}

export interface ExternalStrategyServiceResult {
  finalAnswer: string
  artifact: Record<string, unknown>
  record: ArtifactRecord
}

export function buildExternalStrategyServiceResult(input: {
  basePath: string
  payload?: Record<string, unknown>
  messages: StrategyRunMessage[]
}): ExternalStrategyServiceResult | undefined {
  const plan = objectValue(input.payload?.commandPlan)
  if (
    input.payload?.externalOperationContract !== 'finagent.finance-operation.v1' ||
    plan?.category !== 'strategy' ||
    plan.operation !== 'review'
  ) {
    return undefined
  }
  const backtest = findSuccessfulBacktest(input.messages)
  if (!backtest || backtest.status !== 'backtested') return undefined

  const argumentsPayload = objectValue(plan.payload) ?? {}
  const strategy = objectValue(argumentsPayload.strategy) ?? {}
  const symbol = String(backtest.code ?? backtest.symbol ?? '').trim()
  const result = {
    contract: 'strategy-review-v1',
    operationId: 'strategy.review',
    status: 'backtested',
    sideEffect: 'preparation',
    sideEffectConsent: 'not_required',
    strategy,
    symbols: stringList(argumentsPayload.symbols, symbol),
    backtest,
    boundaries: [
      'no_strategy_save',
      'no_monitor_creation',
      'no_watchlist_write',
      'no_order_side_effect',
    ],
  }
  const digest = createHash('sha256')
    .update(JSON.stringify({ operationId: result.operationId, strategy, backtest }))
    .digest('hex')
    .slice(0, 16)
  const relativePath = `memory/artifacts/strategy/${digest}.json`
  const absolutePath = join(input.basePath, relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8')

  const title = `${String(strategy.name ?? backtest.strategyId ?? 'Strategy review')} — ${symbol || 'portfolio'}`
  const source = 'MarketData.custom_strategy_backtest'
  const record = new ArtifactRegistry(input.basePath).register({
    kind: 'strategy',
    path: relativePath,
    title,
    source,
    verificationStatus: 'verified',
    provenance: {
      tool: 'MarketData',
      action: 'custom_strategy_backtest',
      source: objectValue(backtest.dataEvidence)?.source ?? null,
      cacheStatus: objectValue(backtest.dataEvidence)?.cacheStatus ?? null,
      actualStartDate: backtest.actualStartDate ?? null,
      actualEndDate: backtest.actualEndDate ?? null,
      bars: backtest.bars ?? null,
    },
    metadata: {
      operationId: result.operationId,
      contract: result.contract,
      strategyId: backtest.strategyId ?? null,
      symbol: symbol || null,
      status: result.status,
      sideEffect: result.sideEffect,
    },
  })
  const compactResult = {
    contract: result.contract,
    operationId: result.operationId,
    status: result.status,
    sideEffect: result.sideEffect,
    strategyId: backtest.strategyId ?? null,
    symbol: symbol || null,
    actualStartDate: backtest.actualStartDate ?? null,
    actualEndDate: backtest.actualEndDate ?? null,
    bars: backtest.bars ?? null,
    metrics: backtest.metrics ?? null,
    benchmarkEvidence: backtest.benchmarkEvidence ?? null,
    riskEvidence: backtest.riskEvidence ?? null,
    dataEvidence: backtest.dataEvidence ?? null,
    artifactId: record.id,
    artifactRef: record.stableRef,
    boundaries: result.boundaries,
  }
  return {
    finalAnswer: JSON.stringify(compactResult, null, 2),
    artifact: {
      kind: 'strategy',
      artifactId: record.id,
      stableRef: record.stableRef,
      title: record.title,
      managedArtifact: true,
    },
    record,
  }
}

function findSuccessfulBacktest(
  messages: StrategyRunMessage[],
): Record<string, unknown> | undefined {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>()
  let latest: Record<string, unknown> | undefined
  for (const message of messages) {
    for (const call of message.toolUses ?? []) {
      calls.set(call.id, { name: call.name, input: call.input })
    }
    const toolResult = message.toolResult
    if (!toolResult || toolResult.isError) continue
    const call = calls.get(toolResult.toolUseId)
    if (call?.name !== 'MarketData' || call.input.action !== 'custom_strategy_backtest') continue
    try {
      const parsed = JSON.parse(toolResult.content)
      if (parsed && typeof parsed === 'object') {
        latest = parsed as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return latest
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringList(value: unknown, fallback: string): string[] {
  const values = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
  if (values.length) return values
  return fallback ? [fallback] : []
}
