# FinAgent Workstation

FinAgent Workstation is an Electron and React finance workstation with a TypeScript agent runtime, local data store, provider provenance, dashboards, strategy workflows, and simulated-trading boundaries.

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

- Provider credentials only for providers you intend to use.
- Data source options such as Wind, Tushare, search providers, Xueqiu simulated trading, yfinance/Yahoo Finance, and TradingView.
- Optional local proxy settings when your network requires them.
- Global web access or a working proxy for providers that depend on overseas web services, especially yfinance/Yahoo Finance and TradingView.
- Runtime data directory for sessions, memory, generated dashboards, local cache, provider evidence, logs, and user-created artifacts.

Service dependencies:

- Electron, Node.js, and pnpm for local development.
- Sidecar-backed providers may require Python, local sidecar startup, or provider-specific runtime paths.
- External finance providers may require network access, credentials, quota, cookies, sidecars, or provider-specific runtime paths.
- Missing credentials should block only the credentialed provider path; local readback and public-source workflows should remain usable.

Runtime data such as sessions, dashboards, generated reports, logs, cache, memory, cookies, and API keys belongs outside this repository.

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
