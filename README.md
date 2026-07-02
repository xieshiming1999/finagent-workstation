# FinAgent Workstation

FinAgent Workstation is an Electron and React finance workstation with a TypeScript agent runtime, local data store, provider provenance, dashboards, strategy workflows, and simulated-trading boundaries.

## Abilities

- Desktop agent runtime: chat agent, event agent, sessions, memory, tool execution, permission gates, workflow automation hooks, dashboard/WebView tools, and restart-diagnosable evidence.
- Finance data layer: local-first DataStore, governed provider interfaces, sidecar-backed public providers, live probes, provider matrix, API Health, source time versus fetch time, and typed readbacks.
- Provider governance: Wind, Tushare, TDX/gotdx, EastMoney, AkShare, Sina, Tencent, Yahoo/yfinance, search, macro, and research sources are routed through explicit capabilities instead of anonymous fallbacks.
- Analysis layer: market overview, stock/fund research, macro research, news/search context, risk notes, source-health evidence, and generated reports/workstation panels.
- Strategy and backtest: built-in strategy library, custom StrategySpec validation, backtest execution, saved strategy lifecycle, rerun evidence, portfolio-style comparison, and monitor/watchlist handoff.
- Workflow surfaces: Data Manager, API Health, Macro Research, Strategy Library, watchlists, dashboards, simulated trading, generated WebView reports, and evidence-first workflow tests.

## Quick Start

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Run the app:

```bash
pnpm dev
```

## Runtime Settings

The app needs runtime settings before the agent can run real workflows. Configure them in the app settings UI or in the runtime configuration directory created by the app. Do not commit local credentials.

Minimum model settings:

- LLM provider, base URL, model, and API key.
- Recommended default: a vision-capable model for normal agent workflows, because UI/screenshot/dashboard and visual evidence workflows may need image understanding. Use a text-only model only for text-only smoke tests or workflows that do not inspect images.
- Optional LLM HTTP user-agent header when the selected provider requires one.

Finance data settings:

- Provider credentials only for providers you intend to use. A personal research finance workstation usually fails first on data access, not on the LLM: the hard work is retrieving data, proving the provider returned the expected schema, preserving source time separately from fetch time, and reusing verified local rows before spending another external call.
- Data source options should be treated as governed provider paths, not anonymous fallback blobs. Configure only the providers used by your workflow.
- TDX, EastMoney, and public market-data paths: useful for A-share quote, K-line, fund, market-structure, news, and ranking data. Each provider has different schema stability, route behavior, and transport reliability.
- Wind / AIFinMarket: configure `WIND_API_KEY` only if you have access from Wind AIFinMarket. Use it for licensed professional data, macro series, documents, and advanced finance facts; quota and permission limits are provider-owned and should be visible in API health.
- Tushare: configure `TUSHARE_TOKEN` from a Tushare account when you need supported A-share reference data. Some statement/fund endpoints require extra permissions; unsupported or permission-gated endpoints should stay disabled instead of being advertised as normal workflows.
- Optional local proxy settings when your network requires them.
- Runtime data directory for sessions, memory, generated dashboards, local cache, provider evidence, logs, and user-created artifacts.

Data-source comparison:

