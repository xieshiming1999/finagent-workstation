import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  isEvidenceReviewWorkflowState,
  latestFinanceWorkflowState,
  type FinanceWorkflowState,
} from './finance-workflow-state'

export function buildInvestmentEvidenceReviewSearchToolCalls(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  if (!hasEvidenceReviewIntent(messages, lastUserIndex)) return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  const resultByToolUseId = collectSuccessfulToolResults(turnMessages)
  const hasSessionSearch = collectToolCalls(turnMessages)
    .some((call) => call.name === 'SessionSearch' && resultByToolUseId.has(call.id))
  if (hasSessionSearch) return null
  const stamp = Date.now()
  return INVESTMENT_EVIDENCE_REVIEW_QUERIES.map((query, index) => ({
    id: `investment-evidence-review-search-${stamp}-${index}`,
    name: 'SessionSearch',
    input: { query, limit: 5 },
  }))
}

export function maybeBuildInvestmentEvidenceReviewAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = evidenceReviewWorkflowState(messages, lastUserIndex)
  if (!workflowState) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = collectSuccessfulToolResults(turnMessages)
  const sessionSearchCalls = toolCalls.filter((call) => call.name === 'SessionSearch' && resultByToolUseId.has(call.id))
  if (sessionSearchCalls.length === 0) return null

  const searchEvidence = sessionSearchCalls.map((call) => ({
    query: stringValue(call.input.query ?? call.input.pattern ?? ''),
    result: resultByToolUseId.get(call.id) ?? '',
  }))
  const nonSessionTools = toolCalls.filter((call) => call.name !== 'SessionSearch')
  if (nonSessionTools.some((call) => ['Read', 'Glob', 'Grep', 'LS'].includes(call.name))) {
    return null
  }

  const matched = searchEvidence.filter((item) => !/No matches/i.test(item.result))
  const missing = searchEvidence.filter((item) => /No matches/i.test(item.result))
  const substantiveMatches = matched.filter((item) => !isCurrentReviewRequestOnlyResult(item.result))
  const coverage = evidenceCoverage(workflowState, substantiveMatches)
  const scope = substantiveMatches.length === 0
    ? '本轮 SessionSearch 没有找到可复核的历史建议正文。'
    : '本轮只复核 SessionSearch 找到的会话证据；未把文件系统搜索当成额外证据。'

  const matchedLines = substantiveMatches.slice(0, 4).map((item, index) =>
    `${index + 1}. query="${item.query || '-'}"：${compactEvidenceLine(item.result)}`
  )
  const missingLine = missing.length
    ? missing.slice(0, 4).map((item) => item.query || '-').join('；')
    : '无。'

  const dataEvidence = [
    coverage.stock ? '- 股票侧：找到股票/行情/策略相关线索，可作为部分数据证据；仍需逐条回看对应工具结果后才能判断每个股票建议是否成立。' : '- 股票侧：未找到足够股票建议证据，不能声称已复核全部股票结论。',
    coverage.fund ? '- 基金侧：找到基金观察池或 `watch_signal_check` / NAV 证据，可把已触发/未触发状态视为数据证据。' : '- 基金侧：未找到足够基金数据证据，不能补写基金结论。',
    coverage.watch ? '- 观察/监控侧：找到观察池或信号检查线索，说明部分建议已落到可复核状态。' : '- 观察/监控侧：未找到可复核的观察池/监控状态。',
    coverage.trade ? '- 交易侧：找到交易/组合相关线索；复核交易动作仍需要具体成交/组合工具结果。' : '- 交易侧：未找到可复核的雪球模拟交易或组合成交证据。',
  ]

  return [
    '## 建议复核结论',
    '',
    scope,
    '',
    '### 数据证据',
    '',
    ...dataEvidence,
    '',
    '### 策略假设',
    '',
    '- 选股、选基、入场、止损、止盈、定投或仓位建议，只要没有对应行情、NAV、回测、信号检查、观察池读回或成交回执，就只能算策略假设。',
    '- SessionSearch 没有命中的部分不能被补全为事实；应标记为缺失证据，而不是用当前模型判断替代历史证据。',
    '',
    '### 已检索到的会话线索',
    '',
    ...(matchedLines.length ? matchedLines : ['- 未找到可摘要的匹配结果。']),
    matched.length > substantiveMatches.length
      ? '- 仅命中当前复核请求本身的结果已排除，不作为投资建议证据。'
      : '',
    '',
    '### 缺失或未覆盖证据',
    '',
    `- 未命中的检索：${missingLine}`,
    '- 本轮没有使用 Read/Glob/Grep/LS，也没有调用交易、观察池写入、监控创建或 provider 刷新工具。',
    '',
    '### 下一步',
    '',
    '- 如果要复核某一条具体建议，应指定对象或 session；再读取对应工具结果中的 provider、cache status、source time、fetched-at、watchlist/readback 或交易回执。',
    '- 如果只能找到部分证据，结论必须保持部分复核状态，不能声明“上面所有建议”都已经验证。',
  ].join('\n')
}

