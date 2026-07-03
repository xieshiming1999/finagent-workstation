import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  financeWorkflowStateFromUserContent,
  latestFinanceWorkflowState,
  type FinanceWorkflowState,
} from './finance-workflow-state'
import { parseStrategyBacktestResult } from './finance-backtest-result'
import { summarizeFinanceKlineWindow } from './finance-kline-result'

interface LocalStrategyComparisonRecovery {
  toolCalls: ToolUse[]
}

interface StrategyComparisonRow {
  strategy: string
  totalReturn: number
  maxDrawdown: number
  sharpe: number
  winRate: number
  trades: number
}

type BatchBacktestMetricRow = Omit<StrategyComparisonRow, 'strategy' | 'winRate'>

export function maybeBuildLocalStrategyComparisonAnswer(messages: Message[]): string | null {
  const userPrompt = messages.find((message) => message.role === Role.User)?.content ?? ''
  const workflowState = financeWorkflowStateFromUserContent(userPrompt)
  if (!isLocalStrategyComparisonState(workflowState)) return null
  const turnMessages = messages.slice(1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const backtests = toolCalls
    .filter((call) =>
      call.name === 'MarketData' &&
      String(call.input.action).startsWith('backtest') &&
      resultByToolUseId.has(call.id)
    )
    .map((call) => {
      const strategy = String(call.input.strategy ?? '-')
      const metrics = parseFlexibleBacktestMetrics(resultByToolUseId.get(call.id) ?? '')
      return metrics ? { strategy, ...metrics } : null
    })
    .filter((row): row is StrategyComparisonRow => row !== null)
  const required = new Set(['rsi', 'macd', 'boll', 'ema_cross'])
  const completed = new Set(backtests.map((row) => row.strategy))
  if ([...required].some((strategy) => !completed.has(strategy))) return null

  const quote = [...toolCalls].reverse().find((call) => call.name === 'DataStore' && call.input.action === 'query_quote' && resultByToolUseId.has(call.id))
  const kline = [...toolCalls].reverse().find((call) => call.name === 'DataStore' && call.input.action === 'query_kline' && resultByToolUseId.has(call.id))
  const coverage = [...toolCalls].reverse().find((call) => call.name === 'DataStore' && call.input.action === 'coverage' && resultByToolUseId.has(call.id))
  const indicators = [...toolCalls].reverse().find((call) => call.name === 'DataProcess' && call.input.action === 'indicators' && resultByToolUseId.has(call.id))

  return [
    '## 本地数据证据下的策略比较',
    '',
    `对象：${normalizeCode(workflowState?.subject) ?? '-'}。本次只使用已读到的本地可复用数据和本地回测结果，不触发新的 provider 刷新，也不创建交易、监控或自选股变更。`,
    '',
    '### 数据口径',
    '',
    `- 行情：${quote ? summarizeQuote(resultByToolUseId.get(quote.id) ?? '') ?? '已读取本地 quote_snapshot。' : '未读取到行情摘要。'}`,
    `- K 线：${kline ? summarizeKlineWindow(resultByToolUseId.get(kline.id) ?? '') ?? '已读取本地 kline_daily。' : '未读取到 K 线摘要。'}`,
    `- 覆盖：${coverage ? summarizePlainEvidence(resultByToolUseId.get(coverage.id) ?? '') ?? '已读取本地 coverage。' : '未读取到 coverage 摘要。'}`,
    `- 指标：${indicators ? summarizeIndicator(resultByToolUseId.get(indicators.id) ?? '') ?? '已读取 RSI/MACD/布林线/均线指标。' : '未读取到指标摘要。'}`,
    '',
    '### 策略结果',
    '',
    '| 策略 | 收益 | 回撤 | Sharpe | 胜率 | 交易数 |',
    '|---|---:|---:|---:|---:|---:|',
    ...backtests.map((row) =>
      `| ${displayStrategyName(row.strategy)} | ${formatPctValue(row.totalReturn)} | ${formatPctValue(row.maxDrawdown)} | ${formatNumberValue(row.sharpe)} | ${formatPctValue(row.winRate)} | ${formatNumberValue(row.trades)} |`
    ),
    '',
    '### 结论与边界',
    '',
    '- RSI、MACD、布林线、均线都按当前运行时已实现策略执行；没有把未实现策略当成真实结果。',
    '- 如果多项指标为 0 或交易数为 0，只表示当前样本和参数下没有形成有效交易，不代表低风险或未来收益确定。',
    '- 本地数据的 data time、source 和 fetched-at 以本地 `quote_snapshot`、`kline_daily`、`data_coverage` 读回为准；没有额外 live provider refresh。',
    '- 不编造缺失的收益、回撤、交易次数或基本面解释；要扩展到自定义规则，需要先进入受治理的 StrategySpec/验证/编译流程。',
  ].join('\n')
}

export function maybeBuildWatchlistPortfolioBacktestAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = financeWorkflowStateFromUserContent(messages[lastUserIndex].content)
  if (!isWatchlistPortfolioBacktestState(workflowState)) return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const watchlistCalls = toolCalls.filter((call) => call.name === 'Watchlist' && resultByToolUseId.has(call.id))
  if (watchlistCalls.length === 0) return null
  const backtests = toolCalls
    .filter((call) =>
      resultByToolUseId.has(call.id) &&
      (
        (call.name === 'DataStore' &&
          call.input.action === 'backtest' &&
          String(call.input.mode ?? '') === 'portfolio') ||
        (call.name === 'MarketData' &&
          (call.input.action === 'backtest_batch' || call.input.action === 'backtest'))
      )
    )
    .map((call) => {
      const strategy = String(call.input.strategy ?? '-')
      const content = resultByToolUseId.get(call.id) ?? ''
      const metrics = call.input.action === 'backtest_batch'
        ? parseBatchBacktestMetrics(content)
        : parseFlexibleBacktestMetrics(content)
      return metrics ? { strategy, ...metrics } : null
    })
    .filter((row): row is StrategyComparisonRow => row !== null)
  if (backtests.length < 2) return null

  const latestList = [...watchlistCalls].reverse().find((call) => call.input.action === 'list')
  const latestSummary = [...watchlistCalls].reverse().find((call) => call.input.action === 'summary' || call.input.action === 'list_groups')
  const coverage = [...toolCalls].reverse().find((call) => call.name === 'DataStore' && call.input.action === 'coverage' && resultByToolUseId.has(call.id))
  const stats = [...toolCalls].reverse().find((call) => call.name === 'DataStore' && call.input.action === 'stats' && resultByToolUseId.has(call.id))
  const symbols = latestList ? extractWatchlistSymbols(resultByToolUseId.get(latestList.id) ?? '') : []
  const sorted = [...backtests].sort((a, b) => b.totalReturn - a.totalReturn || b.sharpe - a.sharpe)

  return [
    '## 自选股小型策略组合回测',
    '',
    `已先读取自选股/观察池：${latestSummary ? summarizeWatchlistEvidence(resultByToolUseId.get(latestSummary.id) ?? '') ?? '已读取分组摘要。' : '已读取列表。'}`,
    symbols.length
      ? `候选池：${symbols.join(', ')}。`
      : '当前没有可用候选池，因此不能运行组合回测。',
    '',
    symbols.length ? '### 回测结果' : '### 无法运行',
    '',
    symbols.length
      ? [
          '| 策略 | 收益 | 回撤 | Sharpe | 胜率 | 交易数 |',
          '|---|---:|---:|---:|---:|---:|',
          ...sorted.map((row) =>
            `| ${displayStrategyName(row.strategy)} | ${formatPctValue(row.totalReturn)} | ${formatPctValue(row.maxDrawdown)} | ${formatNumberValue(row.sharpe)} | ${formatPctValue(row.winRate)} | ${formatNumberValue(row.trades)} |`
          ),
        ].join('\n')
      : '- 自选股为空；已停止，没有全市场乱扫。',
    '',
    '### 数据与限制',
    '',
    `- 覆盖：${coverage ? summarizePlainEvidence(resultByToolUseId.get(coverage.id) ?? '') ?? '已读取 coverage。' : '未读取 coverage 摘要。'}`,
    `- 本地库：${stats ? summarizePlainEvidence(resultByToolUseId.get(stats.id) ?? '') ?? '已读取 DataStore stats。' : '未读取 stats 摘要。'}`,
    '- 组合回测是样本内技术策略比较，不等同于真实组合构建；未完整处理调仓频率、成交冲击、停牌、资金容量、行业暴露和相关性。',
    '- 不会创建真实交易、模拟交易、转账、监控或自选股变更；本次只读自选股和运行受控回测。',
  ].join('\n')
}

