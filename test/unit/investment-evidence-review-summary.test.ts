import { describe, expect, it } from "vitest";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import {
  buildInvestmentEvidenceReviewSearchToolCalls,
  maybeBuildInvestmentEvidenceReviewAnswer,
} from "../../src/domain/finance/workflows/finance-evidence-review-summary";

const workflowState = {
  contract: "finance-workflow-state-v1",
  workflowKind: "evidence_review",
  assetClass: "mixed",
  intentMode: "review",
  executionMode: "preview_only",
  safetyBoundary: "read-only evidence review",
  evidenceRefs: ["analysis-evidence-v1", "prior-analysis", "watch_signal_check"],
  confirmationState: "none",
  subject: "prior-analysis",
  source: "agent-structured-intent",
};

function stateMessage(text = "please inspect saved context") {
  return userMessage(`${text}\ndata: ${JSON.stringify({ workflowState })}`);
}

describe("investment evidence review summary", () => {
  it("uses structured workflow state rather than prompt text to start review search", () => {
    const calls = buildInvestmentEvidenceReviewSearchToolCalls([
      stateMessage("arbitrary non-finance wording"),
    ]);

    expect(calls).toHaveLength(4);
    expect(calls?.every((call) => call.name === "SessionSearch")).toBe(true);
  });

  it("does not start review search from the old prompt text without workflow state", () => {
    const calls = buildInvestmentEvidenceReviewSearchToolCalls([
      userMessage("复核上面所有股票和基金建议"),
    ]);

    expect(calls).toBeNull();
  });

  it("builds coverage from structured state and search-query contracts", () => {
    const answer = maybeBuildInvestmentEvidenceReviewAnswer([
      stateMessage("arbitrary non-finance wording"),
      assistantMessage("", [
        { id: "stock", name: "SessionSearch", input: { query: "HIW 股票 基金 观察池 信号检查" } },
        { id: "trade", name: "SessionSearch", input: { query: "Portfolio Xueqiu 交易" } },
      ]),
      toolMessage("stock", "assistant: historical suggestion with tool evidence"),
      toolMessage("trade", 'No matches for "Portfolio Xueqiu 交易".'),
    ]);

    expect(answer).toContain("建议复核结论");
    expect(answer).toContain("股票侧：找到");
    expect(answer).toContain("基金侧：找到");
    expect(answer).toContain("观察/监控侧：找到");
    expect(answer).toContain("交易侧：未找到可复核的雪球模拟交易或组合成交证据");
    expect(answer).toContain("未命中的检索：Portfolio Xueqiu 交易");
  });

  it("does not build coverage from arbitrary query text containing finance words", () => {
    const narrowState = {
      ...workflowState,
      assetClass: "unknown",
      evidenceRefs: [],
    };
    const answer = maybeBuildInvestmentEvidenceReviewAnswer([
      userMessage(`any text\ndata: ${JSON.stringify({ workflowState: narrowState })}`),
      assistantMessage("", [
        { id: "free", name: "SessionSearch", input: { query: "随机 股票 基金 交易 观察池" } },
      ]),
      toolMessage("free", "assistant: historical suggestion with tool evidence"),
    ]);

    expect(answer).toContain("股票侧：未找到足够股票建议证据");
    expect(answer).toContain("基金侧：未找到足够基金数据证据");
    expect(answer).toContain("观察/监控侧：未找到可复核的观察池/监控状态");
    expect(answer).toContain("交易侧：未找到可复核的雪球模拟交易或组合成交证据");
  });

  it("excludes current request-only session hits without matching a specific prompt", () => {
    const answer = maybeBuildInvestmentEvidenceReviewAnswer([
      stateMessage("any text"),
      assistantMessage("", [
        { id: "self", name: "SessionSearch", input: { query: "analysis" } },
      ]),
      toolMessage("self", "user: data: {\"workflowState\":{\"contract\":\"finance-workflow-state-v1\"}}"),
    ]);

    expect(answer).toContain("没有找到可复核的历史建议正文");
    expect(answer).toContain("仅命中当前复核请求本身的结果已排除");
  });
});
