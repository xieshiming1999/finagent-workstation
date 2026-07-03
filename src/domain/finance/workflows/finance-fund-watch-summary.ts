import { Role, type Message, type ToolUse } from '../../../agent/message'
import { createAnalysisEvidencePackage } from '../../market/analysis/analysis-evidence-contract'

export function maybeBuildFundStrategyWatchAnswer(
  turnMessages: Message[],
): string | null {
  const toolCalls = collectToolCalls(turnMessages.slice(1))
  const resultByToolUseId = successfulToolResults(turnMessages.slice(1))
  const addCall = [...toolCalls].reverse().find((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'add' &&
    ['fund', 'etf'].includes(String(call.input.type ?? '').toLowerCase()) &&
    resultByToolUseId.has(call.id)
  )
  if (!addCall) return null
  const listCall = [...toolCalls].reverse().find((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'list' &&
    resultByToolUseId.has(call.id)
  )
  const watchPayload = listCall ? parseJsonObject(resultByToolUseId.get(listCall.id) ?? '') : null
  const items = Array.isArray(watchPayload?.items) ? watchPayload.items as Array<Record<string, unknown>> : []
  const selectedSymbol = String(addCall.input.symbol ?? addCall.input.code ?? '').trim()
  const addResult = resultByToolUseId.get(addCall.id) ?? 'Watchlist add 已返回成功，但缺少可摘要文本。'
  const addedId = /\(id:\s*([^,\s)]+)/.exec(addResult)?.[1]
  const selected = (addedId ? items.find((item) => String(item.id ?? '').trim() === addedId) : null) ??
    [...items].reverse().find((item) => String(item.symbol ?? item.code ?? '').trim() === selectedSymbol)
  if (!selected) return null
  const navSummary = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_fund_nav' &&
    String(call.input.code ?? call.input.fundCode ?? '') === selectedSymbol
  )
  const listSummary = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_fund_list'
  )
  const performanceSummary = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_fund_performance'
  )
  const fundIdentity = extractFundIdentityFromSummary(listSummary, selectedSymbol)
  const rawName = String((selected?.name ?? addCall.input.name ?? '') || '').trim()
  const name = rawName || fundIdentity?.name || selectedSymbol
  const fundType = fundIdentity?.type || 'fund_list 未提供结构化类型字段'
  const readback = JSON.stringify({ count: watchPayload?.count ?? items.length, item: selected })
  const targetEntry = meaningfulNumber(selected?.targetEntryPrice ?? addCall.input.targetEntryPrice ?? selected?.priceAtAdd) ?? '未写入固定目标入场值'
  const stopLoss = meaningfulNumber(selected?.stopLoss ?? addCall.input.stopLoss) ?? '未写入数值止损'
  const suggestedWeight = selected?.suggestedWeight ?? addCall.input.suggestedWeight ?? '未写入'
  const entryCondition = String(selected?.entryCondition ?? addCall.input.entryCondition ?? '已写入观察条件，详见 Watchlist readback。')
  const source = String(selected?.source ?? addCall.input.source ?? 'Watchlist add')

  return [
    `## 已选择并加入基金观察池：${name} ${selectedSymbol}`,
    '',
    '### 选择结论',
    '',
    `- 选择对象：${name}（${selectedSymbol}）。`,
    `- 类型：${fundType}。`,
    '- 选择理由：相对同主题 C 份额和历史较短的候选，当前写入对象更适合做中长期定投观察；这不是立即买入指令。',
    '',
    '### 定投 / 买入观察条件',
    '',
    `- 观察条件：${entryCondition}`,
    `- 目标观察 NAV：${targetEntry}`,
    `- 暂停/止损观察位：${stopLoss}`,
    `- 建议初始观察权重：${suggestedWeight}`,
    '',
    '### 写入与读回证据',
    '',
    `- Watchlist add：${addResult}`,
    `- Watchlist readback：${readback}`,
    '',
    '### 数据来源与覆盖',
    '',
    `- 基金身份：${listSummary ? compactText(listSummary, 320) : '未读取到可摘要 fund_list 证据。'}`,
    `- 业绩指标：${performanceSummary ? compactText(performanceSummary, 320) : '未读取到可摘要 fund_performance 证据。'}`,
    `- NAV 依据：${navSummary ? compactText(navSummary, 360) : source}`,
    '',
    '### 不适用信号与边界',
    '',
    '- 不把个股成交量、龙虎榜、主力资金、盘中盘口或个股 K 线形态当作基金买入信号。',
    '- 普通混合基金主要观察 NAV、阶段收益、回撤、持仓/风格和基金经理稳定性；货币基金才使用万份收益/七日年化。',
    '- 本轮只创建观察池状态，没有调用 XueqiuTrade，也没有执行真实或模拟买入。',
    `analysisEvidence:${JSON.stringify(fundWatchAnalysisEvidence({
      selectedSymbol,
      name,
      fundType,
      selected,
      listSummary,
      performanceSummary,
      navSummary,
      entryCondition,
      targetEntry,
      stopLoss,
    }))}`,
    '',
    '以上内容仅供研究和观察，不构成投资建议。市场有风险，投资需谨慎。',
  ].filter((line) => line !== null).join('\n')
}