export function buildLocalStrategyComparisonRecovery(messages: Message[]): LocalStrategyComparisonRecovery | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = latestFinanceWorkflowState(messages, lastUserIndex)
  if (!isLocalStrategyComparisonState(workflowState)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const hasKlineEvidence = toolCalls.some((call) =>
    ((call.name === 'DataStore' && call.input.action === 'query_kline') ||
      (call.name === 'MarketData' && call.input.action === 'kline')) &&
    resultByToolUseId.has(call.id)
  )
  if (!hasKlineEvidence) return null
  const completedStrategies = new Set(toolCalls
    .filter((call) =>
      call.name === 'MarketData' &&
      String(call.input.action).startsWith('backtest') &&
      resultByToolUseId.has(call.id)
    )
    .map((call) => String(call.input.strategy ?? '')))
  const wanted = ['rsi', 'macd', 'boll', 'ema_cross']
  const missing = wanted.filter((strategy) => !completedStrategies.has(strategy))
  if (missing.length === 0) return null
  const code = normalizeCode(workflowState?.subject)
  if (!code) return null
  const stamp = Date.now()
  return {
    toolCalls: missing.map((strategy, index) => ({
      id: `local-strategy-compare-${strategy}-${stamp}-${index}`,
      name: 'MarketData',
      input: {
        action: 'backtest',
        code,
        strategy,
        period: 'daily',
        limit: 120,
        cacheMode: 'cache-only',
      },
    })),
  }
}

