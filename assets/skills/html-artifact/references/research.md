# Research & Learning Patterns

## When to use

An explainer with collapsible sections, tabbed code samples, and a glossary
in the margin reads very differently from the same words dumped linearly.
Build scaffolding that makes a new topic navigable.

## Templates

### 14 — Feature Explainer ("How X works")

**Shape:** Vertical document with progressive disclosure.

**Key elements:**
- TL;DR box at top (5-line summary)
- Collapsible step-by-step sections (click to expand)
- Tabbed code snippets (e.g., "Config | Code | Response")
- FAQ accordion at bottom
- Sticky sidebar with section links

**Adapt for:** "explain rate limiting in this repo", "how does our auth work",
"document the billing pipeline for new hires".

### 15 — Concept Explainer ("Teach me X")

**Shape:** Interactive diagram + reference panels.

**Key elements:**
- Live visualization (e.g., consistent-hash ring you can add/remove nodes from)
- Comparison table (X vs Y vs Z — when to pick each)
- Hover-linked glossary: term in text → definition in margin
- "Further reading" footer with curated links

**Adapt for:** CS concepts, protocol explanations, architecture pattern
introductions, "ELI5 but with real depth" explainers.
