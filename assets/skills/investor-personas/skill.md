---
description: Investor persona analysis - analyze a stock through the lenses of Buffett, Graham, Lynch, and other masters, each with an independent scoring system
when_to_use: User asks for investor-persona analysis, master-investor frameworks, or multi-persona investment judgment.
---

# Investor Personas

Analyze the same stock through different investing masters, using each
persona's own framework and weighting model to produce a multi-angle
conclusion.

## How to use it

The user may name one or more investors:

```text
single named investor -> single-persona analysis
two or more named investors -> multi-persona parallel analysis using the Agent tool
broad master-investor request -> full-panel analysis
```

For multi-persona analysis, use the Agent tool in parallel:

```text
Agent(run_in_background:true, description:'Buffett analyst', prompt:'Analyze it using the Buffett framework...')
Agent(run_in_background:true, description:'Graham analyst', prompt:'Analyze it using the Graham framework...')
TaskOutput(task_id:'<Buffett task_id>', block:true)
TaskOutput(task_id:'<Graham task_id>', block:true)
```

Only after reading every required persona result may you produce a
combined score or final recommendation.

## Persona list

### 1. Warren Buffett - moat-based value investing

**Framework**: economic moat + owner earnings + management capital allocation  
**Weighting**: moat 30% + earnings predictability 25% + management 20% + valuation margin of safety 25%

Key checks:
- What is the moat source: brand, cost advantage, network effect, switching cost, monopoly? Name it explicitly.
- 10-year ROE/ROIC trend: has it stayed above 15%?
- Owner earnings (`net income + depreciation - capex`): what is the trend?
- Management: does it buy back shares or pay dividends? Is capital allocation rational?
- Buying a great business at a fair price: current PE vs 10-year median

### 2. Benjamin Graham - deep value

**Framework**: margin of safety + quantitative screens  
**Weighting**: valuation 40% + asset quality 30% + earnings stability 30%

Key checks:
- PE < 15? PB < 1.5? PE × PB < 22.5?
- Current ratio > 2? Long-term debt < net current assets?
- Profitable for 10 straight years? Dividend-paying for 20 straight years?
- Graham formula valuation: `V = EPS × (8.5 + 2g) × 4.4 / current rate`

### 3. Peter Lynch - GARP growth

**Framework**: PEG + company classification + story verification  
**Weighting**: PEG 30% + growth 30% + industry position 20% + valuation 20%

Key checks:
- Company type: slow grower / stalwart / fast grower / cyclical / turnaround / asset play?
- PEG: undervalued if < 1, reasonable at 1-2, expensive if > 2
- Revenue growth vs PE: growth rate should exceed PE
- Inventory growth vs revenue growth: inventory growing too fast is a warning sign

### 4. Charlie Munger - multidisciplinary mental models

**Framework**: inversion + circle of competence + behavioral-bias check  
**Weighting**: business quality 30% + management 25% + moat 25% + price 20%

Key checks:
- Invert it: under what conditions does this investment fail?
- Circle of competence: do you genuinely understand the business?
- Behavioral-bias check: confirmation bias, anchoring, loss aversion?
- "Better to buy a great business at a fair price than a fair business at a great price"

### 5. Seth Klarman - risk first

**Framework**: margin of safety + downside protection + catalysts  
**Weighting**: downside risk 30% + margin of safety 25% + catalysts 25% + liquidity 20%

### 6. Howard Marks - cycles and risk

**Framework**: market-cycle positioning + risk assessment  
**Weighting**: cycle judgment 35% + risk premium 25% + market sentiment 20% + valuation 20%

### 7. Joel Greenblatt - magic formula

**Framework**: dual ranking on return on capital (ROIC) and earnings yield (EBIT/EV)  
**Data needed**: EBIT, enterprise value (EV), invested capital  
**Selection rule**: rank each metric independently, then use the combined rank to pick the top 20-30 names

### 8. John Neff - low-PE growth

**Framework**: total return to PE ratio  
**Formula**: `(earnings growth rate + dividend yield) / PE > 2 × market average`

## Output format

Each persona analysis should look like:

```markdown
## <Persona> View - <Symbol>

| Dimension | Score (10) | Basis |
|------|-----------|------|
| Moat | <score> | <evidence> |
| Earnings predictability | <score> | <evidence> |
| Management | <score> | <evidence> |
| Margin of safety | <score> | <evidence> |

**Overall score**: <score>/10 - **<rating>**
**One-line view**: <concise persona-specific conclusion>
```
