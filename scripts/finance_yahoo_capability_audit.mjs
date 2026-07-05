#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const args = parseArgs(process.argv.slice(2))

const paths = {
  providerMatrix: 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json',
  liveStatusReport: 'reports/integrations/finance_live_status_report_2026_06_18.json',
  unificationAudit: 'reports/integrations/finance_data_unification_audit_2026_06_17.json',
  detailedMatrix: 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json',
  electronYahooService: 'finagent_workstation/src/domain/market/services/yahoo-market-data-service.ts',
  electronQuoteFetcher: 'finagent_workstation/src/agent/data/fetchers/fetcher-quote.ts',
  electronKlineFetcher: 'finagent_workstation/src/agent/data/fetchers/fetcher-kline-daily.ts',
  mobileYahooService: 'app/lib/domain/market/services/yahoo_market_data_service.dart',
  mobileYahooSupport: 'app/lib/domain/market/services/yahoo_market_data_support.dart',
  electronMarketDataHelp: 'finagent_workstation/src/agent/tools/market-data-help.ts',
  electronDataSourceSkill: 'finagent_workstation/assets/skills/data-sources/skill.md',
  mobileMarketDataToolSchema: 'app/lib/agent/tools/market_data_tool/market_data_tool_schema.dart',
}

const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_yahoo_capability_audit_2026_06_19.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_yahoo_capability_audit_2026_06_19.md')

const report = buildReport()

