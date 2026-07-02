---
description: Multi-agent collaboration workflow for building a specialist research team that works in parallel and produces one synthesized decision.
when_to_use: User asks for comprehensive analysis, team-based analysis, multi-angle research, or a deep structured report.
---

# Multi-Agent Team

## Team roles

| Role | Responsibility | Main data dependency |
|---|---|---|
| Data collector | Pull all required raw inputs | `MarketData` + `Research` |
| Technical analyst | Read trend, indicators, and chart structure | `DataProcess` |
| Fundamental analyst | Review financials, valuation, and growth | `earnings` + scoring logic |
| Risk analyst | Review risk, ST flags, and validation stress | `st-risk` + `backtest` |
| Decision manager | Combine all outputs into one final recommendation | all of the above |

## Execution flow

### Step 1: Create the team

```text
TeamCreate(name: "research_team", description: "multi-angle analysis for one symbol")
```

### Step 2: Shared data collection

```text
MarketData(action: "quote", code: "600519")
MarketData(action: "kline", symbols: ["600519"])
MarketData(action: "earnings", code: "600519")
MarketData(action: "flow", symbols: ["600519"])
Research(action: "news", query: "Moutai")
```

### Step 3: Parallel specialist analysis

```text
Agent(
  run_in_background: true,
  team_name: "research_team",
  name: "tech",
  description: "technical analyst",
  prompt: "You are the technical analyst. Score the chart setup, trend, key levels, pattern structure, price-volume behavior, and give a 100-point technical score. Data:\n<data>"
)

Agent(
  run_in_background: true,
  team_name: "research_team",
  name: "fundamental",
  description: "fundamental analyst",
  prompt: "You are the fundamental analyst. Review profitability, growth, valuation, ROE, PEG, and assign an investment rating. Data:\n<data>"
)

Agent(
  run_in_background: true,
  team_name: "research_team",
  name: "risk",
  description: "risk analyst",
  prompt: "You are the risk analyst. Review ST risk, industry risk, valuation risk, technical risk signals, and propose a stop-loss level. Data:\n<data>"
)
```

### Step 4: Track progress and add follow-up

```text
TeamList(team_name: "research_team")
TaskOutput(task_id: "agent-1", block: false)
SendMessage(to: "research_team/risk", message: "Add liquidity and position-sizing guidance")
```

`TeamList` gives the `taskId` and status for each member. Use `TaskOutput` to read each member result. `block:false` is only for progress inspection. If the final conclusion depends on that agent, call `TaskOutput(..., block:true)` before synthesizing.

### Step 5: Final synthesis

After all specialist outputs are available:
1. extract scores and key findings
2. combine them with weights, for example technical 40%, fundamental 35%, risk 25%
3. produce the final rating and concrete action plan
4. generate a report if needed

## Difference from Alpha Arena

| Dimension | Multi-Agent Team | Alpha Arena |
|---|---|---|
| Goal | division of labor | competitive comparison |
| Angles | different domains such as technical, fundamental, and risk | similar problem, different frameworks or personas |
| Output | one synthesized conclusion | multiple independent conclusions plus a comparison table |
| Best use | deep work on one symbol | quick multi-view challenge or cross-check |

## Lightweight version

If you do not need a formal team object, run a few parallel background agents directly:

```text
Agent(run_in_background:true, description:"technical", prompt:"...")
Agent(run_in_background:true, description:"fundamental", prompt:"...")
Agent(run_in_background:true, description:"risk", prompt:"...")
```

The `Agent` tool supports background parallelism. Use `TaskOutput(block:true)` before treating the results as complete.
