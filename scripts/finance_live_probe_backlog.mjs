#!/usr/bin/env node
// Build a serial live-probe backlog from the detailed API-call matrix.
// This script does not call providers. It turns matrix gaps into an execution
// plan that can be run by finance_live_probe_matrix.mjs in bounded batches.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))
const matrixPath = resolve(appRoot, args.matrix ?? 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json')
const liveStatusPath = resolve(appRoot, args['live-status'] ?? 'reports/integrations/finance_live_status_report_2026_06_18.json')
const probeScriptPath = resolve(appRoot, 'scripts/finance_live_probe_matrix.mjs')
const jsonOut = resolve(appRoot, args.json ?? 'reports/integrations/finance_live_probe_backlog_2026_06_18.json')
const mdOut = resolve(appRoot, args.md ?? 'reports/integrations/finance_live_probe_backlog_2026_06_18.md')

const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8'))
const liveStatus = readOptionalJson(liveStatusPath)
const probeSpecs = parseProbeSpecs(readFileSync(probeScriptPath, 'utf-8'))
const report = buildBacklog(matrix, probeSpecs, liveStatus)

if (args['no-write'] !== 'true') {
  mkdirSync(dirname(jsonOut), { recursive: true })
  mkdirSync(dirname(mdOut), { recursive: true })
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance live probe backlog: ${report.summary.totalBacklog} rows, ${report.summary.withProbeSpec} with probe specs, ${report.summary.missingProbeDefinition} missing probe definitions`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (report.problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildBacklog(detailedMatrix, specs, liveStatusReport) {
  const liveStatusById = liveStatusIndex(liveStatusReport)
  const candidateRows = (detailedMatrix.rows ?? [])
    .filter((row) => row.liveProbeRequirement === 'needs-live-probe' || row.liveProbeRequirement === 'needs-live-status-evidence')
    .map((row) => backlogRow(row, specs, liveStatusById))
  const observedRows = candidateRows.filter((row) => row.liveStatusEvidence.length > 0)
  const rows = candidateRows.filter((row) => row.liveStatusEvidence.length === 0)

  const summary = {
    generatedAt: new Date().toISOString(),
    detailedMatrixRows: detailedMatrix.summary?.totalRows ?? 0,
    liveTested: detailedMatrix.summary?.rowsByLiveProbeRequirement?.['live-tested'] ?? 0,
    needsLiveStatusEvidence: detailedMatrix.summary?.rowsByLiveProbeRequirement?.['needs-live-status-evidence'] ?? 0,
    needsLiveProbe: detailedMatrix.summary?.rowsByLiveProbeRequirement?.['needs-live-probe'] ?? 0,
    notRequiredLocalOrControl: detailedMatrix.summary?.rowsByLiveProbeRequirement?.['not-required-local-or-control'] ?? 0,
    matrixRowsNeedingLiveProbe: candidateRows.length,
    alreadyCoveredByLiveStatus: observedRows.length,
    alreadyCoveredByLiveStatusByState: countBy(observedRows, (row) => row.liveStatusEvidence[0]?.validationState || row.liveStatusEvidence[0]?.status),
    totalBacklog: rows.length,
    withProbeSpec: rows.filter((row) => row.probeStatus === 'has-probe-spec').length,
    missingProbeDefinition: rows.filter((row) => row.probeStatus === 'missing-probe-definition').length,
    byProvider: countBy(rows, (row) => row.provider),
    byGovernanceAction: countBy(rows, (row) => row.governanceAction),
    byProbeStatus: countBy(rows, (row) => row.probeStatus),
    bySuggestedStage: countBy(rows, (row) => row.suggestedStage),
  }

  return {
    generatedAt: summary.generatedAt,
    source: {
      detailedMatrix: matrixPath,
      liveStatus: liveStatusReport ? liveStatusPath : null,
      probeScript: probeScriptPath,
    },
    policy: {
      defaultConcurrency: 1,
      defaultWaitMs: 1500,
      defaultEastmoneyTimeoutMs: 120000,
      concurrencyRule: 'Run serial by default. Live probe runner requires --concurrency 1; do not use broad concurrent sweeps for provider/schema validation.',
      timeoutRule: 'Use --eastmoney-timeout-ms 120000 for EastMoney-backed direct/sidecar probes; some valid EastMoney endpoints are slow enough that the generic timeout can misclassify them.',
      rawResultLocation: '~/.finagent-workstation/manual-tests/finance-live-matrix by default; use --output to choose a durable artifact path.',
      resumeRule: 'Use --checkpoint <path> --resume true for long batches.',
    },
    summary,
    commandTemplates: commandTemplates(rows),
    rows,
    warnings: warnings(rows),
    problems: validate(rows),
  }
}

function backlogRow(row, specs, liveStatusById = new Map()) {
  const provider = normalizedProvider(row)
  const action = String(row.action ?? row.endpoint ?? '')
  const candidates = matchingSpecs({ provider, action, row }, specs)
  const suggestedStage = suggestedStageFor({ provider, candidates })
  const matchedProbeIds = candidates.map((spec) => spec.id)
  const liveStatusEvidence = matchedProbeIds
    .map((id) => liveStatusById.get(id))
    .filter(Boolean)
    .map((status) => ({
      id: status.id,
      status: status.status,
      validationState: status.validationState,
      failureClass: status.failureClass ?? '',
    }))
  return {
    rowId: row.rowId,
    runtime: row.runtime,
    family: row.family,
    provider,
    action,
    surfaceId: row.surfaceId,
    interfaceId: row.interfaceId,
    interfaceGovernance: row.interfaceGovernance,
    persistenceStatus: row.persistenceStatus,
    readbackStatus: row.readbackStatus,
    canonicalSchema: row.canonicalSchema,
    governanceAction: row.governanceAction,
    runtimeStatus: row.runtimeStatus,
    probeStatus: candidates.length > 0 ? 'has-probe-spec' : 'missing-probe-definition',
    matchedProbeIds,
    liveStatusEvidence,
    suggestedStage,
    suggestedOnly: candidates[0]?.id ?? suggestedOnlyFor({ provider, action, row }),
    recommendedCommand: recommendedCommand({ provider, suggestedStage, only: candidates[0]?.id ?? suggestedOnlyFor({ provider, action, row }) }),
  }
}

function parseProbeSpecs(text) {
  const specs = []
  const regex = /spec\(\s*'([^']+)'\s*,\s*[^,]+,\s*'([^']+)'\s*,\s*'([^']+)'([\s\S]*?)\)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const source = match[0]
    specs.push({
      id: match[1],
      provider: normalizeProviderName(match[2]),
      family: normalizeAction(match[3]),
      stages: parseStages(source),
      active: activeSpec(match[1]),
    })
  }
  return specs
}

function activeSpec(id) {
  if (id === 'electron_tdx_mac_board_members' || id === 'electron_tdx_mac_board_members_quotes') {
    return Boolean(process.env.FIN_API_TEST_TDX_BOARD)
  }
  return true
}

function parseStages(source) {
  const stageMatch = source.match(/\[([^\]]+)\]/)
  if (!stageMatch) return []
  return stageMatch[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function matchingSpecs({ provider, action, row }, specs) {
  const explicitProbeIds = probeIdsFromRow(row, provider)
  const explicitMatches = specs.filter((spec) => spec.active && explicitProbeIds.includes(spec.id))
  if (explicitMatches.length > 0) return explicitMatches

  const providerAliases = providerProbeAliases(provider)
  const actionAliases = actionProbeAliases(action, row)
  return specs.filter((spec) => spec.active && (
    providerAliases.includes(spec.provider) &&
    actionAliases.includes(spec.family)
  ))
}

function probeIdsFromRow(row, provider) {
  const ids = new Set()
  for (const id of row.liveProbeIds ?? []) {
    if (id) ids.add(String(id))
  }
  const includeAllSupportedProviders = row.kind === 'query-or-local' || row.runtimeStatus === 'local-readback'
  const eligibleProviders = new Set(providerProbeAliases(provider))
  for (const [supportKey, support] of Object.entries(row.providerSupport ?? {})) {
    if (!support || typeof support !== 'object') continue
    const supportProvider = normalizeProviderName(support.provider ?? supportKey)
    if (!includeAllSupportedProviders && !eligibleProviders.has(supportProvider)) continue
    if (!['supported', 'global-only', 'credential-gated'].includes(String(support.status))) continue
    if (support.probeId) ids.add(String(support.probeId))
  }
  return [...ids]
}

function providerProbeAliases(provider) {
  if (provider === 'yahoo') return ['yfinance', 'yahoo']
  if (provider === 'akshare') return ['akshare', 'sidecar', 'ta']
  if (provider === 'tushare') return ['tushare', 'sidecar']
  if (provider === 'local') return ['tdx', 'eastmoney', 'akshare', 'yfinance', 'tushare', 'wind']
  return [provider]
}

function actionProbeAliases(action, row) {
  const interfaceId = String(row.interfaceId ?? '')
  const values = new Set([normalizeAction(action)])
  const actionKey = normalizeAction(action)
  for (const prefix of ['query_', 'tdx_', 'yahoo_', 'api_', 'provider_', 'diagnostic_']) {
    if (actionKey.startsWith(prefix)) values.add(actionKey.slice(prefix.length))
  }
  if (actionKey.startsWith('api_ex_')) values.add(actionKey.replace(/^api_/, ''))
  const aliases = {
    query_quote: ['quote', 'stock_list', 'price'],
    query_kline: ['kline_daily', 'history', 'stock_kline'],
    query_fundamental: ['daily_basic', 'earnings', 'fundamentals', 'finance', 'stock_basicinfo'],
    query_money_flow: ['money_flow', 'stock_individual_fund_flow'],
    query_sector: ['sector_rank'],
    query_industry_map: ['sector_cons', 'sector_rank'],
    query_northbound: ['northbound'],
    query_limit_pool: ['limit_pool', 'continuous_limit', 'failed_limit'],
    query_unusual: ['unusual'],
    query_flow_rank: ['money_flow', 'stock_individual_fund_flow_rank'],
    query_chip: ['chip'],
    query_fund_nav: ['fund_nav'],
    query_fund_list: ['fund_list'],
    query_index_constituents: ['index_components', 'index_stock_cons'],
    query_trade_calendar: ['trade_calendar'],
    query_fund_holding: ['fund_holding'],
    query_fund_manager: ['fund_manager'],
    query_tick_chart: ['tick_chart', 'history_tick_chart'],
    query_transactions: ['transactions', 'history_transactions'],
    query_volume_profile: ['volume_profile'],
    query_xdxr: ['xdxr'],
    query_auction: ['auction'],
    query_momentum: ['momentum', 'index_momentum'],
    query_top_board: ['top_board'],
    query_tdx_block_member: ['block'],
    query_tdx_count: ['count'],
    query_tdx_sampling: ['chart_sampling'],
    query_company_info: ['finance', 'company_categories', 'company_content', 'stock_basicinfo'],
    query_wind_document: ['financial_docs_news', 'company_announcements'],
    query_wind_economic: ['economic_data'],
    query_wind_analytics: ['analytics_data'],
    query_yfinance: ['info', 'financials', 'recommendations', 'news', 'options', 'corporate_actions', 'actions'],
    global_fundamental_output: ['cash_flow', 'quarterly_cash_flow', 'eps_revisions', 'eps_trend', 'capital_gains'],
    sector: ['sector_rank'],
    flow_rank: ['money_flow', 'stock_individual_fund_flow_rank'],
    tdx_block: ['block'],
    tdx_count: ['count'],
    tdx_sampling: ['chart_sampling'],
    ex_sampling: ['ex/chart_sampling'],
    tdx_finance: ['finance'],
    tdx_index_bars: ['index_kline'],
    tdx_index_info: ['index_info'],
    tdx_momentum: ['index_momentum'],
    tdx_quotes_list: ['quotes_list'],
    tdx_stock_list: ['stock_list'],
    tdx_tick_chart: ['tick_chart'],
    tdx_history_tick: ['history_tick_chart'],
    tdx_unusual: ['unusual'],
    tdx_xdxr: ['xdxr'],
    yahoo_history: ['history'],
    yahoo_earnings: ['earnings', 'info'],
    yahoo_news: ['news'],
    yahoo_options: ['options', 'option_chain'],
    yfinance: ['yfinance_search'],
    yahoo: ['price', 'info', 'yfinance_search'],
    yahoo_action: ['yfinance_search'],
    yfinance_action: ['yfinance_search'],
    ta: ['ta/rsi'],
    ta_indicator: ['ta/rsi'],
    akshare: ['akshare_search'],
    akshare_func_name: ['akshare_search'],
    sidecar_status: ['local_cache/status'],
    scan: ['scan'],
    tdx: ['quote', 'count'],
    tushare: ['stock_basic', 'daily', 'trade_calendar'],
    screen_fund: ['fund_screener'],
  }
  for (const alias of aliases[actionKey] ?? []) values.add(normalizeAction(alias))
  if (interfaceId.startsWith('global.')) values.add(interfaceId.replace(/^global\./, ''))
  if (interfaceId.startsWith('stock.')) values.add(interfaceId.replace(/^stock\./, ''))
  if (interfaceId.startsWith('market.')) values.add(interfaceId.replace(/^market\./, ''))
  if (interfaceId.startsWith('fund.')) values.add(interfaceId.replace(/^fund\./, 'fund_'))
  return [...values]
}

function suggestedStageFor({ provider, candidates }) {
  if (provider === 'wind' || provider === 'tushare') return 'quota'
  if (candidates.some((spec) => spec.stages.includes('standard'))) return 'standard'
  if (candidates.some((spec) => spec.stages.includes('exhaustive'))) return 'exhaustive'
  return 'all'
}

function suggestedOnlyFor({ provider, action, row }) {
  const base = [provider, action || row.interfaceId || row.surfaceId]
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_:-]+/g, '_')
  return base || row.rowId
}

function recommendedCommand({ provider, suggestedStage, only }) {
  const quota = provider === 'wind' || provider === 'tushare' ? ' --include-quota true' : ''
  return `node scripts/finance_live_probe_matrix.mjs --stage ${suggestedStage}${quota} --concurrency 1 --wait-ms 1500 --eastmoney-timeout-ms 120000 --checkpoint ~/.finagent-workstation/manual-tests/finance-live-matrix/checkpoint.json --resume true --only ${only}`
}

function commandTemplates(rows) {
  const providers = [...new Set(rows.map((row) => row.provider))].sort()
  return providers.map((provider) => {
    const providerRows = rows.filter((row) => row.provider === provider)
    const suggestedStage = providerStageFor(providerRows)
    return {
      provider,
      backlogRows: providerRows.length,
      rowsWithProbeSpec: providerRows.filter((row) => row.probeStatus === 'has-probe-spec').length,
      rowsMissingProbeDefinition: providerRows.filter((row) => row.probeStatus === 'missing-probe-definition').length,
      command: recommendedCommand({
        provider,
        suggestedStage,
        only: providerProbeOnly(provider),
      }),
    }
  })
}

function providerStageFor(rows) {
  const stages = new Set(rows.map((row) => row.suggestedStage))
  if (stages.has('quota')) return 'quota'
  if (stages.has('all')) return 'all'
  if (stages.has('exhaustive')) return 'exhaustive'
  return 'standard'
}

function providerProbeOnly(provider) {
  if (provider === 'yahoo') return 'yahoo'
  if (provider === 'local') return 'tdx'
  return provider
}

function validate(rows) {
  const problems = []
  for (const row of rows) {
    if (!row.rowId) problems.push(`backlog row for ${row.provider}/${row.action} is missing rowId`)
    if (!row.provider || row.provider === 'unknown') problems.push(`${row.rowId} has unknown provider`)
    if (!row.recommendedCommand.includes('--concurrency 1')) problems.push(`${row.rowId} recommended command is missing concurrency limit`)
    if (!row.recommendedCommand.includes('--wait-ms 1500')) problems.push(`${row.rowId} recommended command is missing wait limit`)
    if (!row.recommendedCommand.includes('--eastmoney-timeout-ms 120000')) problems.push(`${row.rowId} recommended command is missing EastMoney timeout budget`)
    if (!row.recommendedCommand.includes('--checkpoint ')) problems.push(`${row.rowId} recommended command is missing checkpoint`)
    if (!row.recommendedCommand.includes('--resume true')) problems.push(`${row.rowId} recommended command is missing resume flag`)
  }
  return problems
}

function warnings(rows) {
  const warnings = []
  const missing = rows.filter((row) => row.probeStatus === 'missing-probe-definition')
  if (missing.length > 0) {
    warnings.push(`${missing.length} live-probe backlog rows do not have a matching finance_live_probe_matrix.mjs spec`)
  }
  return warnings
}

function normalizedProvider(row) {
  return normalizeProviderName(row.normalizedProvider ?? row.provider)
}

function normalizeProviderName(value) {
  const key = String(value ?? '').toLowerCase()
  if (key === 'yfinance') return 'yahoo'
  if (key === 'eastmoneydirect') return 'eastmoney'
  return key || 'unknown'
}

function normalizeAction(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function countBy(rows, selector) {
  const counts = {}
  for (const row of rows) {
    const key = selector(row) ?? 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort())
}

function readOptionalJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function liveStatusIndex(report) {
  const byId = new Map()
  if (!report) return byId
  const rows = [
    ...(report.passedApis ?? []),
    ...(report.failures ?? []),
    ...(report.unsupportedApis ?? []),
    ...(report.credentialOrQuotaGatedApis ?? []),
    ...(report.transportUnstableApis ?? []),
    ...(report.runtimeBlockedApis ?? []),
  ]
  for (const row of rows) {
    if (row?.id) byId.set(row.id, row)
  }
  return byId
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Live Probe Backlog')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Detailed matrix: \`${report.source.detailedMatrix}\``)
  lines.push(`Probe script: \`${report.source.probeScript}\``)
  lines.push('')
  lines.push('## Policy')
  lines.push('')
  lines.push(`- default concurrency: ${report.policy.defaultConcurrency}`)
  lines.push(`- default wait ms: ${report.policy.defaultWaitMs}`)
  lines.push(`- default EastMoney timeout ms: ${report.policy.defaultEastmoneyTimeoutMs}`)
  lines.push(`- concurrency rule: ${report.policy.concurrencyRule}`)
  lines.push(`- timeout rule: ${report.policy.timeoutRule}`)
  lines.push(`- raw results: ${report.policy.rawResultLocation}`)
  lines.push(`- resume: ${report.policy.resumeRule}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- detailed matrix rows: ${report.summary.detailedMatrixRows}`)
  lines.push(`- live tested: ${report.summary.liveTested}`)
  lines.push(`- needs live-status evidence: ${report.summary.needsLiveStatusEvidence}`)
  lines.push(`- needs live probe: ${report.summary.needsLiveProbe}`)
  lines.push(`- not required local/control: ${report.summary.notRequiredLocalOrControl}`)
  lines.push(`- live-probe backlog: ${report.summary.totalBacklog}`)
  lines.push(`- backlog with probe spec: ${report.summary.withProbeSpec}`)
  lines.push(`- backlog missing probe definition: ${report.summary.missingProbeDefinition}`)
  lines.push('')
  lines.push('Provider backlog:')
  lines.push('')
  for (const [provider, count] of Object.entries(report.summary.byProvider)) lines.push(`- ${provider}: ${count}`)
  lines.push('')
  lines.push('## Provider Commands')
  lines.push('')
  lines.push('| Provider | Rows | With Spec | Missing Spec | Serial Command |')
  lines.push('| --- | ---: | ---: | ---: | --- |')
  for (const item of report.commandTemplates) {
    lines.push(`| ${item.provider} | ${item.backlogRows} | ${item.rowsWithProbeSpec} | ${item.rowsMissingProbeDefinition} | \`${item.command}\` |`)
  }
  lines.push('')
  lines.push('## Backlog Rows')
  lines.push('')
  lines.push('| Row | Runtime | Provider | Action | Interface | Schema | Probe Status | Matched Probe IDs | Suggested Stage | Governance Action |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of report.rows) {
    lines.push(`| ${row.rowId} | ${row.runtime} | ${row.provider} | ${row.action} | ${row.interfaceId ? `\`${row.interfaceId}\`` : '-'} | ${row.canonicalSchema ? `\`${row.canonicalSchema}\`` : '-'} | ${row.probeStatus} | ${row.matchedProbeIds.join('<br>') || '-'} | ${row.suggestedStage} | ${row.governanceAction} |`)
  }
  lines.push('')
  lines.push('## Problems')
  lines.push('')
  if (report.problems.length === 0) lines.push('- none')
  else for (const problem of report.problems) lines.push(`- ${problem}`)
  lines.push('')
  lines.push('## Warnings')
  lines.push('')
  if (report.warnings.length === 0) lines.push('- none')
  else for (const warning of report.warnings) lines.push(`- ${warning}`)
  lines.push('')
  return `${lines.join('\n')}`
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const item = values[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) parsed[key] = 'true'
    else {
      parsed[key] = next
      i += 1
    }
  }
  return parsed
}