if (args['no-write'] !== 'true') {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance Yahoo capability audit: ${report.summary.yahooCapabilities} Yahoo capability rows, ${report.summary.livePassed} live-passed capability rows, ${report.summary.problems} problems`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (args['fail-on-problem'] === 'true' && report.problems.length > 0) {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildReport() {
  const providerMatrix = readJson(paths.providerMatrix)
  const liveStatusReport = readJson(paths.liveStatusReport)
  const unificationAudit = readJson(paths.unificationAudit)
  const detailedMatrix = readJson(paths.detailedMatrix)
  const liveByProbe = new Map((liveStatusReport.passedApis ?? []).concat(liveStatusReport.failures ?? []).map((item) => [item.id, item]))
  const unifiedByCapability = new Map((unificationAudit.rows ?? [])
    .filter((row) => row.provider === 'yahoo' || row.provider === 'yfinance' || String(row.capabilityId ?? '').startsWith('yahoo.'))
    .map((row) => [row.capabilityId, row]))
  const detailedYahooRows = (detailedMatrix.rows ?? []).filter((row) => {
    const text = JSON.stringify({
      action: row.action,
      endpoint: row.endpoint,
      provider: row.provider,
      surfaceId: row.surfaceId,
      interfaceId: row.interfaceId,
      canonicalSchema: row.canonicalSchema,
    })
    return /yahoo|yfinance/i.test(text)
  })

  const rows = []
  for (const item of providerMatrix.rows ?? []) {
    const yahoo = item.providers?.yahoo
    if (!yahoo || (!yahoo.capabilityId && yahoo.status === 'not-supported')) continue
    const live = yahoo.probeId ? liveByProbe.get(yahoo.probeId) : null
    const unified = yahoo.capabilityId ? unifiedByCapability.get(yahoo.capabilityId) : null
    const canonicalReady = Boolean(yahoo.normalizer && yahoo.canonicalTable)
    const marketScope = yahoo.marketScope ?? []
    const queryActions = item.queryActions ?? []
    const decision = yahooDecision({ yahoo, live, unified, canonicalReady, marketScope, queryActions, item })
    rows.push({
      interfaceId: item.interfaceId,
      category: item.category,
      chinesePurpose: item.chinesePurpose,
      canonicalSchema: item.canonicalSchema,
      dataStoreTables: item.dataStoreTables ?? [],
      queryActions,
      status: yahoo.status,
      capabilityId: yahoo.capabilityId ?? null,
      adapter: yahoo.adapter ?? null,
      normalizer: yahoo.normalizer ?? null,
      canonicalTable: yahoo.canonicalTable ?? null,
      probeId: yahoo.probeId ?? null,
      liveStatus: live?.status ?? null,
      liveValidationState: live?.validationState ?? null,
      liveParsedCount: live?.parsedCount ?? null,
      liveDurationMs: live?.durationMs ?? null,
      unified: unified?.unified ?? false,
      unificationProblems: unified?.problems ?? [],
      marketScope,
      canonicalReady,
      decision,
      nextAction: yahooNextAction({ decision, yahoo, item, live, unified, canonicalReady }),
      reason: yahoo.reason ?? null,
    })
  }

  rows.sort((a, b) => {
    const priority = {
      'implementation-gap': 0,
      'global-capability-governed': 1,
      'explicit-broad-feed-exemption': 2,
      'explicit-not-supported': 3,
      'informational': 4,
    }
    const left = priority[a.decision] ?? 9
    const right = priority[b.decision] ?? 9
    if (left !== right) return left - right
    return a.interfaceId.localeCompare(b.interfaceId)
  })

  const sourceEvidence = sourceEvidenceChecks()
  const problems = validateRows(rows, detailedYahooRows, sourceEvidence)

  return {
    generatedAt: new Date().toISOString(),
    objective: 'Yahoo/yfinance capability audit joining Data API provider contracts, live evidence, cross-runtime unification, detailed API/action surfaces, and A-share routing guards.',
    source: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, resolve(repoRoot, value)])),
    summary: {
      yahooCapabilities: rows.length,
      detailedYahooRows: detailedYahooRows.length,
      statusCounts: countBy(rows.map((row) => row.status)),
      decisionCounts: countBy(rows.map((row) => row.decision)),
      livePassed: rows.filter((row) => row.liveStatus === 'passed').length,
      canonicalReady: rows.filter((row) => row.canonicalReady).length,
      unified: rows.filter((row) => row.unified).length,
      globalOnly: rows.filter((row) => row.status === 'global-only').length,
      explicitNotSupported: rows.filter((row) => row.status === 'not-supported').length,
      problems: problems.length,
    },
    sourceEvidence,
    rows,
    detailedYahooRows: detailedYahooRows.map((row) => ({
      rowId: row.rowId,
      runtime: row.runtime,
      family: row.family,
      action: row.action,
      endpoint: row.endpoint,
      provider: row.provider,
      interfaceId: row.interfaceId,
      surfaceId: row.surfaceId,
      governanceAction: row.governanceAction,
      canonicalSchema: row.canonicalSchema,
      liveProbeRequirement: row.liveProbeRequirement,
      durableLiveEvidence: row.durableLiveEvidence,
    })),
    problems,
  }
}

function yahooDecision({ yahoo, live, unified, canonicalReady, marketScope, queryActions, item }) {
  if (yahoo.status === 'global-only') {
    const scopeOk = ['US', 'HK', 'global'].every((scope) => marketScope.includes(scope))
    const readbackOk = queryActions.includes('query_yfinance') || queryActions.includes('query_quote') || queryActions.includes('query_kline')
    if (canonicalReady && unified?.unified && live?.status === 'passed' && scopeOk && readbackOk) return 'global-capability-governed'
    return 'implementation-gap'
  }
  if (yahoo.status === 'not-supported' && yahoo.capabilityId === 'yahoo.news.finance_feed') {
    return String(yahoo.reason ?? '').includes('global.finance_news') ? 'explicit-broad-feed-exemption' : 'implementation-gap'
  }
  if (yahoo.status === 'not-supported') return yahoo.capabilityId ? 'explicit-not-supported' : 'informational'
  if (item.interfaceId?.startsWith('global.') || item.interfaceId?.startsWith('option.')) return 'implementation-gap'
  return 'informational'
}

function yahooNextAction({ decision, yahoo, item, live, unified, canonicalReady }) {
  if (decision === 'global-capability-governed') {
    return 'Use cache/readback first for global workflows; keep Yahoo global-only and keep live probe evidence fresh.'
  }
  if (decision === 'explicit-broad-feed-exemption') {
    return 'Keep broad finance feed unsupported for Yahoo; use global.finance_news for symbol-scoped Yahoo news.'
  }
  if (decision === 'implementation-gap') {
    return `Repair Yahoo governance for ${yahoo.capabilityId ?? item.interfaceId}; canonicalReady=${canonicalReady}, live=${live?.status ?? 'missing'}, unified=${Boolean(unified?.unified)}.`
  }
  if (decision === 'explicit-not-supported') {
    return 'Keep not-supported unless Yahoo exposes a semantically equivalent reusable dataset.'
  }
  return 'No action required for this audit row.'
}

function sourceEvidenceChecks() {
  const electronYahooService = readText(paths.electronYahooService)
  const electronQuoteFetcher = readText(paths.electronQuoteFetcher)
  const electronKlineFetcher = readText(paths.electronKlineFetcher)
  const mobileYahooService = readText(paths.mobileYahooService)
  const mobileYahooSupport = readText(paths.mobileYahooSupport)
  const electronDataSourceSkill = readText(paths.electronDataSourceSkill)
  const mobileMarketDataToolSchema = readText(paths.mobileMarketDataToolSchema)
  return {
    electronYahooServiceRejectsAShare: /assertYahooGlobalSymbol\(code\)/.test(electronYahooService) && /A-share 6-digit symbol/.test(electronYahooService),
    mobileYahooServiceRejectsAShare: /assertGlobalSymbol\(symbol\)/.test(mobileYahooService) && /assertGlobalSymbols\(symbols\)/.test(mobileYahooService) && /A-share 6-digit symbol/.test(mobileYahooSupport),
    quoteFetcherAutoRoutesGlobalOnly: /isGlobalSymbol\(code\)/.test(electronQuoteFetcher) && /provider: 'yahoo'/.test(electronQuoteFetcher) && electronQuoteFetcher.includes('!/^\\d{6}$/.test(value)'),
    klineFetcherAutoRoutesGlobalOnly: /market === 'US' \|\| market === 'HK'/.test(electronKlineFetcher) && /provider: 'yahoo'/.test(electronKlineFetcher),
    electronSkillBlocksAShareYahoo: /Do not use Yahoo for China A-shares/.test(electronDataSourceSkill),
    mobileSkillDocumentsYahooGlobal: /Yahoo Finance typed datasets for non-A-share symbols/.test(mobileMarketDataToolSchema),
  }
}

function validateRows(rows, detailedYahooRows, sourceEvidence) {
  const problems = []
  const globalRows = rows.filter((row) => row.status === 'global-only')
  const broadFeed = rows.find((row) => row.capabilityId === 'yahoo.news.finance_feed')
  const governed = rows.filter((row) => row.decision === 'global-capability-governed')
  if (globalRows.length < 13) problems.push(`expected at least 13 Yahoo global-only rows, got ${globalRows.length}`)
  if (governed.length !== globalRows.length) problems.push(`every Yahoo global-only row must be governed: ${governed.length}/${globalRows.length}`)
  if (!broadFeed || broadFeed.decision !== 'explicit-broad-feed-exemption') problems.push('Yahoo broad news.finance_feed exemption is missing or ambiguous')
  for (const row of globalRows) {
    if (!row.capabilityId || !row.normalizer || !row.canonicalTable || !row.probeId) problems.push(`Yahoo global-only row lacks proof fields: ${row.interfaceId}`)
    if (row.liveStatus !== 'passed') problems.push(`Yahoo global-only row probe is not live-passed: ${row.interfaceId}/${row.probeId}`)
    if (!row.unified) problems.push(`Yahoo global-only row is not unified cross-runtime: ${row.interfaceId}/${row.capabilityId}`)
    for (const scope of ['US', 'HK', 'global']) {
      if (!row.marketScope.includes(scope)) problems.push(`Yahoo global-only row missing market scope ${scope}: ${row.interfaceId}`)
    }
    if (!row.queryActions.includes('query_yfinance') && !row.queryActions.includes('query_quote') && !row.queryActions.includes('query_kline')) {
      problems.push(`Yahoo global-only row lacks reusable readback query action: ${row.interfaceId}`)
    }
  }
  const requiredActions = ['query_yfinance', 'yfinance', 'yfinance_search', 'yahoo_earnings', 'yahoo_news', 'yahoo_options', 'yahoo_actions']
  for (const action of requiredActions) {
    if (!detailedYahooRows.some((row) => row.action === action || row.endpoint === action)) problems.push(`detailed matrix lacks Yahoo action row for ${action}`)
  }
  for (const [key, value] of Object.entries(sourceEvidence)) {
    if (!value) problems.push(`source evidence failed: ${key}`)
  }
  return problems
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Yahoo Capability Audit')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Objective')
  lines.push('')
  lines.push(report.objective)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Yahoo capability rows: ${report.summary.yahooCapabilities}`)
  lines.push(`- detailed Yahoo rows: ${report.summary.detailedYahooRows}`)
  lines.push(`- global-only rows: ${report.summary.globalOnly}`)
  lines.push(`- live passed rows: ${report.summary.livePassed}`)
  lines.push(`- canonical-ready rows: ${report.summary.canonicalReady}`)
  lines.push(`- unified rows: ${report.summary.unified}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push('')
  lines.push('Decision counts:')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.decisionCounts).sort()) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('Source evidence:')
  lines.push('')
  for (const [key, value] of Object.entries(report.sourceEvidence)) {
    lines.push(`- ${key}: ${value ? 'pass' : 'fail'}`)
  }
  lines.push('')
  lines.push('## Capability Rows')
  lines.push('')
  lines.push('| Interface | Status | Capability | Probe | Live | Unified | Readback | Decision | Next Action |')
  lines.push('|---|---|---|---|---|---:|---|---|---|')
  for (const row of report.rows) {
    lines.push([
      row.interfaceId,
      row.status,
      row.capabilityId ?? '-',
      row.probeId ?? '-',
      row.liveStatus ?? '-',
      row.unified ? 'yes' : 'no',
      row.queryActions.join('<br>') || '-',
      row.decision,
      row.nextAction,
    ].map(cell).join('|').replace(/^/, '|').concat('|'))
  }
  if (report.problems.length > 0) {
    lines.push('')
    lines.push('## Problems')
    lines.push('')
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function cell(value) {
  return ` ${String(value ?? '').replace(/\|/g, '\\|')} `
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function readText(path) {
  const fullPath = resolve(repoRoot, path)
  if (!existsSync(fullPath)) throw new Error(`missing required file: ${path}`)
  return readFileSync(fullPath, 'utf-8')
}

function countBy(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
    } else {
      parsed[key] = next
      i += 1
    }
  }
  return parsed
}
