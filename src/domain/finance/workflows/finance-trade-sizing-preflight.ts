import { Role, type Message, type ToolUse } from '../../../agent/message'
import { isTradeSizingWorkflowState, latestTradePrepWorkflowState } from './finance-workflow-state'

type TradeAskDecision = 'none' | 'stop' | 'allow_preview'

export function buildTradeSizingPreflightToolCalls(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = latestTradePrepWorkflowState(messages, lastUserIndex)
  if (!isTradeSizingWorkflowState(workflowState)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const calls = collectToolCalls(turnMessages)
  const results = successfulToolResults(turnMessages)
  const failures = failedToolResults(turnMessages)
  const blockedTools = blockedToolNames(workflowState)
  const xueqiuForbidden = blockedTools.has('XueqiuTrade')
  const hasXueqiuReadFailure = calls.some((call) =>
    call.name === 'XueqiuTrade' &&
    (call.input.action === 'portfolios' || call.input.action === 'balance') &&
    failures.has(call.id)
  )
  const hasXueqiuBalance = calls.some((call) =>
    call.name === 'XueqiuTrade' &&
    call.input.action === 'balance' &&
    results.has(call.id)
  )
  const hasPortfolioSnapshot = calls.some((call) =>
    call.name === 'Portfolio' &&
    call.input.action === 'snapshot' &&
    results.has(call.id)
  )
  const hasAskUserQuestion = calls.some((call) =>
    call.name === 'AskUserQuestion' &&
    results.has(call.id)
  )
  const confirmationDecision = latestAskUserDecision(turnMessages)
  const wantsPreview = confirmationDecision === 'allow_preview'
  if (confirmationDecision !== 'none' && !wantsPreview) return null
  if (wantsPreview && !hasTradePreview(calls, results)) {
    const preview = buildPreviewToolCalls(messages, turnMessages, xueqiuForbidden || hasXueqiuReadFailure)
    if (preview.length > 0) return preview
  }
  const sizingSymbol = latestStrategySymbol(messages)
  if (!hasQuote(calls, results) && sizingSymbol) {
    return [{
      id: `trade-sizing-quote-${Date.now()}`,
      name: 'DataStore',
      input: {
        action: 'query_quote',
        code: sizingSymbol,
        limit: 1,
      },
    }]
  }
  if ((xueqiuForbidden || hasXueqiuBalance || hasXueqiuReadFailure) && hasPortfolioSnapshot) {
    if (hasAskUserQuestion) return null
    return [{
      id: `trade-sizing-confirmation-${Date.now()}`,
      name: 'AskUserQuestion',
      input: {
        questions: [{
          question: '策略信号触发后，是否允许进入雪球模拟盘或本地模拟盘执行？',
          header: '交易确认',
          options: [
            {
              label: '触发时再确认',
              description: '现在只保留计算和监控结果，真正买入前再次询问。',
            },
            {
              label: '只计算不下单',
              description: '本轮不进入任何模拟交易执行流程。',
            },
            {
              label: '允许模拟执行',
              description: '后续仍需使用已确认的组合、价格和股数参数。',
            },
          ],
        }],
      },
    }]
  }

  const toolCalls: ToolUse[] = []
  if (!xueqiuForbidden &&
    !hasXueqiuReadFailure &&
    !calls.some((call) => call.name === 'XueqiuTrade' && call.input.action === 'portfolios')) {
    toolCalls.push({
      id: `trade-sizing-xueqiu-portfolios-${Date.now()}`,
      name: 'XueqiuTrade',
      input: { action: 'portfolios' },
    })
  }
  if (!xueqiuForbidden && !hasXueqiuReadFailure && !hasXueqiuBalance) {
    toolCalls.push({
      id: `trade-sizing-xueqiu-balance-${Date.now()}`,
      name: 'XueqiuTrade',
      input: { action: 'balance' },
    })
  }
  if (!hasPortfolioSnapshot) {
    toolCalls.push({
      id: `trade-sizing-portfolio-snapshot-${Date.now()}`,
      name: 'Portfolio',
      input: { action: 'snapshot', market: 'cn' },
    })
  }
  return toolCalls.length > 0 ? toolCalls : null
}

function hasQuote(calls: ToolUse[], results: Map<string, string>): boolean {
  return calls.some((call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_quote' &&
    results.has(call.id)
  )
}

function blockedToolNames(state: { blockedTools?: string[] } | null): Set<string> {
  return new Set((state?.blockedTools ?? []).map((tool) => tool.trim()).filter(Boolean))
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

function failedToolResults(messages: Message[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role === Role.Tool && message.toolResult?.isError) {
      ids.add(message.toolResult.toolUseId)
    }
  }
  return ids
}

function latestAskUserDecision(messages: Message[]): TradeAskDecision {
  const askIds = new Set<string>()
  for (const call of collectToolCalls(messages)) {
    if (call.name === 'AskUserQuestion') askIds.add(call.id)
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const result = messages[index].toolResult
    if (!result || result.isError || !askIds.has(result.toolUseId)) continue
    return extractAskUserDecision(result.content)
  }
  return 'none'
}

function extractAskUserDecision(content: string): TradeAskDecision {
  const decoded = decodeMap(content)
  if (decoded) {
    const explicit = String(decoded.decision ?? decoded.action ?? '').trim().toLowerCase()
    if (['allow_preview', 'preview', 'allow_simulation_preview', 'simulate_preview'].includes(explicit)) {
      return 'allow_preview'
    }
    if (['deny', 'denied', 'no', 'cancel', 'defer', 'later'].includes(explicit)) {
      return 'stop'
    }
    const index = decoded.selectedOptionIndex ?? decoded.optionIndex
    if (index === 3 || index === '3') return 'allow_preview'
    if (index === 1 || index === 2 || index === '1' || index === '2') return 'stop'
  }
  return content.trim() ? 'stop' : 'none'
}

function hasTradePreview(calls: ToolUse[], results: Map<string, string>): boolean {
  return calls.some((call) =>
    results.has(call.id) &&
    (
      (call.name === 'Portfolio' && call.input.action === 'preview_trade') ||
      (call.name === 'XueqiuTrade' && call.input.action === 'preview_order')
    )
  )
}

function buildPreviewToolCalls(
  messages: Message[],
  turnMessages: Message[],
  xueqiuForbidden: boolean,
): ToolUse[] {
  const symbol = latestStrategySymbol(messages)
  const price = latestReferencePrice(messages)
  const cash = latestCash(turnMessages)
  if (!symbol || !price || price <= 0) return []
  const budget = cash && cash > 0 ? cash * 0.2 : price * 100
  const portfolioShares = Math.floor((budget / price) / 100) * 100
  const xueqiuShares = Math.floor(budget / price)
  const now = Date.now()
  const calls: ToolUse[] = []
  if (portfolioShares > 0) {
    calls.push({
      id: `trade-sizing-portfolio-preview-${now}`,
      name: 'Portfolio',
      input: {
        action: 'preview_trade',
        market: 'cn',
        symbol,
        side: 'buy',
        shares: portfolioShares,
        price,
      },
    })
  }
  if (!xueqiuForbidden && xueqiuShares > 0) {
    calls.push({
      id: `trade-sizing-xueqiu-preview-${now}`,
      name: 'XueqiuTrade',
      input: {
        action: 'preview_order',
        side: 'buy',
        symbol,
        shares: xueqiuShares,
        price,
      },
    })
  }
  return calls
}

function latestReferencePrice(messages: Message[]): number | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const decoded = decodeMap(messages[index].toolResult?.content)
    if (!decoded) continue
    const data = firstMap(decoded.data)
    const rows = firstMap(decoded.rows)
    for (const value of [
      decoded.price,
      decoded.value,
      data?.price,
      rows?.price,
      data?.close,
      rows?.close,
    ]) {
      const parsed = numberValue(value)
      if (parsed && parsed > 0) return parsed
    }
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role !== Role.User) continue
    const decoded = decodeUserDataPayload(messages[index].content)
    if (!decoded) continue
    for (const value of [decoded.price, decoded.value, decoded.referencePrice]) {
      const parsed = numberValue(value)
      if (parsed && parsed > 0) return parsed
    }
  }
  return null
}

