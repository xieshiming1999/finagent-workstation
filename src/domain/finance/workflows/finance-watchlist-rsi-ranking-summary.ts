import { Role, type Message, type ToolUse } from '../../../agent/message'
import { isFinanceEvidenceTool } from './finance-workflow-policy'
import {
  financeWorkflowStateFromUserContent,
  type FinanceWorkflowState,
} from './finance-workflow-state'
import { parseStrategyBacktestResult } from './finance-backtest-result'

interface WatchlistRsiBacktestRow {
  code: string
  limit: unknown
  totalReturn: number
  maxDrawdown: number
  sharpe: number
  winRate: number
  trades: number
}

export function maybeBuildWatchlistRsiRankingAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = financeWorkflowStateFromUserContent(messages[lastUserIndex].content)
  if (!isWatchlistRsiRankingState(workflowState)) return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const watchlistCalls = toolCalls.filter((call) => call.name === 'Watchlist')
  const financeToolCalls = toolCalls.filter((call) => isFinanceEvidenceTool(call.name) || call.name === 'Watchlist')
  const backtestCalls = toolCalls.filter((call) =>
    call.name === 'MarketData' &&
    String(call.input.action).startsWith('backtest') &&
    String(call.input.strategy ?? '').toLowerCase() === 'rsi'
  )
  if (watchlistCalls.length === 0 || backtestCalls.length < 3 || financeToolCalls.length < 6) return null

  const resultByToolUseId = successfulToolResults(turnMessages)
  const ranked: WatchlistRsiBacktestRow[] = backtestCalls
    .map((call): WatchlistRsiBacktestRow | null => {
      const result = resultByToolUseId.get(call.id)
      if (!result) return null
      const metrics = parseBacktestMetrics(result)
      if (!metrics) return null
      return {
        code: String(call.input.code ?? call.input.symbol ?? '-'),
        limit: call.input.limit ?? '-',
        ...metrics,
      }
    })
    .filter((row): row is WatchlistRsiBacktestRow => row !== null)
    .sort((a, b) =>
      b.totalReturn - a.totalReturn ||
      b.sharpe - a.sharpe ||
      a.maxDrawdown - b.maxDrawdown ||
      b.trades - a.trades
    )
  if (ranked.length < 3) return null

  const indicators = toolCalls
    .filter((call) => call.name === 'DataProcess' && call.input.action === 'indicators')
    .map((call) => {
      const result = resultByToolUseId.get(call.id)
      if (!result) return null
      return {
        code: String(call.input.code ?? '-'),
        summary: summarizeIndicator(result),
      }
    })
    .filter((item): item is { code: string; summary: string } => Boolean(item?.summary))

  const top = ranked[0]
  if (!top) return null
  return [
    '## 自选股 RSI 策略排序',
    '',
    '已先读取自选股/观察池，并对可用股票候选执行受控 RSI 回测比较。以下排序来自工具返回的样本内回测指标，不能直接视为未来收益承诺。',
    '',
    '### 排序结果',
    '',
    ...ranked.map((row, index) =>
      `${index + 1}. ${row.code}：totalReturn ${row.totalReturn.toFixed(2)}%，maxDrawdown ${row.maxDrawdown.toFixed(2)}%，Sharpe ${row.sharpe.toFixed(2)}，winRate ${row.winRate.toFixed(1)}%，trades ${row.trades}`
    ),
    '',
    '### 当前结论',
    '',
    `- 当前样本内排名第一：${top.code}。`,
    `- 比较口径：\`MarketData(action:"backtest", strategy:"rsi")\`，每个候选 limit=${top.limit}。`,
    indicators.length
      ? `- 补充 RSI/价格快照：${indicators.map((item) => `${item.code} ${item.summary}`).join('；')}`
      : '- 未读取到额外 RSI 指标快照；排序主要依据 backtest 结果。',
    '',
    '### 使用边界',
    '',
    '- 自选股里可能包含重复代码或代码歧义；本次按工具成功返回的股票回测结果排序。',
    '- RSI 是样本内技术策略，存在过拟合、滑点、手续费、冲击成本、停牌和实际成交约束。',
    '- 若某候选 trades 为 0 或收益为 0，应理解为当前样本内 RSI 未形成有效交易，而不是低风险保证。',
  ].join('\n')
}

export function isWatchlistRsiRankingState(state: FinanceWorkflowState | null): boolean {
  if (!state) return false
  if (state.assetClass !== 'stock') return false
  if (state.executionMode === 'blocked') return false
  if (state.workflowKind !== 'strategy_design' && state.workflowKind !== 'strategy_review') return false
  if (state.intentMode !== 'backtest' && state.intentMode !== 'review') return false
  return state.evidenceRefs.some((ref) => {
    const normalized = ref.trim().toLowerCase()
    return normalized === 'watchlist_rsi_ranking' ||
      normalized === 'watchlist.rsi_rank' ||
      normalized === 'strategy.watchlist_ranking'
  })
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.role === Role.Assistant ? message.toolUses ?? [] : [])
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

function summarizeIndicator(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (
    parsed?.action !== 'indicators' ||
    parsed.interfaceId !== 'technical.indicator_series' ||
    !isRecord(parsed.latest) ||
    !isRecord(parsed.indicators)
  ) return null

  const close = finiteNumber(parsed.latest.close)
  const rsi = finiteNumber(parsed.indicators.rsi14)
  if (close == null && rsi == null) return null
  return [
    close == null ? null : `close ${close}`,
    rsi == null ? null : `RSI(14): ${rsi}`,
  ].filter((item): item is string => item !== null).join('; ')
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseBacktestMetrics(value: string): Omit<WatchlistRsiBacktestRow, 'code' | 'limit'> | null {
  const parsed = parseStrategyBacktestResult(value)
  if (!parsed) return null
  return {
    totalReturn: parsed.metrics.totalReturnPct,
    maxDrawdown: parsed.metrics.maxDrawdownPct,
    sharpe: parsed.metrics.sharpeRatio,
    winRate: parsed.metrics.winRatePct,
    trades: parsed.metrics.tradeCount,
  }
}
