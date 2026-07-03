import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  latestFinanceWorkflowState,
  type FinanceWorkflowState,
} from './finance-workflow-state'
import { summarizeStrategyBacktestResult } from './finance-backtest-result'

export interface StrategyMonitorRecovery {
  code: string
  name: string
  price: number
  upper: number
  lower: number
  quoteSummary: string | null
  indicatorSummary: string | null
  backtestSummary: string | null
  toolCalls: ToolUse[]
}

export function buildStrategyMonitorRecovery(messages: Message[]): StrategyMonitorRecovery | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const prompt = messages[lastUserIndex].content
  const workflowState = latestFinanceWorkflowState(messages, lastUserIndex)
  if (!isStrategyMonitorState(workflowState)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  if (toolCalls.some((call) => call.name === 'MonitorCreate')) return null

  const resultByToolUseId = successfulToolResults(turnMessages)
  const latestQuote = [...toolCalls].reverse().find((call) =>
    ((call.name === 'DataStore' && call.input.action === 'query_quote') ||
      (call.name === 'MarketData' && ['quote', 'price'].includes(String(call.input.action)))) &&
    resultByToolUseId.has(call.id)
  )
  const latestIndicators = [...toolCalls].reverse().find((call) =>
    call.name === 'DataProcess' &&
    call.input.action === 'indicators' &&
    resultByToolUseId.has(call.id)
  )
  const latestBacktest = [...toolCalls].reverse().find((call) =>
    ((call.name === 'MarketData' && isMarketDataBacktestAction(call.input.action)) ||
      (call.name === 'DataProcess' && isDataProcessBacktestAction(call.input.action))) &&
    resultByToolUseId.has(call.id)
  )
  if (!latestQuote || (!latestIndicators && !latestBacktest)) return null

  const quoteText = resultByToolUseId.get(latestQuote.id) ?? ''
  const price = extractPrice(quoteText)
  if (!Number.isFinite(price) || price <= 0) return null
  const code = normalizeCode(workflowState?.subject) ?? extractQuoteCode(quoteText)
  if (!code) return null
  const name = extractQuoteName(quoteText) ?? code
  const lower = round2(price * 0.98)
  const upper = round2(price * 1.03)
  const indicatorSummary = latestIndicators ? summarizeIndicator(resultByToolUseId.get(latestIndicators.id) ?? '') : null
  const backtestSummary = latestBacktest ? summarizeBacktest(resultByToolUseId.get(latestBacktest.id) ?? '') : null
  const description = [
    '安全 RSI/趋势观察监控，非自动交易。',
    `当前价 ${price}，上方确认 ${upper}，下方失效 ${lower}。`,
    indicatorSummary ? `指标: ${indicatorSummary}` : null,
    backtestSummary ? `回测: ${backtestSummary}` : null,
    '触发后只提醒用户复核，不执行下单、转账或模拟交易。',
  ].filter(Boolean).join(' ')
  const script = [
    `const quote = callService('/api/finance/quote', {code: '${code}'});`,
    "const row = (quote && Array.isArray(quote.data) ? quote.data[0] : null) || {};",
    "const price = Number(row.price || row.close || row.latest || row.last || 0);",
    `const upper = ${upper};`,
    `const lower = ${lower};`,
    'return {',
    `  code: '${code}',`,
    `  name: row.name || '${escapeSingleQuotedJs(name)}',`,
    '  price,',
    '  upper,',
    '  lower,',
    "  status: price >= upper ? 'trend_confirmed' : (price <= lower ? 'risk_invalidated' : 'watching'),",
    '  triggered: Number.isFinite(price) && (price >= upper || price <= lower),',
    "  meaning: 'RSI/trend observation only; no automatic trading',",
    '};',
  ].join('\n')
  const stamp = Date.now()
  return {
    code,
    name,
    price,
    upper,
    lower,
    quoteSummary: summarizeQuote(quoteText),
    indicatorSummary,
    backtestSummary,
    toolCalls: [
      {
        id: `strategy-monitor-create-${stamp}`,
        name: 'MonitorCreate',
        input: {
          name: `${name} ${code} RSI/趋势安全监控`,
          script,
          interval: '5m',
          condition: 'result.triggered === true',
          displayType: 'value_card',
          description,
          user_prompt: prompt,
          group: 'strategy-monitor',
        },
      },
      {
        id: `strategy-monitor-list-${stamp}`,
        name: 'MonitorList',
        input: {},
      },
    ],
  }
}

function isMarketDataBacktestAction(action: unknown): boolean {
  return [
    'backtest',
    'backtest_batch',
    'backtest_composite',
  ].includes(String(action))
}

function isDataProcessBacktestAction(action: unknown): boolean {
  return [
    'strategy_backtest',
    'strategy_execute',
  ].includes(String(action))
}

