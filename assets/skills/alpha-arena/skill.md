---
description: Alpha Arena runs multiple AI analysts in parallel on the same symbol and compares their conclusions before giving a composite view.
when_to_use: User asks for multiple viewpoints, analyst-vs-analyst comparison, or wants several analyst styles to debate the same stock.
---

# Alpha Arena

Run several AI analysts with different frameworks or personas on the same symbol, compare the outputs, and then summarize the consensus and disagreement.

## Trigger Pattern

Use this skill when the user wants several analyst viewpoints on the same
instrument, a debate between analysis styles, or a composite view after
parallel specialist analysis.

## Workflow

### Step 1: Shared data collection

```text
MarketData(action: "quote", code: "600519")
MarketData(action: "earnings", code: "600519")
DataProcess(action: "summary", code: "600519")
DataProcess(action: "signals", symbol: "600519")
Research(action: "news", query: "Moutai")
```

### Step 2: Parallel analysis

```text
Agent(run_in_background:true, description:"technical analyst", prompt:"You are the technical analyst. Only analyze technical indicators and provide a rating plus target price. Data:\n<data>")

Agent(run_in_background:true, description:"fundamental analyst", prompt:"You are the fundamental analyst. Only analyze financials and valuation. Data:\n<data>")

Agent(run_in_background:true, description:"Buffett-style analyst", prompt:"Use a Buffett framework focused on moat and shareholder returns. Data:\n<data>")

Agent(run_in_background:true, description:"quant analyst", prompt:"Analyze the symbol using momentum, reversal, volatility, and flow factors. Data:\n<data>")

Agent(run_in_background:true, description:"risk analyst", prompt:"Focus on risk factors such as ST risk, industry headwinds, and valuation bubble risk. Data:\n<data>")
```

Each background agent returns a `task_id`, not a final conclusion. Collect all outputs with `TaskOutput(task_id:"...", block:true)` before ranking them.

### Step 3: Comparison table

The main agent summarizes the competing views:

```text
| Analyst | Rating | Target price | Core reason | Confidence |
|---|---|---|---|---|
| Technical | Accumulate | 1800 | MACD golden cross plus bullish moving averages | 75% |
| Fundamental | Buy | 1900 | ROE 22% and PE below its historical average | 85% |
| Buffett | Accumulate | 1850 | elite moat but valuation no longer cheap | 80% |
| Quant | Hold | 1750 | neutral momentum and weak reversal setup | 60% |
| Risk | Hold | - | policy risk and stretched valuation | 70% |
```

### Step 4: Consensus and disagreement

- identify where the analysts agree
- identify where they diverge
- produce the composite recommendation
- name the key unresolved uncertainty

## Custom analyst combinations

If the user specifies the lineup, launch only those analyst variants. If the
lineup is broad or unspecified, choose a small balanced set across technical,
fundamental, risk, quant, and persona-style analysis.

## Report integration

Alpha Arena output can feed a report:
- comparison table section
- consensus/disagreement section
- final verdict section
