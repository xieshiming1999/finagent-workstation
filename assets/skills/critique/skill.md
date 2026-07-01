---
name: critique
description: |
  Run a 5-dimension expert design review on any HTML artifact in the
  project - Philosophy / Visual hierarchy / Detail / Functionality /
  Innovation, each scored 0-10. Outputs a single self-contained HTML
  report with a radar chart, evidence-backed scores, and three lists:
  Keep / Fix / Quick wins. Use when the brief asks for a "design
  review", "design critique", "five-dimension review", "design audit",
  or "what's wrong with my design".
triggers:
  - "critique"
  - "design review"
  - "design audit"
  - "five-dimension review"
  - "5-dim review"
  - "audit my design"
  - "review my deck"
  - "review my landing page"
  - "design review in Chinese"
  - "retrospective in Chinese"
od:
  mode: prototype
  platform: desktop
  scenario: design
  upstream: "https://github.com/alchaincyf/huashu-design"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: false
---

# Critique Skill - 5-Dimension Expert Review

Produce a single-file HTML design review report that scores any artifact
across 5 dimensions and proposes actionable fixes. Inspired by the
*huashu-design* expert-critique flow.

## When to use

- After the agent or user generates an artifact such as a deck,
  prototype, or landing page and asks for review, critique, or diagnosis
- As a self-check loop the agent can run on its own output before
  emitting it
- When comparing two variants of the same design

## What you produce

A single self-contained `<artifact type="text/html">` review report
including:

1. **Header** - what artifact was reviewed, date, reviewer
   (`OD · Critique skill`), and a one-line verdict
2. **Radar chart** - inline SVG, no library, showing the 5 scores
3. **Five dimension cards**, each with:
   - Score 0-10 with band labels:
     - 0-4 `Broken`
     - 5-6 `Functional`
     - 7-8 `Strong`
     - 9-10 `Exceptional`
   - One evidence paragraph citing specific elements / files / lines
   - One Keep / Fix / Quick-win bullet
4. **Combined action lists** at the bottom:
   - **Keep** - what is working and should not be broken
   - **Fix** - P0 / P1 issues that are visually expensive
   - **Quick wins** - 5-15 minute tweaks with disproportionate impact

## The 5 dimensions

> Each dimension is independent. A deck can be 9/10 on Innovation but
> 4/10 on Hierarchy, and the report should say that plainly. Do not
> average away interesting failures.

### 1. Philosophy consistency

> Does the artifact pick a clear direction and stay consistent through
> every micro-decision such as chrome, kicker, spacing, and accent use?

**Evidence to look for:**
- Is there one declared design direction such as Monocle, WIRED, or
  Kinfolk, or is it three styles fighting each other?
- Does the chrome / kicker vocabulary stay in one register, or does one
  page say `Vol.04 · Spring` while another says `BUT WAIT`?
- Are accent / serif / mono used by the same rule throughout?

**0-4** Three styles fighting each other. **5-6** One direction but
half the elements drift. **7-8** Coherent with occasional drift on edge
pages. **9-10** Every element argues for the same thesis.

### 2. Visual hierarchy

> Can a stranger understand what to read first, second, and third
> without being told?

**Evidence to look for:**
- Is the largest type clearly the most important thing on each page?
- Do mono / serif / sans roles match the information role such as meta,
  body, and display?
- Are many loud elements competing, or is there a clean primary /
  secondary / tertiary tier?

**0-4** Everything shouts. **5-6** Hierarchy works on hero pages but
breaks on body pages. **7-8** Clear tiers with occasional collision.
**9-10** The eye moves with zero friction.

### 3. Detail execution

> The 90/10 craft issues: alignment, leading, large-size kerning, image
> framing, footer/chrome polish, and edge-case spacing.

**Evidence to look for:**
- On big-stat pages, does the number sit on a clean baseline or float?
- Are left/right column tops aligned in `grid-2-7-5`?
- Are `frame-img` and caption proportions consistent across pages?
- Do mono labels use the same letter-spacing and uppercase rule?
- Are there orphaned `<br>` tags causing one-character lines?