export function buildStrategyMonitorRecoveryAnswer(messages: Message[], recovery: StrategyMonitorRecovery): string | null {
  const resultByToolUseId = successfulToolResults(messages)
  const createResult = resultByToolUseId.get(recovery.toolCalls[0].id)
  const listResult = resultByToolUseId.get(recovery.toolCalls[1].id)
  if (!createResult || !listResult) return null
  const created = parseJsonObject(createResult)
  return [
    '## RSI/趋势监控已创建',
    '',
    `对象：${recovery.name} ${recovery.code}。`,
    '',
    '### 触发条件',
    '',
    `- 上方确认：价格 >= ${recovery.upper}`,
    `- 下方失效：价格 <= ${recovery.lower}`,
    '- 检查周期：5m',
    '- 含义：这是 RSI/趋势观察提醒，不是自动交易、券商委托、雪球买卖、转账或模拟盘交易。',
    '',
    '### 创建依据',
    '',
    `- 行情：${recovery.quoteSummary ?? `当前价 ${recovery.price}`}`,
    `- 指标：${recovery.indicatorSummary ?? '未提取到可摘要 RSI 指标；监控以价格确认/失效位做安全替代。'}`,
    `- 回测：${recovery.backtestSummary ?? '未提取到额外回测摘要；本次只创建观察提醒。'}`,
    '',
    '### 读回确认',
    '',
    `- MonitorCreate：${created?.ok ? `已创建 id ${created.id ?? '-'}` : '已调用，结果需要人工核对。'}`,
    `- MonitorList：${summarizePlainEvidence(listResult) ?? '已返回当前监控列表。'}`,
  ].join('\n')
}

function isStrategyMonitorState(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'monitor_review' &&
    state.assetClass !== 'fund' &&
    state.executionMode !== 'blocked' &&
    (state.intentMode === 'observe' || state.intentMode === 'review')
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.role === Role.Assistant ? message.toolUses ?? [] : [])
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
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

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function extractPrice(value: string): number {
  const parsed = parseJsonObject(value)
  const rows = parsed && Array.isArray((parsed as any).rows) ? (parsed as any).rows : null
  const row = rows?.[0] ?? parsed
  if (row && typeof row === 'object') {
    for (const key of ['price', 'close', 'latest', 'last', 'current']) {
      const n = Number((row as Record<string, unknown>)[key])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  const match = value.match(/(?:price|close|latest|last|current)[^\d-]*(-?\d+(?:\.\d+)?)/i)
  const n = Number(match?.[1])
  return Number.isFinite(n) ? n : NaN
}

function extractQuoteName(value: string): string | null {
  const parsed = parseJsonObject(value)
  const rows = parsed && Array.isArray((parsed as any).rows) ? (parsed as any).rows : null
  const row = rows?.[0] ?? parsed
  if (row && typeof row === 'object') {
    const name = (row as Record<string, unknown>).name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return null
}

function extractQuoteCode(value: string): string | null {
  const parsed = parseJsonObject(value)
  const rows = parsed && Array.isArray((parsed as any).rows) ? (parsed as any).rows : null
  const row = rows?.[0] ?? parsed
  if (row && typeof row === 'object') {
    for (const key of ['code', 'symbol', 'ts_code']) {
      const code = normalizeCode((row as Record<string, unknown>)[key])
      if (code) return code
    }
  }
  return normalizeCode(value)
}

function normalizeCode(value: unknown): string | null {
  const match = String(value ?? '').match(/\d{6}/)
  return match?.[0] ?? null
}

function escapeSingleQuotedJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function summarizeIndicator(value: string): string | null {
  const parsed = parseJsonObject(value)
  const latest = parsed?.latest
  const indicators = parsed?.indicators
  if (
    parsed?.action !== 'indicators' ||
    parsed.interfaceId !== 'technical.indicator_series' ||
    !latest || typeof latest !== 'object' || Array.isArray(latest) ||
    !indicators || typeof indicators !== 'object' || Array.isArray(indicators)
  ) return null

  const closeValue = (latest as Record<string, unknown>).close
  const rsiValue = (indicators as Record<string, unknown>).rsi14
  const close = typeof closeValue === 'number' && Number.isFinite(closeValue) ? closeValue : null
  const rsi = typeof rsiValue === 'number' && Number.isFinite(rsiValue) ? rsiValue : null
  if (close == null && rsi == null) return null
  return [
    close == null ? null : `close ${close}`,
    rsi == null ? null : `RSI(14): ${rsi}`,
  ].filter((item): item is string => item !== null).join('; ')
}

function summarizeBacktest(value: string): string | null {
  return summarizeStrategyBacktestResult(value)
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
  const line = value.split('\n').find((item) => /price|close|latest|source|asOf/i.test(item))
  return line?.slice(0, 220) ?? null
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
