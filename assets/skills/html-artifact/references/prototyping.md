# Prototyping Patterns

## When to use

Motion and interaction can't be described — only felt. A throwaway page with
the real easing curve or the real click-through tells you in five seconds
what a paragraph of prose never could.

## Templates

### 07 — Animation Sandbox

**Shape:** One panel with the animation + controls below.

**Key elements:**
- The animated element (a card, a transition, a micro-interaction)
- Sliders for: duration, delay, easing curve
- Easing curve preview (CSS cubic-bezier visualizer)
- "Replay" button
- CSS output at bottom (copy-paste ready)

**Adapt for:** loading spinners, page transitions, hover effects, scroll
animations — any motion you need to tune before committing to code.

### 08 — Clickable Flow

**Shape:** 3–5 screen frames linked with transition arrows.

**Key elements:**
- Each screen is a rendered mini-page (realistic size mockup)
- Navigation: click a button/link → next screen slides in
- Breadcrumb or step indicator at top
- "Export JSON" button that dumps the flow as structured data

**Adapt for:** onboarding flows, checkout wizards, form multi-step sequences,
error recovery paths.
