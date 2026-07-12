import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from '../../market/analysis/analysis-evidence-contract'

export function maybeBuildFundCandidateDiscoveryAnswer(
  turnMessages: Message[],
): string | null {
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const screenCall = [...toolCalls].reverse().find((call) =>
    call.name === 'DataStore' &&
    call.input.action === 'screen_fund' &&
    resultByToolUseId.has(call.id)
  )
  if (!screenCall) return null
  const screen = parseFundScreenerEvidence(resultByToolUseId.get(screenCall.id) ?? '')
  if (!screen) return null
  if (screen.funds.length < 1) return null
  const candidates = screen.funds.slice(0, 3)

  const navByCode = new Map<string, string>()
  for (const call of toolCalls) {
    if (
      call.name === 'DataStore' &&
      call.input.action === 'query_fund_nav' &&
      resultByToolUseId.has(call.id)
    ) {
      const code = String(call.input.code ?? call.input.fundCode ?? '').trim()
      const summary = structuredResultSummary(resultByToolUseId.get(call.id) ?? '', 220)
      if (code && summary) navByCode.set(code, summary)
    }
  }
  const fundList = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' && call.input.action === 'query_fund_list'
  )
  const performance = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' && call.input.action === 'query_fund_performance'
  )
  const managers = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' && call.input.action === 'query_fund_manager'
  )
  const errors = turnMessages
    .filter((message) => message.role === Role.Tool && message.toolResult?.isError)
    .map((message) => message.toolResult?.content)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)

  return [
    '## 基金关注候选',
    '',
    '本次只给出基金观察候选，没有加入观察池、没有触发交易，也没有把股票技术信号套用到基金上。',
    '',
    ...(candidates.length < 3
      ? [
          `本轮结构化筛选只返回 ${candidates.length} 个可用候选，因此覆盖度偏低；以下结果只能作为有限样本观察，不应视为完整基金池筛选。`,
          '',
        ]
      : []),
    ...candidates.flatMap((fund, index) => {
      const navStatus = navByCode.get(fund.code)
      const fundType = fund.type ?? 'fund_list 未提供结构化类型字段'
      return [
        `${index + 1}. ${fund.name} ${fund.code}`,
        `   - 类型：${fundType}。`,
        `   - 筛选理由：4433/业绩筛选返回前列；NAV ${fund.nav ?? '-'}，近 1 年 ${fund.return1y ?? '-'}，近 3 年 ${fund.return3y ?? '-'}。`,
        `   - 数据状态：${navStatus ?? '本轮未读取到单基金 NAV 明细；以 fund screener 返回的 NAV/收益字段为准。'}`,
      ]
    }),
    '',
    '## 数据来源与覆盖',
    '',
    `- 筛选来源：${screen.sourceSummary}`,
    `- 覆盖：${screen.coverageSummary ?? '未返回覆盖诊断；不能视为全市场全字段覆盖。'}`,
    `- 基金列表读回：${fundList ? compactText(fundList, 320) : '未读取到可摘要 fund_list 证据。'}`,
    `- 业绩指标读回：${performance ? compactText(performance, 320) : '未读取到可摘要 fund_performance 证据。'}`,
    `- 基金经理：${managers ? compactText(managers, 260) : '未读取到可摘要基金经理证据。'}`,
    '',
    '## 结论边界',
    '',
    '- 这些是高波动主题基金/联接基金候选，不是直接买入建议。',
    `- ${fundCategoryBoundary(candidates)}普通开放式基金使用 NAV/阶段收益；货币基金应使用万份收益和七日年化，不能用普通净值逻辑。`,
    '- 后续进入买入或定投前，还需要补充费率、规模、持仓集中度、回撤、基金经理稳定性和个人风险偏好。',
    errors.length
      ? `- 可见失败：${errors.map((item) => compactText(item, 160)).join('；')}。`
      : '- 本轮未记录阻断性工具失败；预算保护后的额外详情请求不应继续扩大。',
    '',
    `analysisEvidence:${JSON.stringify(fundCandidateAnalysisEvidence({
      candidates,
      screen,
      hasFundList: Boolean(fundList),
      hasPerformance: Boolean(performance),
      hasManagers: Boolean(managers),
      hasNav: navByCode.size > 0,
      errorCount: errors.length,
    }))}`,
  ].join('\n')
}

function fundCategoryBoundary(candidates: Array<{ type: string | null }>): string {
  const categories = new Set(candidates.map((fund) => compactText(fund.type ?? '', 60)).filter(Boolean))
  if (categories.size === 0) return '本轮候选未返回结构化基金类别；'
  return `本轮候选结构化类别：${[...categories].join('、')}；`
}

