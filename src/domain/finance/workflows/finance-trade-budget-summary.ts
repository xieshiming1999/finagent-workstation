import { Role, type Message } from '../../../agent/message'
import { createTradePrepContract } from '../execution/trade-prep-contract'
import { isTradeSizingWorkflowState, latestTradePrepWorkflowState } from './finance-workflow-state'

interface TradeSizingEvidence {
  xueqiuBalance?: Record<string, unknown>
  portfolioSnapshot?: Record<string, unknown>
  strategySignal?: Record<string, unknown>
  rebalanceDraft?: Record<string, unknown>
  portfolioEvidence?: Record<string, unknown>
  portfolioPreview?: Record<string, unknown>
  xueqiuPreview?: Record<string, unknown>
  confirmation?: string
}

export function maybeBuildTradeBudgetSummary(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  const workflowState = latestTradePrepWorkflowState(messages, Math.max(0, lastUserIndex))
  if (!isTradeSizingWorkflowState(workflowState)) return null

  const evidence = collectEvidence(messages)
  if (!evidence.xueqiuBalance && !evidence.portfolioSnapshot) return null
  if (!evidence.confirmation) return null
  if (allowsSimulationPreview(evidence.confirmation) &&
    !evidence.portfolioPreview &&
    !evidence.xueqiuPreview) {
    return null
  }

  const performance = firstRecord(evidence.xueqiuBalance?.performances)
  const portfolio = recordValue(evidence.xueqiuBalance?.portfolio) ?? firstRecord(evidence.xueqiuBalance?.portfolios)
  const xueqiuCash = numberValue(performance?.cash)
  const xueqiuAssets = numberValue(performance?.assets)
  const localCash = numberValue(evidence.portfolioSnapshot?.cash)
  const localAssets = numberValue(evidence.portfolioSnapshot?.assets ?? evidence.portfolioSnapshot?.totalAssets)
  const signalStatus = stringValue(
    evidence.strategySignal?.signalStatus ??
      evidence.strategySignal?.signal ??
      evidence.strategySignal?.status ??
      evidence.strategySignal?.decision,
    'unknown',
  )
  const strategyId = stringValue(
    evidence.strategySignal?.strategyId ??
      recordValue(evidence.strategySignal?.strategySpec)?.id,
    '-',
  )
  const signalSymbol = stringValue(
    evidence.strategySignal?.code ??
      evidence.strategySignal?.symbol ??
      recordValue(evidence.strategySignal?.strategySpec)?.symbol,
    '-',
  )
  const signalPrice = numberValue(evidence.strategySignal?.price ?? evidence.strategySignal?.value)
  const signalSource = stringValue(evidence.strategySignal?.template, '')
  const budgetBase = Number.isFinite(xueqiuCash) ? xueqiuCash : localCash
  const budget = Number.isFinite(budgetBase) ? budgetBase * 0.2 : Number.NaN
  const portfolioDraftLines = evidence.rebalanceDraft
    ? rebalanceDraftLines(evidence.rebalanceDraft, evidence.portfolioEvidence, budgetBase)
    : []
  const previewLines = tradePreviewLines(evidence.portfolioPreview, evidence.xueqiuPreview)
  const lotSize = evidence.xueqiuBalance ? 1 : 100
  const shares = sharesFromBudget(budget, signalPrice, lotSize)

  return [
    '当前策略信号状态：' + signalStatus + '。本轮只完成买入预算与风险准备，没有执行任何交易写入。',
    '',
    '## 可用资金',
    '',
    `- 雪球模拟盘：${stringValue(portfolio?.name, 'finasimu')}；现金 ${money(xueqiuCash)}；总资产 ${money(xueqiuAssets)}。`,
    `- 本地纸组合：现金 ${money(localCash)}；总资产 ${money(localAssets)}。`,
    `- 20% 预算上限：${money(budget)}。`,
    '',
    '## 策略与数据来源',
    '',
    `- 策略：strategyId=${strategyId}；signal=${signalStatus}；标的=${signalSymbol}；参考价=${money(signalPrice)}；信号来源：${signalSource || 'MarketData(action:"custom_strategy_observe" 或已保存 StrategySpec 读回)'}。`,
    '- 模拟盘证据：XueqiuTrade(action:"balance")；本轮未调用 XueqiuTrade(action:"buy"|"sell"|"transfer")。',
    '- 本地组合证据：Portfolio(action:"snapshot")。',
    ...(previewLines.length > 0
      ? ['', '## 非写入预览', '', ...previewLines]
      : []),
    ...(portfolioDraftLines.length > 0 ? [
      '',
      '## 组合再平衡草案',
      '',
      ...portfolioDraftLines,
    ] : []),
    '',
    '## 确认边界',
    '',
    `- 用户确认结果：${evidence.confirmation}。`,
    ...(evidence.rebalanceDraft ? ['- 组合再平衡草案只作为 StrategySpec ranking evidence 的仓位参考，不会自动调仓。'] : []),
    ...(previewLines.length > 0 ? ['- 本轮已完成 preview，但 preview 不代表已下单。'] : []),
    '- 选择“触发时再确认”时，真正信号出现后必须再次确认组合、价格、数量、金额、费用假设和止损边界。',
    '- 当前回答不是下单指令，也不代表已创建或执行雪球模拟盘订单。',
    `tradePrep:${JSON.stringify(createTradePrepContract({
      prepKind: 'strategy_signal_position_sizing',
      strategyId,
      signal: signalStatus,
      symbol: signalSymbol,
      sizing: {
        cash: Number.isFinite(budgetBase) ? budgetBase : null,
        assets: Number.isFinite(xueqiuAssets) ? xueqiuAssets : localAssets,
        budget: Number.isFinite(budget) ? budget : null,
        budgetRule: '20pct_cash',
        referencePrice: Number.isFinite(signalPrice) ? signalPrice : null,
        lotSize,
        shares,
        amount: amountFromShares(shares, signalPrice),
      },
      evidence: {
        xueqiuBalance: !!evidence.xueqiuBalance,
        portfolioSnapshot: !!evidence.portfolioSnapshot,
        strategySignal: !!evidence.strategySignal,
      },
      previews: {
        portfolioPreview: !!evidence.portfolioPreview,
        xueqiuPreview: !!evidence.xueqiuPreview,
      },
      boundaries: [
        'prep_only',
        'no_order_write',
        'no_portfolio_trade',
        'requires_explicit_confirmation_before_execution',
      ],
      ...(evidence.confirmation ? { confirmation: evidence.confirmation } : {}),
    }))}`,
  ].join('\n')
}

