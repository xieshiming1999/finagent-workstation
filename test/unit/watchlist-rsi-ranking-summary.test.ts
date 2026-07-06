import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { maybeBuildWatchlistRsiRankingAnswer } from "../../src/domain/finance/workflows/finance-watchlist-rsi-ranking-summary";

describe("watchlist RSI ranking summary", () => {
  it("builds ranking answer from structured workflow state", () => {
    const answer = maybeBuildWatchlistRsiRankingAnswer(messages(rankingState()));

    expect(answer).toContain("自选股 RSI 策略排序");
    expect(answer).toContain("300059");
    expect(answer).toContain("600519");
  });

  it("does not build ranking answer from prompt text alone", () => {
    const answer = maybeBuildWatchlistRsiRankingAnswer(messages("自选股里哪只最适合 RSI 策略？请排序比较。"));

    expect(answer).toBeNull();
  });

  it("does not interpret legacy indicator prose as typed evidence", () => {
    const answer = maybeBuildWatchlistRsiRankingAnswer(messages(rankingState(), "Latest: close 999\nRSI(14): 1"));

    expect(answer).toContain("未读取到额外 RSI 指标快照");
    expect(answer).not.toContain("close 999");
    expect(answer).not.toContain("RSI(14): 1");
  });

  it("does not rank legacy backtest prose as typed evidence", () => {
    const answer = maybeBuildWatchlistRsiRankingAnswer(messages(rankingState(), undefined, "Total Return: 999\nMax Drawdown: 0\nSharpe Ratio: 99\nWin Rate: 100\nTrades: 4"));

    expect(answer).toBeNull();
  });
});

function messages(user: string, indicatorResult?: string, backtestResult?: string) {
  return [
    userMessage(user),
    assistantMessage("", [
      { id: "wl", name: "Watchlist", input: { action: "list", type: "stock" } },
      { id: "q", name: "DataStore", input: { action: "query_quote", code: "300059" } },
      { id: "i1", name: "DataProcess", input: { action: "indicators", code: "300059" } },
      { id: "b1", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "rsi", limit: 120 } },
      { id: "i2", name: "DataProcess", input: { action: "indicators", code: "600519" } },
      { id: "b2", name: "MarketData", input: { action: "backtest", code: "600519", strategy: "rsi", limit: 120 } },
      { id: "i3", name: "DataProcess", input: { action: "indicators", code: "000858" } },
      { id: "b3", name: "MarketData", input: { action: "backtest", code: "000858", strategy: "rsi", limit: 120 } },
    ]),
    toolMessage("wl", JSON.stringify({ items: [{ symbol: "300059" }, { symbol: "600519" }, { symbol: "000858" }] })),
    toolMessage("q", JSON.stringify({ rows: [{ code: "300059", price: 20.5 }] })),
    toolMessage("i1", indicatorResult ?? indicators("300059", 20.5, 52.1)),
    toolMessage("b1", backtestResult ?? metrics(5)),
    toolMessage("i2", indicatorResult ?? indicators("600519", 1500, 48.2)),
    toolMessage("b2", backtestResult ?? metrics(3)),
    toolMessage("i3", indicatorResult ?? indicators("000858", 120, 42.2)),
    toolMessage("b3", backtestResult ?? metrics(2)),
  ];
}

function indicators(code: string, close: number, rsi14: number): string {
  return JSON.stringify({
    action: "indicators",
    code,
    latest: { date: "2026-07-14", close },
    indicators: { rsi14 },
    interfaceId: "technical.indicator_series",
  });
}

function rankingState(): string {
  return `structured watchlist ranking request
data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"stock","intentMode":"review","executionMode":"preview_only","safetyBoundary":"read-only watchlist ranking","evidenceRefs":["watchlist_rsi_ranking"],"confirmationState":"none","source":"agent-structured-intent"}}`;
}

function metrics(totalReturn: number): string {
  return JSON.stringify({
    contract: "strategy-backtest-result-v1",
    action: "backtest",
    code: "300059",
    strategy: "rsi",
    metrics: { totalReturnPct: totalReturn, maxDrawdownPct: -2, sharpeRatio: 1.1, winRatePct: 50, tradeCount: 4 },
  });
}
