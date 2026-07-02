# Finance Strategy Provenance Design Guide

## Objective

A strategy system should turn investment intent into verifiable rule contracts.
It should not treat natural-language ideas as executable strategies until they
are validated against supported methods, data requirements, risk assumptions,
and trade boundaries.

## Strategy Lifecycle

```text
user intent
  -> structured StrategySpec
  -> method registry
  -> validation
  -> data evidence
  -> backtest or observation review
  -> saved strategy artifact
  -> rerun, comparison, monitor, or trade preparation
```

Each step should produce evidence that can be inspected later.

## StrategySpec

A StrategySpec is the contract between the agent and the strategy engine. It
should include:

- identifier and version;
- strategy type;
- market or universe;
- timeframe and data requirements;
- indicators and parameters;
- entry, exit, risk, and position-sizing rules;
- cost and slippage assumptions;
- unsupported or research-only notes.

The system may let the agent draft a StrategySpec, but executable status must
come from validator code.

## Method Registry

Supported methods should be registered as components, not hidden in prompt
examples. A method should define:

- id and aliases;
- parameter schema;
- required data fields and lookback;
- calculator or explicit non-executable status;
- score direction or signal meaning;
- validation rules;
- help/discovery metadata.

Adding a method is complete only when validation, calculation, evidence,
focused tests, and agent-facing guidance are aligned.

## Evidence And Backtest

Backtest evidence should include:

- StrategySpec id and version;
- data coverage and source provenance;
- executed rules and skipped rules;
- signals and trades;
- return, drawdown, win rate, and risk/reward metrics;
- fees, slippage, adjustment, and position-sizing assumptions;
- unsupported parts and sample limitations.

No-trade results are still useful when they explain whether no signal fired,
data was insufficient, or validation rejected the rules.

## Strategy Types

Stock, fund, portfolio, ETF, and observation strategies need separate semantics.
Fund strategies should use fund NAV, money-yield, drawdown, volatility, holding,
fee, and category evidence instead of blindly applying stock K-line signals.
Portfolio strategies should express ranking, weighting, rebalance, correlation,
and concentration boundaries.

## Trade Boundary

Strategy signals are not orders. A strategy can produce a signal or trade
preparation request, but execution requires separate confirmation, side-effect
handling, and readback evidence.

## Design Rule

The agent may create a strategy idea. The strategy system must validate,
backtest, save, rerun, monitor, and stop unsafe or unsupported parts through
explicit contracts.
