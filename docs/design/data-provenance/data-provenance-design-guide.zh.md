# 金融数据 Provenance 设计指南

## 目标

金融数据层应是受治理的 evidence system，而不是 provider call 集合。关键问题不只是能否取到数据，而是每份数据能否说明 source、schema、timestamp、cache state、reuse boundary 和 failure status。

## Interface-First 模型

正常数据访问应走以下路径：

```text
用户或 agent 请求
  -> interface discovery
  -> data API interface
  -> cache/readback policy
  -> provider capability selection
  -> provider adapter
  -> normalizer
  -> canonical storage 或 output-only envelope
  -> result provenance
```

Interface 表示业务数据需求。Provider 表示一种实现来源。Agent 和 UI code 在 normal workflow 中不应直接调用 provider endpoint。

## 必要概念

| 概念 | 作用 |
| --- | --- |
| Data API Interface | 业务级数据需求 |
| Provider Capability | Provider 对某个 interface 的支持、优先级、限制和状态 |
| Schema | 稳定字段、key、单位和时间语义 |
| Normalizer | Provider-specific payload 到 canonical shape 的映射 |
| Cache | 基于 source time、coverage 和 freshness 的复用规则 |
| Storage | 可复用数据的 canonical table 或 artifact |
| Readback | 同一 runtime 的 query path，证明数据真的可复用 |
| Diagnostic | 有界 provider 检查，不成为业务数据 |
| Evidence | Matrix、probe、readback test、workflow test 和 audit result |

## Schema 与时间

可复用数据必须同时保留 source time 和 retrieval time。Source time 是数据代表的市场时间、事件时间、报告时间、发布时间或交易日。Retrieval time 是系统抓取或写入数据的时间。

Schema 应区分：

- 数据缺失；
- 字段不适用；
- provider 空结果；
- 权限或额度拒绝；
- 参数错误；
- transport failure；
- schema mismatch。

Unknown schema 不应进入 normal workflow。它应被拒绝、进入 diagnostic output，或在复用前完成分类。

## Cache 与 Readback

缓存复用规则应明确。一次 cache hit 应说明：

- interface；
- 产生数据的 provider / capability；
- canonical schema / table；
- source time；
- fetched-at time；
- requested coverage；
- freshness decision。

如果用户指定 provider，不应静默用其他 provider 的缓存替代，除非 workflow 明确允许跨 provider 复用。

## Provider 状态

Provider capability status 应由代码持有并可见：

| 状态 | 含义 |
| --- | --- |
| supported | 可进入 normal workflow |
| credential-gated | 需要凭证或权限 |
| quota-gated | 受额度或频率限制 |
| transport-unstable | 网络或 provider 路径暂时不稳定 |
| disabled | 策略禁用，normal workflow 不使用 |
| not-supported | Provider 不支持该 interface |
| output-only | 已知输出，但不进入可复用存储 |
| diagnostic | 仅用于检查 |

失败应更新 data health 和 routing evidence。Provider failure 不应写入 canonical business table。

## Runtime Probe

Runtime probe 是 data provenance 的一部分。它验证 provider capability 在当前环境是否可用。Probe result 应持久化、分类，并能影响 routing decision。在解释缺失数据或降级数据时，也应能被 agent 和 UI workflow 使用。

## 设计规则

Normal workflow 不应依赖 unknown provider shape。只有完成分类、normalization、persistence、readback 和 provenance 展示后，才能声称数据可复用。
