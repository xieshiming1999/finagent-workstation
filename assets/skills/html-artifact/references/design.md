# Design Patterns

## When to use

HTML is the medium design systems ship in — so it's the natural format for
talking about them. Tokens become live swatches, components become contact
sheets, and the artifact can be fed straight back into the next prompt.

## Templates

### 05 — Living Design System

**Shape:** Vertical page with grouped swatch grids.

**Key elements:**
- Color palette: swatches with hex values, tap-to-copy
- Type scale: rendered at each size with the actual font
- Spacing tokens: visualized as boxes
- Sample component renders at each token combo

**Adapt for:** brand guidelines, theme proposals, design token documentation.

### 06 — Component Variants

**Shape:** Contact sheet (grid of every state).

**Key elements:**
- One component repeated in every combination:
  - Sizes: sm / md / lg
  - States: default / hover / active / disabled / loading
  - Intents: primary / secondary / danger / ghost
- Labels on each cell
- "Copy JSX" or "Copy class" link per variant

**Adapt for:** button, input, badge, avatar, card, alert — any component
the team wants to audit or review.
