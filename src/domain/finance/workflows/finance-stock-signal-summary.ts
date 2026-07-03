import { Role, type Message, type ToolUse } from '../../../agent/message'
import { summarizeFinanceKlineWindow } from './finance-kline-result'
import {
  financeWorkflowStateFromUserContent,
  type FinanceWorkflowState,
} from './finance-workflow-state'

export function maybeBuildStockSignalCheckAnswer(
  turnMessages: Message[],
): string | null {
  const userPrompt = turnMessages.find((message) => message.role === Role.User)?.content ?? ''
  const workflowState = financeWorkflowStateFromUserContent(userPrompt)
  if (!isStockSignalCheckState(workflowState)) return null
  const toolMessages = turnMessages.slice(1)
  const toolCalls = collectToolCalls(toolMessages)
  const resultByToolUseId = successfulToolResults(toolMessages)
  const watchListCall = [...toolCalls].reverse().find((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'list' &&
    resultByToolUseId.has(call.id)
  )
  if (!watchListCall) return null
  const watchPayload = parseJsonObject(resultByToolUseId.get(watchListCall.id) ?? '')
  const items = Array.isArray(watchPayload?.items) ? watchPayload.items as Array<Record<string, unknown>> : []
  const actionableItems = items.filter((item) => {
    const symbol = String(item.symbol ?? item.code ?? '').trim()
    const entry = String(item.entryCondition ?? '').trim()
    return /^\d{6}$/.test(symbol) && entry.length > 0
  })
  if (actionableItems.length === 0) return null
  const selected = selectWatchlistItem(actionableItems, workflowState) ?? actionableItems[actionableItems.length - 1]
  const symbol = String(selected.symbol ?? selected.code ?? '').trim()
  if (!symbol) return null

  const quoteCall = [...toolCalls].reverse().find((call) =>
    ((call.name === 'DataStore' && call.input.action === 'query_quote') ||
      (call.name === 'MarketData' && ['quote', 'price'].includes(String(call.input.action)))) &&
    resultByToolUseId.has(call.id) &&
    (
      String(call.input.code ?? call.input.symbol ?? '') === symbol ||
      callResultMentionsCode(resultByToolUseId.get(call.id) ?? '', symbol)
    )
  )
  const indicatorCall = [...toolCalls].reverse().find((call) =>
    call.name === 'DataProcess' &&
    call.input.action === 'indicators' &&
    String(call.input.code ?? call.input.symbol ?? '') === symbol &&
    resultByToolUseId.has(call.id)
  )
  const klineCall = [...toolCalls].reverse().find((call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_kline' &&
    String(call.input.code ?? call.input.symbol ?? '') === symbol &&
    resultByToolUseId.has(call.id)
  )
  if (!quoteCall && !indicatorCall && !klineCall) return null

  const quoteText = quoteCall ? resultByToolUseId.get(quoteCall.id) ?? '' : ''
  const indicatorText = indicatorCall ? resultByToolUseId.get(indicatorCall.id) ?? '' : ''
  const klineText = klineCall ? resultByToolUseId.get(klineCall.id) ?? '' : ''
  const name = String(selected.name ?? '').trim() ||
    extractQuoteNameForCode(quoteText, symbol) ||
    inferSymbolNameFromEvidence(symbol, resultByToolUseId) ||
    symbol
  const price = extractLatestClose(indicatorText) || extractPriceForCode(quoteText, symbol) || meaningfulNumber(selected.priceAtAdd)
  const entryCondition = String(selected.entryCondition ?? '').trim()
  const targetEntry = meaningfulNumber(selected.targetEntryPrice ?? selected.priceAtAdd)
  const stopLoss = meaningfulNumber(selected.stopLoss)
  const targetPrice = meaningfulNumber(selected.targetPrice)
  const suggestedWeight = selected.suggestedWeight ?? selected.weight ?? '未写入；需要账户权益和风险预算后再精算'
  const trigger = evaluateSimpleStockSignal(entryCondition, price, targetEntry)
  const tradeCalls = toolCalls.filter((call) => call.name === 'XueqiuTrade')
  const askCalls = toolCalls.filter((call) => call.name === 'AskUserQuestion')
  const errorResults = turnMessages
    .filter((message) => message.role === Role.Tool && message.toolResult?.isError)
    .map((message) => message.toolResult?.content)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)

  return [
    `## 观察池买入信号检查：${name} ${symbol}`,
    '',
    `结论：${trigger.triggered ? '出现待确认买入信号，但仍需用户确认后才能进入雪球模拟盘。' : '当前没有触发买入信号，不应下单，也不需要弹出买入确认。'}`,
    '',
    '### 信号状态',
    '',
    `- 观察条件：${entryCondition}`,
    `- 当前价格：${price != null ? price : '未能稳定提取；只按观察条件保持等待'}`,
    `- 判断：${trigger.reason}`,
    targetEntry != null ? `- 目标入场参考：${targetEntry}` : '- 目标入场参考：观察池未写入固定目标价。',
    stopLoss != null ? `- 止损参考：${stopLoss}` : '- 止损参考：观察池未写入固定止损价。',
    targetPrice != null ? `- 止盈参考：${targetPrice}` : '- 止盈参考：观察池未写入固定止盈价。',
    `- 仓位依据：${suggestedWeight}。信号未触发时只保留计划，不计算最终股数或金额。`,
    '',
    '### 数据来源',
    '',
    `- 观察池读回：count ${watchPayload?.count ?? items.length}；本轮只评估带 entryCondition 的观察项，忽略没有策略条件的旧默认行。`,
    `- 行情：${quoteCall ? summarizeQuoteForCode(quoteText, symbol) ?? summarizeQuote(quoteText) ?? '已读回 quote_snapshot，但无法提取稳定摘要。' : '未读取到可摘要行情。'}`,
    `- K线：${klineCall ? summarizeKlineWindow(klineText) ?? '已读回 kline_daily。' : '未读取到可摘要 K 线。'}`,
    `- 指标：${indicatorCall ? summarizeIndicator(indicatorText) ?? '已读回指标结果。' : '未读取到可摘要技术指标。'}`,
    '',
    '### 交易边界',
    '',
    trigger.triggered
      ? '- 若用户确认，下一步才可以调用雪球模拟盘；确认前不得执行买入。'
      : '- 当前信号未触发，因此未调用雪球模拟盘，也未执行任何买入、卖出或转账。',
    `- 本轮 XueqiuTrade 调用数：${tradeCalls.length}；AskUserQuestion 调用数：${askCalls.length}。`,
    ...(errorResults.length ? ['', '### 已暴露的工具错误', '', ...errorResults.map((item) => `- ${item}`)] : []),
    '',
    '以上内容仅供研究和观察，不构成投资建议。市场有风险，投资需谨慎。',
  ].join('\n')
}

function selectWatchlistItem(
  items: Array<Record<string, unknown>>,
  state: FinanceWorkflowState | null,
): Record<string, unknown> | null {
  const subjects = workflowSubjects(state)
  for (const subject of subjects) {
    const match = [...items].reverse().find((item) => {
      const symbol = String(item.symbol ?? item.code ?? '').trim()
      return symbol === subject
    })
    if (match) return match
  }
  return null
}

function workflowSubjects(state: FinanceWorkflowState | null): string[] {
  if (!state) return []
  const values = [
    ...(Array.isArray(state.subjects) ? state.subjects : []),
    state.subject,
  ]
  const normalized = values
    .map((value) => normalizeCode(value))
    .filter((value): value is string => Boolean(value))
  return [...new Set(normalized)]
}

function normalizeCode(value: unknown): string | null {
  const text = String(value ?? '').trim()
  const match = text.match(/\d{6}/)
  return match?.[0] ?? null
}

function isStockSignalCheckState(state: FinanceWorkflowState | null): boolean {
  if (!state) return false
  if (state.assetClass !== 'stock') return false
  if (state.executionMode === 'blocked') return false
  if (state.workflowKind !== 'stock_research' &&
    state.workflowKind !== 'trade_prep' &&
    state.workflowKind !== 'monitor_review') {
    return false
  }
  if (state.intentMode !== 'observe' &&
    state.intentMode !== 'review' &&
    state.intentMode !== 'size') {
    return false
  }
  return state.evidenceRefs.some((ref) => {
    const normalized = ref.trim().toLowerCase()
    return normalized === 'watch_signal_check' ||
      normalized === 'watchlist.signal_check' ||
      normalized === 'stock.signal_check'
  })
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

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function meaningfulNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function inferSymbolNameFromEvidence(symbol: string, resultByToolUseId: Map<string, string>): string | null {
  if (!symbol) return null
  for (const result of resultByToolUseId.values()) {
    for (const line of result.split('\n')) {
      if (!line.includes(symbol)) continue
      const compact = line.replace(/\s+/g, ' ').trim()
      const afterSymbol = compact.match(new RegExp(`(?:^|\\s)${symbol}\\s+([^\\s,，|:：()（）]+)`))
      if (afterSymbol?.[1] && !isBadInferredSymbolName(afterSymbol[1])) {
        return afterSymbol[1]
      }
      const beforeSymbol = compact.match(new RegExp(`([^\\s,，|:：()（）]+)\\s*[（(]?${symbol}[）)]?`))
      if (beforeSymbol?.[1] && !isBadInferredSymbolName(beforeSymbol[1])) {
        return beforeSymbol[1]
      }
    }
  }
  return null
}

function isBadInferredSymbolName(value: string): boolean {
  return /^(PE|PB|ROE|O|C|H|L|V|daily|quote|fundamentals|DataStore|query|code|symbol)$/i.test(value) ||
    /^[`'"]+$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    /^\d+(?:\.\d+)?%?$/.test(value)
}

function extractLatestClose(value: string): number | null {
  return parseIndicatorEvidence(value)?.close ?? null
}

function extractPriceForCode(value: string, code: string): number | null {
  const section = extractSectionForCode(value, code)
  if (!section) return null
  return extractPrice(section)
}

function extractPrice(value: string): number | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const rows = Array.isArray((parsed as any).rows) ? (parsed as any).rows : []
    const first = rows[0] && typeof rows[0] === 'object' ? rows[0] as Record<string, unknown> : parsed
    const price = first.price ?? first.close ?? first.latest ?? first.current ?? first.last_price
    const n = Number(price)
    return Number.isFinite(n) ? n : null
  }
  const match = value.match(/(?:price|close|current|latest)[:=]\s*(-?\d+(?:\.\d+)?)/i)
  return match ? Number(match[1]) : null
}

function summarizeKlineWindow(value: string): string | null {
  return summarizeFinanceKlineWindow(value)
}

function summarizeIndicator(value: string): string | null {
  const evidence = parseIndicatorEvidence(value)
  if (!evidence || (evidence.close == null && evidence.rsi14 == null)) return null
  return [
    evidence.close == null ? null : `close ${evidence.close}`,
    evidence.rsi14 == null ? null : `RSI(14): ${evidence.rsi14}`,
  ].filter((item): item is string => item !== null).join('; ')
}

function parseIndicatorEvidence(value: string): { close: number | null; rsi14: number | null } | null {
  const parsed = parseJsonObject(value)
  const latest = parsed?.latest
  const indicators = parsed?.indicators
  if (
    parsed?.action !== 'indicators' ||
    parsed.interfaceId !== 'technical.indicator_series' ||
    !latest || typeof latest !== 'object' || Array.isArray(latest) ||
    !indicators || typeof indicators !== 'object' || Array.isArray(indicators)
  ) return null
  return {
    close: finiteNumber((latest as Record<string, unknown>).close),
    rsi14: finiteNumber((indicators as Record<string, unknown>).rsi14),
  }
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

function summarizeQuoteForCode(value: string, code: string): string | null {
  const section = extractSectionForCode(value, code)
  if (!section) return null
  return summarizeQuote(section)
}

function extractQuoteNameForCode(value: string, code: string): string | null {
  const section = extractSectionForCode(value, code)
  if (!section) return null
  return extractQuoteName(section)
}

function extractSectionForCode(value: string, code: string): string | null {
  if (!code) return null
  const lines = value.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${code} `) || line.includes(`${code} quote snapshots`))
  if (start < 0) return callResultMentionsCode(value, code) ? value : null
  const section: string[] = []
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]
    if (index > start && /^\d{6}\s+/.test(line) && !line.startsWith(`${code} `)) break
    section.push(line)
  }
  return section.join('\n')
}

