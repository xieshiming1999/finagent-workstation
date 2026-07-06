import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { maybeBuildPositionSizingAnswer } from "../../src/domain/finance/workflows/finance-position-sizing-summary";

describe("position sizing summary", () => {
  it("builds position sizing answer from structured trade-prep state", () => {
    const answer = maybeBuildPositionSizingAnswer(messages(tradePrepState("300059")));

    expect(answer).toContain("仓位决策结论");
    expect(answer).toContain("300059");
    expect(answer).not.toContain("贵州茅台 600519");
  });

  it("does not build position sizing answer from prompt text alone", () => {
    const answer = maybeBuildPositionSizingAnswer(messages("以贵州茅台 600519 为对象：应该买多少？请给出风险仓位框架。"));

    expect(answer).toBeNull();
  });

  it("does not recover position evidence from rendered tool prose", () => {
    const evidence = messages(tradePrepState("300059"));
    evidence.splice(2, 6,
      toolMessage("quote", "price 999 source invented"),
      toolMessage("kline", "K-line 300059\n2026-07-01\t999"),
      toolMessage("fundamental", "PE 1 ROE 99"),
      toolMessage("indicators", "Latest: close 999\nRSI(14): 1"),
      toolMessage("support", "support 998 resistance 1000"),
      toolMessage("flow", "money flow ok"),
    );

    const answer = maybeBuildPositionSizingAnswer(evidence);
    expect(answer).not.toContain("999");
    expect(answer).not.toContain("RSI(14): 1");
    expect(answer).toContain("未读取到可摘要的指标结果");
  });
});

function messages(user: string) {
  return [
    userMessage(user),
    assistantMessage("", [
      { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059" } },
      { id: "kline", name: "DataStore", input: { action: "query_kline", code: "300059" } },
      { id: "fundamental", name: "DataStore", input: { action: "query_fundamental", code: "300059" } },
      { id: "indicators", name: "DataProcess", input: { action: "indicators", code: "300059" } },
      { id: "support", name: "DataProcess", input: { action: "support_summary", code: "300059" } },
      { id: "flow", name: "DataStore", input: { action: "query_money_flow", code: "300059" } },
    ]),
    toolMessage("quote", JSON.stringify({ action: "query_quote", rows: [{ code: "300059", price: 20.5, source: "tdx" }] })),
    toolMessage("kline", JSON.stringify({ action: "query_kline", source: "local", rows: [{ date: "2026-07-01", close: 20.5 }, { date: "2026-07-02", close: 20.7 }] })),
    toolMessage("fundamental", JSON.stringify({ rows: [{ code: "300059", pe: 18, pb: 2.1, roe: 15 }] })),
    toolMessage("indicators", JSON.stringify({ action: "indicators", latest: { date: "2026-07-02", close: 20.7 }, indicators: { rsi14: 52.1 } })),
    toolMessage("support", JSON.stringify({ action: "support_summary", supportResistance: { support: 19.8, resistance: 22 } })),
    toolMessage("flow", "money flow ok"),
  ];
}

function tradePrepState(symbol: string): string {
  return `structured sizing request
data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"trade_prep","assetClass":"stock","intentMode":"size","executionMode":"requires_confirmation","safetyBoundary":"trade preparation only","evidenceRefs":["trade-prep-v1"],"confirmationState":"pending","subject":"${symbol}","source":"agent-structured-intent"}}`;
}
