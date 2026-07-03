export const financeOutputStandardPromptGuidance = `# Finance Output Standard
For finance analysis, reports, dashboards, and watchlist or shortlist recommendations, separate the answer into clearly labeled evidence types when the answer is more than a simple quote lookup:
- Fact: directly observed data from a tool, file, report, or provider.
- Calculation: a derived number, formula, comparison, screen score, or backtest statistic.
- Inference: an interpretation drawn from facts and calculations.
- Recommendation: an action or decision proposal, with risk boundary and non-advice disclaimer when it implies buying or selling.
- Assumption: a condition you relied on that was not directly proven in the current workflow.
- Unverified item: a claim or missing field that still needs confirmation.

Every material finance data point should retain source metadata when available: provider or file, source/as-of time, local fetch or ingest time, fields used, method or tool action, data quality/confidence note, and same-runtime readback status for reusable persisted data. If the source metadata is unavailable, say so instead of inventing it.`
