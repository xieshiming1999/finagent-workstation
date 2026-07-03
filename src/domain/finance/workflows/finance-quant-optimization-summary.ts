import { Role, type Message, type ToolUse } from '../../../agent/message'
import { isFinanceEvidenceTool } from './finance-workflow-policy'
import {
  financeWorkflowStateFromUserContent,
  latestFinanceWorkflowState,
  type FinanceWorkflowState,
} from './finance-workflow-state'
import { summarizeStrategyBacktestResult } from './finance-backtest-result'
import { summarizeFinanceKlineWindow } from './finance-kline-result'

interface QuantOptimizationRecovery {
  toolCalls: ToolUse[]
}

export function maybeBuildQuantOptimizationAnswer(messages: Message[]): string | null {
  const userPrompt = messages.find((message) => message.role === Role.User)?.content ?? ''
  const workflowState = financeWorkflowStateFromUserContent(userPrompt)
  if (!isQuantOptimizationState(workflowState)) return null

  const turnMessages = messages.slice(1)
  const toolCalls = collectToolCalls(turnMessages)
  const financeToolCalls = toolCalls.filter((call) => isFinanceEvidenceTool(call.name))
  const optimizeCalls = toolCalls.filter((call) => call.name === 'MarketData' && call.input.action === 'optimize_params')
  if (optimizeCalls.length === 0 || financeToolCalls.length < 6) return null

  const resultByToolUseId = successfulToolResults(turnMessages)
  const latestOptimizeCall = [...optimizeCalls].reverse().find((call) => resultByToolUseId.has(call.id))
  if (!latestOptimizeCall) return null
  const optimizeEvidence = parseJsonObject(resultByToolUseId.get(latestOptimizeCall.id) ?? '')
  if (!optimizeEvidence || optimizeEvidence.action !== 'optimize_params') return null

  const latestKline = [...toolCalls].reverse().find((call) =>
    call.name === 'MarketData' &&
    call.input.action === 'kline' &&
    resultByToolUseId.has(call.id)
  )
  const latestIndicators = [...toolCalls].reverse().find((call) =>
    call.name === 'DataProcess' &&
    call.input.action === 'indicators' &&
    resultByToolUseId.has(call.id)
  )
  const latestBacktest = [...toolCalls].reverse().find((call) =>
    call.name === 'MarketData' &&
    String(call.input.action).startsWith('backtest') &&
    resultByToolUseId.has(call.id)
  )

  const grid = latestOptimizeCall.input.paramGrid && typeof latestOptimizeCall.input.paramGrid === 'object'
    ? JSON.stringify(latestOptimizeCall.input.paramGrid)
    : '-'
  const bestRows = Array.isArray((optimizeEvidence as any).best) ? (optimizeEvidence as any).best : []
  const best = bestRows[0] as Record<string, unknown> | undefined
  const klineWindow = latestKline ? summarizeKlineWindow(resultByToolUseId.get(latestKline.id) ?? '') : null
  const indicatorSummary = latestIndicators ? summarizeIndicator(resultByToolUseId.get(latestIndicators.id) ?? '') : null
  const backtestSummary = latestBacktest ? summarizeBacktest(resultByToolUseId.get(latestBacktest.id) ?? '') : null

  return [
    '## RSI 参数优化结论',
    '',
    `对象：${normalizeCode(workflowState?.subject) ?? latestOptimizeCall.input.code ?? '-'}。已使用 \`MarketData(action:"optimize_params")\` 做受控参数网格搜索。`,
    '',
    '### 数据窗口',
    '',
    `- 请求窗口：${(optimizeEvidence as any).requestedStartDate ?? '按 period/limit 推导'} 至 ${(optimizeEvidence as any).requestedEndDate ?? '最新可用交易日'}；requestedPeriod: ${(optimizeEvidence as any).requestedPeriod ?? latestOptimizeCall.input.period ?? '未指定'}；requestedLimit: ${(optimizeEvidence as any).requestedLimit ?? '-'}`,
    `- 实际数据窗口：${(optimizeEvidence as any).actualStartDate ?? '-'} 至 ${(optimizeEvidence as any).actualEndDate ?? '-'}；actualBars: ${(optimizeEvidence as any).actualBars ?? '-'}`,
    '',
    '### 已测试网格',
    '',
    `- strategy: ${(optimizeEvidence as any).strategy ?? latestOptimizeCall.input.strategy ?? 'rsi'}`,
    `- tested: ${(optimizeEvidence as any).tested ?? bestRows.length}`,
    `- paramGrid: ${grid}`,
    '',
    '### 当前最优结果',
    '',
    best
      ? [
          `- params: ${JSON.stringify(best.params ?? {})}`,
          `- totalReturn: ${best.totalReturn ?? '-'}`,
          `- maxDrawdown: ${best.maxDrawdown ?? '-'}`,
          `- trades: ${best.trades ?? '-'}`,
          `- sharpe: ${best.sharpe ?? '-'}`,
        ].join('\n')
      : '- 工具未返回可排序的 best 结果。',
    '',
    '### 数据与辅助证据',
    '',
    `- K 线窗口：${klineWindow ?? '未读取到可摘要的 K 线窗口；以优化工具内部样本为准。'}`,
    `- 当前 RSI：${indicatorSummary ?? '未读取到可摘要的 RSI 指标。'}`,
    `- 基准回测：${backtestSummary ?? '未读取到额外基准回测；以 optimizer 返回指标为准。'}`,
    '',
    '### 使用边界',
    '',
    '- 本结果是样本内参数搜索，不等于未来收益；参数越多越容易过拟合。',
    '- 未计入真实交易滑点、冲击成本、手续费差异、停牌和实际成交约束。',
    '- 如果所有候选收益、交易次数或 Sharpe 接近 0，应视为当前样本内没有稳定 RSI 信号，而不是强行选择参数。',
  ].join('\n')
}

