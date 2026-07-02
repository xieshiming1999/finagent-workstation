---
description: Deep annual-report PDF analysis from the perspective of a skeptical auditor and short seller, focused on finding problems, weak spots, and forward clues, then cross-checking against market reaction
when_to_use: User asks to analyze an imported annual report, interpret a filing, inspect charts/tables inside a report, perform annual report analysis, or look for problems inside a report
---
# Deep Report Analysis

Load `analysis-standards` before producing the final report. Its Finance Output Standard governs the final answer: separate facts, calculations, inferences, recommendations, assumptions, and unverified items, and retain source/as-of time, fetch/ingest time, fields used, method/tool action, quality/confidence note, and readback status for every material number.

## Analysis philosophy

When reading a report, you are not a reporter repeating what management
said. You are a **skeptical auditor** and a **contrarian investor**.

- **Invert, always invert** - do not start with "what is good about this company"; start with "what could break this business"
- **Dig whenever narrative conflicts with numbers** - if management says "high growth" while cash flow is falling, something is wrong
- **Do not act as an information relay** - your output is conclusion plus evidence, not chapter-by-chapter retelling
- **Stay alert to value traps** - if a company looks cheap but is actually deteriorating, say that clearly
- **Margin of safety** - every optimistic conclusion must include "if I am wrong, how bad is the downside"

## Step 1: Establish readable report evidence

`ReportParse` is not a complete built-in parser. Use it to verify the file
path and receive extraction guidance. For actual text, use an explicit external
text-extraction step such as `pdftotext` when available, or render key pages
with `PageRender` and inspect them visually.

```text
ReportParse(path: "{{DATA_DIR}}/memory/financeReport/<id>/original.pdf")
PageRender(pdfPath: "{{DATA_DIR}}/memory/financeReport/<id>/original.pdf", page: 1, outputPath: "{{DATA_DIR}}/memory/financeReport/<id>/pages/page_1.png")
```

## Step 2: Diagnose data credibility

This is the core required checklist. Inspect extracted text, rendered tables,
or separately retrieved financial data item by item. For each triggered red
flag, provide the concrete number and your judgment. If the available evidence
does not expose a metric, mark it as missing instead of inventing it.

| # | Check | Red-flag condition | Meaning |
|---|-------|--------------------|---------|
| 1 | Revenue growth vs operating cash flow growth | Revenue up while OCF falls or stalls | Receivables may be piling up; channel stuffing or aggressive credit sales risk |
| 2 | Receivables / revenue ratio vs prior period | Ratio rises by more than 5 percentage points | Collection quality is deteriorating; bad-debt risk |
| 3 | Inventory / revenue ratio vs prior period | Ratio rises by more than 5 percentage points | Unsold product buildup or inventory dressing |
| 4 | Non-recurring gains as a share of net profit | >30% | Profit may be supported by asset sales or subsidies, not sustainable operations |
| 5 | Goodwill / net assets | >30% | High M&A blow-up risk |
| 6 | Cash vs short-term borrowing | High cash and high short-term debt at the same time | Funds may be restricted or diverted; classic red flag |
| 7 | Construction in progress / fixed assets ratio vs prior period | Multi-year projects never capitalized | Possible capitalization of expenses and overstated profit |
| 8 | Prepayments + other receivables / total assets | Unusually elevated | Possible related-party fund occupation |
| 9 | Operating cash flow / net profit (cash conversion) | Persistently <0.8 | Weak earnings quality; paper profit |
| 10 | Audit opinion | Any non-standard unqualified opinion | Maximum red flag - even the auditor is uncomfortable |

Do not expand every item mechanically. Only discuss the items that are
actually problematic. If an item is normal, mention it briefly or skip
it.

## Step 3: Analyze the management narrative

Render key pages such as the board report and management discussion
section, then inspect them with VLM:

```text
PageRender(pdfPath: "<path>", page: <N>, outputPath: "memory/financeReport/<id>/pages/page_<N>.png")
Read(file_path: "memory/financeReport/<id>/pages/page_<N>.png")
```

Check for:

- **Promise delivery** - if you can access the prior report, compare last period's outlook with this period's reality. If management promised something and missed it, call it out explicitly.
- **Language shifts** - wording drift from "rapid growth" to "steady operations" to "responding to challenges" is often a decline pattern
- **Attribution behavior** - good results credited to management while bad results are blamed on the environment is not a good sign
- **Direction of capex** - where the money goes tells you what future the company is betting on
- **Equity-incentive targets** - if the hurdle is too low, management may not believe in strong growth either

## Step 4: Forward clues

| Signal | Interpretation |
|--------|----------------|
| Contract liabilities / prepayments trend | Rising values suggest order backlog and leading revenue signal |
| R&D spend change | Increasing means management is investing for the future; shrinking may mean harvesting or retreat |
| Construction-in-progress project list | Shows where expansion is actually happening |
| Major contracts / major investments | Indicates new customers or new markets |
| Use of raised capital | Compare actual use versus the original promise |

## Step 5: Link to market context

Do not analyze the report in isolation. Cross-check with the existing
tools:

```text
# Peer comparison
DataProcess(action: "score", code: "<code>")

# Price reaction around the report release
MarketData(action: "kline", code: "<code>", period: "daily", limit: 30)

# Broker / market interpretation
Research(action: "news", query: "<company name> annual report analysis")
```

Key questions:

- **Great report, but the stock fell?** What did the market see that you missed?
- **PE/PB vs peers** - is the discount a sign of undervaluation, or is it justified?
- **Institutional / northbound positioning** - is smart money leaving or adding?

## Step 6: Conclusion

You must produce a clear judgment. Do not be vague.

1. **One-line verdict** - is this a wonderful business at a fair price, a mediocre business at a bargain price, or a trap?
2. **Red-flag summary** - list every triggered red flag in severity order
3. **What to keep tracking** - what must be validated next quarter?
4. **If I am wrong** - what is your biggest assumption, and what happens if it fails?

## Output format

- Simple Q&A -> answer directly, conclusion first, evidence after
- Full analysis -> save to `memory/financeReport/<id>/analysis.md`, with optional Dashboard HTML if useful
- Never retell the report chapter by chapter - only output findings with information value
