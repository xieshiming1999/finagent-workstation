# 金融策略 Provenance 设计指南

## 目标

策略系统应把投资意图转成可验证的规则合同。在规则经过方法库、数据要求、风险假设和交易边界验证前，不应把自然语言想法当作可执行策略。

## 策略生命周期

```text
用户意图
  -> structured StrategySpec
  -> method registry
  -> validation
  -> data evidence
  -> backtest 或 observation review
  -> saved strategy artifact
  -> rerun、comparison、monitor 或 trade preparation
```

每一步都应产生后续可检查的 evidence。

## StrategySpec

StrategySpec 是 agent 与策略引擎之间的合同。它应包含：

- identifier 和 version；
- strategy type；
- market 或 universe；
- timeframe 和 data requirements；
- indicators 和 parameters；
- entry、exit、risk 和 position-sizing rules；
- cost 和 slippage assumptions；
- unsupported 或 research-only notes。

系统可以允许 agent 起草 StrategySpec，但是否可执行必须由 validator code 决定。

## Method Registry

受支持方法应以组件方式注册，而不是隐藏在 prompt 示例里。一个方法应定义：

- id 和 aliases；
- parameter schema；
- required data fields 和 lookback；
- calculator 或明确 non-executable status；
- score direction 或 signal meaning；
- validation rules；
- help / discovery metadata。

新增方法只有在 validation、calculation、evidence、focused tests 和 agent-facing guidance 都对齐后，才算完成。

## Evidence 与 Backtest

Backtest evidence 应包含：

- StrategySpec id 和 version；
- data coverage 和 source provenance；
- executed rules 和 skipped rules；
- signals 和 trades；
- return、drawdown、win rate 和 risk/reward metrics；
- fees、slippage、adjustment 和 position-sizing assumptions；
- unsupported parts 和 sample limitations。

没有交易的结果也有价值。它应说明是没有信号触发、数据不足，还是规则被 validation 拒绝。

## Strategy Types

股票、基金、组合、ETF 和观察策略需要不同语义。基金策略应使用 fund NAV、money-yield、drawdown、volatility、holding、fee 和 category evidence，而不是直接套用股票 K 线信号。组合策略应表达 ranking、weighting、rebalance、correlation 和 concentration 边界。

## 交易边界

策略信号不是订单。策略可以产生 signal 或 trade preparation request，但 execution 需要独立确认、外部副作用处理和 readback evidence。

## 设计规则

Agent 可以创建策略想法。策略系统必须通过显式合同完成 validation、backtest、save、rerun、monitor，并拒绝不安全或不支持的部分。