function sharesFromBudget(budget: number, price: number, lotSize: number): number {
  if (!Number.isFinite(budget) || !Number.isFinite(price) || price <= 0) return 0
  const normalizedLotSize = Number.isFinite(lotSize) && lotSize > 0 ? Math.floor(lotSize) : 1
  return Math.floor((budget / price) / normalizedLotSize) * normalizedLotSize
}

function amountFromShares(shares: number, price: number): number | null {
  if (shares <= 0 || !Number.isFinite(price)) return null
  return shares * price
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}

function collectEvidence(messages: Message[]): TradeSizingEvidence {
  const evidence: TradeSizingEvidence = {
    strategySignal: latestMonitorStrategySignal(messages),
  }
  const callsById = new Map<string, { name: string; action: string }>()
  for (const message of messages) {
    if (message.role === Role.Assistant) {
      for (const call of message.toolUses ?? []) {
        callsById.set(call.id, {
          name: call.name,
          action: typeof call.input.action === 'string' ? call.input.action : '',
        })
      }
    }
    if (message.role !== Role.Tool || !message.toolResult || message.toolResult.isError) continue
    const call = callsById.get(message.toolResult.toolUseId)
    const payload = decodeRecord(message.toolResult.content)
    if (!call) continue
    if (payload) {
      evidence.rebalanceDraft ??= findRebalanceDraft(payload)
      evidence.portfolioEvidence ??= findPortfolioEvidence(payload)
    }
    if (call.name === 'AskUserQuestion') {
      evidence.confirmation = payload
        ? extractConfirmation(payload) ?? message.toolResult.content.trim()
        : message.toolResult.content.trim()
      continue
    }
    if (call.name === 'XueqiuTrade' && call.action === 'balance') {
      if (!payload) continue
      evidence.xueqiuBalance = payload
    } else if (call.name === 'XueqiuTrade' && call.action === 'preview_order') {
      if (!payload) continue
      evidence.xueqiuPreview = payload
    } else if (call.name === 'Portfolio' && call.action === 'snapshot') {
      if (!payload) continue
      evidence.portfolioSnapshot = payload
    } else if (call.name === 'Portfolio' && call.action === 'preview_trade') {
      if (!payload) continue
      evidence.portfolioPreview = payload
    } else if (call.name === 'MarketData' && (call.action === 'custom_strategy_observe' || call.action === 'custom_strategy_run')) {
      if (!payload) continue
      evidence.strategySignal = payload
    }
  }
  return evidence
}

function tradePreviewLines(
  portfolioPreview: Record<string, unknown> | undefined,
  xueqiuPreview: Record<string, unknown> | undefined,
): string[] {
  const lines: string[] = []
  if (portfolioPreview) {
    const order = recordValue(portfolioPreview.order)
    const estimated = recordValue(portfolioPreview.estimated)
    lines.push(`- Portfolio(action:"preview_trade")：sideEffect=${stringValue(portfolioPreview.sideEffect, 'false')}；executionAllowed=${stringValue(portfolioPreview.executionAllowed, '-')}；${orderText(order)}；预计现金变化 ${money(numberValue(estimated?.cashBefore))} -> ${money(numberValue(estimated?.cashAfter))}。`)
  }
  if (xueqiuPreview) {
    const order = recordValue(xueqiuPreview.order)
    const readback = recordValue(xueqiuPreview.readbackEvidence)
    lines.push(`- XueqiuTrade(action:"preview_order")：sideEffect=${stringValue(xueqiuPreview.sideEffect, 'false')}；${orderText(order)}；readback=${readback ? Object.keys(readback).join(', ') : '-'}。`)
  }
  if (lines.length > 0) lines.push('- 预览结果不代表已下单，也不写入本地 Portfolio trade。')
  return lines
}