**0-4** Visible tape and string. **5-6** Most pages are clean, but one
or two are ragged. **7-8** Polished, with only a few misses detectable
by an expert eye. **9-10** Magazine-grade craftsmanship.

### 4. Functionality

> Does the artifact work for its intended use: click targets, nav,
> readability at presentation distance, copy/paste behavior for code
> blocks, and mobile fallback when relevant?

**Evidence to look for:**
- For decks: do keyboard, wheel, and touch navigation all work? Is
  there an iframe scroll fallback?
- For landing pages: is the CTA above the fold? Is the phone number
  tappable on mobile?
- For runbooks: are code blocks copyable, in mono, and free of smart
  quotes?
- Is critical information readable from around 4 meters away on a large
  screen?

**0-4** Looks okay but does not do its job. **5-6** Core flow works,
edge cases break. **7-8** Robust in normal use. **9-10** Defensively
engineered.

### 5. Innovation

> Does this push beyond the median? Is there one element that makes
> people lean in?

**Evidence to look for:**
- Is there one unexpected layout, motion, or typographic move that
  feels earned?
- Or is it 100% safe and interchangeable with any deck or landing page
  from any agency?
- Does the innovation fit the design direction, or is it random
  ornament?

**0-4** Generic AI-slop median. **5-6** Competent and forgettable.
**7-8** One memorable moment with the rest solid. **9-10** Multiple
moves worth stealing, all serving the thesis.

## Scoring discipline

- **Always cite evidence**. `Scored 4 because the hero page mixes
  Playfair display with Inter sans on the same line` is better than
  `feels inconsistent`.
- **Do not average up**. If Hierarchy is 5 because page 3 is broken, do
  not bump it to 7 because pages 1 and 2 are fine. Use the worst
  sustained band.
- **Do not inflate**. A 7 means strong, not merely acceptable. If every
  score is 7+, you are not reviewing critically.
- **Innovation is allowed to be low**. A 5/10 can be fine for a
  production deliverable. Do not punish appropriate conservatism.

## Workflow

### Step 1 - Acquire the artifact

Three modes:

1. **Project file** - the user said `review the index.html I just made`;
   open it from the project folder.
2. **Pasted HTML** - the user pasted code in chat; read it from the
   message.
3. **Generated by you in this turn** - you just emitted an artifact and
   want to self-critique it; re-read your own `<artifact>`.

If multiple HTML files exist, ask which one instead of reviewing all of
them.

### Step 2 - Read enough to score

Skim the entire `<style>` block, then read 6-8 representative content
blocks. Do not score from frontmatter alone. The score depends on the
executed design, not just the declared intent.

### Step 3 - Score with evidence

For each of the 5 dimensions, write the score and a 30-80 word evidence
paragraph that names specific elements. Use line numbers, class names,
and page numbers where possible.

Example:

```text
Dimension: Detail execution
Score: 6 / 10
Evidence: Stat cards on page 3 align cleanly (grid-6, 3x2), but on
page 8 the right column footer sits 2vh higher than the left because
.callout has 3vh top margin while the figure does not. Image captions
use mono on page 5 but sans on page 7 - pick one.
```

### Step 4 - Build the action lists

Aggregate the 5 evidence paragraphs into:

- **Keep** (3-5 bullets) - concrete things that are working and should
  not be broken in the next iteration. Cite by class / page / element.
- **Fix** (3-6 bullets) - must-do items, ordered by visual cost saved
  per minute spent. Each bullet should be no more than one sentence.
- **Quick wins** (3-5 bullets) - 5-15 minute changes with a high
  signal-to-noise ratio.

### Step 5 - Emit the report HTML

Build a single file with:

- Header: artifact name, reviewer credit, and date
- Large radar chart (SVG)
- 5 dimension cards in a 1-column or 2-column grid
- Three action lists at the bottom with checkbox affordance

Use the active `DESIGN.md` tokens if one exists. Otherwise, default to
a neutral light theme with an off-white background, near-black text,
and one accent color for radar fill.

## Output contract

```html
<artifact identifier="critique-<artifact-slug>" type="text/html" title="Critique · <Artifact Title>">
<!doctype html>
<html>...</html>
</artifact>
```
