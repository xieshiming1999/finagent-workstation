---
description: Three-way risk debate workflow where aggressive, conservative, and neutral analysts evaluate the same trade and produce a final investment recommendation.
when_to_use: User asks for risk assessment, investment debate, multi-side analysis, or a synthesized decision after competing viewpoints.
---

# Risk Debate

This skill borrows the three-sided debate pattern from TradingAgents. Use three analysts with different risk postures, then synthesize their views into one decision.

## Preconditions

Collect the core data first:

```text
DataProcess(action:'summary', symbol:'<code>')
DataProcess(action:'signals', symbol:'<code>')
MarketData(action:'earnings', symbols:['<code>'])
MarketData(action:'quote', symbols:['<code>'])
```

## Debate flow

### Step 1: Run the three analysts in parallel

```text
Agent(run_in_background:true, description:"aggressive analyst", prompt:"You are the aggressive investment analyst. Write in a direct narrative style rather than bullet points. Argue why the trade deserves bold capital. Focus on: 1) growth catalysts and upside, 2) what the market is underestimating, 3) supportive trend and flow signals, 4) acceptable risk-reward. End with target price, position sizing, and a short summary table.\n\nData:\n<pasted data>")

Agent(run_in_background:true, description:"conservative analyst", prompt:"You are the conservative investment analyst. Write in a direct narrative style rather than bullet points. Argue the downside case. Focus on: 1) downside risk and drawdown risk, 2) fundamental concerns such as leverage, cash flow, and earnings quality, 3) technical danger signals, 4) macro and industry headwinds. End with stop-loss guidance, minimum size guidance, and a short summary table.\n\nData:\n<pasted data>")

Agent(run_in_background:true, description:"neutral analyst", prompt:"You are the balanced analyst. Write in a direct narrative style rather than bullet points. Weigh both sides objectively. Focus on: 1) the central tension, 2) whether current valuation is fair, 3) the catalyst and risk timeline, 4) the best position-management plan. End with a neutral implementation plan and a short summary table.\n\nData:\n<pasted data>")
```

Each parallel agent returns a background `task_id`. Use `TaskOutput(task_id:'...', block:true)` to collect all three outputs before you form the final judgment.

### Step 2: Synthesize the result

After all three are complete, the main agent should:

1. extract the consensus points
2. identify the key disagreements
3. produce the final five-level rating: buy / accumulate / hold / reduce / sell
4. provide the action plan: target price, stop-loss, position size, and time frame
5. end with a summary table

### Step 3: Optional report generation

```text
Dashboard(template: "report")

# Build CONFIG with:
# - KPI section: current price, target price, stop-loss, position size
# - highlight section: shared bullish points
# - risk highlight section: shared risk points
# - table section: side-by-side analyst comparison
# - verdict section: final rating

FileWrite(file_path:'{{DATA_DIR}}/memory/pages/reports/debate_<code>_<date>.html', content:...)
UIControl(action:'addPage', params:{
  "title":"<company> risk debate",
  "file":"{{DATA_DIR}}/memory/pages/reports/debate_<code>_<date>.html",
  "tag":"report"
})
```

## Debate depth

| User intent | Rounds | Method |
|---|---|---|
| Default / fast analysis | 1 | one pass per analyst, then synthesize |
| "deep analysis" | 3 | first pass, then cross-rebuttal, then final stance |
| "extreme depth" | 5 | more rebuttal rounds with explicit citation of prior arguments |

In multi-round mode, each later prompt should include the prior views from the other analysts and require targeted rebuttal.

## Comparison table for the report

| Dimension | Aggressive | Neutral | Conservative |
|---|---|---|---|
| Rating | strong buy / buy | hold / buy | hold / reduce |
| Target price | higher | middle | lower |
| Stop-loss | wider | medium | tighter |
| Position size | large | medium / staged | small / wait |
| Time frame | medium to long | medium | short |

## Record the decision for later reflection

```text
DataProcess(action:'ai_record', symbol:'<code>',
  direction:'<bullish/bearish/neutral>',
  priceAtAnalysis:<current_price>,
  strategy:'risk_debate')
```

## IC memo

If the user asks for an investment memo or IC memo, generate a structured document on top of the debate output.

### IC memo structure

1. Executive summary
2. Investment thesis
3. Company overview
4. Industry context
5. Financial analysis
6. Valuation
7. Risk factors
8. Trade plan
9. Conclusion

### IC memo workflow

```text
# 1. run the debate first

# 2. load supporting valuation and deep-research context
Skill(name: "valuation")
Skill(name: "deep-research")

# 3. generate a report
Dashboard(template: "report")

# CONFIG mapping:
# - kpi: executive summary KPIs
# - text: thesis + company + industry
# - table: financial trends + comparable valuation + risk matrix
# - highlight: bullish reasons and key risks
# - verdict: final conclusion

FileWrite(file_path: "{{DATA_DIR}}/memory/pages/reports/ic_memo_<code>_<date>.html", content: ...)
UIControl(action: "addPage", params: {
  "title": "<company> IC Memo",
  "file": "{{DATA_DIR}}/memory/pages/reports/ic_memo_<code>_<date>.html",
  "tag": "report"
})
```

## Risk debate vs IC memo

| | Risk Debate | IC Memo |
|---|---|---|
| Focus | competing viewpoints | structured decision document |
| Output | rating plus action plan | complete memo |
| Best use | faster decision | larger or first-time position |
| Depth | 1 to 5 rounds | full valuation, industry, and financial analysis |
