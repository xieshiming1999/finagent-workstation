# Finance Data Provenance Design Guide

## Objective

A finance data layer should be a governed evidence system, not a collection of
provider calls. The important question is not only whether data can be fetched,
but whether each data point can explain source, schema, timestamp, cache state,
reuse boundary, and failure status.

## Interface-First Model

Normal data access should follow this path:

```text
user or agent request
  -> interface discovery
  -> data API interface
  -> cache/readback policy
  -> provider capability selection
  -> provider adapter
  -> normalizer
  -> canonical storage or output-only envelope
  -> result provenance
```

The interface represents the business data requirement. The provider represents
one implementation source. Agent and UI code should not call provider endpoints
directly in normal workflows.

## Required Concepts

| Concept | Purpose |
| --- | --- |
| Data API Interface | Business-level data requirement |
| Provider Capability | Provider support, priority, limits, and status for an interface |
| Schema | Stable fields, keys, units, and time semantics |
| Normalizer | Provider-specific payload to canonical shape |
| Cache | Reuse rule based on source time, coverage, and freshness |
| Storage | Canonical table or artifact for reusable data |
| Readback | Same-runtime query path proving persistence is reusable |
| Diagnostic | Bounded provider inspection that does not become business data |
| Evidence | Matrix, probe, readback test, workflow test, and audit result |

## Schema And Time

Reusable data must preserve both source time and retrieval time. Source time is
the market, event, report, publication, or trade date represented by the data.
Retrieval time is when the system fetched or ingested the data.

Schemas should distinguish:

- missing data;
- not applicable fields;
- provider empty result;
- permission or quota denial;
- invalid parameters;
- transport failure;
- schema mismatch.

Unknown schemas should not enter normal workflow. They should be rejected, sent
to diagnostic output, or classified before reuse.

## Cache And Readback

Cache reuse should be explicit. A cache hit should state:

- interface;
- provider/capability that produced the data;
- canonical schema/table;
- source time;
- fetched-at time;
- requested coverage;
- freshness decision.

Provider-specific cache should not silently replace a user-specified provider
request unless the workflow explicitly allows cross-provider reuse.

## Provider Status

Provider capability status should be code-owned and visible:

| Status | Meaning |
| --- | --- |
| supported | Can be used in normal workflow |
| credential-gated | Needs configured credential or permission |
| quota-gated | Limited by quota or rate |
| transport-unstable | Temporarily unreliable network/provider path |
| disabled | Policy-disabled and not used normally |
| not-supported | Provider does not support the interface |
| output-only | Known output but not reusable storage |
| diagnostic | Inspection only |

Failures should update data health and routing evidence. A provider failure
should not be written into canonical business tables.

## Runtime Probe

Runtime probe is part of data provenance. It verifies whether a provider
capability works in the current environment. Probe results should be durable,
classified, and usable by routing decisions. They should also be exposed to
agent and UI workflows when explaining missing or degraded data.

## Design Rule

No normal workflow should depend on unknown provider shape. Classify, normalize,
persist, read back, and show provenance before claiming reusable finance data.
