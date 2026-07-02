---
description: Self-evolving knowledge workflow that stores validated rules, findings, and failures so the agent can reuse successful patterns and avoid repeating bad ones.
when_to_use: Trigger when a recurring analysis pattern keeps working, or when the user asks to save a method or rule for future reuse.
---

# Self-Evolving Knowledge

## Three-layer knowledge structure

```text
{{DATA_DIR}}/memory/
  knowledge/
    rules/
    findings/
    failures/
```

- `rules/`: durable rules that survived repeated validation
- `findings/`: useful patterns that work but may be conditional
- `failures/`: falsified paths that should not be repeated blindly

## Write rules

| Layer | Trigger | Example |
|---|---|---|
| `rules/` | explicit user confirmation plus at least 5 validations without exception | "chasing parabolic moves usually fails" |
| `findings/` | same strategy validated correctly 3 times in a row with win rate above 70% | "EMA works well on large-cap trend stocks" |
| `failures/` | same strategy fails 3 times in a row or user rejects it | "KDJ breaks down in range-bound markets" |

## Record format

```markdown
# <knowledge title>

## Summary
<one-sentence conclusion>

## Evidence
- Source: ai_validate / backtest / user confirmation
- Sample size: N
- Win rate: X%
- Time range: 2026-03 to 2026-05

## Conditions
<when it works>

## Failure conditions
<when it stops working>

## Log
- 2026-05-01: validated
- 2026-05-08: validated
```

## Trigger conditions

1. After `ai_validate`, 3 or more consecutive successful validations -> `findings/`
2. After `ai_validate`, 3 or more consecutive failures -> `failures/`
3. User explicitly confirms the rule is robust -> upgrade to `rules/`
4. User says "remember this method" or "save this strategy" -> write a finding or create a new skill

## Write patterns

### Writing a finding

```text
FileWrite(file_path: "{{DATA_DIR}}/memory/knowledge/findings/ema_trending_stocks.md", content: "# EMA strategy works on trend stocks\n\n## Summary\nEMA20/50 golden-cross works well on large-cap trend stocks and validated with a 65% live-confirmation win rate.\n\n## Evidence\n- Backtest: Moutai ema_cross score 82, Wuliangye score 75\n- Validation: 3 successful ai_validate checks\n- Time: 2026-03 to 2026-05\n\n## Conditions\n- Sector leaders with market cap above CNY 50B\n- Multi-moving-average uptrend\n- Consumption or new-energy leaders\n\n## Failure conditions\n- Range-bound market with ADX below 20\n- Small-cap theme stocks\n")
```

### Writing a failure

```text
FileWrite(file_path: "{{DATA_DIR}}/memory/knowledge/failures/kdj_ranging_market.md", content: "# KDJ fails in range-bound markets\n\n## Summary\nWhen ADX is below 20, KDJ crossovers generate too many false signals and backtests degrade badly.\n\n## Evidence\n- Backtest: Ping An Bank 2026Q1, win rate 35%, score 28\n- Validation: 3 failed ai_validate checks\n\n## Conclusion\nAvoid KDJ when ADX is below 20.\n")
```

### Creating a new reusable skill

```text
FileWrite(file_path: "{{DATA_DIR}}/memory/skills/<strategy>/skill.md", content: "---
description: <one-line description>
when_to_use: <trigger>
---
# <strategy>
## Conditions
<conditions>
## Actions
<steps>
## History
<validation history>
")
```

## Retrieval before analysis

Before analysis or stock picking, check existing knowledge:

```text
FileRead(file_path: "{{DATA_DIR}}/memory/knowledge/failures/")
FileRead(file_path: "{{DATA_DIR}}/memory/knowledge/findings/")
FileRead(file_path: "{{DATA_DIR}}/memory/knowledge/rules/")
```

Always avoid known failures, reuse relevant findings, and respect rules as hard constraints unless the user deliberately overrides them.

## Research notes after major analysis

After an important strategy review or stock-selection study, write a structured note:

```text
FileWrite(file_path: "{{DATA_DIR}}/memory/knowledge/findings/research_<date>_<topic>.md", content: "
# Research: <topic>

## Hypothesis
<hypothesis>

## Experiment
| Symbol | Strategy | Score | Return | Conclusion |
|---|---|---|---|---|
| 600519 | ema_cross | 82 | +45% | valid |
| 000858 | ema_cross | 75 | +32% | valid |

## Conclusion
<whether the hypothesis holds and where>

## Next steps
-> write to findings / update watchlist / continue validation
")
```

## Guardrails

- New knowledge belongs under `{{DATA_DIR}}/memory/`
- Do not overwrite `{{SKILLS_DIR}}/`
- Re-review findings if later validation deteriorates
- `rules/` should change rarely and represent the highest-confidence knowledge