| Source group | Best use | Main boundary | Provenance treatment |
|---|---|---|---|
| Local readback / SQLite | Reusing previously verified rows, dashboards, reports, strategy reruns, and offline-ish continuity | Only valid when freshness and coverage match the workflow | Prefer first; show cache status, source time, fetch time, provider, and schema/table. |
| TDX / gotdx | A-share quote, K-line, index, tick, transactions, and market-structure data | Requires local gotdx/runtime health; endpoint encodings are schema-specific | Persist registered schemas and classify runtime or transport failures in API Health. |
| EastMoney / AkShare | A-share, fund, sector, hot-list, news, ranking, flow, and market-structure public data | Sidecar/route health and wrapper behavior can drift | Normalize through provider-specific adapters; keep invalid-parameter and transport failures separate. |
| Sina / Tencent | Extra public A-share quote/K-line/ranking coverage and fallback diversity | Public endpoints are selective and should not be assumed complete | Register only verified capabilities and keep unsupported rows out of normal routing. |
| Wind / AIFinMarket | Licensed professional, macro, fundamental, document, and advanced finance data | Credential, quota, and permission gated | Prefer cache/readback; expose quota, permission, and credential status before live refresh. |
| Tushare Pro | Structured A-share reference data when the token has permission | Endpoint permissions vary by account | Disable unsupported endpoints and avoid retry loops after permission failure. |
| yfinance / Yahoo Finance | Global instruments, cross-market context, profile, options, actions, holders, and news | Needs Python sidecar plus global web access or proxy | Persist typed global datasets; do not replace China A-share primary providers. |
| Search, macro, and research pages | Narrative explanation, macro attribution, event context, and source discovery | Not automatically canonical market data | Store evidence with source/date/hash where supported; promote only stable schemas into reusable tables. |

Credential and access matrix:

| Data source | Key required | Where to get / configure | Main use |
|---|---|---|---|
| TDX / gotdx public market data | No API key | Local gotdx sidecar/runtime path | A-share quote, K-line, index and market-structure paths. |
| EastMoney public data | No API key | Public EastMoney routes | A-share, ETF, sector, hot-rank, flow, limit-pool and related public data. |
| AkShare public wrappers | No API key | Python sidecar with AkShare installed | Useful compatibility path; still needs sidecar health and schema validation. |
| Wind / AIFinMarket | `WIND_API_KEY` | Wind AIFinMarket / Wind account or portal | Professional, macro, fundamental, document and advanced finance data; quota and permission gated. |
| Tushare Pro | `TUSHARE_TOKEN` | Tushare account -> personal center -> account token | Structured A-share reference data; endpoint permissions vary by account. |

Service dependencies:

- Electron, Node.js, and pnpm for local development.
- Sidecar-backed providers may require Python, local sidecar startup, or provider-specific runtime paths.
- External finance providers may require network access, credentials, quota, cookies, sidecars, or provider-specific runtime paths.
- Missing credentials should block only the credentialed provider path; local readback and public-source workflows should remain usable.

Runtime data such as sessions, dashboards, generated reports, logs, cache, memory, cookies, and API keys belongs outside this repository.

## Design Guides

Design guides are part of the source contract. They are added as the corresponding code domains appear. When a design guide is added or materially changed, update both `README.md` and `README.zh.md` in the same source-change commit so the README describes the code at that point in history.

English:

- `docs/design/agent/agent-design-guide.md`
- `docs/design/data-provenance/data-provenance-design-guide.md`
- `docs/design/strategy-provenance/strategy-provenance-design-guide.md`

Chinese:

- `docs/design/agent/agent-design-guide.zh.md`
- `docs/design/data-provenance/data-provenance-design-guide.zh.md`
- `docs/design/strategy-provenance/strategy-provenance-design-guide.zh.md`

## Development

Validate TypeScript and tests:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

Build:

```bash
pnpm build
```

## Repository Layout

```text
assets/ Bundled skills, dashboards, schema assets, and runtime prompts
docs/design/ Bilingual design guides, added as the related code domains appear
scripts/ Provider audits, probes, maintenance, and workflow helpers
sidecar/ Optional local provider sidecar code
src/ Electron main process, TypeScript agent runtime, and React UI
test/ Unit and workflow-oriented regression tests
```

## Safety Boundary

This project is for research, education, and workflow assistance. It does not provide investment advice. Trading-related workflows must keep simulated and real broker paths separate, require explicit approval for side effects, and record the evidence used for each decision.

Do not commit API keys, cookies, tokens, local proxy settings, runtime sessions, or generated data into this repository.

## License

Apache License 2.0. See `LICENSE`.
