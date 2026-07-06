import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { maybeBuildWatchlistPortfolioBacktestAnswer } from "../../src/domain/finance/workflows/finance-strategy-comparison-summary";

describe("watchlist portfolio backtest summary", () => {
  it("builds portfolio backtest answer from structured workflow state", () => {
    const answer = maybeBuildWatchlistPortfolioBacktestAnswer(messages(portfolioState()));

    expect(answer).toContain("自选股小型策略组合回测");
    expect(answer).toContain("候选池");
    expect(answer).toContain("RSI");
  });

  it("does not build portfolio backtest answer from prompt text alone", () => {
    const answer = maybeBuildWatchlistPortfolioBacktestAnswer(messages("对自选股组合做一次回测"));

    expect(answer).toBeNull();
  });
});

function messages(user: string) {
  return [
    userMessage(user),
    assistantMessage("", [
      { id: "wl", name: "Watchlist", input: { action: "list", type: "stock" } },
      { id: "summary", name: "Watchlist", input: { action: "summary", type: "stock" } },
      { id: "coverage", name: "DataStore", input: { action: "coverage" } },
      { id: "stats", name: "DataStore", input: { action: "stats" } },
      { id: "rsi", name: "MarketData", input: { action: "backtest_batch", strategy: "rsi" } },
      { id: "macd", name: "MarketData", input: { action: "backtest_batch", strategy: "macd" } },
    ]),
    toolMessage("wl", JSON.stringify({ items: [{ symbol: "300059" }, { symbol: "600519" }, { symbol: "000858" }] })),
    toolMessage("summary", "watchlist stock count=3"),
    toolMessage("coverage", "coverage ok"),
    toolMessage("stats", "stats ok"),
    toolMessage("rsi", batchMetrics("rsi", 5)),
    toolMessage("macd", batchMetrics("macd", 4)),
  ];
}

function portfolioState(): string {
  return `structured portfolio backtest request
data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"portfolio","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only watchlist portfolio backtest","evidenceRefs":["watchlist_portfolio_backtest"],"confirmationState":"none","source":"agent-structured-intent"}}`;
}

function batchMetrics(strategy: string, totalReturn: number): string {
  return JSON.stringify({
    action: "backtest_batch",
    results: [
      {
        strategy,
        totalReturn,
        maxDrawdown: -2,
        sharpe: 1.1,
        winRate: 50,
        trades: 4,
      },
    ],
  });
}
