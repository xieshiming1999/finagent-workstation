# wind-mcp-skill

> **Access Wind financial data** for A-shares, Hong Kong equities, US equities,
> funds, indexes, bonds, announcements, news, and macro data.

---

## What this is

This skill accesses the Wind financial database through MCP and gives the AI
agent:

- A-share market data including latest price, K-line, and minute data, plus
  fundamentals such as reports, equity structure, events, technicals, and risk
- Hong Kong and US equity market data plus fundamentals, events, technicals,
  and risk
- ETF and mutual-fund data including profile, financials, holdings,
  performance, holders, and management company
- Index and board data including quotes, profile, weighted PE / PB / PS, and
  technical indicators
- Bond data including bond profile, issuer profile, market valuation, duration,
  convexity, spread, and issuer financials
- Company announcements and financial-news RAG
- Macro and industry economic indicators through EDB
- A general natural-language fallback entry only when the specialized Wind
  tools do not cover the request

Not covered:
- European or Japanese equities
- other non-US/non-China-concept foreign equity markets
- FX or futures order-book quotes
- crypto
- non-financial data

---

## Installation

```bash
# Global install (recommended for cross-project and cross-agent reuse)

# GitHub
npx skills add Wind-Information-Co-Ltd/wind-skills --skill wind-mcp-skill -g -y

# Gitee mirror
npx skills add https://gitee.com/wind_info/wind-skills.git --skill wind-mcp-skill -g -y
```

If you want the skill available only inside the current project, remove `-g`.
With `-g`, the skills tool performs a global install or link for supported
clients such as Claude Code, Cursor, OpenClaw, or Hermes.

---

## API key

`WIND_API_KEY` is required. Get it from
[Wind AI FinMarket](https://aifinmarket.wind.com.cn/#/user/overview).

After installation, ask the AI for a Wind data request and it should guide key
setup through the stdout JSON envelope fields such as `error.agent_action` or
`error.hint`. You usually do not need to manage config paths manually.

You can also run this from the skill directory:

```bash
node scripts/cli.mjs open-portal
```

If the CLI reports `KEY_MISSING`, follow the setup instruction in stdout
`error.agent_action` or `error.hint`. The program automatically checks the
`WIND_API_KEY` environment variable and common local config files.

---

## Usage notes

- `analytics_data` is only a fallback. If the request clearly maps to
  announcements, news, macro, market data, or fundamentals, use the
  specialized `server_type` first.
- `references/tool-manifest.json` is the authoritative list for validating
  `server_type + tool_name`. Invalid combinations are rejected locally before
  the backend call.
- On Windows PowerShell 5.x, JSON escaping often causes
  `INVALID_PARAMS_JSON`. Check the shell-escaping guidance in
  [SKILL.md](./SKILL.md) first.
- K-line tools must always include both `begin_date` and `end_date`.
  Minute-quote tools use `begin` and `end`.
- For market-data `indexes`, copy the exact field names from
  [references/indicators.md](./references/indicators.md).
- One tool call supports one target only. Multi-symbol comparison requires
  multiple calls.
- In Codex sandbox environments, Wind network calls need
  `require_escalated`.

---

## Upgrade

```bash
# Global install
npx skills update wind-mcp-skill -g -y

# Project-local install
npx skills update wind-mcp-skill -y
```

When a `call` command detects a newer version, stderr prints a
`[wind-skills] 检测到新版可用` block. The emitted `升级命令:` line already uses the
correct `-g` or non-`-g` form for your install location. Copy it exactly.

---

## Directory layout

```text
wind-mcp-skill/
├── SKILL.md                     # Core AI-facing rules: coverage, usage, tool table, caveats, tips, and error handling
├── references/
│   ├── indicators.md            # Chinese indexes field list grouped by category
│   └── tool-manifest.json       # Authoritative server_type / tool_name validation list
├── scripts/
│   ├── cli.mjs                  # Main MCP call entry point
│   └── update-check.mjs         # Upgrade awareness probe
└── README.md
```

For the detailed tool list, input schemas, and field explanations, see
[SKILL.md](./SKILL.md).
