import { Role, type Message } from '../../../agent/message'
import { createStrategyReviewContract } from '../../market/strategy-spec/strategy-review-contract'

export function maybeBuildPortfolioMonitorReviewSummary(messages: Message[]): string | null {
  const event = latestPortfolioMonitorEvent(messages)
  if (!event) return null

  const confirmation = latestAskUserQuestionAnswer(messages)
  if (!confirmation && !hasAnyToolCall(messages)) return null

  const strategyId = stringValue(event.strategyId, '-')
  const signal = stringValue(event.signal ?? event.status ?? event.state, 'review')
  const portfolioEvidence = recordValue(event.portfolioEvidence)
  const rebalanceDraft = recordValue(event.rebalanceDraft)
  const positions = positionsValue(rebalanceDraft)
  const selectedSymbols = selectedSymbolsValue(portfolioEvidence, rebalanceDraft)

  return [
    `组合再平衡监控已触发：strategyId=${strategyId}；signal=${signal}。`,
    '',
    '## 组合排序证据',
    '',
    '- 监控模板：portfolio_rebalance_monitor。',
    `- 入选标的：${selectedSymbols.length > 0 ? selectedSymbols.join('、') : '-'}。`,
    `- 组合证据：${describePortfolioEvidence(portfolioEvidence)}`,
    `- 再平衡草案：${describeRebalanceDraft(rebalanceDraft)}`,
    ...(positions.length > 0 ? [
      '',
      '## 目标权重草案',
      '',
      ...positions.slice(0, 5).map(positionLine),
    ] : []),
    '',
    '## 边界',
    '',
    '- 本轮只复核 StrategySpec ranking evidence 与 rebalanceDraft，不自动调仓。',
    '- 不写入 Portfolio 交易，不调用 XueqiuTrade(buy/sell/transfer)。',
    '- 若后续准备执行模拟盘调仓，必须重新确认组合、权重、价格、金额、费用和风险边界。',
    `- 用户确认结果：${confirmation ?? '未确认；保持观察。'}`,
    `strategyReview:${JSON.stringify(createStrategyReviewContract({
      reviewKind: 'portfolio_rebalance_monitor',
      strategyId,
      signal,
      subjects: selectedSymbols,
      evidence: portfolioEvidence ?? {},
      draft: rebalanceDraft ?? {},
      boundaries: [
        'review_only',
        'no_portfolio_mutation',
        'no_xueqiu_trade',
        'requires_explicit_confirmation_before_execution',
      ],
      ...(confirmation ? { confirmation } : {}),
    }))}`,
  ].join('\n')
}

function latestPortfolioMonitorEvent(messages: Message[]): Record<string, unknown> | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.User) continue
    const marker = 'data:'
    const index = message.content.lastIndexOf(marker)
    if (index < 0) continue
    const payload = decodeRecord(message.content.slice(index + marker.length))
    if (!payload || payload.template !== 'portfolio_rebalance_monitor') continue
    return payload
  }
  return null
}

function latestAskUserQuestionAnswer(messages: Message[]): string | null {
  const askIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== Role.Assistant) continue
    for (const call of message.toolUses ?? []) {
      if (call.name === 'AskUserQuestion') askIds.add(call.id)
    }
  }
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.Tool || !message.toolResult || message.toolResult.isError) continue
    if (!askIds.has(message.toolResult.toolUseId)) continue
    const payload = decodeRecord(message.toolResult.content)
    return payload
      ? stringValue(payload.answer ?? payload.selected ?? payload.choice ?? payload.response, message.toolResult.content.trim())
      : message.toolResult.content.trim()
  }
  return null
}

function hasAnyToolCall(messages: Message[]): boolean {
  return messages.some((message) => message.role === Role.Assistant && (message.toolUses?.length ?? 0) > 0)
}

function decodeRecord(content: string): Record<string, unknown> | null {
  const text = content.trim()
  if (!text.startsWith('{')) return null
  try {
    const decoded = JSON.parse(text)
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positionsValue(draft: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(draft?.positions)
    ? draft.positions.filter((item): item is Record<string, unknown> => !!recordValue(item))
    : []
}

function selectedSymbolsValue(
  evidence: Record<string, unknown> | null,
  draft: Record<string, unknown> | null,
): string[] {
  const values = [
    evidence?.selectedSymbols,
    recordValue(evidence?.aggregateMetrics)?.selectedSymbols,
    recordValue(evidence?.portfolioBacktestEvidence)?.selectedSymbols,
    draft?.selectedSymbols,
    recordValue(draft?.aggregateMetrics)?.selectedSymbols,
    recordValue(draft?.portfolioBacktestEvidence)?.selectedSymbols,
  ]
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const symbols = value.map((item) => String(item).trim()).filter(Boolean)
    if (symbols.length > 0) return symbols
  }
  return positionsValue(draft)
    .map((row) => stringValue(row.symbol ?? row.code, ''))
    .filter(Boolean)
}

function describePortfolioEvidence(evidence: Record<string, unknown> | null): string {
  if (!evidence) return '-'
  const aggregate = recordValue(evidence.aggregateMetrics)
  const risk = recordValue(evidence.portfolioBacktestEvidence) ?? recordValue(evidence.portfolioRiskEvidence)
  const parts = [
    `mode=${stringValue(evidence.mode, '-')}`,
    `selected=${stringValue(evidence.selectedCount, '-')}`,
  ]
  if (aggregate) {
    parts.push(`expectedReturn=${stringValue(aggregate.expectedReturnPct, '-')}%`)
    parts.push(`portfolioMaxDrawdown=${stringValue(aggregate.portfolioMaxDrawdownPct, '-')}%`)
  }
  if (risk) {
    parts.push(`bars=${stringValue(risk.bars, '-')}`)
    parts.push(`return=${stringValue(risk.portfolioReturnPct, '-')}%`)
  }
  return parts.join('；')
}

function describeRebalanceDraft(draft: Record<string, unknown> | null): string {
  if (!draft) return '-'
  return [
    `mode=${stringValue(draft.mode, '-')}`,
    `rebalanceInterval=${stringValue(draft.rebalanceInterval, '-')}`,
    `maxPositionWeight=${stringValue(draft.maxPositionWeight, '-')}`,
    `tradeBoundary=${stringValue(draft.tradeBoundary, '-')}`,
  ].join('；')
}

function positionLine(position: Record<string, unknown>): string {
  const symbol = stringValue(position.symbol ?? position.code, '-')
  const weight = numberValue(position.targetWeight)
  const weightText = Number.isFinite(weight) ? `${(weight * 100).toFixed(1)}%` : '-'
  return `- ${symbol}：targetWeight=${weightText}；weightCapped=${stringValue(position.weightCapped, 'false')}。`
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.NaN
}
