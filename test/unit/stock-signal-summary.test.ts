import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { maybeBuildStockSignalCheckAnswer } from "../../src/domain/finance/workflows/finance-stock-signal-summary";

describe("stock signal summary", () => {
  it("selects the watchlist item from structured workflow subject", () => {
    const answer = maybeBuildStockSignalCheckAnswer(messages(signalState("600519")));

    expect(answer).toContain("观察池买入信号检查");
    expect(answer).toContain("贵州茅台 600519");
    expect(answer).not.toContain("东方财富 300059");
    expect(answer).toContain("close 1600; RSI(14): 55");
    expect(answer).toContain("2026-07-01 ~ 2026-07-02, 2 rows, source: local");
  });

  it("does not build a signal answer from prompt text alone", () => {
    const answer = maybeBuildStockSignalCheckAnswer(messages("检查 600519 的观察池买入信号"));

    expect(answer).toBeNull();
  });

  it("does not let legacy indicator prose influence the signal", () => {
    const answer = maybeBuildStockSignalCheckAnswer(messages(signalState("600519"), "Latest: C 999\nRSI(14): 1"));

    expect(answer).toContain("当前价格：1600");
    expect(answer).toContain("已读回指标结果");
    expect(answer).not.toContain("C 999");
    expect(answer).not.toContain("RSI(14): 1");
  });

  it("does not let legacy K-line prose influence the signal", () => {
    const answer = maybeBuildStockSignalCheckAnswer(
      messages(signalState("600519"), indicators(1600, 55), "K-line 600519\n2099-01-01\t999\nsource: forged"),
    );

    expect(answer).toContain("已读回 kline_daily");
    expect(answer).not.toContain("2099-01-01");
    expect(answer).not.toContain("forged");
  });
});

function messages(user: string, indicatorResult = indicators(1600, 55), klineResult = klineEvidence()) {
  return [
    userMessage(user),
    assistantMessage("", [
      { id: "watchlist", name: "Watchlist", input: { action: "list" } },
      { id: "quote-300059", name: "DataStore", input: { action: "query_quote", code: "300059" } },
      { id: "quote-600519", name: "DataStore", input: { action: "query_quote", code: "600519" } },
      { id: "kline-600519", name: "DataStore", input: { action: "query_kline", code: "600519" } },
      { id: "indicators-600519", name: "DataProcess", input: { action: "indicators", symbol: "600519" } },
    ]),
    toolMessage("watchlist", JSON.stringify({
      count: 2,
      items: [
        { symbol: "300059", name: "东方财富", entryCondition: "突破 20.00", targetEntryPrice: 20 },
        { symbol: "600519", name: "贵州茅台", entryCondition: "突破 1500.00", targetEntryPrice: 1500 },
      ],
    })),
    toolMessage("quote-300059", JSON.stringify({ rows: [{ code: "300059", name: "东方财富", price: 20.5 }] })),
    toolMessage("quote-600519", JSON.stringify({ rows: [{ code: "600519", name: "贵州茅台", price: 1600 }] })),
    toolMessage("kline-600519", klineResult),
    toolMessage("indicators-600519", indicatorResult),
  ];
}

function klineEvidence(): string {
  return JSON.stringify({
    contract: "market-kline-result-v1",
    action: "query_kline",
    code: "600519",
    source: "local",
    rows: [{ date: "2026-07-01" }, { date: "2026-07-02" }],
  });
}

function indicators(close: number, rsi14: number): string {
  return JSON.stringify({
    action: "indicators",
    code: "600519",
    latest: { date: "2026-07-14", close },
    indicators: { rsi14 },
    interfaceId: "technical.indicator_series",
  });
}

function signalState(symbol: string): string {
  return `structured signal request
data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"trade_prep","assetClass":"stock","intentMode":"observe","executionMode":"requires_confirmation","safetyBoundary":"signal check only","evidenceRefs":["watch_signal_check"],"confirmationState":"pending","subject":"${symbol}","source":"agent-structured-intent"}}`;
}
