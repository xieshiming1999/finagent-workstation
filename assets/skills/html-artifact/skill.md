---
name: html-artifact
description: Build self-contained HTML artifacts instead of markdown when the output benefits from spatial layout, side-by-side comparison, interactivity, or data visualization. Based on Anthropic's "Unreasonable Effectiveness of HTML" patterns.
triggers:
  - compare X options side by side
  - explain how X works
  - show me X as a dashboard
  - make a one-pager / report / writeup
  - draft a plan with milestones / risks
  - render the diff / module / flowchart
  - clickable prototype / interactive editor
od.mode: prototype
od.featured: 5
---

# HTML Artifact

A general-purpose pattern: when the natural answer involves spatial structure
(side-by-side, before/after, timeline, graph, dashboard, interactive form),
output a single self-contained HTML file instead of a wall of markdown text.

The result is a document the user actually reads, not skims. Each file in
`templates/` is a complete, copy-and-modify reference for one shape of output.

## When to choose HTML over markdown

Pick HTML if **any** of these hold:

- Two or more things should be visible **at the same time** (compare, contrast)
- The relationship is **spatial**, not linear (diff, flowchart, module map, design tokens)
- The reader needs to **interact** to understand (toggle states, scrub time, edit values)
- Data is best read as **chart + label** rather than a number in prose
- The same content will be **referenced multiple times** (a plan, a runbook, a deck)

If the answer is just text or a single list, stay in markdown — HTML adds friction.

## Pattern catalog

20 templates organized by the kind of work they replace. Pick the one closest
to the user's intent, copy it as the starting point, replace its placeholder
content with the real subject, output to {{DATA_DIR}}/memory/pages/<topic>.html`.

| Pattern | Template | Use when |
|---------|----------|----------|
| **Three approaches** | `01-exploration-code-approaches.html` | Comparing 2–4 ways to solve the same problem; trade-offs in margin |
| **Visual directions** | `02-exploration-visual-designs.html` | Showing 4 design/layout options the user can react to |
| **Implementation plan** | `16-implementation-plan.html` | Milestones, data-flow, risky code, risk table — the plan the implementer reads |
| **Annotated PR** | `03-code-review-pr.html` | Diff with margin notes, severity tags, jump links |
| **PR writeup** | `17-pr-writeup.html` | Author-side: motivation, before/after, file-by-file tour |
| **Module map** | `04-code-understanding.html` | Unfamiliar package as boxes + arrows, hot path highlighted |
| **Design system** | `05-design-system.html` | Tokens (color, type, spacing) as swatches you can copy from |
| **Component variants** | `06-component-variants.html` | Every size/state/intent of one component on a single sheet |
| **Animation sandbox** | `07-prototype-animation.html` | Tune duration/easing in isolation before wiring it in |
| **Clickable flow** | `08-prototype-interaction.html` | 3–5 linked screens — feel whether the interaction is right |
| **Slide deck** | `09-slide-deck.html` | Arrow-key presentation, no Keynote/PPT |
| **SVG figures** | `10-svg-illustrations.html` | Inline SVG illustrations for posts/docs |
| **Flowchart** | `13-flowchart-diagram.html` | Pipeline as real flowchart with click-to-expand steps |
| **Status report** | `11-status-report.html` | Weekly: shipped/slipped + small chart |
| **Incident timeline** | `12-incident-report.html` | Post-mortem: minute-by-minute timeline + log excerpts |
| **Feature explainer** | `14-research-feature-explainer.html` | TL;DR + collapsible steps + tabbed code samples + FAQ |
| **Concept explainer** | `15-research-concept-explainer.html` | Live diagram + comparison table + glossary |
| **Triage board** | `18-editor-triage-board.html` | Drag tickets across Now/Next/Later/Cut, copy ordering out |
| **Feature flag editor** | `19-editor-feature-flags.html` | Grouped toggles, dependency warnings, copy diff |
| **Prompt tuner** | `20-editor-prompt-tuner.html` | Editable template + live sample re-render |

The `index.html` template is a gallery layout that lists multiple artifacts —
useful when you've made several and want a single entry point.

## Workflow

1. **Listen for shape, not topic.** "Compare X" → 01. "Explain how X works" → 14
   or 15. "What's left to ship" → 16 or 11. The user's words name the shape.
2. **Read the template.** All templates live at
   `$SKILL_DIR/templates/<name>.html`. They are complete,
   self-contained HTML — open one, see what it expects.
3. **Replace placeholder content** with the real subject. Keep the structure
   and visual system. Don't rewrite the CSS unless the active design system
   demands it.
   For finance dashboards in FinAgent Workstation, keep first-pass generated pages
   compact: use a template or a small page when possible, avoid oversized inline
   CSS/JS, and keep custom HTML around 12k characters unless the user explicitly
   asks for a more elaborate artifact. Match the active app design system:
   use the FinAgent Workstation dark panel surface, spacing, typography, and finance
   red-up/green-down convention unless the user explicitly asks for another
   visual direction.
4. **Use real data.** If the user has a repo / PR / log / metric, fetch or
   ask for it. Placeholder data ("Item A / Item B / Item C") makes the artifact
   feel like a demo. Real data makes it feel useful.
5. **Choose delivery mode:**
   - **Small HTML** (tables, badges, comparisons under ~50 lines): use ` ```html ``` `
     code fence directly in chat — the UI renders it inline as native widgets.
   - **Full page** (dashboards, decks, interactive editors): write to
     `{{DATA_DIR}}/memory/pages/<topic>.html` then open:
     `UIControl { action: "openPage", params: { path: "{{DATA_DIR}}/memory/pages/<topic>.html", title: "..." } }`
     The tool returns observed panel state when possible. If you edit an already-open
     page, call `WebView(action:"refresh", id:"<panel-id>")` and verify with
     `WebView(action:"get_info")` or `WebView(action:"screenshot")` when needed.
6. **Summarize in chat.** After opening a full page, reply with a 1–2 sentence
   summary of what you made and how to interact with it.

## Editor templates need a Bridge

Templates 18, 19, 20 are interactive — the user does work in the UI (drag
cards, toggle flags, edit prompts) and needs an **export** button that sends
the result back. Wire these via the Bridge:

```html
<script>
  // Inside an async export button handler:
  const result = serializeBoardState();
  await Bridge.notify(`Triage result:\n${result}`);
