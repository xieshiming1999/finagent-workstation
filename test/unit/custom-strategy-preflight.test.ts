import { describe, expect, it } from "vitest";
import { buildFinancePreflightToolCalls, maybeBuildFinanceBoundedAnswer, maybeInterceptFinanceToolCalls } from "../../src/domain/finance/workflows/finance-workflow-hooks";
import { assistantMessage, toolMessage, userMessage } from "../../src/agent/message";
import { financeWorkflowStateFromToolCall } from "../../src/domain/finance/workflows/finance-workflow-state";

describe("custom strategy preflight", () => {
  it("does not discover the custom strategy contract from prompt text alone", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("帮我为贵州茅台设计一个低风险买入策略，必须包含入场、止损、止盈、仓位规则，并验证哪些条件当前系统支持。"),
    ]);

    expect(calls).toBeNull();
  });

  it("discovers the custom strategy contract from structured state without prompt words", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(
        'prepare artifact\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"validate","executionMode":"preview_only","safetyBoundary":"read-only validation","evidenceRefs":["StrategySpec"],"confirmationState":"none","source":"agent-structured-intent"},"strategySpec":{"id":"state_strategy_v1","assetClass":"stock","symbol":"300059","symbols":["300059"]}}'
      ),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: { action: "custom_strategy_help" },
      }),
    ]);
  });

  it("uses structured StrategySpec after contract discovery", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(
        'prepare artifact\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only backtest","evidenceRefs":["StrategySpec"],"confirmationState":"none","source":"agent-structured-intent"},"strategySpec":{"id":"state_strategy_v1","assetClass":"stock","symbol":"300059","symbols":["300059"],"timeframe":"1d"}}'
      ),
      assistantMessage("", [
        { id: "help", name: "MarketData", input: { action: "custom_strategy_help" } },
      ]),
      toolMessage("help", JSON.stringify({ action: "custom_strategy_help" })),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: expect.objectContaining({
          action: "custom_strategy_backtest",
          strategySpec: expect.objectContaining({
            id: "state_strategy_v1",
            symbol: "300059",
          }),
        }),
      }),
    ]);
  });

  it("answers saved strategy comparison from structured custom_strategy_run evidence", () => {
    const messages = [
      userMessage(
        'strategy rerun\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"rerun","executionMode":"readback","safetyBoundary":"read-only strategy rerun","subjects":["300059","600519"],"confirmationState":"none","source":"agent-structured-intent"}}',
      ),
      assistantMessage("", [
        { id: "list", name: "MarketData", input: { action: "custom_strategy_list" } },
      ]),
      toolMessage("list", JSON.stringify({ action: "custom_strategy_list", count: 1 })),
      assistantMessage("", [
        {
          id: "run-300059",
          name: "MarketData",
          input: { action: "custom_strategy_run", strategyId: "saved_strategy_v1", code: "300059" },
        },
        {
          id: "run-600519",
          name: "MarketData",
          input: { action: "custom_strategy_run", strategyId: "saved_strategy_v1", code: "600519" },
        },
      ]),
      toolMessage("run-300059", JSON.stringify({
        action: "custom_strategy_run",
        strategyId: "saved_strategy_v1",
        code: "300059",
        status: "backtested",
        bars: 121,
        actualStartDate: "2025-12-25",
        actualEndDate: "2026-06-30",
        metrics: { tradeCount: 0, totalReturnPct: 0, maxDrawdownPct: 0, winRatePct: 0 },
        benchmarkEvidence: { benchmarkReturnPct: -12.68 },
        dataCoverage: { rows: 121, actualStartDate: "2025-12-25", actualEndDate: "2026-06-30", source: "local", cacheStatus: "local-hit" },
      })),
      toolMessage("run-600519", JSON.stringify({
        action: "custom_strategy_run",
        strategyId: "saved_strategy_v1",
        code: "600519",
        status: "backtested",
        bars: 126,
        actualStartDate: "2025-12-24",
        actualEndDate: "2026-07-06",
        metrics: { tradeCount: 2, totalReturnPct: 3.4, maxDrawdownPct: 2.1, winRatePct: 50 },
        benchmarkEvidence: { benchmarkReturnPct: 1.2 },
        dataCoverage: { rows: 126, actualStartDate: "2025-12-24", actualEndDate: "2026-07-06", source: "local", cacheStatus: "local-hit" },
      })),
    ];

    const answer = maybeBuildFinanceBoundedAnswer(messages);

    expect(answer).toContain("已保存策略重跑比较");
    expect(answer).toContain("saved_strategy_v1");
    expect(answer).toContain("300059");
    expect(answer).toContain("600519");
    expect(answer).toContain("系统已停止追加保存");
  });

  it("does not infer unsupported custom strategy state from tool-call text", () => {
    const state = financeWorkflowStateFromToolCall({
      id: "validation",
      name: "MarketData",
      input: {
        action: "custom_strategy_validate",
        strategySpec: {
          name: "news sentiment proxy",
          entry: {
            conditions: [{ indicator: "rsi", operator: ">", value: 40 }],
          },
        },
      },
    });

    expect(state?.hasUnsupportedExecutableParts).not.toBe(true);
  });

  it("preserves explicit unsupported state from tool-call workflowState", () => {
    const state = financeWorkflowStateFromToolCall({
      id: "validation",
      name: "MarketData",
      input: {
        action: "custom_strategy_validate",
        workflowState: {
          contract: "finance-workflow-state-v1",
          workflowKind: "strategy_design",
          assetClass: "stock",
          intentMode: "validate",
          executionMode: "blocked",
          safetyBoundary: "unsupported strategy parts",
          evidenceRefs: ["StrategySpec"],
          confirmationState: "none",
          source: "agent-structured-intent",
          hasUnsupportedExecutableParts: true,
        },
        strategySpec: { name: "proxy strategy" },
      },
    });

    expect(state?.hasUnsupportedExecutableParts).toBe(true);
    expect(state?.executionMode).toBe("blocked");
  });

  it("does not rerun discovery after a custom strategy action exists in the same turn", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("帮我设计一个策略并验证。"),
      assistantMessage("", [
        { id: "validate", name: "MarketData", input: { action: "custom_strategy_validate", strategySpec: {} } },
      ]),
    ]);

    const names = calls?.map((call) => call.name) ?? [];
    expect(names).not.toContain('XueqiuTrade');
    expect(names).not.toContain('Portfolio');
  });

  it("does not route ordinary preset strategy selection through custom StrategySpec", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("茅台用现有 RSI 策略最近一年表现怎么样？"),
    ]);

    expect(calls).toBeNull();
  });

  it("does not route fund observation strategy prompts through stock StrategySpec", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("帮我设计一个基金定投观察策略，要求考虑回撤和净值趋势，不要使用股票 K 线信号。"),
    ]);

    expect(calls).toBeNull();
  });

  it("does not trigger trade sizing preflight for portfolio rebalance monitor creation", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(`请只为已保存的 strategyId=workflow_portfolio_rank_monitor_v1 创建一个新的组合再平衡复核监控，使用 MonitorCreate(template:"portfolio_rebalance_monitor")。
rebalanceDraft.positions 必须包含：600519 targetWeight 0.33、000858 targetWeight 0.33、300059 targetWeight 0.34。
rebalanceDraft.rebalanceInterval="monthly"，rebalanceDraft.maxPositionWeight=0.4。
只做复核监控，不做任何交易写入。`),
    ]);

    const names = calls?.map((call) => call.name) ?? [];
    expect(names).not.toContain('XueqiuTrade');
    expect(names).not.toContain('Portfolio');
  });

  it("uses strategy signal monitor payload as the trade sizing symbol source", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage('[Monitor Notification: 金风科技_002202_策略信号监控] 策略信号已触发：金风科技 002202.SZ。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。\ndata: {"template":"strategy_signal","strategyId":"workflow_test_strategy_signal_002202","code":"002202.SZ","name":"金风科技","signal":"entry","price":23.9,"confirmationRequired":true}'),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "DataStore",
        input: {
          action: "query_quote",
          code: "002202",
          limit: 1,
        },
      }),
    ]);
  });

  it("continues a fund strategy workflow from governed fund readback into fund observation", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(
        'fund workflow\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"fund","intentMode":"observe","executionMode":"preview_only","safetyBoundary":"fund observation only","evidenceRefs":["fund_nav"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "fund-nav", name: "DataStore", input: { action: "query_fund_nav", code: "001480", limit: 60 } },
      ]),
      toolMessage("fund-nav", "001480 fund NAV | interface:fund.nav_history | provider:eastmoney"),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: expect.objectContaining({
          action: "custom_strategy_observe",
          symbols: ["001480"],
          strategySpec: expect.objectContaining({
            assetClass: "fund",
            fundCode: "001480",
          }),
        }),
      }),
    ]);
  });

  it("does not enter fund strategy preflight from prompt text alone", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("帮我设计一个基金定投观察策略，要求考虑回撤和净值趋势，不要使用股票 K 线信号。"),
      assistantMessage("", [
        { id: "fund-nav", name: "DataStore", input: { action: "query_fund_nav", code: "001480", limit: 60 } },
      ]),
      toolMessage("fund-nav", "001480 fund NAV | interface:fund.nav_history | provider:eastmoney"),
    ]);

    expect(calls).toBeNull();
  });

  it("does not turn broad fund selection observation wording into fund strategy observation", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("帮我选几个适合长期观察的基金，并说明数据依据。请区分普通基金和货币基金的数据口径。"),
      assistantMessage("", [
        { id: "fund-nav", name: "DataStore", input: { action: "query_fund_nav", code: "000011", limit: 120 } },
      ]),
      toolMessage("fund-nav", "000011 fund NAV | interface:fund.nav_history | provider:eastmoney"),
    ]);

    expect(calls).toBeNull();
  });

  it("continues after custom strategy help has already succeeded", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("设计一个可验证的买入策略。"),
      assistantMessage("", [
        { id: "help", name: "MarketData", input: { action: "custom_strategy_help" } },
      ]),
      toolMessage("help", JSON.stringify({ action: "custom_strategy_help" })),
    ]);

    expect(calls).toBeNull();
  });

  it("does not draft a default stock backtest when StrategySpec is missing", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(
        'prepare backtest\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only backtest","evidenceRefs":["StrategySpec"],"confirmationState":"none","subject":"300059","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "help", name: "MarketData", input: { action: "custom_strategy_help" } },
      ]),
      toolMessage("help", JSON.stringify({ action: "custom_strategy_help" })),
    ]);

    expect(calls).toBeNull();
  });

  it("save-and-rerun preflight saves latest backtested strategy evidence", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("帮我设计策略并用本地数据回测。"),
      assistantMessage("", [
        { id: "backtest", name: "MarketData", input: { action: "custom_strategy_backtest" } },
      ]),
      toolMessage("backtest", JSON.stringify({
        action: "custom_strategy_backtest",
        status: "backtested",
        symbol: "300059",
        strategyId: "custom_low_risk_entry_v1",
        validation: {
          strategyId: "custom_low_risk_entry_v1",
          spec: {
            id: "custom_low_risk_entry_v1",
            symbol: "300059",
            symbols: ["300059"],
          },
        },
        metrics: { tradeCount: 3 },
      })),
      userMessage(
        'persist strategy artifact\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"stock","intentMode":"save","executionMode":"preview_only","safetyBoundary":"save strategy artifact only","evidenceRefs":["custom_strategy_backtest"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: expect.objectContaining({
          action: "custom_strategy_save",
          strategySpec: expect.objectContaining({ symbol: "300059" }),
          evidence: expect.objectContaining({ status: "backtested" }),
        }),
      }),
    ]);
  });

  it("save-and-rerun preflight runs saved backtested strategy by id", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage("把刚才验证通过的策略保存下来，然后重新按策略 ID 跑一次，确认结果一致。"),
      assistantMessage("", [
        { id: "save", name: "MarketData", input: { action: "custom_strategy_save" } },
      ]),
      toolMessage("save", JSON.stringify({
        action: "custom_strategy_save",
        status: "evidence_attached",
        strategyId: "custom_low_risk_entry_v1",
        spec: {
          id: "custom_low_risk_entry_v1",
          universe: {
            type: "single",
            symbols: ["300059"],
          },
        },
        evidence: {
          status: "backtested",
          actualStartDate: "2025-12-24",
          actualEndDate: "2026-06-30",
          bars: 122,
        },
      })),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: {
          action: "custom_strategy_run",
          strategyId: "custom_low_risk_entry_v1",
          symbols: ["300059"],
        },
      }),
    ]);
  });

  it("answers after saved strategy reruns successfully instead of continuing tool cycles", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(
        'persist and rerun strategy artifact\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"stock","intentMode":"rerun","executionMode":"preview_only","safetyBoundary":"save and rerun strategy artifact only","evidenceRefs":["custom_strategy_backtest","custom_strategy_save","custom_strategy_run"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
      assistantMessage("", [
        { id: "save", name: "MarketData", input: { action: "custom_strategy_save" } },
        { id: "run", name: "MarketData", input: { action: "custom_strategy_run", strategyId: "custom_low_risk_entry_v1", symbols: ["300059"] } },
      ]),
      toolMessage("save", JSON.stringify({
        action: "custom_strategy_save",
        status: "evidence_attached",
        strategyId: "custom_low_risk_entry_v1",
        spec: {
          id: "custom_low_risk_entry_v1",
          universe: { type: "single", symbols: ["300059"] },
        },
        evidence: { status: "backtested" },
      })),
      toolMessage("run", JSON.stringify({
        action: "custom_strategy_run",
        status: "backtested",
        strategyId: "custom_low_risk_entry_v1",
        code: "300059",
        actualStartDate: "2025-12-24",
        actualEndDate: "2026-06-30",
        bars: 122,
        metrics: {
          tradeCount: 2,
          totalReturn: 0.08,
          maxDrawdown: -0.03,
          winRate: 0.5,
        },
      })),
    ]);

    expect(answer).toContain("## 策略保存与重跑完成");
    expect(answer).toContain("custom_low_risk_entry_v1");
    expect(answer).toContain("custom_strategy_run");
    expect(answer).toContain("交易次数：2");
  });

  it("collects account evidence from structured trade sizing state", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(tradeSizingStateContent("300059")),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({ name: "XueqiuTrade", input: { action: "portfolios" } }),
      expect.objectContaining({ name: "XueqiuTrade", input: { action: "balance" } }),
      expect.objectContaining({ name: "Portfolio", input: { action: "snapshot", market: "cn" } }),
    ]);
  });

  it("honors workflow controls that forbid XueqiuTrade during trade sizing", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(tradeSizingStateContent("300059", ["Bash", "Script", "Read", "XueqiuTrade"])),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({ name: "Portfolio", input: { action: "snapshot", market: "cn" } }),
    ]);
  });

  it("asks for confirmation after local-only sizing evidence when XueqiuTrade is forbidden", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(tradeSizingStateContent("300059", ["Bash", "Script", "Read", "XueqiuTrade"])),
      assistantMessage("", [
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
      ]),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 100000 })),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "AskUserQuestion",
        input: expect.objectContaining({
          questions: expect.arrayContaining([
            expect.objectContaining({ header: "交易确认" }),
          ]),
        }),
      }),
    ]);
  });

  it("asks for confirmation after strategy sizing account evidence exists", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage(tradeSizingStateContent("300059")),
      assistantMessage("", [
        { id: "portfolios", name: "XueqiuTrade", input: { action: "portfolios" } },
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
      ]),
      toolMessage("portfolios", JSON.stringify({ portfolios: [{ name: "finasimu" }] })),
      toolMessage("balance", JSON.stringify({ performances: [{ cash: 86384.1 }] })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 100000 })),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "AskUserQuestion",
        input: expect.objectContaining({
          questions: expect.arrayContaining([
            expect.objectContaining({ header: "交易确认" }),
          ]),
        }),
      }),
    ]);
  });

  it("produces preview-only trade calls after explicit simulation confirmation", () => {
    const calls = buildFinancePreflightToolCalls([
      toolMessage("backtest", JSON.stringify({
        action: "custom_strategy_backtest",
        status: "backtested",
        symbol: "300059",
        strategyId: "custom_strategy_v1",
      })),
      userMessage(tradeSizingStateContent("300059")),
      assistantMessage("", [
        { id: "quote", name: "MarketData", input: { action: "query_quote", symbols: ["300059"] } },
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
      ]),
      toolMessage("quote", JSON.stringify({
        action: "query_quote",
        data: [{ code: "300059", price: 20 }],
      })),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 200000, assets: 200000 })),
      toolMessage("ask", JSON.stringify({ decision: "allow_preview", selectedOptionIndex: 3, selectedOptionLabel: "允许模拟执行" })),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "Portfolio",
        input: {
          action: "preview_trade",
          market: "cn",
          symbol: "300059",
          side: "buy",
          shares: 1000,
          price: 20,
        },
      }),
      expect.objectContaining({
        name: "XueqiuTrade",
        input: {
          action: "preview_order",
          side: "buy",
          symbol: "300059",
          shares: 1000,
          price: 20,
        },
      }),
    ]);
  });

  it("uses monitor payload price for preview after desktop text quote readback", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage('[Monitor Notification: 东方财富_300059_策略信号监控] 策略信号已触发：东方财富 300059。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。\ndata: {"template":"strategy_signal","strategyId":"workflow_trade_preview_strategy_300059","code":"300059","name":"东方财富","signal":"entry","price":21.89,"confirmationRequired":true}'),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059", limit: 1 } },
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
      ]),
      toolMessage("quote", "300059 quote snapshots | interface:stock.quote | price:20.97"),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 200000, assets: 200000 })),
      toolMessage("ask", JSON.stringify({ decision: "allow_preview", selectedOptionIndex: 3, selectedOptionLabel: "允许模拟执行" })),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "Portfolio",
        input: expect.objectContaining({
          action: "preview_trade",
          symbol: "300059",
          shares: 900,
          price: 21.89,
        }),
      }),
      expect.objectContaining({
        name: "XueqiuTrade",
        input: expect.objectContaining({
          action: "preview_order",
          symbol: "300059",
          shares: 913,
          price: 21.89,
        }),
      }),
    ]);
  });

  it("answers strategy trade sizing from structured Xueqiu and portfolio evidence", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(tradeSizingStateContent("300059")),
      assistantMessage("", [
        { id: "signal", name: "MarketData", input: { action: "custom_strategy_observe" } },
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
      ]),
      toolMessage("signal", JSON.stringify({
        action: "custom_strategy_observe",
        strategyId: "custom_strategy_v1",
        signalStatus: "wait",
      })),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 1000000, assets: 1000000 })),
      toolMessage("ask", JSON.stringify({ answer: "触发时再确认" })),
    ]);

    expect(answer).toContain('XueqiuTrade(action:"balance")');
    expect(answer).toContain('Portfolio(action:"snapshot")');
    expect(answer).toContain("触发时再确认");
    expect(answer).toContain("未调用 XueqiuTrade");
    const prep = tradePrep(answer ?? "");
    expect(prep.contract).toBe("trade-prep-v1");
    expect(prep.prepKind).toBe("strategy_signal_position_sizing");
    expect(prep.boundaries).toContain("no_order_write");
    expect(prep.evidence).toMatchObject({
      xueqiuBalance: true,
      portfolioSnapshot: true,
      strategySignal: true,
    });
  });

  it("does not enter trade sizing summary from prompt text alone", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage("如果策略触发买入信号，先计算买入数量和风险，不要直接下单；需要我确认后才允许进入雪球模拟盘。"),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
    ]);

    expect(answer).toBeNull();
  });

  it("preserves monitor strategy signal evidence in trade sizing summary", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage('[Monitor Notification: 金风科技_002202_策略信号监控] 策略信号已触发：金风科技 002202。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。\ndata: {"template":"strategy_signal","strategyId":"workflow_test_strategy_signal_002202","code":"002202","name":"金风科技","signal":"entry","price":23.9,"confirmationRequired":true}'),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { question: "请选择操作", options: ["1", "2", "3"] } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 1000000, totalAssets: 1000000, positions: 0, holdings: [] })),
      toolMessage("ask", "3"),
    ]);

    expect(answer).toContain("strategyId=workflow_test_strategy_signal_002202");
    expect(answer).toContain("signal=entry");
    expect(answer).toContain("标的=002202");
    expect(answer).toContain("参考价=23.90");
    expect(answer).toContain("strategy_signal");
    expect(answer).toContain("未调用 XueqiuTrade");
  });

  it("summarizes fund monitor trigger as fund observation review, not stock trade sizing", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage('[Monitor Notification: 基金定投观察] 基金观察策略已触发：易方达消费行业 110022。请先复核基金净值、回撤、波动和定投边界，不要直接申购、赎回或写入模拟交易。\ndata: {"template":"fund_rule_monitor","strategyId":"fund_dca_observation_110022_v1","code":"110022","signal":"observe_or_prepare","value":3.4567,"monitorDraft":{"mode":"fund_rule_monitor","cadenceDays":30},"dcaObservation":{"mode":"fund_observation_only","cadenceDays":30},"confirmationRequired":true}'),
      assistantMessage("", [
        { id: "ask", name: "AskUserQuestion", input: { question: "是否进入基金观察复核？", options: ["1. 只复核，不交易", "2. 取消"] } },
      ]),
      toolMessage("ask", "1"),
    ]);

    expect(answer).toContain("基金观察监控已触发");
    expect(answer).toContain("strategyId=fund_dca_observation_110022_v1");
    expect(answer).toContain("fund=110022");
    expect(answer).toContain("fund_rule_monitor");
    expect(answer).toContain("不申购、不赎回");
    expect(answer).toContain("不使用股票 K 线信号");
    const evidence = analysisEvidence(answer ?? "");
    expect(evidence.contract).toBe("analysis-evidence-v1");
    expect(evidence.kind).toBe("fund_analysis");
    expect(evidence.strategyReadiness).toBe("analysis_only");
    expect(evidence.subject.id).toBe("110022");
    expect(evidence.sourceCoverage.interfaceId).toBe("fund.monitor_event");
    expect(answer).not.toContain("XueqiuTrade(action:\"balance\")");
  });

  it("asks a fund-specific confirmation before reviewing fund monitor trigger", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage('[Monitor Notification: 基金定投观察] 基金观察策略已触发：易方达消费行业 110022。请先复核基金净值、回撤、波动和定投边界，不要直接申购、赎回或写入模拟交易。\ndata: {"template":"fund_rule_monitor","strategyId":"fund_dca_observation_110022_v1","code":"110022","signal":"observe_or_prepare","confirmationRequired":true}'),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "AskUserQuestion",
        input: expect.objectContaining({
          questions: expect.arrayContaining([
            expect.objectContaining({ header: "基金观察" }),
          ]),
        }),
      }),
    ]);
  });

  it("asks a portfolio-specific confirmation before reviewing rebalance monitor trigger", () => {
    const calls = buildFinancePreflightToolCalls([
      userMessage('[Monitor Notification: 组合再平衡复核] 组合策略复核触发：strategyId=portfolio_rank_v1。请复核 portfolioEvidence、rebalanceDraft 和再平衡边界，不要自动调仓或下单。\ndata: {"template":"portfolio_rebalance_monitor","strategyId":"portfolio_rank_v1","signal":"review_rebalance","portfolioEvidence":{"mode":"equal_weight_selected_metrics","selectedCount":2,"aggregateMetrics":{"selectedSymbols":["600519","000858"],"expectedReturnPct":8.4,"portfolioMaxDrawdownPct":-5.2}},"rebalanceDraft":{"mode":"equal_weight_top_n","rebalanceInterval":"monthly","maxPositionWeight":0.4,"positions":[{"symbol":"600519","targetWeight":0.4,"weightCapped":true},{"symbol":"000858","targetWeight":0.4}],"tradeBoundary":"evidence only; confirmation required before any order"},"confirmationRequired":true}'),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        name: "AskUserQuestion",
        input: expect.objectContaining({
          questions: expect.arrayContaining([
            expect.objectContaining({ header: "组合复核" }),
          ]),
        }),
      }),
    ]);
  });

  it("summarizes portfolio rebalance monitor trigger without trade writes", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage('[Monitor Notification: 组合再平衡复核] 组合策略复核触发：strategyId=portfolio_rank_v1。请复核 portfolioEvidence、rebalanceDraft 和再平衡边界，不要自动调仓或下单。\ndata: {"template":"portfolio_rebalance_monitor","strategyId":"portfolio_rank_v1","signal":"review_rebalance","portfolioEvidence":{"mode":"equal_weight_selected_metrics","selectedCount":2,"aggregateMetrics":{"selectedSymbols":["600519","000858"],"expectedReturnPct":8.4,"portfolioMaxDrawdownPct":-5.2},"portfolioBacktestEvidence":{"bars":120,"portfolioReturnPct":6.1}},"rebalanceDraft":{"mode":"equal_weight_top_n","rebalanceInterval":"monthly","maxPositionWeight":0.4,"positions":[{"symbol":"600519","targetWeight":0.4,"weightCapped":true},{"symbol":"000858","targetWeight":0.4}],"tradeBoundary":"evidence only; confirmation required before any order"},"confirmationRequired":true}'),
      assistantMessage("", [
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "组合复核" }] } },
      ]),
      toolMessage("ask", "1"),
    ]);

    expect(answer).toContain("组合再平衡监控已触发");
    expect(answer).toContain("strategyId=portfolio_rank_v1");
    expect(answer).toContain("portfolio_rebalance_monitor");
    expect(answer).toContain("600519、000858");
    expect(answer).toContain("targetWeight=40.0%");
    expect(answer).toContain("不自动调仓");
    expect(answer).toContain("不写入 Portfolio 交易");
    const review = strategyReview(answer ?? "");
    expect(review.contract).toBe("strategy-review-v1");
    expect(review.reviewKind).toBe("portfolio_rebalance_monitor");
    expect(review.strategyId).toBe("portfolio_rank_v1");
    expect(review.subjects).toEqual(expect.arrayContaining(["600519", "000858"]));
    expect(review.boundaries).toContain("no_portfolio_mutation");
    expect(answer).not.toContain('XueqiuTrade(action:"balance")');
  });

  it("records plain-text AskUserQuestion confirmation without authorizing preview", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(tradeSizingStateContent("300059")),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("ask", "触发时再确认"),
    ]);

    expect(answer).toContain('XueqiuTrade(action:"balance")');
    expect(answer).toContain("触发时再确认");
  });

  it("waits for preview evidence after simulation approval", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage('[Monitor Notification: 东方财富_300059_策略信号监控] 策略信号已触发：东方财富 300059。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。\ndata: {"template":"strategy_signal","strategyId":"workflow_trade_preview_strategy_300059","code":"300059","name":"东方财富","signal":"entry","price":21.89,"confirmationRequired":true}'),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { question: "是否允许模拟执行？" } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 200000, assets: 200000 })),
      toolMessage("ask", JSON.stringify({ decision: "allow_preview", selectedOptionIndex: 3, selectedOptionLabel: "允许模拟执行" })),
    ]);

    expect(answer).toBeNull();
  });

  it("reports post-confirmation preview evidence in trade sizing summary", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(tradeSizingStateContent("300059")),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
        { id: "portfolio-preview", name: "Portfolio", input: { action: "preview_trade", symbol: "300059", side: "buy", shares: 900, price: 21.89 } },
        { id: "xueqiu-preview", name: "XueqiuTrade", input: { action: "preview_order", symbol: "300059", side: "buy", shares: 900, price: 21.89 } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 200000, assets: 200000 })),
      toolMessage("ask", JSON.stringify({ decision: "allow_preview", selectedOptionIndex: 3, selectedOptionLabel: "允许模拟执行" })),
      toolMessage("portfolio-preview", JSON.stringify({
        action: "preview_trade",
        sideEffect: false,
        executionAllowed: true,
        order: { symbol: "300059", side: "buy", shares: 900, price: 21.89 },
        estimated: { cashBefore: 200000, cashAfter: 180299 },
      })),
      toolMessage("xueqiu-preview", JSON.stringify({
        action: "preview_order",
        sideEffect: false,
        order: { symbol: "300059", side: "buy", shares: 900, price: 21.89 },
        readbackEvidence: { balance: {}, position: {} },
      })),
    ]);

    expect(answer).toContain("## 非写入预览");
    expect(answer).toContain('Portfolio(action:"preview_trade")');
    expect(answer).toContain('XueqiuTrade(action:"preview_order")');
    expect(answer).toContain("order=buy 300059 900 @ 21.89");
    expect(answer).toContain("sideEffect=false");
    expect(answer).toContain("预览结果不代表已下单");
    expect(answer).toContain("当前回答不是下单指令");
  });

  it("reports monitor-trigger preview evidence in trade sizing summary", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage('[Monitor Notification: 东方财富_300059_策略信号监控] 策略信号已触发：东方财富 300059。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。\ndata: {"template":"strategy_signal","strategyId":"workflow_trade_preview_strategy_300059","code":"300059","name":"东方财富","signal":"entry","price":21.89,"confirmationRequired":true}'),
      assistantMessage("", [
        { id: "quote", name: "DataStore", input: { action: "query_quote", code: "300059", limit: 1 } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
        { id: "portfolio-preview", name: "Portfolio", input: { action: "preview_trade", symbol: "300059", side: "buy", shares: 900, price: 21.89 } },
        { id: "xueqiu-preview", name: "XueqiuTrade", input: { action: "preview_order", symbol: "300059", side: "buy", shares: 900, price: 21.89 } },
      ]),
      toolMessage("quote", "300059 quote snapshots | interface:stock.quote | price:21.06"),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 1000000, totalAssets: 1000000, positions: 0, holdings: [] })),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("ask", JSON.stringify({ decision: "allow_preview", selectedOptionIndex: 3, selectedOptionLabel: "允许模拟执行" })),
      toolMessage("portfolio-preview", JSON.stringify({
        action: "preview_trade",
        sideEffect: false,
        executionAllowed: true,
        order: { symbol: "300059", side: "buy", shares: 900, price: 21.89 },
        estimated: { cashBefore: 1000000, cashAfter: 980292.7 },
      })),
      toolMessage("xueqiu-preview", JSON.stringify({
        action: "preview_order",
        sideEffect: false,
        order: { symbol: "300059", side: "buy", shares: 900, price: 21.89 },
        readbackEvidence: { balance: {}, position: {} },
      })),
    ]);

    expect(answer).toContain("## 非写入预览");
    expect(answer).toContain('Portfolio(action:"preview_trade")');
    expect(answer).toContain('XueqiuTrade(action:"preview_order")');
    expect(answer).toContain("tradePrep:");
  });

  it("does not parse plain-text portfolio snapshot cash in trade sizing summary", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(tradeSizingStateContent("300059")),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", "The paper portfolio is empty. Initial cash: 1000000.00. Use trade to buy positions."),
      toolMessage("ask", "触发时再确认"),
    ]);

    expect(answer).not.toContain("本地纸组合：现金 1000000.00");
  });

  it("summarizes portfolio rebalance draft as evidence-only trade preparation", () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(tradeSizingStateContent("600519")),
      assistantMessage("", [
        { id: "balance", name: "XueqiuTrade", input: { action: "balance" } },
        { id: "snapshot", name: "Portfolio", input: { action: "snapshot", market: "cn" } },
        { id: "watchlist", name: "Watchlist", input: { action: "list", strategyId: "rank_strategy_v1", status: "watching" } },
        { id: "ask", name: "AskUserQuestion", input: { questions: [{ header: "交易确认" }] } },
      ]),
      toolMessage("balance", JSON.stringify({
        portfolio: { name: "finasimu" },
        performances: [{ cash: 100000, assets: 100000 }],
      })),
      toolMessage("snapshot", JSON.stringify({ action: "snapshot", cash: 200000, assets: 200000 })),
      toolMessage("watchlist", JSON.stringify({
        action: "list",
        items: [{
          symbol: "600519",
          strategyId: "rank_strategy_v1",
          strategyRules: {
            portfolioEvidence: {
              aggregateMetrics: {
                expectedReturnPct: 8.4,
                portfolioMaxDrawdownPct: -6.2,
                selectedSymbols: ["600519", "000858"],
              },
            },
            rebalanceDraft: {
              mode: "equal_weight_top_n",
              rebalanceInterval: "monthly",
              positions: [
                { symbol: "600519", targetWeight: 0.4, weightCapped: true },
                { symbol: "000858", targetWeight: 0.4, weightCapped: true },
              ],
              tradeBoundary: "Requires confirmation before any order.",
            },
          },
        }],
      })),
      toolMessage("ask", "触发时再确认"),
    ]);

    expect(answer).toContain("## 组合再平衡草案");
    expect(answer).toContain("600519：目标权重 40.0%");
    expect(answer).toContain("000858：目标权重 40.0%");
    expect(answer).toContain("按当前现金估算金额 40000.00");
    expect(answer).toContain("不会自动调仓");
    expect(answer).toContain("本轮未调用 XueqiuTrade");
  });

  it("does not repair missing custom_strategy_rank symbols from prompt names alone", () => {
    const interception = maybeInterceptFinanceToolCalls(
      [
        userMessage("帮我比较茅台、五粮液、东方财富，找出更适合动量策略的一只，并说明数据来源和回测假设。"),
      ],
      [
        {
          id: "rank",
          name: "MarketData",
          input: {
            action: "custom_strategy_rank",
            strategySpec: { id: "momentum_rank_v1" },
          },
        },
      ],
    );

    expect(interception).toBeNull();
  });

  it("repairs missing custom_strategy_rank symbols from structured workflow-state subjects", () => {
    const interception = maybeInterceptFinanceToolCalls(
      [
        userMessage(
          'rank candidates\n' +
          'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only rank","evidenceRefs":["custom_strategy_rank"],"confirmationState":"none","subjects":["600519","000858","300059"],"source":"agent-structured-intent"}}'
        ),
      ],
      [
        {
          id: "rank",
          name: "MarketData",
          input: {
            action: "custom_strategy_rank",
            strategySpec: { id: "momentum_rank_v1" },
          },
        },
      ],
    );

    expect(interception?.autoToolCalls).toEqual([
      expect.objectContaining({
        name: "MarketData",
        input: expect.objectContaining({
          action: "custom_strategy_rank",
          symbols: ["600519", "000858", "300059"],
        }),
      }),
    ]);
  });
});

