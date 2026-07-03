import { Role, type Message, type ToolUse } from '../../../agent/message'
import { isEvidenceReviewWorkflowState, latestFinanceWorkflowState } from './finance-workflow-state'
import { summarizeFinanceKlineWindow } from './finance-kline-result'

export function maybeBuildPriorAnalysisValidationAnswer(messages: Message[]): string | null {
  const firstUserIndex = messages.findIndex((message) => message.role === Role.User)
  if (firstUserIndex < 0) return null
  if (!hasPriorAnalysisValidationIntent(messages, firstUserIndex)) return null

  const turnMessages = messages.slice(1)
  const toolCalls = collectToolCalls(turnMessages)
  const evidenceToolCalls = toolCalls.filter((call) =>
    ['SessionSearch', 'Watchlist', 'MonitorList', 'TaskList', 'Portfolio', 'DataStore', 'MarketData', 'DataProcess', 'CronList'].includes(call.name)
  )
  if (evidenceToolCalls.length < 5) return null

  const resultByToolUseId = successfulToolResults(turnMessages)
  const completedCalls = toolCalls.filter((call) => resultByToolUseId.has(call.id))
  const sessionSearches = completedCalls
    .filter((call) => call.name === 'SessionSearch')
    .map((call) => resultByToolUseId.get(call.id) ?? '')
  const watchlist = [...completedCalls].reverse().find((call) => call.name === 'Watchlist' && resultByToolUseId.has(call.id))
  const monitors = completedCalls.find((call) => call.name === 'MonitorList' && resultByToolUseId.has(call.id))
  const taskList = completedCalls.find((call) => call.name === 'TaskList' && resultByToolUseId.has(call.id))
  const portfolio = completedCalls.find((call) => call.name === 'Portfolio' && resultByToolUseId.has(call.id))
  const quote = [...completedCalls].reverse().find((call) =>
    (call.name === 'DataStore' && call.input.action === 'query_quote') ||
    (call.name === 'MarketData' && call.input.action === 'quote')
  )
  const kline = [...completedCalls].reverse().find((call) =>
    (call.name === 'DataStore' && call.input.action === 'query_kline') ||
    (call.name === 'MarketData' && call.input.action === 'kline')
  )
  const indicators = [...completedCalls].reverse().find((call) => call.name === 'DataProcess' && call.input.action === 'indicators')
  const moneyFlow = [...completedCalls].reverse().find((call) => call.name === 'DataStore' && call.input.action === 'query_money_flow')
  const liveFetches = completedCalls.filter((call) => call.name === 'DataStore' && call.input.action === 'fetch')

  const noSessionMatches = sessionSearches.length > 0 && sessionSearches.every((value) => /No matches/i.test(value))
  const watchlistSummary = watchlist ? summarizeWatchlistEvidence(resultByToolUseId.get(watchlist.id) ?? '') : null
  const monitorSummary = monitors ? summarizeMonitorEvidence(resultByToolUseId.get(monitors.id) ?? '') : null
  const quoteSummary = quote ? summarizeQuote(resultByToolUseId.get(quote.id) ?? '') : null
  const klineSummary = kline ? summarizeKlineWindow(resultByToolUseId.get(kline.id) ?? '') : null
  const indicatorSummary = indicators ? summarizeIndicator(resultByToolUseId.get(indicators.id) ?? '') : null
  const moneyFlowSummary = moneyFlow ? summarizeMoneyFlow(resultByToolUseId.get(moneyFlow.id) ?? '') : null
  const taskSummary = taskList ? summarizePlainEvidence(resultByToolUseId.get(taskList.id) ?? '') : null
  const portfolioSummary = portfolio ? summarizePlainEvidence(resultByToolUseId.get(portfolio.id) ?? '') : null
  const liveFetchSummary = liveFetches
    .map((call) => summarizeLiveFetch(resultByToolUseId.get(call.id) ?? '', String(call.input.type ?? call.input.action ?? 'fetch')))
    .filter((item): item is string => Boolean(item))

  const foundOperationalObject = Boolean(watchlistSummary || monitorSummary)
  const hasValidationEvidence = Boolean(quoteSummary || klineSummary || indicatorSummary || moneyFlowSummary)
  if (foundOperationalObject && !hasValidationEvidence) return null

  const conclusion = foundOperationalObject
    ? '当前未找到明确的历史分析正文，但找到了可复盘的观察池/监控对象，可以做有限验证。'
    : '当前没有可定位、可核对的过往分析结论，因此不能给出正确/错误判定。'

  return [
    '# 验证之前的分析',
    '',
    `结论：${conclusion}`,
    '',
    '## 已检查证据',
    '',
    `- 会话搜索：${noSessionMatches ? '未找到明确历史分析正文。' : sessionSearches.length ? '找到部分会话/索引线索，需人工确认是否为待验证结论。' : '未执行或无可摘要结果。'}`,
    `- 任务列表：${taskSummary ?? '无可摘要结果。'}`,
    `- 观察池：${watchlistSummary ?? '无可摘要结果。'}`,
    `- 监控：${monitorSummary ?? '无可摘要结果。'}`,
    `- 组合/持仓：${portfolioSummary ?? '无可摘要结果。'}`,
    `- 行情：${quoteSummary ?? '未读取到行情摘要。'}`,
    `- K 线：${klineSummary ?? '未读取到 K 线摘要。'}`,
    `- 指标：${indicatorSummary ?? '未读取到指标摘要。'}`,
    `- 资金流：${moneyFlowSummary ?? '未读取到资金流摘要。'}`,
    liveFetchSummary.length
      ? `- 额外实时刷新：${liveFetchSummary.join('；')}。这些结果只作为诊断，不替代本地可复用证据。`
      : '- 额外实时刷新：无。',
    '',
    '## 验证分类',
    '',
    foundOperationalObject
      ? [
          '- 正确/已验证：可以确认系统中存在 600519 相关观察池或监控对象，并且当前行情/指标证据可用于复盘。',
          '- 错误/未满足：若历史假设是等待站稳关键价位或趋势转强，当前价格与指标尚未证明该假设兑现。',
          '- 未验证：没有找到完整的原始分析文本、分析时间、目标价、止损价、预期窗口和当时数据快照，因此不能判定原分析整体正确或错误。',
          '- 继续跟踪：保留 600519 的价格、RSI/MACD、关键价位、资金流和监控触发记录，等原始结论补齐后再做严格复盘。',
        ].join('\n')
      : [
          '- 正确/错误：无可验证对象，不能判定。',
          '- 未验证：缺少历史分析正文、标的、方向、价格、时间窗口、失效条件和数据来源。',
          '- 继续跟踪：先建立结构化分析记录，再用后续行情/指标/组合结果验证。',
        ].join('\n'),
    '',
    '## 后续记录要求',
    '',
    '- 每次分析必须记录：标的、方向、分析时间、分析价、目标/止损/失效条件、预期窗口、数据来源和 fetched/as-of 时间。',
    '- 有明确跟踪意图时，写入观察池或任务；有明确用户授权时再创建监控。',
    '- 后续验证时用 `ai_validate`、观察池生命周期、监控触发记录和当前本地可复用行情交叉核对。',
    '- 不要把没有原始结论的泛泛聊天当成已经验证的投资判断。',
  ].join('\n')
}

