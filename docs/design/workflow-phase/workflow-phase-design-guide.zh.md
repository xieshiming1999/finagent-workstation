# 金融 Workflow Phase 设计指南

## 目标

金融 workflow 应按阶段组织，使系统能够解释已经发生了什么、下一步允许做什么，以及风险边界在哪里。

核心阶段模型是：

```text
Data
  -> Analysis
  -> Strategy
  -> Trade Preparation
  -> Execution
  -> Review
```

## 阶段定义

| 阶段 | 问题 | 输出 |
| --- | --- | --- |
| Data | 哪些事实可用且可信？ | provenance-backed data evidence |
| Analysis | 事实说明什么，还缺什么？ | research evidence、candidates、confidence、gaps |
| Strategy | 哪些规则可以验证？ | StrategySpec、validation、backtest、monitor plan |
| Trade Preparation | 如果行动，买卖多少、承担什么风险？ | preview、sizing、risk、confirmation request |
| Execution | 哪个副作用被授权并完成？ | external 或 local write result 加 readback |
| Review | 发生了什么，应学习什么？ | post-action evidence、audit、next action |

## Analysis 不是 Strategy

Analysis 负责选择和解释。它可以识别值得关注的股票、基金、行业或事件，但不会直接产生可执行规则。

Strategy 负责定义规则。它说明 entry、exit、risk、sizing、data coverage 和 validation status。策略可以被监控或回测，但策略不是订单。

Trade preparation 负责计算数量和风险。除非 execution 被独立授权，否则它应停止在外部或本地副作用之前。

## Artifacts

每个阶段都应创建或更新结构化 artifact：

- data evidence 和 provider health；
- analysis evidence；
- StrategySpec 和 validation report；
- backtest 或 review report；
- trade preview 和 confirmation state；
- execution readback；
- workflow audit。

Artifact 让 workflow 可以在重启后恢复，也让测试可以验证行为，而不必解析自由文本回答。

## UI 与 Agent 行为

UI 应展示 phase state，而不是 raw internal payload。Agent 应通过 tool 和 artifact 在阶段之间推进，不应通过脆弱的字符串匹配推断 phase state。

当 workflow 无法推进时，系统应说明被阻断的阶段、缺失 evidence 和下一步可恢复动作。

## 设计规则

可靠金融 workflow 不会从回答直接跳到行动。它通过显式阶段推进，并在每一步保留 evidence 和 approval boundary。
