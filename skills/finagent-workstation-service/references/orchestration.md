# Orchestration And Arbitration

The calling code agent owns task decomposition, acceptance, intervention, and
the final user-facing summary. FinAgent supplies finance evidence and bounded
actions through typed contracts.

1. Create a `finagent.task-brief.v1` with explicit product, finance operation,
   UI runtime, side-effect ceiling, evidence requirements, limits, and
   completion conditions. Use `interactionPolicy: "caller-mediated"`.
2. Submit with `orchestrate-start`, stream immediately, and relay exact question
   or permission requests to the caller. Never invent a response.
3. Build `finagent.evidence-ledger.v1` with `ledger`. Assign events to
   requirements using sequence, type, tool-call id, or artifact id selectors.
   Unmapped and missing evidence must remain visible.
4. When evidence is incomplete or wrong, send one bounded
   `finagent.intervention.v1` with exact product/run/session/turn coordinates.
   Do not replace history or silently start a different session.
5. Create corrected reports with `finagent.report-revision.v1`. Each revision is
   immutable and may name a parent artifact; never overwrite the prior file.
6. Produce and validate `finagent.arbitration-v1`. Every accepted claim must
   cite evidence entry ids. State conflicts, safety state, interventions, and
   remaining uncertainty before writing the final summary.

Use structured service endpoints as pass evidence. Logs, renderer text, and
`current.jsonl` are diagnostics only.
