import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { buildStrategyMonitorRecovery } from "../../src/domain/finance/workflows/finance-strategy-monitor-recovery";

describe("strategy monitor recovery", () => {
  it("uses structured monitor state and evidence instead of prompt keywords", () => {
    const recovery = buildStrategyMonitorRecovery([
      userMessage(
        'stateful request\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"monitor_review","assetClass":"stock","intentMode":"observe","executionMode":"preview_only","safetyBoundary":"observation only","evidenceRefs":["strategy_review"],"confirmationState":"none","subject":"300059","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059" } },
        { id: "indicators", name: "DataProcess", input: { action: "indicators", symbol: "300059" } },
      ]),
      toolMessage("quote", JSON.stringify({ rows: [{ code: "300059", name: "东方财富", price: 20.5, source: "tdx" }] })),
      toolMessage("indicators", indicators(20.5, 48.2)),
    ]);

    expect(recovery).toEqual(expect.objectContaining({
      code: "300059",
      name: "东方财富",
    }));
    expect(recovery?.toolCalls[0].input.name).toContain("300059");
    expect(recovery?.toolCalls[0].input.name).not.toContain("600519");
    expect(String(recovery?.toolCalls[0].input.script)).toContain("code: '300059'");
    expect(recovery?.indicatorSummary).toBe("close 20.5; RSI(14): 48.2");
  });

  it("does not create monitor recovery from prompt text alone", () => {
    const recovery = buildStrategyMonitorRecovery([
      userMessage("回测结果不错，帮我设置监控并回读确认。"),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059" } },
        { id: "indicators", name: "DataProcess", input: { action: "indicators", symbol: "300059" } },
      ]),
      toolMessage("quote", JSON.stringify({ rows: [{ code: "300059", name: "东方财富", price: 20.5 }] })),
      toolMessage("indicators", indicators(20.5, 48.2)),
    ]);

    expect(recovery).toBeNull();
  });

  it("does not treat backtest-like action names as backtest evidence", () => {
    const recovery = buildStrategyMonitorRecovery([
      userMessage(
        'stateful request\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"monitor_review","assetClass":"stock","intentMode":"observe","executionMode":"preview_only","safetyBoundary":"observation only","evidenceRefs":["strategy_review"],"confirmationState":"none","subject":"300059","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059" } },
        { id: "fake", name: "DataProcess", input: { action: "not_a_backtest_contract", symbol: "300059" } },
      ]),
      toolMessage("quote", JSON.stringify({ rows: [{ code: "300059", name: "东方财富", price: 20.5, source: "tdx" }] })),
      toolMessage("fake", JSON.stringify({ action: "not_a_backtest_contract", status: "ok" })),
    ]);

    expect(recovery).toBeNull();
  });

  it("does not interpret legacy indicator prose as typed evidence", () => {
    const recovery = buildStrategyMonitorRecovery([
      userMessage(
        'stateful request\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"monitor_review","assetClass":"stock","intentMode":"observe","executionMode":"preview_only","safetyBoundary":"observation only","evidenceRefs":["strategy_review"],"confirmationState":"none","subject":"300059","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059" } },
        { id: "indicators", name: "DataProcess", input: { action: "indicators", symbol: "300059" } },
      ]),
      toolMessage("quote", JSON.stringify({ rows: [{ code: "300059", name: "东方财富", price: 20.5 }] })),
      toolMessage("indicators", "Latest: close 999\nRSI(14): 1"),
    ]);

    expect(recovery?.indicatorSummary).toBeNull();
  });
});

function indicators(close: number, rsi14: number): string {
  return JSON.stringify({
    action: "indicators",
    code: "300059",
    latest: { date: "2026-07-14", close },
    indicators: { rsi14 },
    interfaceId: "technical.indicator_series",
  });
}