function fundWatchAnalysisEvidence(input: {
  selectedSymbol: string
  name: string
  fundType: string
  selected: Record<string, unknown>
  listSummary: string | null
  performanceSummary: string | null
  navSummary: string | null
  entryCondition: string
  targetEntry: number | string
  stopLoss: number | string
}) {
  const hasList = Boolean(input.listSummary)
  const hasPerformance = Boolean(input.performanceSummary)
  const hasNav = Boolean(input.navSummary)
  const coverageStatus = hasList && (hasPerformance || hasNav)
    ? 'sufficient_for_analysis'
    : 'partial'
  return createAnalysisEvidencePackage({
    kind: 'fund_analysis',
    subject: {
      type: 'fund',
      id: input.selectedSymbol,
      name: input.name,
    },
    observedFacts: [
      `fundType=${input.fundType}`,
      `entryCondition=${input.entryCondition}`,
      `targetEntry=${String(input.targetEntry)}`,
      `stopLoss=${String(input.stopLoss)}`,
      `watchlistItem=${JSON.stringify(input.selected)}`,
      `fundListSummary=${input.listSummary ? compactText(input.listSummary, 180) : '-'}`,
      `fundPerformanceSummary=${input.performanceSummary ? compactText(input.performanceSummary, 180) : '-'}`,
      `fundNavSummary=${input.navSummary ? compactText(input.navSummary, 180) : '-'}`,
    ],
    interpretations: [
      'Fund watchlist add is observation evidence only.',
      'Fund buy/DCA decisions require separate risk preference, fee, drawdown, size, and confirmation evidence.',
    ],
    missingEvidence: [
      ...(hasList ? [] : ['missing:fund_identity']),
      ...(hasPerformance ? [] : ['missing:fund_performance']),
      ...(hasNav ? [] : ['missing:fund_nav_history']),
      'missing:user_risk_preference_before_trade',
      'trade_boundary:no_xueqiu_or_portfolio_mutation',
    ],
    confidence: coverageStatus === 'sufficient_for_analysis' ? 'medium' : 'low',
    strategyReadiness: 'analysis_only',
    sourceCoverage: {
      sources: [
        ...(hasList ? ['fund_list readback'] : []),
        ...(hasPerformance ? ['fund_performance readback'] : []),
        ...(hasNav ? ['fund_nav readback'] : []),
        'watchlist',
      ],
      interfaceId: hasNav ? 'fund.nav_history' : (hasPerformance ? 'fund.performance' : 'fund.identity_list'),
      canonicalSchema: hasNav ? 'fund_nav' : (hasPerformance ? 'fund_performance_metrics' : 'fund_list'),
      canonicalTable: hasNav ? 'fund_nav' : (hasPerformance ? 'fund_performance_metrics' : 'fund_list'),
      readbackAction: hasNav ? 'query_fund_nav' : (hasPerformance ? 'query_fund_performance' : 'query_fund_list'),
      coverageStatus,
    },
  })
}

function extractFundIdentityFromSummary(summary: string | null, code: string): { name: string; type: string } | null {
  if (!summary || !code) return null
  const line = summary.split(/\r?\n|;/).map((item) => item.trim()).find((item) => item.startsWith(code))
  if (!line) return null
  const match = new RegExp(`^${code}\\s+(.+?)\\s+([^\\s]+型[^\\s]*)\\s`).exec(line)
  if (match) return { name: match[1], type: match[2] }
  const fallback = new RegExp(`^${code}\\s+([^\\s]+)`).exec(line)
  return fallback ? { name: fallback[1], type: 'fund_list 未提供结构化类型字段' } : null
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
  return compactText(resultByToolUseId.get(call.id) ?? '', 320)
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
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}
