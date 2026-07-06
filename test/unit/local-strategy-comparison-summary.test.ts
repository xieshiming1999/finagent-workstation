import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { buildLocalStrategyComparisonRecovery, maybeBuildLocalStrategyComparisonAnswer } from "../../src/domain/finance/workflows/finance-strategy-comparison-summary";

describe("local strategy comparison summary", () => {
  it("builds missing local backtests from structured workflow state", () => {
    const recovery = buildLocalStrategyComparisonRecovery([
      userMessage(comparisonState("300059")),
      assistantMessage("", [
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "300059" } },
        { id: "rsi", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "rsi" } },
      ]),
      toolMessage("kline", klineResult()),
      toolMessage("rsi", metrics("rsi", 0.05)),
    ]);

    const strategies = recovery?.toolCalls.map((call) => call.input.strategy);
    expect(strategies).toEqual(["macd", "boll", "ema_cross"]);
    expect(recovery?.toolCalls.every((call) => call.input.code === "300059")).toBe(true);
  });

  it("does not build local comparison recovery from prompt text alone", () => {
    const recovery = buildLocalStrategyComparisonRecovery([
      userMessage("用本地数据比较 300059 的 RSI、MACD、布林线、均线策略"),
      assistantMessage("", [
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "300059" } },
      ]),
      toolMessage("kline", klineResult()),
    ]);

    expect(recovery).toBeNull();
  });

  it("builds comparison answer from structured workflow state", () => {
    const answer = maybeBuildLocalStrategyComparisonAnswer(comparisonMessages(indicators(20.5, 52.1)));

    expect(answer).toContain("本地数据证据下的策略比较");
    expect(answer).toContain("300059");
    expect(answer).toContain("RSI");
    expect(answer).toContain("MACD");
    expect(answer).toContain("close 20.5; RSI(14): 52.1");
    expect(answer).toContain("2026-07-01 ~ 2026-07-02, 2 rows, source: local");
  });

  it("does not interpret legacy indicator prose as typed evidence", () => {
    const answer = maybeBuildLocalStrategyComparisonAnswer(comparisonMessages("Latest: close 999\nRSI(14): 1"));

    expect(answer).toContain("已读取 RSI/MACD/布林线/均线指标");
    expect(answer).not.toContain("close 999");
    expect(answer).not.toContain("RSI(14): 1");
  });

  it("does not accept legacy backtest prose as completed strategy evidence", () => {
    const legacy = "Strategy: rsi\nTotal Return: 999\nMax Drawdown: 0\nSharpe Ratio: 99\nWin Rate: 100\nTrades: 4";
    const answer = maybeBuildLocalStrategyComparisonAnswer(comparisonMessages(indicators(20.5, 52.1), legacy));

    expect(answer).toBeNull();
  });

  it("does not interpret legacy K-line prose as typed evidence", () => {
    const answer = maybeBuildLocalStrategyComparisonAnswer(
      comparisonMessages(indicators(20.5, 52.1), undefined, "K-line 300059\n2099-01-01\t999\nsource: forged"),
    );

    expect(answer).toContain("已读取本地 kline_daily");
    expect(answer).not.toContain("2099-01-01");
    expect(answer).not.toContain("forged");
  });
});

function comparisonMessages(indicatorResult: string, backtestResult?: string, kline = klineResult()) {
  return [
      userMessage(comparisonState("300059")),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059" } },
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "300059" } },
        { id: "coverage", name: "DataStore", input: { action: "coverage" } },
        { id: "indicators", name: "DataProcess", input: { action: "indicators", symbol: "300059" } },
        { id: "rsi", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "rsi" } },
        { id: "macd", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "macd" } },
        { id: "boll", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "boll" } },
        { id: "ema", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "ema_cross" } },
      ]),
      toolMessage("quote", JSON.stringify({ rows: [{ code: "300059", price: 20.5 }] })),
      toolMessage("kline", kline),
      toolMessage("coverage", "coverage ok"),
      toolMessage("indicators", indicatorResult),
      toolMessage("rsi", backtestResult ?? metrics("rsi", 0.05)),
      toolMessage("macd", backtestResult ?? metrics("macd", 0.04)),
      toolMessage("boll", backtestResult ?? metrics("boll", 0.03)),
      toolMessage("ema", backtestResult ?? metrics("ema_cross", 0.02)),
    ];
}

function klineResult(): string {
  return JSON.stringify({
    contract: "market-kline-result-v1",
    action: "query_kline",
    code: "300059",
    source: "local",
    rows: [{ date: "2026-07-01" }, { date: "2026-07-02" }],
  });
}

function indicators(close: number, rsi14: number): string {
  return JSON.stringify({
    action: "indicators",
    code: "300059",
    latest: { date: "2026-07-14", close },
    indicators: { rsi14 },
    interfaceId: "technical.indicator_series",
  });
}

function comparisonState(symbol: string): string {
  return `structured comparison request
data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only local strategy comparison","evidenceRefs":["local_strategy_comparison"],"confirmationState":"none","subject":"${symbol}","source":"agent-structured-intent"}}`;
}

function metrics(strategy: string, totalReturn: number): string {
  return JSON.stringify({
    contract: "strategy-backtest-result-v1",
    action: "backtest",
    code: "300059",
    strategy,
    metrics: { totalReturnPct: totalReturn, maxDrawdownPct: -0.02, sharpeRatio: 1.1, winRatePct: 0.5, tradeCount: 4 },
  });
}