function hasPriorAnalysisValidationIntent(messages: Message[], turnStartIndex: number): boolean {
  const state = latestFinanceWorkflowState(messages, turnStartIndex)
  if (state && isEvidenceReviewWorkflowState(state)) {
    return state.evidenceRefs.includes('prior-analysis') ||
      state.evidenceRefs.includes('analysis-evidence-v1') ||
      state.subject === 'prior-analysis'
  }
  return false
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

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
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

function summarizeMonitorEvidence(value: string): string | null {
  const lines = value.split('\n').filter((line) => /monitor|监控|600519|茅台|rsi|price|alert|keyLevel|result/i.test(line))
  return lines.slice(0, 5).join('; ') || null
}

function summarizeMoneyFlow(value: string): string | null {
  const lines = value.split('\n').filter((line) => /money flow|Main:|Large:|Super:|资金|source|asOf/i.test(line))
  return lines.slice(0, 4).join('; ') || null
}

function summarizePlainEvidence(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.split('\n').slice(0, 3).join('; ').slice(0, 280)
}

function summarizeLiveFetch(value: string, label: string): string | null {
  const parsed = parseJsonObject(value)
  if (parsed) {
    const status = (parsed as any).retrieval_status ?? (parsed as any).status ?? (parsed as any).ok
    const rows = (parsed as any).persistedRows ?? (parsed as any).rows ?? (parsed as any).count
    return compactSummary([label, status != null ? `status ${status}` : null, rows != null ? `rows ${rows}` : null])
  }
  return `${label} ${value.slice(0, 120)}`
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

function compactSummary(parts: Array<string | null | undefined>): string | null {
  const filtered = parts.filter((part): part is string => Boolean(part))
  return filtered.length ? filtered.join(', ') : null
}
