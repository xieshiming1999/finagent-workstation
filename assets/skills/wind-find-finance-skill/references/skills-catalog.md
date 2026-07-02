---
name: find-skills-catalog
description: Local copy of the platform skill catalog. Updated together with `wind-find-finance-skill` when running `npx skills update -g -y`.
---

# Skill Catalog

> Catalog of every installable platform skill.
> Updated together with `wind-find-finance-skill` by `npx skills update -g -y`.

---

## Data Skills (Retrieval / Query)

> Retrieval and query tasks: market quotes, funds, equity financials,
> announcements, news, and macro indicators.

| Name                  | Category                             | Required setup | Summary |
| --------------------- | ------------------------------------ | -------------- | ------- |
| wind-mcp-skill        | Data - market / fund / equity / macro / docs | API Key | Access Wind finance data across A-shares, Hong Kong equities, ETF/public funds, company announcements, finance news, and macro indicators. |
| wind-alice            | Alice professional finance analysis agent | API Key | Alice analysis entry point for fact checking, one-page company memos, diligence question lists, earnings commentary, thematic stock picking, fund analysis, macro / bond / credit analysis, market sizing, and comps work. |
| tushare-finance-skill | Data - market / financials / macro / multi-asset | Dependency + Token | Access Tushare Pro finance data covering A-shares, Hong Kong, US equities, funds, futures, bonds, financial statements, and macro indicators. |

---

## Alice Sub-Skill Index

> These capabilities are all served through `wind-alice`. When the user
> explicitly names the Chinese or English sub-skill, or asks a highly
> matched question, recommend installing / invoking `wind-alice` and pass
> the matching sub-skill name to Alice.

| Chinese name | English skill name | Best for |
| --- | --- | --- |
| 通胀情景债券轮动策略 | `Inflation Bond Strategy` | Bond / money-market / duration rotation driven by CPI and PPI turning points |
| 宏观数据解读 | `Macro Data Interpretation` | Weekly-research-style interpretation of CPI, PPI, PMI, GDP, total social financing, and similar macro indicators |
| 按主题选股 | `Thematic Stock Screening` | Breaking down market themes, validating theme logic, and screening true beneficiaries |
| 债券利率走势研判 | `Bond Rate Outlook` | Bond rate outlook from trading, strategy, and allocation perspectives |
| 信用分析 | `Credit Analysis` | Issuer credit, cash flow, ratings comparison, and default-probability analysis |
| 基金对比分析 | `Fund Compare` | Comparing multiple funds across returns, risk, holdings, and manager ability |
| 基金筛选与投资建议 | `Fund Screening & Investment Advisory` | Multi-factor fund screening plus advisory-style allocation suggestions |
| 投资标的创意与筛选 | `Investment Idea Generation` | Generating investable ideas from factors and themes |
| 公司一页纸 | `Company One-Page Investment Memo` | One-page listed-company investment memo |
| 上市公司调研问题清单 | `Stock DD List` | Buy-side diligence memo with deep-dive questions for management |
| 全球上市公司季报点评 | `Global Share Quarterly Earnings Review` | Global listed-company earnings review with beat/miss framing and key changes |
| 市场规模测算与战略建模 | `Market Sizing & Strategic Modeling` | Top-down / bottom-up market sizing with scenario sensitivity |
| 可比公司分析 | `fsi-comps-analysis` | Institutional-grade comparable-company analysis with Excel and written report output |
| 事实核验 | `Fact Check` | Point-by-point verification of financial data, statements, events, and textual claims |

---

## Workflow Skills (Decision / Analysis)

> Decision and workflow tasks: valuation, post-market review, stock
> selection, backtesting, single-name research, and market-theme work.