function isCurrentReviewRequestOnlyResult(value: string): boolean {
  const compact = value.replace(/\s+/g, ' ')
  return /user:/i.test(compact) &&
    /finance-workflow-state-v1/.test(compact) &&
    !/assistant:|tool:|Watchlist|DataProcess|MarketData|DataStore|XueqiuTrade|Portfolio|MonitorCreate/.test(compact)
}

function hasEvidenceReviewIntent(messages: Message[], turnStartIndex: number): boolean {
  return evidenceReviewWorkflowState(messages, turnStartIndex) != null
}

function evidenceReviewWorkflowState(messages: Message[], turnStartIndex: number): FinanceWorkflowState | null {
  const state = latestFinanceWorkflowState(messages, turnStartIndex)
  return isEvidenceReviewWorkflowState(state) ? state : null
}

function evidenceCoverage(
  state: FinanceWorkflowState,
  matches: Array<{ query: string; result: string }>,
): { stock: boolean; fund: boolean; watch: boolean; trade: boolean } {
  const refs = state.evidenceRefs.map((ref) => ref.trim().toLowerCase())
  const queryKeys = new Set(matches.map((item) => item.query.trim()))
  const hasRef = (...values: string[]) => values.some((value) => refs.includes(value))
  const hasQuery = (...values: string[]) => values.some((value) => queryKeys.has(value))
  return {
    stock: state.assetClass === 'stock' || state.assetClass === 'mixed' || hasRef('stock', 'quote', 'kline', 'analysis-evidence-v1') || hasQuery(STOCK_FUND_WATCH_QUERY, STOCK_ADVICE_QUERY),
    fund: state.assetClass === 'fund' || state.assetClass === 'mixed' || hasRef('fund', 'fund_nav', 'fund.nav_history', 'watch_signal_check') || hasQuery(STOCK_FUND_WATCH_QUERY, FUND_WATCH_QUERY),
    watch: hasRef('watch', 'monitor', 'watch_signal_check', 'prior-analysis') || hasQuery(STOCK_FUND_WATCH_QUERY, FUND_WATCH_QUERY),
    trade: state.workflowKind === 'trade_prep' || hasRef('trade', 'portfolio', 'xueqiu', 'trade-prep-v1') || hasQuery(PORTFOLIO_TRADE_QUERY),
  }
}

const STOCK_FUND_WATCH_QUERY = 'HIW 股票 基金 观察池 信号检查'
const FUND_WATCH_QUERY = '基金观察池 watch_signal_check'
const STOCK_ADVICE_QUERY = '股票 推荐 买入 建议'
const PORTFOLIO_TRADE_QUERY = 'Portfolio Xueqiu 交易'
const INVESTMENT_EVIDENCE_REVIEW_QUERIES = [
  STOCK_FUND_WATCH_QUERY,
  FUND_WATCH_QUERY,
  STOCK_ADVICE_QUERY,
  PORTFOLIO_TRADE_QUERY,
]

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.toolUses ?? [])
}

function collectSuccessfulToolResults(messages: Message[]): Map<string, string> {
  const resultByToolUseId = new Map<string, string>()
  for (const message of messages) {
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) {
      resultByToolUseId.set(message.toolResult.toolUseId, message.toolResult.content)
    }
  }
  return resultByToolUseId
}

function compactEvidenceLine(value: string): string {
  const line = value
    .replace(/\s+/g, ' ')
    .replace(/```[\s\S]*?```/g, '[code omitted]')
    .trim()
  return line.length <= 260 ? line : `${line.slice(0, 257)}...`
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}
