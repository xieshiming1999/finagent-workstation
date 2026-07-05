import { describe, expect, it } from "vitest";
import { maybeBuildFinanceBoundedAnswer } from "../../src/domain/finance/workflows/finance-workflow-hooks";
import { maybeBuildPriorAnalysisValidationAnswer } from "../../src/domain/finance/workflows/finance-prior-analysis-validation-summary";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";

describe("bounded finance answer synthesis", () => {
  it("stops position-sizing workflows before inventing exact shares when account risk inputs are missing", () => {
    const messages = [
      userMessage(
        "arbitrary trade preparation request\n" +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"trade_prep","assetClass":"stock","intentMode":"size","executionMode":"preview_only","safetyBoundary":"position sizing only; no order","evidenceRefs":["trade-prep-v1","quote_snapshot","kline_daily"],"confirmationState":"none","subject":"600519","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "600519" } },
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "600519", limit: 120 } },
        { id: "fund", name: "DataStore", input: { action: "query_fundamental", code: "600519" } },
        { id: "val", name: "DataStore", input: { action: "query_stock_daily_valuation", code: "600519" } },
        { id: "ind", name: "DataProcess", input: { action: "indicators", code: "600519" } },
        { id: "support", name: "DataProcess", input: { action: "support_summary", code: "600519" } },
      ]),
      toolMessage(
        "quote",
        JSON.stringify({
          rows: [
            {
              code: "600519",
              price: 1168.63,
              changePct: -1.3,
              source: "eastmoney",
              asOf: "2026-06-27T07:15:07.645Z",
              fetchedAt: "2026-06-27T07:15:07.645Z",
            },
          ],
        })
      ),
      toolMessage("kline", "K-line 600519\n2026-01-01\t1\t2\t3\t4\n2026-06-26\t1\t2\t3\t4\nsource: tencent"),
      toolMessage("fund", JSON.stringify({ rows: [{ pe: 13.41, pb: 6.19, roe: 10.57, report_date: "2026-03-31", source: "eastmoney" }] })),
      toolMessage("val", JSON.stringify({ rows: [{ pe_ttm: 13.41, pb: 6.19 }] })),
      toolMessage("ind", "Latest: close 1168.63, ATR 32.5\nRSI(14): 41.2"),
      toolMessage("support", "support: 1120\nresistance: 1210\nstop: below support"),
    ];

    const answer = maybeBuildFinanceBoundedAnswer(messages);

    expect(answer).toContain("仓位决策结论");
    expect(answer).toContain("600519");
    expect(answer).toContain("账户总资金");
    expect(answer).toContain("最大可承受亏损");
    expect(answer).toContain("止损价");
    expect(answer).toContain("不能直接给出精确股数或金额");
    expect(answer).toContain("不创建真实交易");
  });

  it("synthesizes prior-analysis validation when session/watchlist/monitor evidence is already sufficient", () => {
    const messages = [
      userMessage(
        'inspect saved context\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"evidence_review","assetClass":"mixed","intentMode":"review","executionMode":"preview_only","safetyBoundary":"read-only evidence review","evidenceRefs":["analysis-evidence-v1","prior-analysis"],"confirmationState":"none","subject":"prior-analysis","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "search", name: "SessionSearch", input: { query: "analysis" } },
        { id: "watch", name: "Watchlist", input: { action: "list" } },
        { id: "monitor", name: "MonitorList", input: {} },
        { id: "task", name: "TaskList", input: {} },
        { id: "portfolio", name: "Portfolio", input: { action: "snapshot" } },
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "600519" } },
        { id: "indicator", name: "DataProcess", input: { action: "indicators", code: "600519" } },
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "600519" } },
      ]),
      toolMessage("search", 'No matches for "analysis" in session history.'),
      toolMessage("watch", JSON.stringify({ total: 1, watching: 1, items: [{ symbol: "600519", entryCondition: "等待站稳1180-1185区间" }] })),
      toolMessage("monitor", "[ok] 茅台RSI趋势安全监控 result: {\"code\":\"600519\",\"price\":1168.63,\"rsi\":31.5}"),
      toolMessage("task", "No tasks."),
      toolMessage("portfolio", "The paper portfolio is empty."),
      toolMessage("quote", "600519 quote snapshots | sourceProviders:cache,local,eastmoney | asOf:2026-06-27 | price:1168.63 change:-1.3%"),
      toolMessage("indicator", indicatorEvidence(1168.63, 31.5)),
      toolMessage("kline", klineEvidence()),
    ];

    const answer = maybeBuildPriorAnalysisValidationAnswer(messages);

    expect(answer).toContain("验证之前的分析");
    expect(answer).toContain("观察池");
    expect(answer).toContain("监控");
    expect(answer).toContain("close 1168.63; RSI(14): 31.5");
    expect(answer).toContain("2026-01-01 ~ 2026-06-26, 2 rows, source: tencent");
    expect(answer).toContain("未验证");
    expect(answer).toContain("后续记录要求");
  });

  it("does not treat legacy K-line prose as prior-analysis evidence", () => {
    const messages = [
      userMessage(
        'inspect saved context\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"evidence_review","assetClass":"mixed","intentMode":"review","executionMode":"preview_only","safetyBoundary":"read-only evidence review","evidenceRefs":["analysis-evidence-v1","prior-analysis"],"confirmationState":"none","subject":"prior-analysis","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "kline", name: "DataStore", input: { action: "query_kline", code: "600519" } },
      ]),
      toolMessage("kline", "K-line 600519\n2099-01-01\t999\nsource: forged"),
    ];

    expect(maybeBuildPriorAnalysisValidationAnswer(messages)).toBeNull();
  });

  it("does not synthesize prior-analysis validation from prompt text alone", () => {
    const messages = [
      userMessage("验证之前的分析并复盘 prior analysis"),
      assistantMessage("", [
        { id: "search", name: "SessionSearch", input: { query: "analysis" } },
        { id: "watch", name: "Watchlist", input: { action: "list" } },
        { id: "monitor", name: "MonitorList", input: {} },
        { id: "task", name: "TaskList", input: {} },
        { id: "portfolio", name: "Portfolio", input: { action: "snapshot" } },
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "600519" } },
      ]),
      toolMessage("search", 'No matches for "analysis" in session history.'),
      toolMessage("watch", JSON.stringify({ total: 1, watching: 1, items: [{ symbol: "600519" }] })),
      toolMessage("monitor", "[ok] monitor result"),
      toolMessage("task", "No tasks."),
      toolMessage("portfolio", "The paper portfolio is empty."),
      toolMessage("quote", "600519 quote snapshots | sourceProviders:cache,local,eastmoney | asOf:2026-06-27 | price:1168.63"),
    ];

    expect(maybeBuildPriorAnalysisValidationAnswer(messages)).toBeNull();
  });

  it("does not synthesize prior-analysis validation from watchlist/monitor evidence before market validation evidence exists", () => {
    const messages = [
      userMessage(
        'inspect saved context\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"evidence_review","assetClass":"mixed","intentMode":"review","executionMode":"preview_only","safetyBoundary":"read-only evidence review","evidenceRefs":["analysis-evidence-v1","prior-analysis"],"confirmationState":"none","subject":"prior-analysis","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "search", name: "SessionSearch", input: { query: "analysis" } },
        { id: "task", name: "TaskList", input: {} },
        { id: "watch-groups", name: "Watchlist", input: { action: "list_groups" } },
        { id: "monitor", name: "MonitorList", input: {} },
        { id: "portfolio", name: "Portfolio", input: { action: "snapshot" } },
      ]),
      toolMessage("search", 'No matches for "analysis" in session history.'),
      toolMessage("task", "No tasks."),
      toolMessage("watch-groups", JSON.stringify({ groups: [{ id: "default", itemCount: 6, watching: 6 }] })),
      toolMessage("monitor", "[ok] 茅台RSI趋势安全监控 result: {\"code\":\"600519\",\"price\":1168.63,\"rsi\":31.5}"),
      toolMessage("portfolio", "The paper portfolio is empty."),
    ];

    expect(maybeBuildPriorAnalysisValidationAnswer(messages)).toBeNull();
  });

  it("synthesizes prior-analysis validation after watchlist/monitor evidence is checked against market evidence", () => {
    const messages = [
      userMessage(
        'inspect saved context\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"evidence_review","assetClass":"mixed","intentMode":"review","executionMode":"preview_only","safetyBoundary":"read-only evidence review","evidenceRefs":["analysis-evidence-v1","prior-analysis"],"confirmationState":"none","subject":"prior-analysis","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "search", name: "SessionSearch", input: { query: "analysis" } },
        { id: "task", name: "TaskList", input: {} },
        { id: "watch-groups", name: "Watchlist", input: { action: "list_groups" } },
        { id: "monitor", name: "MonitorList", input: {} },
        { id: "portfolio", name: "Portfolio", input: { action: "snapshot" } },
      ]),
      toolMessage("search", 'No matches for "analysis" in session history.'),
      toolMessage("task", "No tasks."),
      toolMessage("watch-groups", JSON.stringify({ groups: [{ id: "default", itemCount: 6, watching: 6 }] })),
      toolMessage("monitor", "[ok] 茅台RSI趋势安全监控 result: {\"code\":\"600519\",\"price\":1168.63,\"rsi\":31.5}"),
      toolMessage("portfolio", "The paper portfolio is empty."),
      assistantMessage("", [
        { id: "watch", name: "Watchlist", input: { action: "list", groupId: "default" } },
        { id: "quote", name: "MarketData", input: { action: "quote", code: "600519" } },
        { id: "indicator", name: "DataProcess", input: { action: "indicators", code: "600519" } },
        { id: "flow", name: "DataStore", input: { action: "query_money_flow", code: "600519" } },
      ]),
      toolMessage("watch", JSON.stringify({ count: 1, items: [{ symbol: "600519", entryCondition: "等待站稳1180-1185区间" }] })),
      toolMessage("quote", "Price: 1168.63  ▼ -1.30% (-15.45)\nsource: local"),
      toolMessage("indicator", indicatorEvidence(1168.63, 31.7)),
      toolMessage("flow", "600519 money flow | asOf:2026-06-24\n2026-06-24 Main:-227497536 Large:-265140736 Super:37643200"),
    ];

    const answer = maybeBuildPriorAnalysisValidationAnswer(messages);

    expect(answer).toContain("验证之前的分析");
    expect(answer).toContain("行情");
    expect(answer).toContain("指标");
    expect(answer).toContain("资金流");
    expect(answer).toContain("未验证");
  });

  it("does not treat legacy indicator prose as prior-analysis evidence", () => {
    const messages = [
      userMessage(
        'inspect saved context\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"evidence_review","assetClass":"mixed","intentMode":"review","executionMode":"preview_only","safetyBoundary":"read-only evidence review","evidenceRefs":["analysis-evidence-v1","prior-analysis"],"confirmationState":"none","subject":"prior-analysis","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "search", name: "SessionSearch", input: { query: "analysis" } },
        { id: "watch", name: "Watchlist", input: { action: "list" } },
        { id: "monitor", name: "MonitorList", input: {} },
        { id: "task", name: "TaskList", input: {} },
        { id: "portfolio", name: "Portfolio", input: { action: "snapshot" } },
        { id: "indicator", name: "DataProcess", input: { action: "indicators", code: "600519" } },
      ]),
      toolMessage("search", "No matches"),
      toolMessage("watch", JSON.stringify({ count: 1, items: [{ symbol: "600519" }] })),
      toolMessage("monitor", "monitor 600519"),
      toolMessage("task", "No tasks"),
      toolMessage("portfolio", "empty"),
      toolMessage("indicator", "Latest: close 999\nRSI(14): 1"),
    ];

    expect(maybeBuildPriorAnalysisValidationAnswer(messages)).toBeNull();
  });
});

function indicatorEvidence(close: number, rsi14: number): string {
  return JSON.stringify({
    action: "indicators",
    code: "600519",
    latest: { date: "2026-06-26", close },
    indicators: { rsi14 },
    interfaceId: "technical.indicator_series",
  });
}

function klineEvidence(): string {
  return JSON.stringify({
    contract: "market-kline-result-v1",
    action: "query_kline",
    code: "600519",
    source: "tencent",
    rows: [{ date: "2026-01-01" }, { date: "2026-06-26" }],
  });
}