export function buildQuantOptimizationRecovery(messages: Message[]): QuantOptimizationRecovery | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = latestFinanceWorkflowState(messages, lastUserIndex)
  if (!isQuantOptimizationState(workflowState)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  if (toolCalls.some((call) => call.name === 'MarketData' && call.input.action === 'optimize_params')) {
    return null
  }
  const resultByToolUseId = successfulToolResults(turnMessages)
  const hasKlineEvidence = toolCalls.some((call) =>
    ((call.name === 'DataStore' && call.input.action === 'query_kline') ||
      (call.name === 'MarketData' && call.input.action === 'kline')) &&
    resultByToolUseId.has(call.id)
  )
  if (!hasKlineEvidence) return null
  const code = normalizeCode(workflowState?.subject)
  if (!code) return null
  const stamp = Date.now()
  return {
    toolCalls: [
      {
        id: `quant-optimize-rsi-${stamp}`,
        name: 'MarketData',
        input: {
          action: 'optimize_params',
          code,
          strategy: 'rsi',
          period: '5y',
          paramGrid: {
            period: [10, 14, 20],
            oversold: [25, 30, 35],
            overbought: [65, 70, 75],
          },
        },
      },
    ],
  }
}

function isQuantOptimizationState(state: FinanceWorkflowState | null): boolean {
  if (!state) return false
  if (state.assetClass !== 'stock') return false
  if (state.executionMode === 'blocked') return false
  if (state.workflowKind !== 'strategy_design' && state.workflowKind !== 'strategy_review') return false
  if (state.intentMode !== 'backtest' && state.intentMode !== 'review') return false
  return state.evidenceRefs.some((ref) => {
    const normalized = ref.trim().toLowerCase()
    return normalized === 'optimize_params' ||
      normalized === 'marketdata.optimize_params' ||
      normalized === 'strategy.optimization'
  })
}

function normalizeCode(value: unknown): string | null {
  const match = String(value ?? '').match(/\d{6}/)
  return match?.[0] ?? null
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.toolUses ?? [])
}

function successfulToolResults(messages: Message[]): Map<string, string> {
  const resultByToolUseId = new Map<string, string>()
  for (const message of messages) {
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) {
      resultByToolUseId.set(message.toolResult.toolUseId, message.toolResult.content)
    }
  }
  return resultByToolUseId
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function summarizeKlineWindow(value: string): string | null {
  return summarizeFinanceKlineWindow(value)
}

function summarizeIndicator(value: string): string | null {
  const parsed = parseJsonObject(value)
  const latest = parsed?.latest
  const indicators = parsed?.indicators
  if (
    parsed?.action !== 'indicators' ||
    parsed.interfaceId !== 'technical.indicator_series' ||
    !isRecord(latest) ||
    !isRecord(indicators)
  ) return null

  const close = finiteNumber(latest.close)
  const rsi = finiteNumber(indicators.rsi14)
  if (close == null && rsi == null) return null
  return [
    close == null ? null : `close ${close}`,
    rsi == null ? null : `RSI(14): ${rsi}`,
  ].filter((item): item is string => item !== null).join('; ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function summarizeBacktest(value: string): string | null {
  return summarizeStrategyBacktestResult(value)
}
