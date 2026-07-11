import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  financeWorkflowStateFromToolCall,
  financeWorkflowStateFromUserContent,
  isStrategyState,
  latestFinanceWorkflowState,
  type FinanceWorkflowState,
} from './finance-workflow-state'

export const CUSTOM_STRATEGY_SKIP_REASONS = {
  validateOnly:
    'Skipped: the current user request asked to validate the custom strategy first and not save/backtest in this turn. A successful custom_strategy_validate result already exists, so no provider request, script execution, backtest, or save was made.',
  rejectedValidation:
    'Skipped: custom_strategy_validate rejected unsupported executable strategy parts. No proxy strategy, backtest, save, provider request, script, file inspection, monitor, or trade action was made.',
  unsupportedProxy:
    'Skipped: the current user request asked about unsupported custom strategy sources. No proxy StrategySpec, backtest, save, provider request, script, monitor, or trade action was made without explicit user approval.',
  saveComplete:
    'Skipped: custom_strategy_save already persisted the validated/backtested strategy for this turn. No extra DataProcess, provider request, script, file inspection, run, monitor, or trade action was made.',
  redirectToSave:
    'Skipped: this save-intent custom strategy turn already has validated backtest evidence. Redirecting unrelated provider/tool drift to custom_strategy_save instead.',
  backtestComplete:
    'Skipped: custom_strategy_backtest already returned executable backtest evidence for this turn. No extra DataProcess, provider request, script, file inspection, save, or run action was made.',
  comparisonComplete:
    'Skipped: comparable custom_strategy_backtest evidence already exists for all requested symbols. Answering from the comparison evidence instead of narrowing to a single backtest.',
} as const

