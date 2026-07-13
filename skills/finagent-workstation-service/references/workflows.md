# Workflows

Start a typed run with an explicit category, operation, arguments, session mode,
and `headless` UI runtime. The service returns a run id immediately. Stream from
cursor zero and retain the greatest event sequence.

Use `pending RUN_ID` when an interaction event arrives. Reply with the complete
request coordinates returned by the service. A response resumes the same run;
do not start a replacement run. After a disconnect, replay with `events --after`
and resume streaming without duplicating already observed sequences.

Use `result RUN_ID`, `artifacts`, and `artifact ID` for terminal evidence. Treat
tool, agent, transport, timeout, and cancellation errors as distinct failures.
