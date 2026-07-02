# 金融 Agent 设计指南

## 目标

金融 agent 应被设计为可靠的金融工作系统，而不是行情 API 外面的一层聊天包装。系统必须保存 evidence、管理状态、暴露安全工具，并在明确风险边界前停止。

设计目标是让每个 workflow 都能回答四个问题：

1. 用户真正想完成什么。
2. 使用了哪些数据和工具。
3. 回答由哪些 evidence、假设和缺口支撑。
4. 哪些状态或 artifact 可以恢复、审计或复用。

## 核心层级

| 层级 | 责任 |
| --- | --- |
| Prompt | 稳定指令和角色边界 |
| Context | 本轮相关、当前、带来源的信息 |
| Memory | 会影响未来工作的 working、session 和 durable 状态 |
| Skill | 可复用任务流程和错误恢复指导 |
| Tool | 输入可验证、结果可观察的行动面 |
| Harness | Session、permission、compact、logging、recovery、validation 和 audit |
| Goal | 有范围、完成标准和验证方式的任务 |
| Loop | 递归评估进展并提示下一步 |
| Data | 来源、schema、时间、缓存、读回和质量 evidence |

这些层不是替代关系。Prompt 可以描述政策，但关键约束必须由 harness 执行。Skill 可以说明流程，但可执行合同应由 tool、schema 和 domain service 持有。

## Agent Harness

Harness 是模型外侧的可靠性层。它应提供：

- session 保存与恢复；
- 结构化 tool validation；
- permission 和 approval 边界；
- 用户追问处理；
- failure classification；
- context compact；
- background task checkpoint；
- tool result persistence；
- data readback verification；
- audit history。

Harness 不应包含应用领域的捷径。领域判断应放在 tool、domain service、schema 和 workflow artifact 中。

## Tool Contract

面向 agent 的工具应能支持自我修正：

- invalid argument 应通过 tool error channel 失败；
- missing credential 应说明 provider 和缺失设置；
- unsupported action 应暴露 discovery / help path；
- read-only、write、quota-consuming 和 external side-effect action 应可区分；
- 每个结果都应在适用时说明 source、time 和 durable artifact。

普通 tool result 不应把隐藏失败包装成成功文本。

## Context 与 Memory

Context 是模型此刻需要的信息。Memory 是未来工作要继续携带的状态。Skill 是流程。分开这三者，可以避免临时 provider 失败、旧报告或一次性指令变成长期事实。

好的 context artifact 应包含 source、scope、timestamp、validity 和所属 task。好的 memory 记录决策、约束、偏好和工作状态。好的 skill 解释可复用流程和恢复路径。

## 用户追问与审批

当 workflow 需要用户输入时，agent 应明确提问并等待。自动化和测试应观察 question 或 approval state，并根据 workflow 回答。Agent loop 不应通过脆弱的自然语言字符串匹配来替代结构化状态。

高风险动作必须在外部副作用前停止，直到 approval 被记录。

## 设计规则

模型可以解释意图并提出下一步。系统必须拥有合同、验证、持久化、provenance 和安全边界。