</script>
```

The agent then receives the result as a notification and can act on it
(write a markdown summary, update a file, etc.).

In FinAgent Workstation WebView pages, `Bridge` is injected by the native WebView
preload and all Bridge calls return Promises. Do not define fallback
`window.Bridge`, `window.AgentBridge`, or mock Bridge wrappers in generated
HTML. If Bridge is unavailable, show a small inline error and log to
`console.error`; it means the artifact is not running in the expected WebView
preload context or needs to be reopened/refreshed.

For non-editor templates (everything else), no Bridge is needed — they're
read-only artifacts.

## Honor the active design system

If the current task provides an explicit design system or visual palette, swap
the CSS variables at the top of the template (`--clay`, `--olive`, etc.) for
that palette and typography. The structure of the templates stays the same;
only the visual identity changes. Do not reference `{{DATA_DIR}}/memory/DESIGN.md`; Fin
Electron does not create or ship that file by default.

The bundled templates use Anthropic's Claude visual system (ivory paper,
clay accent, serif headlines). It's a strong default if no design system
is active.

## Quality bar

Every artifact should:

- Render correctly at 390px (mobile) and 1440px (desktop)
- Have real, plausible content — not "Lorem ipsum" or "Item 1, Item 2"
- Use semantic HTML (`<header>`, `<section>`, real heading hierarchy)
- Include alt text and ARIA labels where icons stand in for words
- Pass color contrast at AA level

If the user gives you a vague brief ("a status report"), ask one clarifying
question to get something specific to render — what project, what week,
what metrics — before generating. Specificity is what makes the artifact
worth opening.
