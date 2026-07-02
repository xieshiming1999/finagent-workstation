var strategyId = '{{strategy_id}}';
var portfolioEvidence = {{portfolio_evidence}};
var rebalanceDraft = {{rebalance_draft}};
var reviewInterval = '{{review_interval}}';
var positions = Array.isArray(rebalanceDraft.positions) ? rebalanceDraft.positions : [];
var symbols = positions
  .map(function (item) { return item.symbol || item.code || ''; })
  .filter(function (value, index, arr) { return value && arr.indexOf(value) === index; });
var portfolioBacktest =
  portfolioEvidence.portfolioBacktestEvidence ||
  rebalanceDraft.portfolioBacktestEvidence ||
  {};
var reviewKey = strategyId + ':' + symbols.join(',') + ':' + reviewInterval;

if (!state.lastPortfolioReviewKey || state.lastPortfolioReviewKey !== reviewKey) {
  state.lastPortfolioReviewKey = reviewKey;
  Bridge.sendToAgent(
    '组合策略复核触发：strategyId=' + strategyId + '。请复核 portfolioEvidence、rebalanceDraft 和再平衡边界，不要自动调仓或下单。',
    {
      template: 'portfolio_rebalance_monitor',
      strategyId: strategyId,
      signal: 'review_rebalance',
      symbols: symbols,
      portfolioEvidence: portfolioEvidence,
      rebalanceDraft: rebalanceDraft,
      reviewInterval: reviewInterval,
      confirmationRequired: true,
      tradeBoundary: 'Portfolio rebalance review only. Do not place Portfolio or XueqiuTrade orders before explicit user confirmation and post-action readback.'
    }
  );
}

return {
  template: 'portfolio_rebalance_monitor',
  strategyId: strategyId,
  signal: symbols.length > 0 ? 'review_rebalance' : 'wait',
  items: [
    { label: 'symbols', value: symbols.length },
    { label: 'return', value: portfolioBacktest.portfolioReturnPct || 0 },
    { label: 'maxDD', value: portfolioBacktest.portfolioMaxDrawdownPct || 0 }
  ],
  selectedCount: symbols.length,
  rebalanceInterval: rebalanceDraft.rebalanceInterval || reviewInterval,
  maxPositionWeight: rebalanceDraft.maxPositionWeight || null,
  confirmationRequired: true,
  tradeBoundary: 'Review only. No automatic rebalance or order.'
};
