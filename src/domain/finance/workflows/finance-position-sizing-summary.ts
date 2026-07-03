import { Role, type Message, type ToolUse } from '../../../agent/message'
import { isFinanceEvidenceTool } from './finance-workflow-policy'
import {
  financeWorkflowStateFromUserContent,
  isTradeSizingWorkflowState,
} from './finance-workflow-state'

export function maybeBuildPositionSizingAnswer(messages: Message[]): string | null {
  const userPrompt = messages.find((message) => message.role === Role.User)?.content ?? ''
  const workflowState = financeWorkflowStateFromUserContent(userPrompt)
  if (!isTradeSizingWorkflowState(workflowState)) return null

  const turnMessages = messages.slice(1)
  const toolCalls = collectToolCalls(turnMessages)
  const financeToolCalls = toolCalls.filter((call) => isFinanceEvidenceTool(call.name))
  if (financeToolCalls.length < 6) return null

  const resultByToolUseId = successfulToolResults(turnMessages)
  const latestQuote = [...toolCalls].reverse().find((call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_quote' &&
    resultByToolUseId.has(call.id)
  )
  const latestKline = [...toolCalls].reverse().find((call) =>
    ((call.name === 'DataStore' && call.input.action === 'query_kline') ||
      (call.name === 'MarketData' && call.input.action === 'kline')) &&
    resultByToolUseId.has(call.id)
  )
  const latestFundamental = [...toolCalls].reverse().find((call) =>
    call.name === 'DataStore' &&
    ['query_fundamental', 'query_stock_daily_valuation'].includes(String(call.input.action)) &&
    resultByToolUseId.has(call.id)
  )
  const latestIndicators = [...toolCalls].reverse().find((call) =>
    call.name === 'DataProcess' &&
    call.input.action === 'indicators' &&
    resultByToolUseId.has(call.id)
  )
  const latestSupport = [...toolCalls].reverse().find((call) =>
    call.name === 'DataProcess' &&
    call.input.action === 'support_summary' &&
    resultByToolUseId.has(call.id)
  )

  if (!latestQuote || (!latestKline && !latestIndicators && !latestSupport)) return null

  const quoteSummary = summarizeQuote(resultByToolUseId.get(latestQuote.id) ?? '')
  const klineWindow = latestKline ? summarizeKlineWindow(resultByToolUseId.get(latestKline.id) ?? '') : null
  const fundamentalSummary = latestFundamental ? summarizeFundamental(resultByToolUseId.get(latestFundamental.id) ?? '') : null
  const indicatorSummary = latestIndicators ? summarizeIndicator(resultByToolUseId.get(latestIndicators.id) ?? '') : null
  const supportSummary = latestSupport ? summarizeSupport(resultByToolUseId.get(latestSupport.id) ?? '') : null
  const subject = normalizeCode(workflowState?.subject) ?? '-'

  return [
    '## 仓位决策结论',
    '',
    `对象：${subject}。本次只给出风险仓位框架，不创建真实交易、券商委托、模拟盘交易或观察池变更。`,
    '',
    '### 已使用证据',
    '',
    `- 行情：${quoteSummary ?? '已读取本地/可复用行情，但未能提取稳定摘要。'}`,
    `- K 线/波动：${klineWindow ?? '未读取到可摘要的 K 线窗口；以技术风险工具结果为辅助。'}`,
    `- 技术指标：${indicatorSummary ?? '未读取到可摘要的指标结果。'}`,
    `- 支撑/风险位：${supportSummary ?? '未读取到可摘要的支撑位结果。'}`,
    `- 基本面/估值：${fundamentalSummary ?? '未读取到可摘要的估值或基本面字段。'}`,
    '',
    '### 仓位框架',
    '',
    '- 现在不能直接给出精确股数或金额，因为缺少账户总资金、已有持仓、单笔最大可承受亏损和止损价。',
    '- 先确定账户风险预算，例如每笔最多亏损账户权益的 0.5% 到 1%。',
    '- 再确定止损价或失效条件，计算每股风险 = 计划买入价 - 止损价。',
    '- 可买股数 = floor(账户权益 * 单笔风险比例 / 每股风险)，仓位比例 = 可买股数 * 计划买入价 / 账户权益。',
    '',
    '### 需要用户补充',
    '',
    '- 账户总资金或可用于本策略的资金上限。',
    `- 当前是否已经持有 ${subject}，以及持仓成本和数量。`,
    '- 本次交易最大可承受亏损金额或比例。',
    '- 明确止损价、技术失效位，或希望采用的止损规则。',
    '',
    '在这些输入补齐前，合理动作是保持观察或只讨论风险框架，不应输出确定买入股数、确定买入金额或下单动作。',
  ].join('\n')
}

function normalizeCode(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/^(\d{6})(?:\.(?:SH|SZ))?$/i)
  return match?.[1] ?? null
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

function summarizeKlineWindow(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (!parsed) return null
  const rows = recordRows(parsed)
  const dated = rows.filter((row) => scalar(row.date ?? row.tradeDate ?? row.trade_date))
  if (dated.length === 0) return null
  const first = scalar(dated[0].date ?? dated[0].tradeDate ?? dated[0].trade_date)
  const last = scalar(dated[dated.length - 1].date ?? dated[dated.length - 1].tradeDate ?? dated[dated.length - 1].trade_date)
  const source = scalar(parsed.source ?? parsed.provider ?? dated[dated.length - 1].source)
  return `${first} ~ ${last}, ${dated.length} rows${source ? `, source: ${source}` : ''}`
}

function summarizeIndicator(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (!parsed || parsed.action !== 'indicators') return null
  const latest = recordValue(parsed.latest)
  const indicators = recordValue(parsed.indicators)
  return compactSummary([
    latest ? `latest ${scalar(latest.date) ?? '-'} close ${scalar(latest.close) ?? '-'}` : null,
    indicators?.rsi14 != null ? `RSI(14) ${scalar(indicators.rsi14)}` : null,
    indicators?.atr14 != null ? `ATR(14) ${scalar(indicators.atr14)}` : null,
  ])
}

function summarizeQuote(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const rows = recordRows(parsed)
    const first = rows[0] ?? parsed
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
  return null
}

function summarizeFundamental(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const rows = recordRows(parsed)
    const first = rows[0] ?? parsed
    return compactSummary([
      pickMetric(first, ['pe', 'pe_ttm', 'PE', 'PE_TTM'], 'PE'),
      pickMetric(first, ['pb', 'PB'], 'PB'),
      pickMetric(first, ['roe', 'ROE', 'roe_weighted'], 'ROE'),
      pickMetric(first, ['reportDate', 'report_date', 'asOf', 'as_of', 'date'], 'date'),
      pickMetric(first, ['source', 'provider'], 'source'),
    ])
  }
  return null
}

function summarizeSupport(value: string): string | null {
  const parsed = parseJsonObject(value)
  if (!parsed || !['support', 'support_summary'].includes(String(parsed.action))) return null
  const support = recordValue(parsed.supportResistance) ?? parsed
  const indicators = recordValue(parsed.indicators)
  return compactSummary([
    pickMetric(support, ['support', 'support1', 'nearestSupport'], 'support'),
    pickMetric(support, ['resistance', 'resistance1', 'nearestResistance'], 'resistance'),
    pickMetric(support, ['stop', 'stopLoss', 'stop_loss'], 'stop'),
    indicators ? pickMetric(indicators, ['atr', 'atr14'], 'ATR') : null,
  ])
}

function recordRows(payload: Record<string, unknown>): Record<string, unknown>[] {
  const value = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.data) ? payload.data : []
  return value.filter((row): row is Record<string, unknown> => Boolean(recordValue(row)))
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function pickMetric(row: Record<string, unknown>, keys: string[], label: string): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value == null || value === '') continue
    return `${label} ${value}`
  }
  return null
}

function compactSummary(parts: Array<string | null | undefined>): string | null {
  const values = parts.filter((part): part is string => Boolean(part && part.trim()))
  return values.length ? values.join('; ') : null
}
