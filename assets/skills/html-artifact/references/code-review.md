# Code Review & Understanding Patterns

## When to use

Diffs and code structure are inherently spatial — markdown flattens them.
Use HTML when: the reviewer needs to jump between related hunks, the module
is easier understood as a graph, or the PR description has before/after sections.

## Templates

### 03 — Annotated Pull Request

**Shape:** Vertical diff with margin annotations.

**Key elements:**
- File-grouped diff hunks with syntax highlighting
- Margin notes with severity tags (critical / suggestion / nitpick)
- Jump links in a sidebar TOC
- Summary stats: files changed, lines added/removed

**Adapt for:** code review comments, security audit reports, style lint results.

### 17 — PR Writeup (Author Side)

**Shape:** Narrative with expandable sections.

**Key elements:**
- Motivation / "Why now" section
- Before/after comparison panel
- File-by-file tour: what changed and **why**
- "Focus your review on..." highlight box
- Testing / rollback notes

**Adapt for:** changelog entries, schema update guides, release notes.

### 04 — Module Map

**Shape:** Boxes-and-arrows diagram (inline SVG) + side panel.

**Key elements:**
- Module boxes with names and brief roles
- Arrows showing data flow / imports
- Hot path highlighted in accent color
- Entry points listed
- Click a box to see its exports

**Adapt for:** onboarding docs, architecture overviews, dependency maps.
