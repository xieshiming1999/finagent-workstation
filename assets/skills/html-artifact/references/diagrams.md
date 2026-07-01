# Diagrams & Illustrations Patterns

## When to use

Inline SVG gives the agent a real pen. When the answer is best understood as
a picture — not a list — draw it. The result is vector art that can be tweaked
by hand or pasted straight into the final document.

## Templates

### 10 — SVG Figure Sheet

**Shape:** Vertical page of 4–6 self-contained SVG illustrations.

**Key elements:**
- Each illustration is a standalone `<svg>` with descriptive title
- Consistent color palette and stroke weight across all
- Labeled axes/parts
- Copy button per figure (SVG source)

**Adapt for:** blog post illustrations, documentation figures, concept diagrams,
process step icons, comparison graphics.

### 13 — Annotated Flowchart

**Shape:** Full-page SVG flowchart with click-to-expand detail panels.

**Key elements:**
- Decision diamonds, process boxes, start/end capsules
- Arrows with labeled conditions (yes/no, success/failure)
- Click a step → side panel shows: what runs, timing, failure mode
- Color-coding by status: green (passing), orange (slow), red (failing)
- Legend at bottom

**Adapt for:** deploy pipelines, approval workflows, data processing chains,
user journey maps, state machines.