function analysisEvidence(summary: string): Record<string, any> {
  const line = summary.split(/\r?\n/).find((item) => item.startsWith("analysisEvidence:"));
  if (!line) throw new Error("analysisEvidence line missing");
  return JSON.parse(line.slice("analysisEvidence:".length));
}

function strategyReview(summary: string): Record<string, any> {
  const line = summary.split(/\r?\n/).find((item) => item.startsWith("strategyReview:"));
  if (!line) throw new Error("strategyReview line missing");
  return JSON.parse(line.slice("strategyReview:".length));
}

function tradePrep(summary: string): Record<string, any> {
  const line = summary.split(/\r?\n/).find((item) => item.startsWith("tradePrep:"));
  if (!line) throw new Error("tradePrep line missing");
  return JSON.parse(line.slice("tradePrep:".length));
}

function tradeSizingStateContent(symbol: string, blockedTools: string[] = []): string {
  return `structured trade sizing request
data: ${JSON.stringify({
  workflowState: {
    contract: "finance-workflow-state-v1",
    workflowKind: "trade_prep",
    assetClass: "stock",
    intentMode: "size",
    executionMode: "requires_confirmation",
    safetyBoundary: "trade preparation only",
    evidenceRefs: ["trade-prep-v1"],
    confirmationState: "pending",
    subject: symbol,
    source: "agent-structured-intent",
    ...(blockedTools.length > 0 ? { blockedTools } : {}),
  },
})}`;
}