export function isLocalStrategyComparisonState(state: FinanceWorkflowState | null): boolean {
  if (!state) return false
  if (state.assetClass !== 'stock') return false
  if (state.executionMode === 'blocked') return false
  if (state.workflowKind !== 'strategy_design' && state.workflowKind !== 'strategy_review') return false
  if (state.intentMode !== 'backtest' && state.intentMode !== 'review') return false
  return state.evidenceRefs.some((ref) => {
    const normalized = ref.trim().toLowerCase()
    return normalized === 'local_strategy_comparison' ||
      normalized === 'strategy.comparison' ||
      normalized === 'backtest_comparison'
  })
}

function normalizeCode(value: unknown): string | null {
  const match = String(value ?? '').match(/\d{6}/)
  return match?.[0] ?? null
}

export function isWatchlistPortfolioBacktestState(state: FinanceWorkflowState | null): boolean {
  if (!state) return false
  if (state.executionMode === 'blocked') return false
  if (state.workflowKind !== 'strategy_design' && state.workflowKind !== 'strategy_review') return false
  if (state.intentMode !== 'backtest' && state.intentMode !== 'review') return false
  if (state.assetClass !== 'portfolio' && state.assetClass !== 'mixed' && state.assetClass !== 'stock') return false
  return state.evidenceRefs.some((ref) => {
    const normalized = ref.trim().toLowerCase()
    return normalized === 'watchlist_portfolio_backtest' ||
      normalized === 'portfolio.backtest' ||
      normalized === 'watchlist.portfolio_backtest'
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

function summarizeQuote(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const rows = Array.isArray((parsed as any).rows) ? (parsed as any).rows : []
    const first = rows[0] && typeof rows[0] === 'object' ? rows[0] as Record<string, unknown> : parsed
    const price = first.price ?? first.close ?? first.latest ?? first.current ?? first.last_price
    const change = first.changePct ?? first.change_pct ?? first.pct_chg ?? first.percent ?? first.changePercent
    const source = first.source ?? first.provider ?? first.sourceProviders ?? (parsed as any).source ?? (parsed as any).provider
    const asOf = first.asOf ?? first.as_of ?? first.tradeDate ?? first.trade_date ?? first.date ?? (parsed as any).asOf
    const fetchedAt = first.fetchedAt ?? first.fetched_at ?? (parsed as any).fetchedAt
    return compactSummary([
      price != null ? `price ${price}` : null,
      change != null ? `change ${change}` : null,
      source != null ? `source ${source}` : null,
      asOf != null ? `data time ${asOf}` : null,
      fetchedAt != null ? `retrieved ${fetchedAt}` : null,
    ])
  }
  const lines = value.split('\n').filter((line) =>
    /price|close|change|source|provider|asOf|fetched/i.test(line)
  )
  return lines.slice(0, 4).join('; ') || null
}

function summarizeWatchlistEvidence(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const count = (parsed as any).count ?? (Array.isArray((parsed as any).items) ? (parsed as any).items.length : null)
    const group = (parsed as any).group ?? (parsed as any).tag
    return compactSummary([count != null ? `count ${count}` : null, group != null ? `group ${group}` : null])
  }
  const lines = value.split('\n').filter((line) => /total|watching|entered|600519|entryCondition|观察|自选/i.test(line))
  return lines.slice(0, 5).join('; ') || null
}

function summarizePlainEvidence(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.split('\n').slice(0, 3).join('; ').slice(0, 280)
}

function compactSummary(parts: Array<string | null | undefined>): string | null {
  const filtered = parts.filter((part): part is string => Boolean(part))
  return filtered.length ? filtered.join(', ') : null
}

function parseFlexibleBacktestMetrics(value: string): Omit<StrategyComparisonRow, 'strategy'> | null {
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

function parseBatchBacktestMetrics(value: string): Omit<StrategyComparisonRow, 'strategy'> | null {
  const parsed = parseJsonObject(value)
  const results = parsed && Array.isArray((parsed as any).results) ? (parsed as any).results : []
  if (results.length === 0) return null

  const rows: BatchBacktestMetricRow[] = results.map((row: any) => ({
    totalReturn: parsePercentLike(row?.totalReturn),
    maxDrawdown: parsePercentLike(row?.maxDrawdown),
    sharpe: parseNumberLike(row?.sharpe),
    trades: parseNumberLike(row?.trades),
  })).filter((row: {
    totalReturn: number | null
    maxDrawdown: number | null
    sharpe: number | null
    trades: number | null
  }): row is BatchBacktestMetricRow =>
    row.totalReturn != null &&
    row.maxDrawdown != null &&
    row.sharpe != null &&
    row.trades != null
  )
  if (rows.length === 0) return null

  const totalReturn = rows.reduce((sum, row) => sum + row.totalReturn, 0) / rows.length
  const maxDrawdown = Math.max(...rows.map((row) => row.maxDrawdown))
  const sharpe = rows.reduce((sum, row) => sum + row.sharpe, 0) / rows.length
  const trades = rows.reduce((sum, row) => sum + row.trades, 0)
  const tradedRows = rows.filter((row) => row.trades > 0)
  const winRate = tradedRows.length === 0
    ? 0
    : tradedRows.filter((row) => row.totalReturn > 0).length / tradedRows.length
  return { totalReturn, maxDrawdown, sharpe, winRate, trades }
}

function parsePercentLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) > 1 ? value / 100 : value
  }
  if (typeof value !== 'string') return null
  const parsed = Number(value.replace('%', '').trim())
  if (!Number.isFinite(parsed)) return null
  return parsed / 100
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function displayStrategyName(strategy: string): string {
  return ({
    rsi: 'RSI',
    macd: 'MACD',
    macd_cross: 'MACD',
    boll: '布林线',
    bollinger: '布林线',
    ema_cross: '均线',
    dual_ma: '双均线',
    buy_and_hold: '买入持有',
    buy_hold: '买入持有',
  } as Record<string, string>)[strategy] ?? strategy
}

function formatPctValue(value: number): string {
  if (!Number.isFinite(value)) return '-'
  const pct = Math.abs(value) <= 1 ? value * 100 : value
  return `${pct.toFixed(2)}%`
}

function formatNumberValue(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function extractWatchlistSymbols(value: string): string[] {
  const parsed = parseJsonObject(value)
  const items = parsed && Array.isArray((parsed as any).items) ? (parsed as any).items : []
  return items
    .map((item: any) => String(item?.symbol ?? item?.code ?? '').trim())
    .filter(Boolean)
    .filter((symbol: string, index: number, arr: string[]) => arr.indexOf(symbol) === index)
}
