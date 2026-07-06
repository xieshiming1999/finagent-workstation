import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { maybeBuildStockStrategyWatchAnswer } from "../../src/domain/finance/workflows/finance-stock-watch-summary";

describe("finance stock watch summary", () => {
  it("emits analysis evidence for stock watchlist observation", () => {
    const answer = maybeBuildStockStrategyWatchAnswer([
      userMessage("把东方财富加入股票观察池"),
      assistantMessage("", [
        {
          id: "quote",
          name: "DataStore",
          input: { action: "query_quote", code: "300059" },
        },
        {
          id: "kline",
          name: "DataStore",
          input: { action: "query_kline", code: "300059" },
        },
        {
          id: "add",
          name: "Watchlist",
          input: {
            action: "add",
            type: "stock",
            symbol: "300059",
            name: "东方财富",
            entryCondition: "放量突破后观察",
            targetEntryPrice: 20.1,
            stopLoss: 18.8,
            targetPrice: 23.5,
          },
        },
        { id: "list", name: "Watchlist", input: { action: "list" } },
      ]),
      toolMessage("quote", "300059 东方财富 quote snapshots price=20.10 source=local"),
      toolMessage("kline", "300059 kline rows=120 latest=2026-07-02 source=local"),
      toolMessage("add", "Added 东方财富 (id: stock-watch-1, symbol: 300059)"),
      toolMessage("list", JSON.stringify({
        count: 1,
        items: [{
          id: "stock-watch-1",
          symbol: "300059",
          name: "东方财富",
          status: "watching",
          entryCondition: "放量突破后观察",
          targetEntryPrice: 20.1,
          stopLoss: 18.8,
          targetPrice: 23.5,
        }],
      })),
    ]);

    expect(answer).toContain("## 已选择并加入观察池");
    const evidence = analysisEvidence(answer ?? "");
    expect(evidence.contract).toBe("analysis-evidence-v1");
    expect(evidence.kind).toBe("stock_analysis");
    expect(evidence.strategyReadiness).toBe("analysis_only");
    expect(evidence.subject.id).toBe("300059");
    expect(evidence.sourceCoverage.interfaceId).toBe("stock.daily_kline");
    expect(evidence.sourceCoverage.coverageStatus).toBe("sufficient_for_analysis");
  });

  it("does not infer the stock name from user prompt text", () => {
    const answer = maybeBuildStockStrategyWatchAnswer([
      userMessage("把300059 东方财富加入股票观察池"),
      assistantMessage("", [
        {
          id: "add",
          name: "Watchlist",
          input: {
            action: "add",
            type: "stock",
            symbol: "300059",
            entryCondition: "放量突破后观察",
          },
        },
        { id: "list", name: "Watchlist", input: { action: "list" } },
      ]),
      toolMessage("add", "Added (id: stock-watch-1, symbol: 300059)"),
      toolMessage("list", JSON.stringify({
        count: 1,
        items: [{
          id: "stock-watch-1",
          symbol: "300059",
          status: "watching",
          entryCondition: "放量突破后观察",
        }],
      })),
    ]);

    expect(answer).toContain("## 已选择并加入观察池：300059 300059");
    const evidence = analysisEvidence(answer ?? "");
    expect(evidence.subject.name).toBe("300059");
  });
});

function analysisEvidence(summary: string): Record<string, any> {
  const line = summary.split(/\r?\n/).find((item) => item.startsWith("analysisEvidence:"));
  if (!line) throw new Error("analysisEvidence line missing");
  return JSON.parse(line.slice("analysisEvidence:".length));
}