function allowsSimulationPreview(answer: string): boolean {
  const decoded = decodeRecord(answer)
  if (!decoded) return false
  const explicit = String(decoded.decision ?? decoded.action ?? '').trim().toLowerCase()
  if (['allow_preview', 'preview', 'allow_simulation_preview', 'simulate_preview'].includes(explicit)) return true
  const index = decoded.selectedOptionIndex ?? decoded.optionIndex
  return index === 3 || index === '3'
}

function orderText(order: Record<string, unknown> | null): string {
  if (!order) return 'order=-'
  return `order=${stringValue(order.side, '-')} ${stringValue(order.symbol, '-')} ${stringValue(order.shares, '-')} @ ${stringValue(order.price, '-')}`
}

function findRebalanceDraft(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = recordValue(payload.rebalanceDraft)
  if (direct) return direct
  const rules = recordValue(payload.strategyRules)
  const fromRules = recordValue(rules?.rebalanceDraft)
  if (fromRules) return fromRules
  const items = payload.items
  if (Array.isArray(items)) {
    for (const item of items) {
      const row = recordValue(item)
      if (!row) continue
      const fromItem = recordValue(row.rebalanceDraft)
      if (fromItem) return fromItem
      const rowRules = recordValue(row.strategyRules)
      const nested = recordValue(rowRules?.rebalanceDraft)
      if (nested) return nested
    }
  }
  return undefined
}

function findPortfolioEvidence(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = recordValue(payload.portfolioEvidence)
  if (direct) return direct
  const rules = recordValue(payload.strategyRules)
  const fromRules = recordValue(rules?.portfolioEvidence)
  if (fromRules) return fromRules
  const items = payload.items
  if (Array.isArray(items)) {
    for (const item of items) {
      const row = recordValue(item)
      if (!row) continue
      const fromItem = recordValue(row.portfolioEvidence)
      if (fromItem) return fromItem
      const rowRules = recordValue(row.strategyRules)
      const nested = recordValue(rowRules?.portfolioEvidence)
      if (nested) return nested
    }
  }
  return undefined
}

function rebalanceDraftLines(
  draft: Record<string, unknown>,
  evidence: Record<string, unknown> | undefined,
  cash: number,
): string[] {
  const lines = [
    `- 来源：custom_strategy_rank / Watchlist readback；mode=${stringValue(draft.mode, 'equal_weight_top_n')}；rebalanceInterval=${stringValue(draft.rebalanceInterval, '-')}。`,
  ]
  const aggregate = recordValue(draft.aggregateMetrics) ?? recordValue(evidence?.aggregateMetrics)
  if (aggregate) {
    lines.push(`- 组合证据：expectedReturn=${stringValue(aggregate.expectedReturnPct, '-')}%；portfolioMaxDrawdown=${stringValue(aggregate.portfolioMaxDrawdownPct, '-')}%；selected=${stringValue(aggregate.selectedSymbols, '-')}。`)
  }
  const positions = Array.isArray(draft.positions) ? draft.positions : []
  for (const item of positions.slice(0, 5)) {
    const position = recordValue(item)
    if (!position) continue
    const symbol = stringValue(position.symbol, '-')
    const weight = numberValue(position.targetWeight)
    const amount = Number.isFinite(cash) && Number.isFinite(weight) ? cash * weight : Number.NaN
    lines.push(`- ${symbol}：目标权重 ${Number.isFinite(weight) ? (weight * 100).toFixed(1) : '-'}%；按当前现金估算金额 ${money(amount)}；weightCapped=${stringValue(position.weightCapped, 'false')}。`)
  }
  lines.push(`- 边界：${stringValue(draft.tradeBoundary, 'evidence only; confirmation required before any order')}`)
  return lines
}

function latestMonitorStrategySignal(messages: Message[]): Record<string, unknown> | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.User) continue
    const marker = 'data:'
    const index = message.content.lastIndexOf(marker)
    if (index < 0) continue
    const payload = decodeRecord(message.content.slice(index + marker.length))
    if (!payload || payload.template !== 'strategy_signal') continue
    return payload
  }
  return undefined
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

function extractConfirmation(payload: Record<string, unknown>): string | null {
  for (const key of ['answer', 'selected', 'choice', 'response', 'content']) {
    const value = stringValue(payload[key], '')
    if (value) return value
  }
  const answers = payload.answers
  if (Array.isArray(answers) && answers.length > 0) {
    const first = answers[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object') {
      return stringValue((first as Record<string, unknown>).answer ?? (first as Record<string, unknown>).value, null)
    }
  }
  return null
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && value[0] && typeof value[0] === 'object'
    ? value[0] as Record<string, unknown>
    : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.NaN
}

function stringValue(value: unknown, fallback: string | null): string {
  if (typeof value === 'string') return value.trim() ? value.trim() : fallback ?? ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return fallback ?? ''
}

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '-'
}
