# Finance Agent Design Guide

## Objective

A finance agent should be designed as a reliable financial work system, not as
a chat wrapper around market APIs. The system must preserve evidence, manage
state, expose safe tools, and stop at explicit risk boundaries.

The design goal is to make every workflow answer four questions:

1. What did the user intend to accomplish?
2. What data and tools were used?
3. What evidence, assumptions, and gaps support the answer?
4. What state or artifact can be resumed, audited, or reused?

## Core Layers

| Layer | Responsibility |
| --- | --- |
| Prompt | Stable instructions and role boundaries |
| Context | Relevant, current, source-aware information for this turn |
| Memory | Working, session, and durable state that should influence future work |
| Skill | Reusable task procedure and recovery guidance |
| Tool | Validated action surface with observable results |
| Harness | Session, permission, compaction, logging, recovery, validation, and audit |
| Goal | Bounded task with scope, done criteria, and verification |
| Loop | Recursive progress evaluation and next-action control |
| Data | Source, schema, time, cache, readback, and quality evidence |

These layers are complementary. A prompt can describe policy, but the harness
must enforce critical constraints. A skill can teach a workflow, but tools and
schemas must own executable contracts.

## Agent Harness

The harness is the reliability layer around the model. It should provide:

- session save and restore;
- structured tool validation;
- permission and approval boundaries;
- user-question handling;
- failure classification;
- context compaction;
- background task checkpoints;
- tool-result persistence;
- data readback verification;
- audit history.

The harness should not contain application-domain shortcuts. Domain decisions
belong in tools, domain services, schemas, and workflow artifacts.

## Tool Contract

Agent-facing tools should be specific enough for self-correction:

- invalid arguments should fail through the tool error channel;
- missing credentials should identify the provider and missing setting;
- unsupported actions should expose a discovery/help path;
- read-only, write, quota-consuming, and external side-effect actions should be
  distinguishable;
- every result should identify its source, time, and durable artifact when
  applicable.

Normal tool results should not encode hidden failures as success text.

## Context And Memory

Context is what the model needs now. Memory is state that should affect future
work. Skills are procedures. Keeping these separate prevents a temporary tool
failure, a stale report, or a one-off instruction from becoming long-term
truth.

Good context artifacts include source, scope, timestamp, validity, and the task
they belong to. Good memory records decisions, constraints, preferences, and
work state. Good skills explain reusable procedures and recovery paths.

## User Questions And Approvals

When a workflow requires user input, the agent should ask explicitly and wait.
Automation and testing should observe the question or approval state and answer
according to the workflow. The agent loop should not parse natural-language
answers with fragile string matching as a substitute for structured state.

High-risk actions should stop before side effects until approval is recorded.

## Design Rule

The model may interpret intent and propose next steps. The system must own
contracts, validation, persistence, provenance, and safety boundaries.
