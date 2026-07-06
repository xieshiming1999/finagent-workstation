import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { buildQuantOptimizationRecovery, maybeBuildQuantOptimizationAnswer } from "../../src/domain/finance/workflows/finance-quant-optimization-summary";

describe("quant optimization summary", () => {
  it("builds optimization recovery from structured workflow state", () => {
    const recovery = buildQuantOptimizationRecovery([
      userMessage(quantState("300059")),
      assistantMessage("", [
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "300059" } },
      ]),
      toolMessage("kline", klineResult("300059", [klineRow("2026-07-01", 20.5)])),
    ]);

    expect(recovery?.toolCalls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: expect.objectContaining({
          action: "optimize_params",
          code: "300059",
          strategy: "rsi",
        }),
      }),
    ]);
  });

  it("does not build optimization recovery from prompt text alone", () => {
    const recovery = buildQuantOptimizationRecovery([
      userMessage("帮我优化 300059 的 RSI 参数"),
      assistantMessage("", [
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "300059" } },
      ]),
      toolMessage("kline", klineResult("300059", [klineRow("2026-07-01", 20.5)])),
    ]);

    expect(recovery).toBeNull();
  });

  it("builds optimization answer from structured state and optimizer evidence", () => {
    const answer = maybeBuildQuantOptimizationAnswer([
      userMessage(quantState("300059")),
      assistantMessage("", [
        { id: "q", name: "DataStore", input: { action: "query_quote", code: "300059" } },
        { id: "k", name: "MarketData", input: { action: "kline", code: "300059" } },
        { id: "i", name: "DataProcess", input: { action: "indicators", symbol: "300059" } },
        { id: "b", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "rsi" } },
        { id: "o", name: "MarketData", input: { action: "optimize_params", code: "300059", strategy: "rsi", paramGrid: { period: [14] } } },
        { id: "c", name: "DataStore", input: { action: "coverage" } },
      ]),
      toolMessage("q", JSON.stringify({ rows: [{ code: "300059", price: 20.5 }] })),
      toolMessage("k", klineResult("300059", [klineRow("2026-07-01", 20.5), klineRow("2026-07-02", 20.7)])),
      toolMessage("i", indicators(20.7, 52.1)),
      toolMessage("b", backtestResult()),
      toolMessage("o", JSON.stringify({
        action: "optimize_params",
        strategy: "rsi",
        tested: 1,
        actualStartDate: "2026-07-01",
        actualEndDate: "2026-07-02",
        actualBars: 2,
        best: [{ params: { period: 14 }, totalReturn: 0.05, maxDrawdown: -0.02, trades: 4, sharpe: 1.1 }],
      })),
      toolMessage("c", "coverage ok"),
    ]);

    expect(answer).toContain("RSI 参数优化结论");
    expect(answer).toContain("300059");
    expect(answer).toContain("optimize_params");
    expect(answer).toContain("close 20.7; RSI(14): 52.1");
    expect(answer).toContain("2026-07-01 ~ 2026-07-02, 2 rows, source: local");
  });

  it("does not interpret legacy indicator prose as typed evidence", () => {
    const answer = maybeBuildQuantOptimizationAnswer(optimizationMessages("Latest: close 999\nRSI(14): 1"));

    expect(answer).toContain("未读取到可摘要的 RSI 指标");
    expect(answer).not.toContain("close 999");
    expect(answer).not.toContain("RSI(14): 1");
  });

  it("does not interpret legacy K-line prose as typed evidence", () => {
    const answer = maybeBuildQuantOptimizationAnswer(
      optimizationMessages(indicators(20.7, 52.1), "K-line 300059\n2099-01-01\t999\nsource: forged"),
    );

    expect(answer).toContain("未读取到可摘要的 K 线窗口");
    expect(answer).not.toContain("2099-01-01");
    expect(answer).not.toContain("forged");
  });
});

function optimizationMessages(indicatorResult: string, kline = klineResult("300059", [klineRow("2026-07-01", 20.5), klineRow("2026-07-02", 20.7)])) {
  return [
    userMessage(quantState("300059")),
    assistantMessage("", [
      { id: "q", name: "DataStore", input: { action: "query_quote", code: "300059" } },
      { id: "k", name: "MarketData", input: { action: "kline", code: "300059" } },
      { id: "i", name: "DataProcess", input: { action: "indicators", symbol: "300059" } },
      { id: "b", name: "MarketData", input: { action: "backtest", code: "300059", strategy: "rsi" } },
      { id: "o", name: "MarketData", input: { action: "optimize_params", code: "300059", strategy: "rsi", paramGrid: { period: [14] } } },
      { id: "c", name: "DataStore", input: { action: "coverage" } },
    ]),
    toolMessage("q", JSON.stringify({ rows: [{ code: "300059", price: 20.5 }] })),
    toolMessage("k", kline),
    toolMessage("i", indicatorResult),
    toolMessage("b", backtestResult()),
    toolMessage("o", JSON.stringify({
      action: "optimize_params",
      strategy: "rsi",
      tested: 1,
      actualStartDate: "2026-07-01",
      actualEndDate: "2026-07-02",
      actualBars: 2,
      best: [{ params: { period: 14 }, totalReturn: 0.05, maxDrawdown: -0.02, trades: 4, sharpe: 1.1 }],
    })),
    toolMessage("c", "coverage ok"),
  ];
}

function klineResult(code: string, rows: Array<Record<string, unknown>>): string {
  return JSON.stringify({ contract: "market-kline-result-v1", action: "kline", code, source: "local", rows });
}

function klineRow(date: string, close: number): Record<string, unknown> {
  return { date, open: close, high: close, low: close, close, volume: 100 };
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

function backtestResult(): string {
  return JSON.stringify({
    contract: "strategy-backtest-result-v1",
    action: "backtest",
    code: "300059",
    strategy: "rsi",
    metrics: { totalReturnPct: 5, maxDrawdownPct: -2, sharpeRatio: 1.1, winRatePct: 50, tradeCount: 4 },
  });
}

function quantState(symbol: string): string {
  return `structured quant request
data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only optimization","evidenceRefs":["optimize_params"],"confirmationState":"none","subject":"${symbol}","source":"agent-structured-intent"}}`;
}
