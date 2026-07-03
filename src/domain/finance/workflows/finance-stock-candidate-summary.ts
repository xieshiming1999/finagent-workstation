import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from '../../market/analysis/analysis-evidence-contract'

export function maybeBuildStockCandidateDiscoveryAnswer(
  turnMessages: Message[],
): string | null {
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const breakoutCall = [...toolCalls].reverse().find((call) =>
    call.name === 'DataProcess' &&
    call.input.action === 'breakout_summary' &&
    resultByToolUseId.has(call.id)
  )
  if (!breakoutCall) return null
  const payload = parseJsonObject(resultByToolUseId.get(breakoutCall.id) ?? '')
  const rows = Array.isArray((payload as any)?.results) ? (payload as any).results as Array<Record<string, unknown>> : []
  const candidates = rows
    .filter((row) => String(row.status ?? 'ok') === 'ok')
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, 3)
  if (candidates.length < 3) return null

  const quoteCalls = toolCalls.filter((call) =>
    call.name === 'DataStore' &&
    call.input.action === 'query_quote' &&
    resultByToolUseId.has(call.id)
  )
  const quoteByCode = new Map<string, string>()
  for (const call of quoteCalls) {
    const code = String(call.input.code ?? call.input.symbol ?? '').trim()
    const summary = summarizeQuote(resultByToolUseId.get(call.id) ?? '')
    if (code && summary) quoteByCode.set(code, summary)
  }
  const sector = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    (call.name === 'DataStore' && call.input.action === 'query_sector_ranking') ||
    (call.name === 'MarketData' && call.input.action === 'sector')
  )
  const flow = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    (call.name === 'DataStore' && call.input.action === 'query_flow_rank') ||
    (call.name === 'MarketData' && call.input.action === 'flow_rank')
  )
  const hot = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    (call.name === 'DataStore' && call.input.action === 'query_hot_rank') ||
    (call.name === 'MarketData' && call.input.action === 'hot_rank')
  )
  const indexQuote = latestToolResultSummary(toolCalls, resultByToolUseId, (call) =>
    call.name === 'DataStore' && call.input.action === 'query_index_quote'
  )
  const errorResults = turnMessages
    .filter((message) => message.role === Role.Tool && message.toolResult?.isError)
    .map((message) => message.toolResult?.content)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)

  return [
    '## 观察候选',
    '',
    '本次只给出观察候选，没有加入观察池、没有创建监控，也没有触发交易。',
    '',
    ...candidates.flatMap((row, index) => {
      const code = String(row.code ?? '-')
      const name = String(row.name ?? code)
      const score = formatNumberValue(Number(row.score ?? 0))
      const decision = String(row.decision ?? 'watch')
      const latestDate = String(row.latestDate ?? '-')
      const price = formatNumberValue(Number(row.quotePrice ?? row.latestClose ?? NaN))
      const changePct = formatPctValue(Number(row.changePct ?? NaN))
      const high20 = formatNumberValue(Number(row.high20 ?? NaN))
      const volumeRatio = formatNumberValue(Number(row.volumeRatio ?? NaN))
      const macdHist = formatNumberValue(Number(row.macdHist ?? NaN))
      const maAligned = row.maAligned === true ? '均线多头排列' : '均线未完全多头排列'
      return [
        `${index + 1}. ${name} ${code}`,
        `   - 结论：${decision}，技术评分 ${score}。`,
        `   - 理由：最新价 ${price}，涨跌幅 ${changePct}，20日高点 ${high20}，成交量比 ${volumeRatio}，MACD 柱 ${macdHist}，${maAligned}。`,
        `   - 数据时间：技术样本最新交易日 ${latestDate}${quoteByCode.get(code) ? `；行情 ${quoteByCode.get(code)}` : '；行情以 breakout_summary 返回 quotePrice 为准'}。`,
      ]
    }),
    '',
    '## 市场证据',
    '',
    `- 指数/市场：${indexQuote ?? '已尝试读取指数证据，但没有可摘要结果。'}`,
    `- 板块：${sector ?? '未读取到可摘要板块证据。'}`,
    `- 资金流：${flow ? compactText(flow, 260) : '未读取到可摘要资金流证据。'}`,
    `- 热度：${hot ? compactText(hot, 220) : '未读取到可摘要热度证据。'}`,
    '',
    '## 覆盖限制',
    '',
    `- 技术验证来自 \`DataProcess(action:"breakout_summary")\`，sourcePolicy: ${String((payload as any)?.sourcePolicy ?? '本地可复用数据优先，必要时走受治理 provider')}。`,
    '- 基本面/估值覆盖有限；本轮没有把缺失的 PE、PB、ROE 或公司基本面字段补写成事实。',
    errorResults.length
      ? `- 可见失败：${errorResults.map((item) => compactText(item, 160)).join('；')}。本回答没有隐藏该失败，候选主要依据资金/热度/板块和技术验证。`
      : '- 本轮未记录阻断性工具失败。',
    '- 这些是观察候选，不是买入建议；进入交易前还需要补齐持仓、风险预算、止损位和更完整基本面证据。',
    '',
    `analysisEvidence:${JSON.stringify(stockCandidateAnalysisEvidence({
      candidates,
      payload,
      hasSector: Boolean(sector),
      hasFlow: Boolean(flow),
      hasHot: Boolean(hot),
      hasIndexQuote: Boolean(indexQuote),
      errorCount: errorResults.length,
    }))}`,
  ].join('\n')
}