function fundCandidateAnalysisEvidence(input: {
  candidates: Array<{ code: string; name: string; type: string | null; nav: string | null; return1y: string | null; return3y: string | null }>
  screen: NonNullable<ReturnType<typeof parseFundScreenerEvidence>>
  hasFundList: boolean
  hasPerformance: boolean
  hasManagers: boolean
  hasNav: boolean
  errorCount: number
}): AnalysisEvidencePackage {
  const codes = input.candidates.map((fund) => fund.code).filter(Boolean)
  return createAnalysisEvidencePackage({
    kind: 'candidate_research',
    subject: {
      type: 'candidate_set',
      id: codes.join(','),
      name: 'fund candidate set',
    },
    observedFacts: [
      `candidateCount=${input.candidates.length}`,
      ...(codes.length ? [`topCandidates=${codes.join(',')}`] : []),
      `source=${input.screen.sourceSummary}`,
      ...(input.screen.coverageSummary ? [`coverage=${input.screen.coverageSummary}`] : []),
      `errorCount=${input.errorCount}`,
    ],
    interpretations: [
      'fund_candidates:observation_only',
      'candidate_selection:bounded_budget_summary',
      'fund_signals:not_stock_technical_proxy',
      ...(input.hasNav ? ['fund_nav:available'] : []),
      ...(input.hasFundList ? ['fund_list:available'] : []),
      ...(input.hasPerformance ? ['fund_performance:available'] : []),
      ...(input.hasManagers ? ['fund_manager:available'] : []),
    ],
    missingEvidence: [
      ...(input.hasNav ? [] : ['fund_nav_confirmation']),
      'fee_confirmation',
      'fund_size_confirmation',
      'drawdown_confirmation',
      'holding_concentration_confirmation',
      'fund_manager_stability_confirmation',
      'user_risk_preference',
      'strategy_validation',
      ...(input.errorCount > 0 ? ['visible_failures'] : []),
    ],
    confidence: input.candidates.length >= 3 ? 'medium' : 'low',
    strategyReadiness: 'candidate',
    sourceCoverage: {
      sources: [input.screen.provider],
      interfaceId: input.screen.interfaceId,
      capabilityId: input.screen.capabilityId,
      canonicalSchema: input.screen.canonicalSchema,
      canonicalTable: input.screen.canonicalTable,
      readbackAction: 'screen_fund',
      coverageStatus: input.screen.coverageSummary ? 'sufficient_for_analysis' : 'partial',
    },
  })
}

function parseFundScreenerEvidence(value: string): {
  provider: string
  interfaceId: string
  capabilityId: string
  canonicalSchema: string
  canonicalTable: string
  sourceSummary: string
  coverageSummary: string | null
  funds: Array<{ code: string; name: string; type: string | null; nav: string | null; return1y: string | null; return3y: string | null }>
} | null {
  const payload = parseJsonRecord(value)
  if (!payload || payload.action !== 'screen_fund' || !Array.isArray(payload.candidates)) return null
  const funds = payload.candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const code = textField(candidate, 'code')
    const name = textField(candidate, 'name')
    if (!code || !name) return []
    return [{
      code,
      name,
      type: textField(candidate, 'fund_type') ?? textField(candidate, 'type'),
      nav: scalarText(candidate.nav),
      return1y: scalarText(candidate.return_1y),
      return3y: scalarText(candidate.return_3y),
    }]
  })
  const provider = textField(payload, 'provider') ?? 'unknown'
  const interfaceId = textField(payload, 'interfaceId') ?? 'fund.candidate_research'
  const capabilityId = textField(payload, 'capabilityId') ?? 'local.cache'
  const canonicalSchema = textField(payload, 'canonicalSchema') ?? 'fund_performance_metrics'
  const canonicalTable = textField(payload, 'canonicalTable') ?? 'fund_performance_metrics'
  const coverage = isRecord(payload.coverage) ? payload.coverage : null
  return {
    provider,
    interfaceId,
    capabilityId,
    canonicalSchema,
    canonicalTable,
    sourceSummary: `${provider} via ${interfaceId}`,
    coverageSummary: coverage ? JSON.stringify(coverage) : null,
    funds,
  }
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
  return structuredResultSummary(resultByToolUseId.get(call.id) ?? '', 320)
}

function structuredResultSummary(value: string, max: number): string | null {
  const parsed = parseJsonValue(value)
  return parsed === null ? null : compactText(JSON.stringify(parsed), max)
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(value)
  return isRecord(parsed) ? parsed : null
}

function parseJsonValue(value: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' && value[key].trim() ? value[key].trim() : null
}

function scalarText(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function compactText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}