function latestCash(messages: Message[]): number | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const decoded = decodeMap(messages[index].toolResult?.content)
    if (!decoded) continue
    const performance = firstMap(decoded.performances)
    const parsed = numberValue(performance?.cash)
    if (parsed && parsed > 0) return parsed
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const decoded = decodeMap(messages[index].toolResult?.content)
    if (!decoded) continue
    for (const value of [
      decoded.cash,
      decoded.initialCash,
      decoded.initial_cash,
    ]) {
      const parsed = numberValue(value)
      if (parsed && parsed > 0) return parsed
    }
  }
  return null
}

function latestStrategySymbol(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const decoded = decodeMap(messages[index].toolResult?.content)
    if (!decoded) continue
    const symbol = strategySymbolFromMap(decoded)
    if (symbol) return symbol
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role !== Role.User) continue
    const decoded = decodeUserDataPayload(messages[index].content)
    if (!decoded) continue
    const symbol = strategySymbolFromMap(decoded)
    if (symbol) return symbol
  }
  return null
}

function decodeUserDataPayload(content: string): Record<string, unknown> | null {
  const marker = content.lastIndexOf('data:')
  if (marker < 0) return null
  return decodeMap(content.slice(marker + 'data:'.length))
}

function decodeMap(content: string | undefined): Record<string, unknown> | null {
  const text = content?.trim() ?? ''
  if (!text.startsWith('{')) return null
  try {
    const decoded = JSON.parse(text)
    return isRecord(decoded) ? decoded : null
  } catch {
    return null
  }
}

function strategySymbolFromMap(decoded: Record<string, unknown>): string | null {
  for (const key of ['symbol', 'code']) {
    const value = normalizeSymbol(decoded[key])
    if (value) return value
  }
  if (isRecord(decoded.validation)) {
    const value = strategySymbolFromMap(decoded.validation)
    if (value) return value
  }
  const spec = decoded.spec ?? decoded.strategySpec
  if (isRecord(spec)) {
    const value = strategySymbolFromMap(spec)
    if (value) return value
  }
  if (Array.isArray(decoded.symbols) && decoded.symbols.length > 0) {
    return normalizeSymbol(decoded.symbols[0])
  }
  return null
}

function normalizeSymbol(value: unknown): string | null {
  const text = String(value ?? '').trim().toUpperCase()
  if (!text) return null
  const clean = text.replace(/\.(SH|SZ|BJ)$/iu, '')
  if (/^\d{6}$/u.test(clean)) return clean
  if (/^(SH|SZ|BJ)\d{6}$/u.test(text)) return text.slice(2)
  return null
}

function firstMap(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) return item
    }
  }
  return isRecord(value) ? value : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/gu, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}
