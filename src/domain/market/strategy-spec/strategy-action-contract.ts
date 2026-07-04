export type StrategyAction = 'rerun' | 'watch' | 'monitor' | 'read'

export type StrategyMonitorTemplate =
  | 'strategy_signal'
  | 'fund_rule_monitor'
  | 'portfolio_rebalance_monitor'

export interface StrategyActionItem {
  strategyId: string
  status: string
  assetClass: string
  strategyType?: string
  symbols: string[]
  evidenceAction: string
  runnable?: boolean
}

export function buildStrategyLibraryActionPrompt(
  action: StrategyAction,
  item: StrategyActionItem,
): string {
  const id = item.strategyId
  const target = item.symbols.length > 0 ? `，标的 ${item.symbols.join(', ')}` : ''
  if (action === 'rerun') {
    return `请读取已保存策略 strategyId=${id}${target}，通过 MarketData(action:"custom_strategy_run") 重跑；如果该策略状态不是 backtested，请只读回保存证据并解释为什么不能当作可执行回测。`
  }
  if (action === 'watch') {
    return `请读取已保存策略 strategyId=${id}${target}，把它转成观察池方案并写入 Watchlist(action:"add")：必须保留 strategyId、strategyRules、触发条件、失效条件、数据来源和再次确认边界；写入后用 Watchlist(action:"list", strategyId:"${id}"${item.symbols[0] ? `, symbol:"${item.symbols[0]}"` : ''}, status:"watching") 精确读回确认，避免重复标的误认。不要直接下单。`
  }
  if (action === 'monitor') {
    const template = monitorTemplateForStrategy(item)
    const templateGuidance = monitorTemplateGuidance(template)
    return `请读取已保存策略 strategyId=${id}${target}，通过 MonitorCreate(template:"${template}") 创建监控方案：必须保留 strategyId、strategyRules 或 monitorDraft、监控频率、触发信号、需要的数据、失败处理和触发时再次确认边界；${templateGuidance} 创建后用 MonitorList 读回确认。不要直接交易。`
  }
  return `请读取已保存策略 strategyId=${id}${target}，展示策略状态、保存证据、数据来源、是否可重跑，以及下一步可做的观察池或监控动作。`
}

export function monitorTemplateForStrategy(item: StrategyActionItem): StrategyMonitorTemplate {
  if (item.strategyType === 'portfolio_strategy') return 'portfolio_rebalance_monitor'
  if (item.strategyType === 'fund_strategy' || item.strategyType === 'etf_market_strategy') return 'fund_rule_monitor'
  const assetClass = item.assetClass.toLowerCase()
  if (assetClass === 'fund' || item.status === 'observed' || item.evidenceAction === 'custom_strategy_observe') {
    return 'fund_rule_monitor'
  }
  if (item.status === 'ranked' || item.evidenceAction === 'custom_strategy_rank') {
    return 'portfolio_rebalance_monitor'
  }
  return 'strategy_signal'
}

function monitorTemplateGuidance(template: StrategyMonitorTemplate): string {
  if (template === 'fund_rule_monitor') {
    return '基金观察策略必须使用 monitorDraft / dcaObservation 和基金 NAV/yield 证据，不要套用股票 K 线信号。'
  }
  if (template === 'portfolio_rebalance_monitor') {
    return '组合排序策略必须使用 portfolioEvidence / rebalanceDraft 做复核监控，只提醒再平衡复核，不自动调仓或下单。'
  }
  return '股票策略信号使用 strategyRules 与本地 quote/kline 证据。'
}