| Name | Category | Required setup | Summary |
| --- | --- | --- | --- |
| dcf-model | Valuation | None | DCF valuation modeling with WACC and sensitivity analysis |
| earnings-analysis | Valuation - earnings | None | Earnings review with beat/miss framing and valuation update |
| valuation-pricing-framework | Valuation | None | Valuation and pricing framework for rerating/upside judgment |
| equity-investment-thesis | Single-name research | None | Deep single-stock investment-thesis work in sell-side-research style |
| a-share-primary-theme-identification | Market theme | None | Identify the primary A-share market theme using cycle and fund-flow behavior |
| market-environment-analysis | Market theme | None | Global market environment analysis for risk-on / risk-off framing |
| theme-detector | Market theme | None | Cross-sector theme detection using FINVIZ plus lifecycle analysis |
| post-market-debrief | Review | None | Post-market review covering full market picture and theme rotation |
| position-sizer | Position sizing | None | Position sizing using risk, Kelly, and ATR frameworks |
| backtest-expert | Backtest | None | Systematic quantitative backtesting with stress testing |
| valuation_snapshot_skill | Valuation | None | Fast valuation read on level, percentile, and rerating triggers |
| bull_bear_case_builder_skill | Single-name research | None | Build both bull and bear cases to compress confirmation bias and surface the core disagreement |
| peer_comparison_decision_skill | Single-name research | None | Compare candidate companies on quality, growth, valuation, and catalysts to support a choose-one decision |
| moat_strength_review_skill | Single-name research | None | Evaluate whether competitive advantages are real, durable, and convertible into returns |
| business_model_decoder_skill | Single-name research | None | Explain clearly how a business acquires users, makes money, expands, and where it is constrained |
| major_announcement_impact_skill | Event / announcement / earnings docs | None | Analyze the core impact of major announcements such as M&A, stake reduction, or placements |
| conference_call_takeaway_skill | Event / announcement / earnings docs | None | Extract key call takeaways, management tone, and warning signs |
| guidance_change_impact_skill | Event / announcement / earnings docs | None | Explain what guidance raises/cuts mean, how credible they are, and the likely downstream impact |
| sec_filing_question_answer_skill | Event / announcement / earnings docs | None | Answer questions precisely from long regulatory documents such as 10-K, 10-Q, and prospectuses |
| sector_rotation_radar_skill | Market theme | None | Detect sector-strength rotation, capital rotation, and style shifts |
| market_regime_switch_skill | Market theme | None | Judge whether the market is in offense, defense, chop, or a switching regime |
| institutional_position_shift_skill | Market theme | None | Identify institutional-position changes and consensus rotation, especially around quarterly holdings research |
| theme_leader_identification_skill | Market theme / stock picking | None | Identify leaders, core names, and followers within hot themes |
| breakout_candidate_finder_skill | Stock picking | None | Screen mature chart setups and pending breakouts with explicit triggers |
| pullback_opportunity_finder_skill | Stock picking | None | Find sufficiently pulled-back names whose trends remain intact |
| high_quality_compounder_finder_skill | Stock picking | None | Screen high-ROE, moat-rich, long-term compounder candidates |
| trade_plan_builder_skill | Trade execution | None | Build a complete pre-trade plan including entry, size, stop, and take-profit |
| position_sizing_decision_skill | Trade execution / position sizing | None | Suggest single-trade size and scaling based on risk budget and volatility |
| stop_loss_discipline_skill | Trade execution | None | Design price, thesis, and time-based stop-loss rules and actions |
| take_profit_ladder_skill | Trade execution | None | Design staged profit-taking, stop-to-breakeven, and runner rules |
| wind-alice | Alice professional finance analysis agent | API Key | Alice analysis entry point for fact checking, one-page company memos, diligence question lists, earnings commentary, thematic stock picking, fund analysis, macro / bond / credit analysis, market sizing, and comps work |

---

## Category Index (for exploration questions)

| Category | Skill count | Representative skill |
| --- | --- | --- |
| Data - market / fund / equity / macro / docs | 4 | wind-mcp-skill |
| Alice professional finance analysis agent | 1 | wind-alice |
| Valuation | 4 | dcf-model |
| Single-name research | 5 | equity-investment-thesis |
| Event / announcement / earnings docs | 4 | major_announcement_impact_skill |
| Market theme | 7 | a-share-primary-theme-identification |
| Stock picking | 4 | breakout_candidate_finder_skill |
| Review | 1 | post-market-debrief |
| Position sizing | 2 | position-sizer |
| Trade execution | 4 | trade_plan_builder_skill |
| Backtest | 1 | backtest-expert |

---

## Installation Formula

Replace `<name>` in the command with the value from the `Name` column above:

```bash
# Global install (recommended - shared across projects and AI agents)
# GitHub
npx skills add Wind-Information-Co-Ltd/wind-skills --skill <name> -g -y
# Gitee mirror
npx skills add https://gitee.com/wind_info/wind-skills.git --skill <name> -g -y
```

> To limit usage to the current project only, remove `-g`.

Parameter notes:

- `-g`: global install - shared across projects and automatically symlinked into every recognized AI agent such as Claude Code, Cursor, OpenClaw, and Hermes
- without `-g`: current project only - installed into the current directory without affecting other projects or agents
- `-y`: required - skips the interactive menu so the command does not block

---

## Upgrade All Installed Skills

```bash
npx skills update -g -y
```

Meaning: `update` re-pulls the latest version of every installed skill,
`-g` upgrades only the global installs, and `-y` skips the scope prompt.