function stockCandidateAnalysisEvidence(input: {
  candidates: Array<Record<string, unknown>>
  payload: Record<string, unknown> | null
  hasSector: boolean
  hasFlow: boolean
  hasHot: boolean
  hasIndexQuote: boolean
  errorCount: number
}): AnalysisEvidencePackage {
  const codes = input.candidates
    .map((row) => String(row.code ?? '').trim())
    .filter(Boolean)
  return createAnalysisEvidencePackage({
    kind: 'candidate_research',
    subject: {
      type: 'candidate_set',
      id: codes.join(','),
      name: 'stock candidate set',
    },
    observedFacts: [
      `candidateCount=${input.candidates.length}`,
      ...(codes.length ? [`topCandidates=${codes.join(',')}`] : []),
      `sourceAction=${String(input.payload?.action ?? 'breakout_summary')}`,
      `errorCount=${input.errorCount}`,
    ],
    interpretations: [
      'stock_candidates:observation_only',
      'candidate_selection:bounded_budget_summary',
      ...(input.hasHot ? ['hot_rank:available'] : []),
      ...(input.hasFlow ? ['flow_rank:available'] : []),
      ...(input.hasSector ? ['sector_context:available'] : []),
      ...(input.hasIndexQuote ? ['market_index_context:available'] : []),
    ],
    missingEvidence: [
      'valuation_confirmation',
      'single_stock_money_flow_confirmation',
      'position_size_context',
      'user_selected_candidate',
      'strategy_validation',
      ...(input.errorCount > 0 ? ['visible_failures'] : []),
    ],
    confidence: input.candidates.length >= 3 ? 'medium' : 'low',
    strategyReadiness: 'candidate',
    sourceCoverage: {
      sources: [String(input.payload?.source ?? 'DataProcess breakout_summary')],
      interfaceId: String(input.payload?.interfaceId ?? 'stock.candidate_research'),
      capabilityId: String(input.payload?.capabilityId ?? 'local.cache'),
      canonicalSchema: String(input.payload?.canonicalSchema ?? 'kline_daily'),
      canonicalTable: String(input.payload?.canonicalTable ?? 'kline_daily'),
      readbackAction: String(input.payload?.action ?? 'breakout_summary'),
      sourceDataTime: String(input.payload?.sourceDataTime ?? ''),
      fetchedAt: String(input.payload?.fetchedAt ?? ''),
      cacheStatus: String(input.payload?.cacheStatus ?? ''),
      coverageStatus: input.candidates.length >= 3 ? 'sufficient_for_analysis' : 'partial',
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

function summarizeQuote(value: string): string | null {
  const parsed = parseJsonObject(value)
  const rows = parsed && Array.isArray((parsed as any).data) ? (parsed as any).data : []
  const row = rows[0]
  if (!row || typeof row !== 'object') return compactText(value, 180)
  const code = row.code ?? row.symbol ?? '-'
  const price = row.price ?? row.close ?? row.current ?? '-'
  const pct = row.change_pct ?? row.changePct ?? row.pct_chg ?? '-'
  const sourceTime = row.timestamp ?? row.sourceDataTime ?? parsed?.sourceDataTime ?? '-'
  const fetched = row.fetchedAt ?? row.fetched_at ?? parsed?.fetchedAt ?? '-'
  return `${code} price=${price} pct=${pct} sourceTime=${sourceTime} fetchedAt=${fetched}`
}

function formatPctValue(value: number): string {
  if (!Number.isFinite(value)) return '-'
  const pct = Math.abs(value) <= 1 ? value * 100 : value
  return `${pct.toFixed(2)}%`
}

function formatNumberValue(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
