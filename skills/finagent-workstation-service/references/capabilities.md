# Capabilities

Discovery is authoritative. Call `capabilities` and select only an operation
whose compile-time contract and current runtime readiness support the request.

- `data.query`: canonical records and provider provenance.
- `analysis.run`: `analysis-evidence-v1` and optional reports/dashboards.
- `strategy.review`: `strategy-review-v1`, including backtest artifacts.
- `execution.preview`: `trade-prep-v1`; no order or portfolio write.
- `execution.simulate`: permission-required paper action with an idempotency key
  and `execution-receipt-v1`.
- `execution.real`: unavailable in the external v1 contract.

Use an explicit product for session resume and execution. Do not silently move a
session or side-effect request to another product.
