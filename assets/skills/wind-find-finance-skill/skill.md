---
description: Wind finance skill discovery and routing entry. Use for finance data, market analysis, valuation, review, stock picking, position sizing, trade planning, backtesting, and Wind capability questions.
when_to_use: Use when the user asks what Wind/finance capability to use, asks for a finance workflow that may need Wind data, or asks a market/data question before a specific skill is chosen.
---

# Wind Finance Skill Router

This is the native desktop adaptation of the official Wind `wind-find-finance-skill`.
It does not install external skills at runtime. It routes to bundled desktop skills and the native `wind-aifinmarket` data skill.

## Required References

Read these files as needed:

- `$SKILL_DIR/references/skills-catalog.md` - official Wind skill catalog snapshot.
- `$SKILL_DIR/references/official-wind-find-finance-skill.md` - full upstream discovery skill snapshot.
- `Skill(skill: "wind-aifinmarket")` - native Wind data foundation.

## Routing Rules

1. If the task is direct financial data lookup, quote/K-line/news/announcement/macro/fundamental retrieval, load `wind-aifinmarket`.
2. If the task is analysis or decision-making, identify the best local workflow skill first, then use `wind-aifinmarket` as the data foundation.
3. If the official catalog names a workflow skill that is not bundled locally, use the closest existing desktop skill and explicitly state the downgrade.
4. Do not answer Wind-covered financial facts from general knowledge when the native Wind skill is available.
5. Do not run `npx skills add`; bundled assets are the source of truth inside this app.

## Common Local Workflow Mapping

- DCF / valuation / pricing: `dcf-valuation` or `valuation`.
- Market overview / post-market debrief / market regime: `market-overview`.
- Stock picking / candidate search: `stock-picking`, `advanced-scanner`, or `rps-ranking`.
- Earnings review: `stock-earnings-review`.
- Risk / position / trade planning: `risk-debate`, `trade-execution`, or `strategy-system`.
- Fund screening: `fund-screening`.
- Dashboard/report workflows: `monitor-dashboard`, `finance-report`, or `report-analysis`.

Always load `wind-aifinmarket` when the workflow needs Wind-backed data.
