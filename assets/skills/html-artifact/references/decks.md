# Deck Pattern

## When to use

A handful of `<section>` tags and twenty lines of JS is a slide deck. Point
the agent at a Slack thread or a design doc and get something you can
arrow-key through in a meeting — no Keynote, no export step.

## Template

### 09 — Arrow-Key Slide Deck

**Shape:** Full-viewport slides, horizontal navigation.

**Key elements:**
- Each slide is a `<section>` with centered content
- ← → arrow keys to navigate
- Slide counter (1/N) in corner
- Escape shows overview (all slides miniature)
- Supports: text slides, image slides, code slides, two-column comparison

**Construction:**
```html
<section class="slide">
  <h2>Title</h2>
  <p>One point per slide, big text.</p>
</section>
```

**Keyboard:** Left/Right = navigate, Home/End = first/last, Escape = overview.

**Adapt for:** lightning talks, project updates, demo walkthroughs, decision
presentations ("here are 3 options, I recommend B").

**For richer decks:** use `simple-deck` if available, or write a self-contained
page under `memory/pages/` with local CSS and JavaScript.
