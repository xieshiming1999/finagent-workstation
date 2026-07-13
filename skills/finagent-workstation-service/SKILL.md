---
name: finagent-workstation-service
description: Use the local FinAgent Workstation run service for typed finance data, analysis, strategy, artifacts, durable sessions, streamed questions and permission-controlled simulated execution. Use when a code agent needs workstation finance abilities through supported APIs or MCP instead of reading UI text, logs, or session files.
---

# FinAgent Workstation Service

Use `scripts/finagent_client.py` as the transport. Set `FINAGENT_ENDPOINT` when
the service is not on the documented default loopback port.

1. Run `python3 scripts/finagent_client.py capabilities` before selecting an
   operation. Check `externalFinance.operations[].availability` and readiness.
2. Prefer `start`, then `stream --compact`. Store the last `sequence`; reconnect with
   `stream RUN_ID --after SEQUENCE --compact` or inspect `events` without transcript
   scraping. Use `run-sync` only for compatibility.
3. On `interaction.required` or `permission.required`, inspect `pending` and
   surface the exact request to the caller. Submit only caller-selected values
   with `answer` or `permission`, retaining every request coordinate.
4. Retrieve terminal evidence with `result`. Fetch large outputs by artifact id.
5. Never infer approval, auto-answer a question, or treat general code-agent
   autonomy as consent to trade. Real execution is unavailable in v1.

Read [capabilities.md](references/capabilities.md) before choosing an operation,
[workflows.md](references/workflows.md) for lifecycle calls, and
[execution-safety.md](references/execution-safety.md) for any trade-related task.
