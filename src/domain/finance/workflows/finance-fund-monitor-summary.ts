import { Role, type Message } from '../../../agent/message'
import { createAnalysisEvidencePackage } from '../../market/analysis/analysis-evidence-contract'

export function maybeBuildFundMonitorReviewSummary(messages: Message[]): string | null {
  const event = latestFundMonitorEvent(messages)
  if (!event) return null

  const confirmation = latestAskUserQuestionAnswer(messages)
  if (!confirmation && !hasAnyToolCall(messages)) return null

  const strategyId = stringValue(event.strategyId, '-')
  const code = stringValue(event.code ?? event.fundCode ?? event.symbol, '-')
  const signal = stringValue(event.signal ?? event.status ?? event.state, 'review')
  const value = numberValue(event.value ?? event.nav)
  const monitorDraft = recordValue(event.monitorDraft)
  const dcaObservation = recordValue(event.dcaObservation)

  return [
    `基金观察监控已触发：strategyId=${strategyId}；fund=${code}；signal=${signal}。`,
    '',
    '## 基金观察证据',
    '',
    `- 监控模板：fund_rule_monitor；最新净值/观测值：${formatNumber(value)}。`,
    `- 观察规则：${describeRecord(monitorDraft)}`,
    `- 定投观察：${describeRecord(dcaObservation)}`,
    '',
    '## 边界',
    '',
    '- 本轮只进入基金观察复核，不申购、不赎回、不写入雪球模拟盘或 Portfolio 交易。',
    '- 基金策略应继续使用 NAV/yield、回撤、波动、定投节奏等基金数据合同，不使用股票 K 线信号。',
    `- 用户确认结果：${confirmation ?? '未确认；保持观察。'}`,
    `analysisEvidence:${JSON.stringify(fundMonitorAnalysisEvidence({
      strategyId,
      code,
      signal,
      value,
      monitorDraft,
      dcaObservation,
      confirmation,
    }))}`,
  ].join('\n')
}

function fundMonitorAnalysisEvidence(input: {
  strategyId: string
  code: string
  signal: string
  value: number
  monitorDraft: Record<string, unknown> | null
  dcaObservation: Record<string, unknown> | null
  confirmation: string | null
}) {
  return createAnalysisEvidencePackage({
    kind: 'fund_analysis',
    subject: { type: 'fund', id: input.code, name: input.code },
    observedFacts: [
      `strategyId=${input.strategyId}`,
      `signal=${input.signal}`,
      `observedValue=${formatNumber(input.value)}`,
      `monitorDraft=${describeRecord(input.monitorDraft)}`,
      `dcaObservation=${describeRecord(input.dcaObservation)}`,
      `confirmation=${input.confirmation ?? 'pending'}`,
    ],
    interpretations: [
      'Fund monitor trigger is observation/review evidence only.',
      'Fund strategy review should use fund NAV/yield, drawdown, volatility, and DCA cadence contracts.',
    ],
    missingEvidence: [
      'missing:live_fund_nav_readback_if_not_in_event_payload',
      'missing:fee_size_drawdown_manager_context_before_trade',
      'trade_boundary:no_subscription_redemption_or_simulated_trade',
    ],
    confidence: 'low',
    strategyReadiness: 'analysis_only',
    sourceCoverage: {
      sources: ['fund_rule_monitor event payload'],
      interfaceId: 'fund.monitor_event',
      readbackAction: 'monitor_trigger',
      coverageStatus: 'partial',
    },
  })
}

function latestFundMonitorEvent(messages: Message[]): Record<string, unknown> | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.User) continue
    const marker = 'data:'
    const index = message.content.lastIndexOf(marker)
    if (index < 0) continue
    const payload = decodeRecord(message.content.slice(index + marker.length))
    if (!payload || payload.template !== 'fund_rule_monitor') continue
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

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.NaN
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '-'
}

function describeRecord(value: Record<string, unknown> | null): string {
  if (!value) return '-'
  const entries = Object.entries(value)
    .filter(([, item]) => typeof item !== 'object')
    .slice(0, 6)
    .map(([key, item]) => `${key}=${String(item)}`)
  return entries.length > 0 ? entries.join('；') : JSON.stringify(value)
}