function callResultMentionsCode(value: string, code: string): boolean {
  return Boolean(code) && (value.includes(code) || value.includes(`${code}.SH`) || value.includes(`${code}.SZ`))
}

function extractQuoteName(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const rows = Array.isArray((parsed as any).rows) ? (parsed as any).rows : []
    const first = rows[0] && typeof rows[0] === 'object' ? rows[0] as Record<string, unknown> : parsed
    const name = first.name ?? first.stockName ?? first.security_name ?? first.short_name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }
  const direct = value.match(/name[:=]\s*([^\s,，;；]+)/i)
  return direct?.[1] ?? null
}

function evaluateSimpleStockSignal(entryCondition: string, price: number | null, targetEntry: number | null): { triggered: boolean, reason: string } {
  if (price == null || !Number.isFinite(price)) {
    return { triggered: false, reason: '未取得稳定当前价格，不能触发买入。' }
  }
  if (targetEntry != null && price >= targetEntry) {
    return { triggered: true, reason: `价格 ${price} 已达到或超过目标入场参考 ${targetEntry}。` }
  }
  const breakout = /突破[^\d]*(\d+(?:\.\d+)?)/.exec(entryCondition)?.[1]
  if (breakout && price >= Number(breakout)) {
    return { triggered: true, reason: `价格 ${price} 已达到突破观察价 ${breakout}。` }
  }
  const pullback = /(?:回踩|低吸|接近)[^\d]*(\d+(?:\.\d+)?)/.exec(entryCondition)?.[1]
  const pullbackCenter = pullback ? Number(pullback) : null
  if (pullbackCenter != null && Math.abs(price - pullbackCenter) / pullbackCenter <= 0.015) {
    return { triggered: true, reason: `价格 ${price} 接近低吸/回踩观察价 ${pullbackCenter}。` }
  }
  const waits = [
    pullbackCenter != null ? `低吸区间约 ${round2(pullbackCenter * 0.985)}-${round2(pullbackCenter * 1.015)}` : null,
    breakout != null ? `突破触发价 ${breakout}` : null,
  ].filter(Boolean)
  return {
    triggered: false,
    reason: waits.length
      ? `价格 ${price} 未落入${waits.join('，也未达到')}，因此继续观察。`
      : `价格 ${price} 与观察条件未形成可执行触发，继续观察。`,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function compactSummary(parts: Array<string | null | undefined>): string | null {
  const filtered = parts.filter((part): part is string => Boolean(part))
  return filtered.length ? filtered.join(', ') : null
}
