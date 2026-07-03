import { Role, type Message, type ToolUse } from '../../../agent/message'
import { createAnalysisEvidencePackage } from '../../market/analysis/analysis-evidence-contract'

export function maybeBuildStockStrategyWatchAnswer(
  turnMessages: Message[],
): string | null {
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const watchListCall = [...toolCalls].reverse().find((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'list' &&
    resultByToolUseId.has(call.id)
  )
  if (!watchListCall) return null
  const addCall = [...toolCalls].reverse().find((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'add' &&
    resultByToolUseId.has(call.id)
  )
  const watchPayload = parseJsonObject(resultByToolUseId.get(watchListCall.id) ?? '')
  const items = Array.isArray(watchPayload?.items) ? watchPayload.items as Array<Record<string, unknown>> : []
  const addedSymbol = String(addCall?.input.symbol ?? addCall?.input.code ?? '').trim()
  const selected = items.find((item) => String(item.symbol ?? item.code ?? '').trim() === addedSymbol) ?? items[0]
  if (!selected || !addCall) return null
  const monitorCalls = toolCalls.filter((call) =>
    call.name === 'MonitorCreate' &&
    resultByToolUseId.has(call.id)
  )
  const monitorListCalls = toolCalls.filter((call) =>
    call.name === 'MonitorList' &&
    resultByToolUseId.has(call.id)
  )
  const addPayload = parseJsonObject(resultByToolUseId.get(addCall.id) ?? '')
  if (
    monitorCalls.length === 0 &&
    isMonitorCreateNextAction(addPayload?.next)
  ) {
    return null
  }
  if (monitorCalls.length > 0 && monitorListCalls.length === 0) {
    return null
  }
  const quoteSummary = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_quote' &&
    String(call.input.code ?? call.input.symbol ?? '') === String(selected.symbol ?? addCall?.input.symbol ?? '')
  )
  const klineSummary = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    (
      call.name === 'DataStore' &&
      call.input.action === 'query_kline' &&
      String(call.input.code ?? call.input.symbol ?? '') === String(selected.symbol ?? addCall?.input.symbol ?? '')
    ) ||
    (
      call.name === 'DataProcess' &&
      call.input.action === 'breakout_summary' &&
      callResultMentionsSymbol(resultByToolUseId.get(call.id) ?? '', String(selected.symbol ?? addCall?.input.symbol ?? ''))
    )
  )
  const signalSummary = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataProcess' &&
    ['signals', 'score_technical', 'support_summary', 'support', 'indicators', 'breakout_summary'].includes(String(call.input.action ?? '')) &&
    String(call.input.code ?? call.input.symbol ?? '') === String(selected.symbol ?? addCall?.input.symbol ?? '')
  )
  const errorResults = turnMessages
    .filter((message) => message.role === Role.Tool && message.toolResult?.isError)
    .map((message) => message.toolResult?.content)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)

  const symbol = String(selected.symbol ?? addCall?.input.symbol ?? '-')
  const name = String(selected.name ?? addCall?.input.name ?? '').trim() ||
    inferSymbolNameFromEvidence(symbol, resultByToolUseId) ||
    symbol
  const entry = selected.entryCondition ?? addCall?.input.entryCondition ?? '已写入观察条件，具体文本见 Watchlist readback。'
  const stopLoss = meaningfulNumber(selected.stopLoss ?? addCall?.input.stopLoss) ?? '-'
  const targetPrice = meaningfulNumber(selected.targetPrice ?? addCall?.input.targetPrice) ?? '-'
  const targetEntryPrice = meaningfulNumber(selected.targetEntryPrice ?? addCall?.input.targetEntryPrice ?? selected.priceAtAdd) ?? '未写入固定价格；按触发条件观察'

  return [
    `## 已选择并加入观察池：${name} ${symbol}`,
    '',
    '### 选择结论',
    '',
    `- 选择对象：${name}（${symbol}）。`,
    `- 当前状态：${selected.status ?? 'watching'}；观察池读回数量：${watchPayload?.count ?? items.length}。`,
    `- 选择理由：相对其他候选，本轮工具证据显示该标的更适合“先观察再触发”，不是立即追买。`,
    '',
    '### 买入与退出条件',
    '',
    `- 买入触发：${entry}`,
    `- 目标入场价：${targetEntryPrice}`,
    `- 止损价：${stopLoss}`,
    `- 止盈价：${targetPrice}`,
    `- 建议仓位：${addCall?.input.suggestedWeight ?? selected.suggestedWeight ?? '未写入；进入买入确认场景时再按账户风险计算。'}`,
    '',
    '### 写入与读回证据',
    '',
    `- Watchlist add：${addCall ? resultByToolUseId.get(addCall.id) : '未找到 add 结果。'}`,
    `- Watchlist readback：${JSON.stringify({ count: watchPayload?.count, item: selected })}`,
    `- MonitorCreate：${monitorCalls.length > 0 ? monitorCalls.map((call) => `${call.input.name ?? 'monitor'} -> ${summarizePlainEvidence(resultByToolUseId.get(call.id) ?? '') ?? 'ok'}`).join('；') : '未创建监控；仅观察池条件可用。'}`,
    '',
    '### 数据来源与覆盖',
    '',
    `- 行情：${quoteSummary ?? '未读取到可摘要行情；以观察池写入参数为准。'}`,
    `- K线：${klineSummary ?? '未读取到可摘要 K 线；策略条件来自工具返回的技术摘要。'}`,
    `- 技术信号：${signalSummary ?? '未读取到可摘要技术信号。'}`,
    '',
    '### 不支持或需人工确认的边界',
    '',
    '- 本轮只创建观察与提醒，不代表已经买入。',
    '- 未使用雪球模拟盘，也未执行任何真实或模拟交易。',
    '- 基本面/估值若为空或覆盖不足，不能作为强买入依据。',
    '- 放量、资金持续性和盘中成交质量需要后续刷新或下一轮信号检查确认。',
    ...(errorResults.length ? ['', '### 已暴露的工具错误', '', ...errorResults.map((item) => `- ${item}`)] : []),
    `analysisEvidence:${JSON.stringify(stockWatchAnalysisEvidence({
      symbol,
      name,
      selected,
      entry,
      stopLoss,
      targetPrice,
      targetEntryPrice,
      quoteSummary,
      klineSummary,
      signalSummary,
      monitorCount: monitorCalls.length,
      errorResults,
    }))}`,
    '',
    '以上内容仅供研究和观察，不构成投资建议。市场有风险，投资需谨慎。',
  ].join('\n')
}

