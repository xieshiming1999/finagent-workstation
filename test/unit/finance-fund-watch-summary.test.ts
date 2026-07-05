import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { maybeBuildFundStrategyWatchAnswer } from "../../src/domain/finance/workflows/finance-fund-watch-summary";

describe("finance fund watch summary", () => {
  it("emits analysis evidence for fund watchlist observation", () => {
    const answer = maybeBuildFundStrategyWatchAnswer([
      userMessage("帮我把易方达消费行业加入基金观察池"),
      assistantMessage("", [
        {
          id: "add",
          name: "Watchlist",
          input: {
            action: "add",
            type: "fund",
            symbol: "110022",
            name: "易方达消费行业",
            entryCondition: "回撤后定投观察",
          },
        },
        { id: "list", name: "Watchlist", input: { action: "list" } },
        { id: "fund-list", name: "DataStore", input: { action: "query_fund_list" } },
        { id: "nav", name: "DataStore", input: { action: "query_fund_nav", code: "110022" } },
      ]),
      toolMessage("add", "Added 易方达消费行业 (id: fund-watch-1, symbol: 110022)"),
      toolMessage("list", JSON.stringify({
        count: 1,
        items: [{
          id: "fund-watch-1",
          symbol: "110022",
          name: "易方达消费行业",
          type: "fund",
          entryCondition: "回撤后定投观察",
        }],
      })),
      toolMessage("fund-list", "110022 易方达消费行业 混合型 fund_list source=local"),
      toolMessage("nav", "110022 fund NAV rows=120 latest=2026-07-02 source=local"),
    ]);

    expect(answer).toContain("## 已选择并加入基金观察池");
    const evidence = analysisEvidence(answer ?? "");
    expect(evidence.contract).toBe("analysis-evidence-v1");
    expect(evidence.kind).toBe("fund_analysis");
    expect(evidence.strategyReadiness).toBe("analysis_only");
    expect(evidence.subject.id).toBe("110022");
    expect(evidence.sourceCoverage.interfaceId).toBe("fund.nav_history");
    expect(evidence.sourceCoverage.coverageStatus).toBe("sufficient_for_analysis");
  });
});

function analysisEvidence(summary: string): Record<string, any> {
  const line = summary.split(/\r?\n/).find((item) => item.startsWith("analysisEvidence:"));
  if (!line) throw new Error("analysisEvidence line missing");
  return JSON.parse(line.slice("analysisEvidence:".length));
}