export function maybeBuildCustomStrategyValidateOnlyAnswer(messages: Message[], proposedToolCalls: ToolUse[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const state = latestFinanceWorkflowState(messages, lastUserIndex)
  if (!isStrategyState(state) || state?.intentMode !== 'validate' || state.safetyBoundary !== 'validate only') return null
  if (!proposedToolCalls.some(isCustomStrategyValidateOnlyOverrunToolCall)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  for (const call of [...toolCalls].reverse()) {
    if (call.name !== 'MarketData' || call.input.action !== 'custom_strategy_validate') continue
    const payload = parseJsonObject(resultByToolUseId.get(call.id) ?? '')
    if (!payload || payload.action !== 'custom_strategy_validate' || payload.status !== 'validated') continue
    const spec = typeof payload.normalizedSpec === 'object' && payload.normalizedSpec !== null
      ? payload.normalizedSpec as Record<string, unknown>
      : {}
    const report = typeof payload.validationReport === 'object' && payload.validationReport !== null
      ? payload.validationReport as Record<string, unknown>
      : {}
    const id = stringOrNull(spec.id)
    const name = stringOrNull(spec.name)
    const symbol = customStrategySymbol(spec)
    return [
      '策略结构已验证通过，本轮按用户要求停在验证步骤，未执行回测、保存、脚本或额外行情查询。',
      '',
      `- 策略：${name || id || '自定义策略'}。`,
      ...(id ? [`- strategyId：${id}。`] : []),
      ...(symbol ? [`- 标的：${symbol}。`] : []),
      `- 已接受规则：${compactList(report.acceptedRules)}。`,
      `- 假设条件：${compactList(report.assumptions)}。`,
      `- 警告：${compactList(report.warnings)}。`,
      `- 不支持的可执行部分：${compactList(report.unsupported, '无')}。`,
      '',
      '下一步如果需要回测，请单独要求“用这个策略回测”；如果需要保存，请先完成回测证据后再保存。',
    ].join('\n')
  }
  return null
}

export function maybeBuildCustomStrategyAutoSaveToolCalls(messages: Message[], proposedToolCalls: ToolUse[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const state = commandStateFromLastUser(messages, lastUserIndex)
  if (!state || !isStrategyState(state) || state.intentMode !== 'save') return null
  if (proposedToolCalls.some((call) => call.name === 'MarketData' && call.input.action === 'custom_strategy_save')) return null
  if (!proposedToolCalls.some(isCustomStrategySaveOverrunToolCall)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = new Map<string, string>()
  let hasSave = false
  for (const message of turnMessages) {
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) {
      resultByToolUseId.set(message.toolResult.toolUseId, message.toolResult.content)
      const payload = parseJsonObject(message.toolResult.content)
      if (payload?.action === 'custom_strategy_save') hasSave = true
    }
  }
  if (hasSave) return null

  for (const call of [...toolCalls].reverse()) {
    if (call.name !== 'MarketData' || call.input.action !== 'custom_strategy_backtest') continue
    const payload = parseJsonObject(resultByToolUseId.get(call.id) ?? '')
    if (!payload || payload.action !== 'custom_strategy_backtest' || payload.status !== 'backtested') continue
    const validation = objectOrEmpty(payload.validation)
    const spec = objectOrEmpty(validation.spec)
    if (Object.keys(spec).length === 0) continue
    return [{
      id: `auto-custom-strategy-save-${Date.now()}`,
      name: 'MarketData',
      input: {
        action: 'custom_strategy_save',
        strategySpec: spec,
        evidence: payload,
      },
    }]
  }
  return null
}

export function maybeBuildCustomStrategyBacktestAnswer(messages: Message[], proposedToolCalls: ToolUse[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const state = latestFinanceWorkflowState(messages, lastUserIndex)
  if (!isStrategyState(state) || state?.intentMode !== 'backtest') return null
  if (!proposedToolCalls.some(isCustomStrategyBacktestOverrunToolCall)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  for (const call of [...toolCalls].reverse()) {
    if (call.name !== 'MarketData' || call.input.action !== 'custom_strategy_backtest') continue
    const payload = parseJsonObject(resultByToolUseId.get(call.id) ?? '')
    if (!payload || payload.action !== 'custom_strategy_backtest' || payload.status !== 'backtested') continue
    const validation = objectOrEmpty(payload.validation)
    const spec = objectOrEmpty(validation.spec)
    const metrics = objectOrEmpty(payload.metrics)
    const assumptions = objectOrEmpty(payload.assumptions)
    const dataCoverage = strategyDataCoverageSummary(payload)
    return [
      '已完成自定义策略回测，并停止追加新的策略变体、交易动作、监控或自选股写入。本回答以 `custom_strategy_backtest` 的结构化结果为准。',
      '',
      `- 标的：${customStrategyBacktestSymbol(payload, spec, call) ?? '-'}。`,
      `- 策略ID：${stringOrNull(payload.strategyId) ?? stringOrNull(validation.strategyId) ?? '-'}。`,
      `- 数据覆盖：${dataCoverage}。`,
      `- 交易次数：${metrics.tradeCount ?? metrics.trades ?? payload.trades ?? 0}。`,
      `- 总收益率：${metrics.totalReturnPct ?? metrics.totalReturn ?? payload.totalReturn ?? '-'}%。`,
      `- 最大回撤：${metrics.maxDrawdownPct ?? metrics.maxDrawdown ?? payload.maxDrawdown ?? '-'}%。`,
      `- 胜率：${metrics.winRatePct ?? metrics.winRate ?? payload.winRate ?? '-'}%。`,
      `- 佣金/滑点：${assumptions.commissionPct ?? '-'}% / ${assumptions.slippagePct ?? '-'}%。`,
      `- 仓位规则：${formatPositionSizing(assumptions.positionSizing ?? spec.positionSizing)}。`,
      `- 退出规则：${customStrategyExitSummary(spec)}。`,
      '',
      '结果边界：未保存策略；未调用 `custom_strategy_save`；未执行交易、监控创建或自选股写入。若交易次数为 0，说明该窗口内未触发完整买入条件，不能据此推断参数放宽后的表现。',
    ].join('\n')
  }
  return null
}

export function maybeBuildCustomStrategyComparisonAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const state = commandStateFromLastUser(messages, lastUserIndex)
  if (!state || !isStrategyState(state) || state.intentMode !== 'backtest') return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const rows = toolCalls
    .filter((call) =>
      call.name === 'MarketData' &&
      call.input.action === 'custom_strategy_backtest' &&
      resultByToolUseId.has(call.id)
    )
    .map((call) => {
      const payload = parseJsonObject(resultByToolUseId.get(call.id) ?? '')
      if (!payload || payload.action !== 'custom_strategy_backtest') return null
      const validation = objectOrEmpty(payload.validation)
      const spec = objectOrEmpty(validation.spec)
      const metrics = objectOrEmpty(payload.metrics)
      const assumptions = objectOrEmpty(payload.assumptions)
      const symbol = stringOrNull(payload.symbol) ?? stringOrNull(call.input.code) ?? customStrategySymbol(spec) ?? '-'
      return {
        symbol,
        strategyId: stringOrNull(payload.strategyId) ?? stringOrNull(validation.strategyId) ?? '-',
        bars: payload.bars ?? '-',
        start: payload.actualStartDate ?? '-',
        end: payload.actualEndDate ?? '-',
        trades: metrics.tradeCount ?? metrics.trades ?? payload.trades ?? 0,
        totalReturn: metrics.totalReturnPct ?? metrics.totalReturn ?? payload.totalReturn ?? 0,
        maxDrawdown: metrics.maxDrawdownPct ?? metrics.maxDrawdown ?? payload.maxDrawdown ?? 0,
        winRate: metrics.winRatePct ?? metrics.winRate ?? payload.winRate ?? 0,
        commission: assumptions.commissionPct ?? '-',
        slippage: assumptions.slippagePct ?? '-',
        dataCoverage: strategyDataCoverageSummary(payload),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const latestBySymbol = new Map<string, typeof rows[number]>()
  for (const row of rows) latestBySymbol.set(row.symbol, row)
  const comparableRows = [...latestBySymbol.values()]
  if (comparableRows.length < 2) return null

  const selected = [...comparableRows].sort((left, right) =>
    Number(right.trades) - Number(left.trades) ||
    Number(right.totalReturn) - Number(left.totalReturn) ||
    Number(left.maxDrawdown) - Number(right.maxDrawdown)
  )[0]

  return [
    '## 多标的动量策略比较',
    '',
    '已停止继续设计新变体或追加行情工具调用。本回答只基于本轮已经完成的 `custom_strategy_backtest` 结果，对同一类 StrategySpec 动量规则做横向比较。',
    '',
    '| 标的 | strategyId | K线 | 区间 | 交易数 | 总收益 | 最大回撤 | 胜率 |',
    '|---|---|---:|---|---:|---:|---:|---:|',
    ...comparableRows.map((row) =>
      `| ${row.symbol} | ${row.strategyId} | ${row.bars} | ${row.start} ~ ${row.end} | ${row.trades} | ${row.totalReturn}% | ${row.maxDrawdown}% | ${row.winRate}% |`
    ),
    '',
    `结论：当前可比结果中，优先候选为 ${selected.symbol}。选择依据是交易触发数、收益和回撤的受控排序；若三者交易数都为 0，则结论只能说明当前窗口没有形成完整动量入场信号，不能推断放宽条件后的表现。`,
    '',
    '## 数据来源与回测假设',
    '',
    `- 数据覆盖：${selected.dataCoverage}。`,
    `- 成本假设：佣金 ${selected.commission}%；滑点 ${selected.slippage}%。`,
    '- 策略边界：没有调用 DataProcess、Script、Read/Grep；没有下单、模拟盘交易、监控或自选股变更。',
    '- Unsupported 边界：如果某个变体返回验证失败，应按失败结果披露，不用新的代理规则冒充原策略。',
  ].join('\n')
}

export function maybeBuildCustomStrategyRunComparisonAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const listCall = toolCalls.find((call) =>
    call.name === 'MarketData' && call.input.action === 'custom_strategy_list'
  )
  if (!listCall || !resultByToolUseId.has(listCall.id)) return null
  const rows = toolCalls
    .filter((call) =>
      call.name === 'MarketData' &&
      call.input.action === 'custom_strategy_run' &&
      resultByToolUseId.has(call.id)
    )
    .map((call) => {
      const payload = parseJsonObject(resultByToolUseId.get(call.id) ?? '')
      if (!payload || payload.action !== 'custom_strategy_run') return null
      const metrics = objectOrEmpty(payload.metrics)
      const symbol = stringOrNull(payload.code) ??
        stringOrNull(payload.symbol) ??
        stringOrNull(call.input.code) ??
        stringOrNull(call.input.symbol) ??
        '-'
      return {
        symbol,
        strategyId: stringOrNull(payload.strategyId) ?? stringOrNull(call.input.strategyId) ?? '-',
        status: stringOrNull(payload.status) ?? '-',
        bars: payload.bars ?? '-',
        start: payload.actualStartDate ?? '-',
        end: payload.actualEndDate ?? '-',
        trades: metrics.tradeCount ?? payload.tradeCount ?? 0,
        totalReturn: metrics.totalReturnPct ?? metrics.totalReturn ?? payload.totalReturn ?? 0,
        maxDrawdown: metrics.maxDrawdownPct ?? metrics.maxDrawdown ?? payload.maxDrawdown ?? 0,
        winRate: metrics.winRatePct ?? metrics.winRate ?? payload.winRate ?? 0,
        benchmark: objectOrEmpty(payload.benchmarkEvidence).benchmarkReturnPct ?? '-',
        dataCoverage: strategyDataCoverageSummary(payload),
        lifecycle: objectOrEmpty(payload.lifecycleAdvice),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const latestBySymbol = new Map<string, typeof rows[number]>()
  for (const row of rows) latestBySymbol.set(row.symbol, row)
  const comparableRows = [...latestBySymbol.values()]
  if (comparableRows.length < 2) return null
  const strategyIds = [...new Set(comparableRows.map((row) => row.strategyId))]
  const sameStrategy = strategyIds.length === 1
  const selected = [...comparableRows].sort((left, right) =>
    Number(right.trades) - Number(left.trades) ||
    Number(right.totalReturn) - Number(left.totalReturn) ||
    Number(left.maxDrawdown) - Number(right.maxDrawdown)
  )[0]

  return [
    '## 已保存策略重跑比较',
    '',
    '已读取 Strategy Library，并通过 `custom_strategy_run` 按保存的 strategyId 重跑。系统已停止追加保存、Read、脚本、provider 或交易工具调用。',
    '',
    `- 策略一致性：${sameStrategy ? `同一 strategyId（${strategyIds[0]}）` : `多个 strategyId（${strategyIds.join(', ')}），比较时需注意策略并非完全一致`}。`,
    '',
    '| 标的 | strategyId | 状态 | K线 | 区间 | 交易数 | 总收益 | 最大回撤 | 胜率 | 基准收益 |',
    '|---|---|---|---:|---|---:|---:|---:|---:|---:|',
    ...comparableRows.map((row) =>
      `| ${row.symbol} | ${row.strategyId} | ${row.status} | ${row.bars} | ${row.start} ~ ${row.end} | ${row.trades} | ${row.totalReturn}% | ${row.maxDrawdown}% | ${row.winRate}% | ${row.benchmark}% |`
    ),
    '',
    `结论：当前结构化结果中，优先候选为 ${selected.symbol}。排序依据是交易数、总收益和最大回撤；如果交易数为 0，则只能说明该保存策略在该窗口没有形成可验证交易样本。`,
    '',
    '## 数据与边界',
    '',
    ...comparableRows.map((row) => `- ${row.symbol}：${row.dataCoverage}。`),
    '- 本轮没有保存新策略、没有读取策略 JSON 文件、没有创建监控、没有交易或模拟盘操作。',
    '- 若某个保存策略返回 readback_only 或 validation error，应把它列为不可执行记录，而不是改写后再次保存。',
  ].join('\n')
}

export function maybeBuildCustomStrategySaveRunBoundaryAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = new Map<string, { content: string, isError: boolean }>()
  for (const message of turnMessages) {
    if (message.role === Role.Tool && message.toolResult) {
      resultByToolUseId.set(message.toolResult.toolUseId, {
        content: message.toolResult.content,
        isError: message.toolResult.isError,
      })
    }
  }

  let latestSave: Record<string, unknown> | null = null
  let latestRun: Record<string, unknown> | null = null
  let latestRunError = ''
  for (const call of toolCalls) {
    const result = resultByToolUseId.get(call.id)
    if (!result) continue
    if (call.name !== 'MarketData') continue
    if (call.input.action === 'custom_strategy_save' && !result.isError) {
      const payload = parseJsonObject(result.content)
      if (payload?.action === 'custom_strategy_save') latestSave = payload
    }
    if (call.input.action === 'custom_strategy_run' && result.isError) {
      latestRunError = result.content
    }
    if (call.input.action === 'custom_strategy_run' && !result.isError) {
      const payload = parseJsonObject(result.content)
      if (payload?.action === 'custom_strategy_run') latestRun = payload
    }
  }

  const saveStatus = stringOrNull(latestSave?.status)
  if (latestRun && latestRun.status === 'backtested') {
    const spec = objectOrEmpty(latestSave?.spec)
    const metrics = objectOrEmpty(latestRun.metrics)
    const strategyId =
      stringOrNull(latestRun.strategyId) ??
      stringOrNull(latestSave?.strategyId) ??
      stringOrNull(spec.id) ??
      '-'
    return [
      '## 策略保存与重跑完成',
      '',
      '已通过结构化策略记录完成保存，并使用 `custom_strategy_run` 按 strategyId 重新执行。系统已停止追加 provider、脚本、文件、监控或交易工具调用。',
      '',
      `- strategyId：${strategyId}。`,
      `- 保存状态：${saveStatus ?? '-'}。`,
      `- 重跑状态：${stringOrNull(latestRun.status) ?? '-'}。`,
      `- 标的：${stringOrNull(latestRun.code) ?? stringOrNull(latestRun.symbol) ?? '-'}。`,
      `- 数据覆盖：${strategyDataCoverageSummary(latestRun)}。`,
      `- 交易次数：${String(metrics.tradeCount ?? latestRun.tradeCount ?? '-')}。`,
      `- 总收益：${String(metrics.totalReturn ?? '-')}。`,
      `- 最大回撤：${String(metrics.maxDrawdown ?? '-')}。`,
      `- 胜率：${String(metrics.winRate ?? '-')}。`,
      '',
      '结论：该策略已经具备可复用策略记录、验证/回测证据和按 strategyId 重跑路径。后续可在 Strategy Library 中查看，或在新的用户请求中用于更多标的比较、观察池和监控工作流。',
    ].join('\n')
  }

  const isNotRunnable = saveStatus === 'validated'
  if (!latestSave || !isNotRunnable) return null

  const spec = objectOrEmpty(latestSave.spec)
  const evidence = objectOrEmpty(latestSave.evidence)
  const strategyId = stringOrNull(latestSave.strategyId) ?? stringOrNull(spec.id) ?? '-'
  return [
    '## 策略保存与重跑边界',
    '',
    '本轮没有得到可重跑的 backtested 策略。系统已停止继续追加 provider、脚本、文件或交易工具调用。',
    '',
    `- strategyId：${strategyId}。`,
    `- 保存状态：${saveStatus ?? '-'}。`,
    `- 策略名称：${stringOrNull(spec.name) ?? '-'}。`,
    `- 回测证据：${Object.keys(evidence).length === 0 ? '未随保存结果返回 backtested evidence' : `${evidence.status ?? '-'}；${strategyDataCoverageSummary(evidence)}`}。`,
    ...(latestRunError ? [`- 重跑结果：${latestRunError}。`] : []),
    '',
    '结论：该记录可以作为研究/观察草案保存，但不能声明“按 strategyId 重跑一致”。只有 `custom_strategy_backtest` 成功并以 backtested evidence 保存后，`custom_strategy_run` 才能作为可复用策略执行路径。',
    '',
    '后续方向：如果这是基金定投观察策略，应进入基金观察/监控合同；如果需要可执行回测，应先补齐基金 NAV/yield 回测引擎或改用当前 StrategySpec v1 支持的数据与指标。',
  ].join('\n')
}

export function maybeBuildCustomStrategyRejectedValidationAnswer(messages: Message[], proposedToolCalls: ToolUse[]): string | null {
  if (!proposedToolCalls.some(isCustomStrategyRejectedOverrunToolCall)) return null
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const state = latestFinanceWorkflowState(messages, lastUserIndex)
  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  const latestValidation = [...toolCalls].reverse().find((call) =>
    call.name === 'MarketData' && call.input.action === 'custom_strategy_validate')
  if (!latestValidation) {
    return state?.hasUnsupportedExecutableParts === true ? rejectedValidationBoundaryAnswer() : null
  }
  const payload = parseJsonObject(resultByToolUseId.get(latestValidation.id) ?? '')
  if (!payload || payload.action !== 'custom_strategy_validate' || payload.status !== 'rejected') {
    return state?.hasUnsupportedExecutableParts === true ? rejectedValidationBoundaryAnswer() : null
  }
  const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : []
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(String) : []
  return [
    '该策略未进入可执行回测，并已停止追加代理策略、脚本、文件或额外行情工具调用。本回答只基于 `custom_strategy_validate` 的拒绝结果。',
    '',
    `- 策略ID：${payload.strategyId ?? '-'}。`,
    '- 验证状态：rejected。',
    `- 不可执行部分：${errors.length === 0 ? '未返回详细错误' : errors.join('；')}。`,
    ...(warnings.length > 0 ? [`- 警告：${warnings.join('；')}。`] : []),
    '- 结果边界：未调用 `custom_strategy_backtest`，未调用 `custom_strategy_save`，未创建代理规则替代被拒绝的 StrategySpec。',
    '',
    '如果要继续，应先把这些条件改写成当前 StrategySpec v1 支持的指标；代理版策略必须作为新的用户请求重新设计，不能冒充原策略回测。',
  ].join('\n')
}

export function maybeBuildCustomStrategyRejectedValidationBoundedAnswer(messages: Message[]): string | null {
  return maybeBuildCustomStrategyRejectedValidationAnswer(messages, [{
    id: 'custom-strategy-rejected-boundary-probe',
    name: 'MarketData',
    input: { action: 'custom_strategy_backtest' },
  }])
}

function rejectedValidationBoundaryAnswer(): string {
  return [
    '该策略未进入可执行回测，并已停止追加代理策略、脚本、文件或额外行情工具调用。本回答基于结构化工作流状态：最近一次 StrategySpec 验证已经被标记为 blocked / unsupported。',
    '',
    '- 验证状态：rejected。',
    '- 不可执行部分：详见最近一次 `custom_strategy_validate` 的结构化 validationIssues / unsupportedDetails / errors。',
    '- 结果边界：未调用 `custom_strategy_backtest`，未调用 `custom_strategy_save`，未创建代理规则替代被拒绝的 StrategySpec。',
    '',
    '如果要继续，应先提交修正后的 StrategySpec；代理版策略必须作为新的用户请求重新设计，不能冒充原策略回测。',
  ].join('\n')
}

export function maybeBuildCustomStrategyUnsupportedProxyAnswer(messages: Message[], proposedToolCalls: ToolUse[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const state = latestFinanceWorkflowState(messages, lastUserIndex)
  if (!isStrategyState(state) || state?.hasUnsupportedExecutableParts !== true) return null
  const proxyCall = proposedToolCalls.find((call) => isUnsupportedCustomStrategyProxyToolCall(call))
  if (!proxyCall) return null
  return [
    '该策略没有进入可执行回测，并已停止代理策略、脚本、文件或额外行情工具调用。',
    '',
    '- 当前结构化工作流状态显示 StrategySpec 含有不支持的可执行部分。',
    '- 本轮未调用 `custom_strategy_backtest`，未调用 `custom_strategy_save`，也未创建代理规则。',
    '- 如果需要代理版策略，必须作为新的用户请求明确设计；代理版结果不能冒充原始策略回测。',
  ].join('\n')
}

export function maybeBuildCustomStrategySaveAnswer(messages: Message[], proposedToolCalls: ToolUse[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const commandState = commandStateFromLastUser(messages, lastUserIndex)
  if (!commandState || !isStrategyState(commandState) || commandState.intentMode !== 'save') return null
  const state = commandState
  if (!isStrategyState(state) || state?.intentMode !== 'save') return null
  if (!proposedToolCalls.some(isCustomStrategySaveOverrunToolCall)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const resultByToolUseId = successfulToolResults(turnMessages)
  for (const call of [...toolCalls].reverse()) {
    if (call.name !== 'MarketData' || call.input.action !== 'custom_strategy_save') continue
    const payload = parseJsonObject(resultByToolUseId.get(call.id) ?? '')
    if (!payload || payload.action !== 'custom_strategy_save') continue
    const spec = objectOrEmpty(payload.spec)
    const validation = objectOrEmpty(payload.validation)
    const evidence = objectOrEmpty(payload.evidence)
    return [
      '自定义策略已保存，并停止追加技术指标、脚本、文件或额外行情工具调用。本回答只基于 `custom_strategy_save` 的代码执行结果。',
      '',
      `- 策略ID：${stringOrNull(payload.strategyId) ?? stringOrNull(validation.strategyId) ?? stringOrNull(spec.id) ?? '-'}。`,
      `- 版本：${payload.version ?? validation.version ?? '-'}。`,
      `- 保存状态：${payload.status ?? '-'}。`,
      `- 策略名称：${stringOrNull(spec.name) ?? '-'}。`,
      `- 回测证据：${Object.keys(evidence).length === 0 ? '未随保存结果返回回测证据' : `${evidence.actualStartDate ?? '-'} ~ ${evidence.actualEndDate ?? '-'}，K线 ${evidence.bars ?? '-'} 根，状态 ${evidence.status ?? '-'}`}。`,
      '- 数据边界：保存的是经过验证的 StrategySpec 和已有回测证据；未执行真实交易、模拟盘交易、监控创建或自选股变更。',
      '',
      '之后复用时应通过 `custom_strategy_run` 或 strategyId 读取已保存策略，不要把策略名当成内置 backtest strategy 字符串。',
    ].join('\n')
  }
  return null
}

export function maybeBuildCustomStrategySavedAnswer(messages: Message[]): string | null {
  return maybeBuildCustomStrategySaveAnswer(messages, [{
    id: 'custom-strategy-save-boundary-probe',
    name: 'MarketData',
    input: { action: 'query_kline' },
  }])
}

function commandStateFromLastUser(messages: Message[], lastUserIndex: number): FinanceWorkflowState | null {
  return financeWorkflowStateFromUserContent(messages[lastUserIndex]?.content ?? '')
}

function isCustomStrategyValidateOnlyOverrunToolCall(call: ToolUse): boolean {
  if (call.name === 'Bash' || call.name === 'Script') return true
  if (call.name === 'DataProcess') return true
  if (call.name !== 'MarketData') return false
  const action = String(call.input.action ?? '')
  if (!action) return true
  if (action === 'custom_strategy_validate' || action === 'custom_strategy_help') return false
  return action === 'custom_strategy_backtest' ||
    action === 'custom_strategy_save' ||
    action === 'custom_strategy_run' ||
    action.startsWith('query_') ||
    action === 'kline' ||
    action === 'quote' ||
    action === 'price' ||
    action === 'technical_indicator'
}

function isCustomStrategyRejectedOverrunToolCall(call: ToolUse): boolean {
  if (call.name === 'Bash' || call.name === 'Script' || call.name === 'Read' || call.name === 'Grep') return true
  if (call.name === 'DataProcess') return true
  if (call.name !== 'MarketData') return false
  const action = String(call.input.action ?? '')
  return action === 'custom_strategy_backtest' ||
    action === 'custom_strategy_save' ||
    action === 'custom_strategy_run' ||
    action.startsWith('query_') ||
    action === 'kline' ||
    action === 'quote' ||
    action === 'price' ||
    action === 'technical_indicator'
}

function isUnsupportedCustomStrategyProxyToolCall(call: ToolUse): boolean {
  if (call.name === 'Bash' || call.name === 'Script' || call.name === 'Read' || call.name === 'Grep') return true
  if (call.name === 'DataProcess') return true
  if (call.name !== 'MarketData') return false
  const action = String(call.input.action ?? '')
  if (action === 'custom_strategy_help') return false
  if (action === 'custom_strategy_validate') {
    return financeWorkflowStateFromToolCall(call)?.hasUnsupportedExecutableParts !== true
  }
  return action === 'custom_strategy_backtest' ||
    action === 'custom_strategy_save' ||
    action === 'custom_strategy_run' ||
    action.startsWith('query_') ||
    action === 'kline' ||
    action === 'quote' ||
    action === 'price' ||
    action === 'technical_indicator'
}

function isCustomStrategyBacktestOverrunToolCall(call: ToolUse): boolean {
  if (call.name === 'Bash' || call.name === 'Script' || call.name === 'Read' || call.name === 'Grep') return true
  if (call.name === 'DataProcess') return true
  if (call.name !== 'MarketData') return false
  const action = String(call.input.action ?? '')
  if (action === 'custom_strategy_validate' || action === 'custom_strategy_backtest' || action === 'custom_strategy_help') return false
  return action.startsWith('query_') ||
    action === 'kline' ||
    action === 'quote' ||
    action === 'price' ||
    action === 'technical_indicator' ||
    action === 'backtest' ||
    action === 'backtest_batch' ||
    action === 'optimize_params'
}

function isCustomStrategySaveOverrunToolCall(call: ToolUse): boolean {
  if (call.name === 'Bash' || call.name === 'Script' || call.name === 'Read' || call.name === 'Grep') return true
  if (call.name === 'DataProcess') return true
  if (call.name !== 'MarketData') return false
  const action = String(call.input.action ?? '')
  if (
    action === 'custom_strategy_validate' ||
    action === 'custom_strategy_backtest' ||
    action === 'custom_strategy_save' ||
    action === 'custom_strategy_help' ||
    action === 'custom_strategy_list'
  ) return false
  return action.startsWith('query_') ||
    action === 'kline' ||
    action === 'quote' ||
    action === 'price' ||
    action === 'technical_indicator' ||
    action === 'custom_strategy_run'
}

function customStrategyExitSummary(spec: Record<string, unknown>): string {
  const exit = spec.exit
  if (typeof exit !== 'object' || exit === null) return exit == null ? '未返回' : String(exit)
  const exitMap = exit as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(exitMap, 'any')) return `任一触发（OR）：${compactList(exitMap.any)}`
  if (Object.prototype.hasOwnProperty.call(exitMap, 'all')) return `全部满足（AND）：${compactList(exitMap.all)}`
  return JSON.stringify(exitMap)
}

function customStrategyBacktestSymbol(
  payload: Record<string, unknown>,
  spec: Record<string, unknown>,
  call: ToolUse,
): string | null {
  return stringOrNull(payload.symbol) ??
    stringOrNull(payload.code) ??
    customStrategySymbol(spec) ??
    stringOrNull(call.input.symbol) ??
    stringOrNull(call.input.code) ??
    firstString(call.input.symbols) ??
    firstString(call.input.codes)
}

function customStrategySymbol(spec: Record<string, unknown>): string | null {
  const direct = stringOrNull(spec.symbol) ?? stringOrNull(spec.code) ?? stringOrNull(spec.fundCode)
  if (direct) return direct
  if (Array.isArray(spec.symbols) && spec.symbols.length > 0) return String(spec.symbols[0])
  if (Array.isArray(spec.codes) && spec.codes.length > 0) return String(spec.codes[0])
  const universe = spec.universe
  if (typeof universe === 'object' && universe !== null) {
    const symbols = (universe as Record<string, unknown>).symbols
    if (Array.isArray(symbols) && symbols.length > 0) return String(symbols[0])
    const codes = (universe as Record<string, unknown>).codes
    if (Array.isArray(codes) && codes.length > 0) return String(codes[0])
  }
  return null
}

function firstString(value: unknown): string | null {
  return Array.isArray(value)
    ? value.map(stringOrNull).find((item): item is string => Boolean(item)) ?? null
    : null
}

function formatPositionSizing(value: unknown): string {
  if (value == null) return '-'
  if (typeof value === 'string') return value.trim() || '-'
  if (typeof value !== 'object' || Array.isArray(value)) return String(value)
  const row = value as Record<string, unknown>
  const type = stringOrNull(row.type) ?? stringOrNull(row.method) ?? 'custom'
  const parts = Object.entries(row)
    .filter(([key, item]) => key !== 'type' && key !== 'method' && item != null)
    .map(([key, item]) => `${key}=${String(item)}`)
  return parts.length > 0 ? `${type} (${parts.join(', ')})` : type
}

function strategyDataCoverageSummary(payload: Record<string, unknown>): string {
  const coverage = objectOrEmpty(payload.dataCoverage)
  const rows = coverage.rows ?? payload.bars ?? '-'
  const requiredBars = coverage.requiredBars
  const sufficient = coverage.sufficient
  const start = coverage.actualStartDate ?? payload.actualStartDate ?? '-'
  const end = coverage.actualEndDate ?? payload.actualEndDate ?? '-'
  const source = coverage.source
  const cacheStatus = coverage.cacheStatus
  return [
    `${String(start)} ~ ${String(end)}`,
    `K线 ${String(rows)} 根`,
    ...(requiredBars != null ? [`要求 ${String(requiredBars)} 根`] : []),
    ...(sufficient != null ? [`覆盖${sufficient === true ? '满足' : '不足'}`] : []),
    ...(source != null ? [`source=${String(source)}`] : []),
    ...(cacheStatus != null ? [`cache=${String(cacheStatus)}`] : []),
  ].join('；')
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

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function compactList(value: unknown, empty = '未返回'): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return empty
    return value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('；')
  }
  if (value == null) return empty
  const text = String(value).trim()
  return text || empty
}
