# wind-find-finance-skill

> **Wind finance capability entry (meta-skill)** · read the skill catalog,
> help the AI list platform capabilities, and recommend installation

---

## What this is

This is not a data skill. It is an **entry skill**:

- The user asks "what finance capabilities do we have?" or raises a
  finance question but the AI is unsure which skill to use -> trigger
  this skill.
- The AI reads `references/skills-catalog.md` -> lists all available
  platform skills across both data-discovery and finance-workflow
  categories.
- It presents the matching install commands so the user can choose what
  to install.
- It may run `scripts/update-check.mjs` in a lock-driven way to check
  for updates and notify the user.

---

## Installation

```bash
# Global install (recommended - shared across projects and AI agents)
# GitHub
npx skills add Wind-Information-Co-Ltd/wind-skills --skill wind-find-finance-skill -g -y
# Gitee mirror
npx skills add https://gitee.com/wind_info/wind-skills.git --skill wind-find-finance-skill -g -y
```

> To limit usage to the current project only, remove `-g`. With `-g`,
> the installer automatically symlinks the skill into every recognized
> AI agent on the machine, such as Claude Code, Cursor, OpenClaw, and
> Hermes.

**No API key is required**. This skill does not call any MCP server. It
only reads local documentation.

---

## Directory structure

```text
wind-find-finance-skill/
├── SKILL.md                         # Core rules loaded by the AI (five-step trigger flow)
├── references/
│   └── skills-catalog.md            # Local copy of the platform skill catalog
├── scripts/
│   ├── update-check.mjs             # Update probe and notification helper
└── README.md
```

There is **no data `cli.mjs`** here. The LLM mainly uses file reads, and
`scripts/update-check.mjs` only handles update notifications.

---

## How it works

This skill is a **meta-skill**. Compared with a data skill:

| Dimension | Data skill (for example `wind-mcp-skill`) | This skill |
| --- | --- | --- |
| Calls the underlying MCP server | ✅ | ❌ |
| Needs `WIND_API_KEY` | ✅ | ❌ |
| Returns business data | ✅ | ❌ |
| Returns skill recommendations and install commands | ❌ | ✅ |
| Typical caller | AI calls it directly to fetch data | AI calls it first when unsure which skill to use |

After the AI loads `SKILL.md`, it follows these rules:

1. Read `references/skills-catalog.md` to get the local catalog.
2. Pick 1-3 relevant skills based on the user request and list them,
   including install commands.
3. Run `node scripts/update-check.mjs`. The script reads source and hash
   from the lock file. If stderr contains a `[wind-skills]` update
   notice, tell the user once per session.

---

## Upgrade

```bash
# Install globally (default recommendation)
npx skills update wind-find-finance-skill -g -y

# Install into the current project only (without -g)
npx skills update wind-find-finance-skill -y
```

When you run `node scripts/update-check.mjs`, the stderr line after
`升级命令：` already reflects whether `-g` is needed for the current
install location. Reuse it directly.

`references/skills-catalog.md` is updated together with the skill
package.

---

## Design notes

- **Minimal code**: the core recommendation logic stays in Markdown plus
  the AI's normal file-reading tools; the Node.js script only handles
  update reminders.
- **Cross-agent friendly**: any agent that lets the LLM read files and
  fetch URLs can use it.
- It only writes `~/.cache/wind-aifinmarket/update-state.json`, a shared
  cache across multiple skills. It does not write business data.
- **Platform versioning** is maintained separately from each skill's
  frontmatter version. When a monorepo skill changes, increment the
  corresponding `skill.md` version line.

---
