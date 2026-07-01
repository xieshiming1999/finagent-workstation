# Custom Editor Patterns

## When to use

Sometimes it's hard to describe what you want in a text box. Build a throwaway
editor for the exact thing you're working on. The key rule: **always end with
an export button** that turns the UI state back into something you can paste
into the agent or commit.

**These templates require a Bridge** so the export result flows back to the
agent as a notification.

## Templates

### 18 — Triage Board (Kanban)

**Shape:** 4-column drag-and-drop board.

**Key elements:**
- Columns: Now / Next / Later / Cut
- Cards with title, priority badge, optional tag
- Drag and drop between columns
- Counter per column
- "Copy ordering" button → markdown list grouped by column

**Bridge export:**
```js
const result = columns.map(col =>
  `## ${col.title}\n${col.cards.map(c => `- ${c.title}`).join('\n')}`
).join('\n\n');
Bridge.notify(result);
```

**Adapt for:** sprint planning, feature prioritization, backlog grooming,
content calendar, any batch-sorting task.

### 19 — Feature Flag Editor

**Shape:** Vertical list with toggle switches.

**Key elements:**
- Flags grouped by area/team
- Each flag: name, description, toggle switch, "modified" indicator
- Dependency warnings: if flag A requires B, and B is off → warning
- "Copy diff" button → only the changed keys as JSON or env format

**Adapt for:** config management, A/B test setup, permission toggles,
environment variable editors.

### 20 — Prompt Tuner

**Shape:** Split view — editable template left, live previews right.

**Key elements:**
- Left pane: textarea with `{{variable}}` slots highlighted
- Right pane: 3 sample inputs auto-rendered with the current template
- As you type, right pane updates live
- "Copy prompt" button → final interpolated text

**Adapt for:** email template editors, notification text editors, code
template builders, regex testers with live match preview.
