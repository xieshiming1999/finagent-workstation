# Finance Workflow Phase Design Guide

## Objective

Finance workflows should be organized by phase so the system can explain what
has happened, what is allowed next, and where the risk boundary sits.

The core phase model is:

```text
Data
  -> Analysis
  -> Strategy
  -> Trade Preparation
  -> Execution
  -> Review
```

## Phase Definitions

| Phase | Question | Output |
| --- | --- | --- |
| Data | What facts are available and trustworthy? | provenance-backed data evidence |
| Analysis | What do the facts imply and what is missing? | research evidence, candidates, confidence, gaps |
| Strategy | What rules can be verified? | StrategySpec, validation, backtest, monitor plan |
| Trade Preparation | If acting, how much and under what risk? | preview, sizing, risk, confirmation request |
| Execution | What side effect was authorized and completed? | external or local write result plus readback |
| Review | What happened and what should be learned? | post-action evidence, audit, next action |

## Analysis Is Not Strategy

Analysis selects and explains. It can identify interesting stocks, funds,
sectors, or events, but it does not create executable rules by itself.

Strategy defines rules. It specifies entry, exit, risk, sizing, data coverage,
and validation status. A strategy can be monitored or backtested, but it is not
an order.

Trade preparation calculates quantity and risk. It stops before external or
local side effects unless execution is separately authorized.

## Artifacts

Each phase should create or update structured artifacts:

- data evidence and provider health;
- analysis evidence;
- StrategySpec and validation report;
- backtest or review report;
- trade preview and confirmation state;
- execution readback;
- workflow audit.

Artifacts let the workflow resume after restart and let tests verify behavior
without parsing free-form final text.

## UI And Agent Behavior

UI should display phase state rather than raw internal payloads. The agent
should use tools and artifacts to move between phases, not infer phase state
from fragile string matching.

When a workflow cannot advance, the system should state the blocking phase,
missing evidence, and next recoverable action.

## Design Rule

A reliable finance workflow does not jump from answer to action. It moves
through explicit phases, with evidence and approval boundaries at each step.