function isMonitorCreateNextAction(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.tool === 'MonitorCreate'
}

function stockWatchAnalysisEvidence(input: {
  symbol: string
  name: string
  selected: Record<string, unknown>
  entry: unknown
  stopLoss: unknown
  targetPrice: unknown
  targetEntryPrice: unknown
  quoteSummary: string | null
  klineSummary: string | null
  signalSummary: string | null
  monitorCount: number
  errorResults: string[]
}) {
  const hasQuote = Boolean(input.quoteSummary)
  const hasKline = Boolean(input.klineSummary)
  const hasSignal = Boolean(input.signalSummary)
  const coverageStatus = hasQuote && (hasKline || hasSignal)
    ? 'sufficient_for_analysis'
    : 'partial'
  return createAnalysisEvidencePackage({
    kind: 'stock_analysis',
    subject: {
      type: 'stock',
      id: input.symbol,
      name: input.name,
    },
    observedFacts: [
      `entryCondition=${String(input.entry)}`,
      `targetEntryPrice=${String(input.targetEntryPrice)}`,
      `stopLoss=${String(input.stopLoss)}`,
      `targetPrice=${String(input.targetPrice)}`,
      `watchlistItem=${JSON.stringify(input.selected)}`,
      `monitorCount=${input.monitorCount}`,
      `quoteSummary=${input.quoteSummary ? compactText(input.quoteSummary, 180) : '-'}`,
      `klineSummary=${input.klineSummary ? compactText(input.klineSummary, 180) : '-'}`,
      `signalSummary=${input.signalSummary ? compactText(input.signalSummary, 180) : '-'}`,
    ],
    interpretations: [
      'Stock watchlist add is observation and trigger-preparation evidence only.',
      'Buy/sell, position sizing, and monitor execution require separate validated strategy or trade-prep contracts.',
    ],
    missingEvidence: [
      ...(hasQuote ? [] : ['missing:stock_quote']),
      ...(hasKline ? [] : ['missing:stock_kline']),
      ...(hasSignal ? [] : ['missing:technical_signal']),
      'missing:position_sizing_before_trade',
      'trade_boundary:no_xueqiu_or_portfolio_mutation',
      ...input.errorResults.map((item) => `workflow_error:${compactText(item, 120)}`),
    ],
    confidence: coverageStatus === 'sufficient_for_analysis' ? 'medium' : 'low',
    strategyReadiness: 'analysis_only',
    sourceCoverage: {
      sources: [
        ...(hasQuote ? ['quote readback'] : []),
        ...(hasKline ? ['kline readback'] : []),
        ...(hasSignal ? ['technical signal'] : []),
        'watchlist',
      ],
      interfaceId: hasKline ? 'stock.daily_kline' : 'stock.quote',
      canonicalSchema: hasKline ? 'kline_daily' : 'quote_snapshot',
      canonicalTable: hasKline ? 'kline_daily' : 'quote_snapshot',
      readbackAction: hasKline ? 'query_kline' : 'query_quote',
      coverageStatus,
    },
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

function latestToolResultSummary(
  toolCalls: ToolUse[],
  resultByToolUseId: Map<string, string>,
  predicate: (call: ToolUse) => boolean,
): string | null {
  const call = [...toolCalls].reverse().find((item) => predicate(item) && resultByToolUseId.has(item.id))
  if (!call) return null
  const value = resultByToolUseId.get(call.id) ?? ''
  return summarizePlainEvidence(value) ?? compactText(value, 360)
}

function callResultMentionsSymbol(value: string, symbol: string): boolean {
  return Boolean(symbol) && value.includes(symbol)
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function compactText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}

function meaningfulNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function inferSymbolNameFromEvidence(symbol: string, resultByToolUseId: Map<string, string>): string | null {
  for (const value of resultByToolUseId.values()) {
    const parsedName = extractQuoteNameForCode(value, symbol)
    if (parsedName && !isBadInferredSymbolName(parsedName)) return parsedName
  }
  return null
}

function isBadInferredSymbolName(value: string): boolean {
  return /^(PE|PB|ROE|O|C|H|L|V|daily|quote|fundamentals|DataStore|query|code|symbol)$/i.test(value) ||
    /^\d/.test(value) ||
    value.length > 16
}

function summarizePlainEvidence(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? compactText(text, 320) : null
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
  if (start < 0) return value.includes(code) ? value : null
  const section: string[] = []
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]
    if (index > start && /^\d{6}\s+/.test(line) && !line.startsWith(`${code} `)) break
    section.push(line)
  }
  return section.join('\n')
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
  if (direct?.[1] && !isBadInferredSymbolName(direct[1])) return direct[1]
  const fetched = value.match(/Fetched\s+\d+\s+rows\s+for\s+\d{6}\s+([^\s,，;；]+)/i)
  if (fetched?.[1] && !isBadInferredSymbolName(fetched[1])) return fetched[1]
  return null
}
