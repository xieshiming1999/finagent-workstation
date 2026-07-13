# Execution Safety

Read-only data and analysis require no trading permission. Strategy review and
trade preview are preparation only. Simulated execution requires an exact
permission response and a caller-supplied idempotency key. Verify product, run,
turn, request, account, instrument, side, quantity, price constraints, and
operation before presenting or resolving permission.

Denial must leave portfolio/order state unchanged. Approval must produce one
receipt and retrying the idempotency key must not duplicate the action. Never
use always-allow. The external v1 contract does not support real execution.

Snapshot the local paper account with `paper-state` before and after a
simulation. Fetch the durable receipt with
`execution-receipt IDEMPOTENCY_KEY`. Retrying the exact order with that key must
return `idempotentReplay:true` while `tradeCount` remains unchanged.
