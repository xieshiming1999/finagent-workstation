---
name: finance-report
description: |
  Quarterly / monthly financial report — masthead with KPIs, revenue and
  burn charts, P&L summary table, top-line highlights, and an outlook
  paragraph. Use when the brief mentions "financial report", "Q3 report",
  "MRR review", "P&L", or "earnings report".
triggers:
  - "financial report"
  - "finance report"
  - "quarterly report"
  - "p&l"
  - "mrr review"
  - "earnings report"
  - "financial statements"
od:
  mode: prototype
  platform: desktop
  scenario: finance
  featured: 10
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [rtl-and-bidi]
---

# Finance Report Skill

Produce a single-screen financial report in one self-contained HTML file.

## Finance agent runtime note

When using the app report dashboard template for stock, fund, market, strategy,
or data-health analysis, pass any available `analysis-evidence-v1` object as
`analysisEvidence` in the report config. The report template renders this as
the analysis evidence section with facts, interpretation, gaps, confidence,
source coverage, data time, fetched time, cache status, and readiness. Do not
hide source coverage or missing evidence only in prose.
After creating or refreshing a report dashboard, call
`WebView(action:"verify_report", id:<dashboard id or observed dash id>)`.
If it fails, treat the failure as a workflow-blocking artifact error: correct
the structured config or regenerate the report from the current template, then
verify again before finalizing.

When macro context is relevant, pass governed factor rows as `macroFactors` or
`macroFactorEvidence` in the same report config. Each row should come from
`DataStore(action:"query_macro_factors", ...)` and preserve source name, source
published time, fetched time, affected assets/regions/sectors, transmission
channels, status, and confidence. Keep this section separate from technical,
fundamental, strategy, or trade-action evidence.
For root-cause, strategy-risk, or attribution reports, also pass the structured
rows returned by `DataStore(action:"query_macro_attribution", ...)` as
`macroAttribution` or summarize them in the analysis-evidence section. Preserve
confidence, missing evidence, contradictions, invalidation conditions, and next
update action; do not flatten them into a single causal claim.

## Workflow

1. **Read the active DESIGN.md.** Tables, KPI cards, and chart strokes use
   palette tokens — never invent new ones.
2. **Classify** the period (monthly / quarterly / yearly) and entity
   (startup, division, project) from the brief. If unspecified, assume a
   quarterly SaaS report and pick believable numbers.
3. **Layout** the page in this order:
   - Masthead: company / period / "Confidential — Finance" badge.
   - Headline KPI strip (4 cards): Revenue, Net new MRR, Gross margin, Cash runway.
   - Revenue trend chart (inline SVG line + area).
   - Cost breakdown chart (inline SVG bar) with a 2–3 bullet caption.
   - P&L summary table (Revenue / Gross profit / Opex / Net) with current vs prior period.
   - Top accounts table with logo placeholders, plan, ARR, status badge.
   - Outlook paragraph + footer with author + signature line.
4. **Write** one self-contained HTML doc (CSS in one inline `<style>` block).
5. **Self-check**: every number ties to a labelled chart or table; deltas
   show direction and percentage; accent colour used at most twice.

## Output contract

```
<artifact identifier="finance-report-q3" type="text/html" title="Q3 Finance Report">
<!doctype html>
<html>...</html>
</artifact>
```
