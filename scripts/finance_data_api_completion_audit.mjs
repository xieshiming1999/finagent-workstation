#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const parentRoot = resolve(repoRoot, '..')
const args = parseArgs(process.argv.slice(2))
const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_data_api_completion_audit_2026_06_18.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_data_api_completion_audit_2026_06_18.md')

const paths = {
  progress: 'docs/design/integrations/finance_api_continuous_improvement_progress_2026_06_17.md',
  providerMatrix: 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json',
  detailedMatrix: 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json',
  liveProbeBacklog: 'reports/integrations/finance_live_probe_backlog_2026_06_18.json',
  liveStatusReport: 'reports/integrations/finance_live_status_report_2026_06_18.json',
  mobileStatus: 'reports/integrations/finance_mobile_api_status_2026_06_17.json',
  dataHealthReport: 'reports/integrations/finance_data_health_report_2026_06_18.json',
  windCapabilityAudit: 'reports/integrations/finance_wind_capability_audit_2026_06_19.json',
  yahooCapabilityAudit: 'reports/integrations/finance_yahoo_capability_audit_2026_06_19.json',
  eastmoneyAkshareSeparationAudit: 'reports/integrations/finance_eastmoney_akshare_separation_audit_2026_06_19.json',
  datastoreMatrix: 'reports/integrations/finance_api_datastore_matrix_2026_06_18.json',
  schemaGovernanceAudit: 'reports/integrations/finance_schema_governance_audit_2026_06_17.json',
  unificationAudit: 'reports/integrations/finance_data_unification_audit_2026_06_17.json',
  outputOnlyProbe: 'reports/integrations/finance_output_only_api_contract_probe_2026_06_18.json',
  electronContract: 'src/agent/data/data-api-interfaces.json',
  electronCacheCoverage: 'src/agent/data/data-api-cache-coverage.json',
  electronRouter: 'src/agent/data/data-api-interface-router.ts',
  electronCachePolicy: 'src/agent/data/data-api-cache-policy.ts',
  electronProviderPolicy: 'src/agent/data/provider-policy.ts',
  electronBaseFetcher: 'src/agent/data/fetchers/base-fetcher.ts',
  electronFetchOptions: 'src/agent/data/fetchers/fetcher-interface-utils.ts',
  electronOutputOnlyContract: 'src/agent/data/output-only-interfaces.ts',
  electronDataStoreQueries: 'src/agent/tools/data-store-tool-query-catalog-coverage.ts',
  electronDataApiSkillReferenceScript: 'scripts/finance_data_api_skill_reference.mjs',
  electronOutputOnlySkillReferenceScript: 'scripts/finance_output_only_api_skill_reference.mjs',
  electronProviderMatrixScript: 'scripts/finance_data_api_provider_matrix.mjs',
  electronDetailedMatrixScript: 'scripts/finance_detailed_api_call_provider_matrix.mjs',
  electronLiveProbeBacklogScript: 'scripts/finance_live_probe_backlog.mjs',
  electronDataHealthReportScript: 'scripts/finance_data_health_report.mjs',
  electronWindCapabilityAuditScript: 'scripts/finance_wind_capability_audit.mjs',
  electronYahooCapabilityAuditScript: 'scripts/finance_yahoo_capability_audit.mjs',
  electronEastmoneyAkshareSeparationAuditScript: 'scripts/finance_eastmoney_akshare_separation_audit.mjs',
  electronDatastoreMatrixScript: 'scripts/finance_api_datastore_matrix.mjs',
  electronSchemaGovernanceAuditScript: 'scripts/finance_schema_governance_audit.mjs',
  electronUnificationAuditScript: 'scripts/finance_data_unification_audit.mjs',
  electronDataPanel: 'src/renderer/panels/DataPanel.tsx',
  electronDataWidget: 'src/renderer/components/DataWidget.tsx',
  mobileContract: '../app/lib/domain/market/providers/data_api_interface_contract.dart',
  mobileRouter: '../app/lib/domain/market/providers/data_api_interface_router.dart',
  mobileProviderPolicy: '../app/lib/agent/data_fetcher/provider_policy.dart',
  mobileDataHealthService: '../app/lib/domain/market/services/market_data_support_service.dart',
  mobileMarketDataToolSchema: '../app/lib/agent/tools/market_data_tool/market_data_tool_schema.dart',
  mobileDataHealthTest: '../app/test/domain/market/services/market_data_support_service_test.dart',
  mobileProviderBoundaryTest: '../app/test/domain/market/providers/data_api_interface_router_test.dart',
  mobileProviderPolicyTest: '../app/test/agent/data_fetcher/provider_policy_test.dart',
  finagentProviderPolicy: '../finagent/lib/agent/data_fetcher/provider_policy.dart',
}

const interfaceBackedFetchers = [
  { path: 'src/agent/data/fetchers/fetcher-money-flow.ts', interfaceId: 'stock.money_flow' },
  { path: 'src/agent/data/fetchers/fetcher-index-kline.ts', interfaceId: 'index.daily_kline' },
  { path: 'src/agent/data/fetchers/fetcher-sector.ts', interfaceId: 'market.sector_ranking' },
  { path: 'src/agent/data/fetchers/fetcher-limit-pool.ts', interfaceId: 'market.limit_pool' },
  { path: 'src/agent/data/fetchers/fetcher-northbound.ts', interfaceId: 'market.northbound_flow' },
  { path: 'src/agent/data/fetchers/fetcher-fund-holding.ts', interfaceId: 'fund.holding' },
  { path: 'src/agent/data/fetchers/fetcher-fund-manager.ts', interfaceId: 'fund.manager' },
  { path: 'src/agent/data/fetchers/fetcher-calendar.ts', interfaceId: 'calendar.trade_days' },
  { path: 'src/agent/data/fetchers/fetcher-fundamental.ts', interfaceId: 'stock.daily_valuation' },
  { path: 'src/agent/data/fetchers/fetcher-chip-distribution.ts', interfaceId: 'stock.chip_distribution' },
  { path: 'src/domain/market/providers/bridge-finance-provider.ts', interfaceId: 'index.quote' },
  { path: 'src/domain/market/services/finance-news-data-api-service.ts', interfaceId: 'news.finance_feed' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.company_profile' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.financial_statements' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.recommendations' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.holders' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.insider_transactions' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.finance_news' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'option.chain_snapshot' },
  { path: 'src/domain/market/services/yahoo-market-data-service.ts', interfaceId: 'global.corporate_actions' },
  { path: 'src/domain/market/services/wind-data-api-service.ts', interfaceId: 'wind.financial_document' },
  { path: 'src/domain/market/services/wind-data-api-service.ts', interfaceId: 'wind.economic_series' },
  { path: 'src/domain/market/services/wind-data-api-service.ts', interfaceId: 'wind.analytics_result' },
]

const financeSkillRoots = [
  'assets/skills',
  '../app/assets/finance/skills',
  '../finagent/assets/finance/skills',
]
const financeAgentInstructionFiles = [
  'assets/bundle/AGENTS.md',
  'assets/bundle/chat/AGENTS.md',
  '../finagent/assets/finance/AGENTS.md',
  '../finagent/assets/finance/chat/AGENTS.md',
]

const providerSpecificSkillPath = /\/(?:tushare|yfinance|wind-aifinmarket|tradingview)\//
const directProviderCallPattern = /(DataStore|MarketData)\(action:\s*["'](?:akshare|tdx|tushare|yfinance)["']/g
const explicitProviderContextPattern = /diagnostic|validation|explicit|specific provider|provider-constrained|Compatibility|debugging|provider validation|用户明确要求|显式|诊断|验证|provider-specific/i
const disabledTushareApis = [
  'fina_indicator',
  'income',
  'balancesheet',
  'cashflow',
  'moneyflow',
  'fund_basic',
  'fund_nav',
]
const disabledTushareBlockPattern = /do not call|do not use|disabled|blocked|cannot access|permission set|不要调用|不直接调用|禁用|已禁用|不可用|权限/i

const report = buildReport()

if (args['no-write'] !== 'true') {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance data API completion audit: ${report.summary.checksPassed}/${report.summary.checks} checks passed, ${report.summary.problems} problems`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (report.problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildReport() {
  const checks = []
  const problems = []
  const providerMatrix = readJson(paths.providerMatrix)
  const detailedMatrix = readJson(paths.detailedMatrix)
  const liveProbeBacklog = readJson(paths.liveProbeBacklog)
  const liveStatusReport = readJson(paths.liveStatusReport)
  const mobileStatus = readJson(paths.mobileStatus)
  const dataHealthReport = readJson(paths.dataHealthReport)
  const windCapabilityAudit = readJson(paths.windCapabilityAudit)
  const yahooCapabilityAudit = readJson(paths.yahooCapabilityAudit)
  const eastmoneyAkshareSeparationAudit = readJson(paths.eastmoneyAkshareSeparationAudit)
  const datastoreMatrix = readJson(paths.datastoreMatrix)
  const schemaGovernanceAudit = readJson(paths.schemaGovernanceAudit)
  const unificationAudit = readJson(paths.unificationAudit)
  const outputOnlyProbe = readJson(paths.outputOnlyProbe)
  const electronContract = readJson(paths.electronContract)
  const cacheCoverage = readJson(paths.electronCacheCoverage)

  addCheck(checks, problems, 'source-artifacts-exist', 'Plan source artifacts exist in the repository', requiredPathsExist(Object.values(paths)))

  addCheck(checks, problems, 'provider-matrix-shape', 'Interface/provider matrix is generated from the contract and has no validation problems', [
    providerMatrix.summary?.interfaces >= 26 ? null : `expected at least 26 desktop interfaces, got ${providerMatrix.summary?.interfaces}`,
    providerMatrix.summary?.providers >= 9 ? null : `expected at least 9 providers, got ${providerMatrix.summary?.providers}`,
    providerMatrix.summary?.capabilities >= 112 ? null : `expected at least 112 provider capabilities, got ${providerMatrix.summary?.capabilities}`,
    providerMatrix.summary?.problems === 0 ? null : `provider matrix reports ${providerMatrix.summary?.problems} problems`,
  ])

  addCheck(checks, problems, 'provider-matrix-generated-artifact-fresh', 'Provider matrix artifact is fresh against the code-owned interface contract', validateGeneratedJsonArtifact({
    script: paths.electronProviderMatrixScript,
    artifact: paths.providerMatrix,
    label: 'provider matrix',
  }))

  addCheck(checks, problems, 'provider-matrix-cache-coverage', 'Every desktop interface declares an implemented DataStore/cache lookup rule', [
    (providerMatrix.summary?.cacheStatusCounts?.implemented ?? 0) === providerMatrix.summary?.interfaces
      ? null
      : `provider matrix cache coverage is not fully implemented: ${JSON.stringify(providerMatrix.summary?.cacheStatusCounts ?? {})}`,
    Object.entries(cacheCoverage.interfaces ?? {})
      .filter(([, value]) => value?.status === 'not-implemented')
      .map(([interfaceId]) => `${interfaceId} cache coverage is not implemented`),
  ].flat())

  addCheck(checks, problems, 'provider-matrix-operational-reasons', 'Every explicit non-callable or gated provider capability explains the operational decision', validateOperationalReasons(providerMatrix))

  addCheck(checks, problems, 'detailed-matrix-coverage', 'Detailed API-call matrix classifies every inventoried API/action row', [
    detailedMatrix.summary?.totalRows === detailedMatrix.summary?.inventoryRows
      ? null
      : `detailed matrix row count mismatch: ${detailedMatrix.summary?.totalRows}/${detailedMatrix.summary?.inventoryRows}`,
    detailedMatrix.summary?.totalRows >= 412 ? null : `expected at least 412 detailed rows, got ${detailedMatrix.summary?.totalRows}`,
    detailedMatrix.summary?.unclassifiedRows === 0 ? null : `detailed matrix has ${detailedMatrix.summary?.unclassifiedRows} unclassified rows`,
    detailedMatrix.summary?.providerRowsWithoutSurface === 0 ? null : `detailed matrix has ${detailedMatrix.summary?.providerRowsWithoutSurface} provider rows without surface id`,
    detailedMatrix.summary?.problems === 0 ? null : `detailed matrix reports ${detailedMatrix.summary?.problems} problems`,
    (detailedMatrix.summary?.outputOnlyInterfaceRows ?? 0) >= 12
      ? null
      : `expected at least 12 normalized output-only interface rows, got ${detailedMatrix.summary?.outputOnlyInterfaceRows ?? 0}`,
    (detailedMatrix.rows ?? []).filter((row) => !row.surfaceId).slice(0, 20).map((row) => `row ${row.rowId} missing surfaceId`),
  ].flat())

  addCheck(checks, problems, 'tool-action-surface-boundary', 'Only help-style tool controls remain outside data, output-only, derived, or diagnostic governance', validateToolActionSurfaceBoundary(detailedMatrix))

  addCheck(checks, problems, 'live-status-traceability', 'Every recorded live-status row is referenced by detailed matrix inventory or provider capability evidence', [
    detailedMatrix.summary?.unreferencedLiveStatusRows === 0
      ? null
      : `detailed matrix has ${detailedMatrix.summary?.unreferencedLiveStatusRows} unreferenced live-status rows`,
    (detailedMatrix.summary?.rowsWithDurableLiveEvidence ?? 0) >= (detailedMatrix.summary?.durableLivePassedRows ?? 0)
      ? null
      : `durable live passed rows exceed durable live evidence rows: ${JSON.stringify(detailedMatrix.summary ?? {})}`,
  ])

  addCheck(checks, problems, 'schema-governance-table-matrix-coverage', 'Every registered reusable canonical table is represented in the datastore matrix manifest', [
    (schemaGovernanceAudit.summary?.reusableMatrixRows ?? 0) >= 25
      ? null
      : `expected at least 25 reusable datastore matrix rows, got ${schemaGovernanceAudit.summary?.reusableMatrixRows ?? 0}`,
    (schemaGovernanceAudit.gaps ?? [])
      .filter((gap) => gap.type === 'registered-table-not-in-matrix')
      .map((gap) => `registered table missing datastore matrix coverage: ${gap.table}`),
  ].flat())

  addCheck(checks, problems, 'datastore-matrix-no-broken-rows', 'Datastore concept matrix has no broken reusable evidence rows', [
    datastoreMatrix.summary?.rows >= 28 ? null : `expected at least 28 datastore matrix rows, got ${datastoreMatrix.summary?.rows ?? 0}`,
    datastoreMatrix.summary?.failed === 0 ? null : `datastore matrix reports ${datastoreMatrix.summary?.failed} failed rows`,
    (datastoreMatrix.summary?.byStatus?.proven ?? 0) >= 26
      ? null
      : `expected at least 26 proven datastore rows, got ${datastoreMatrix.summary?.byStatus?.proven ?? 0}`,
    (datastoreMatrix.summary?.byStatus?.['fetch-only'] ?? 0) >= 1
      ? null
      : `expected at least 1 intentional fetch-only datastore row, got ${datastoreMatrix.summary?.byStatus?.['fetch-only'] ?? 0}`,
    ...(datastoreMatrix.rows ?? [])
      .filter((row) => row.status === 'broken')
      .map((row) => `broken datastore row: ${row.id}`),
  ])

  addCheck(checks, problems, 'datastore-matrix-generated-artifact-fresh', 'Datastore matrix artifact is fresh against its code-owned manifest and structural checks', validateDatastoreMatrixGeneratedArtifact())

  addCheck(checks, problems, 'detailed-matrix-generated-artifact-fresh', 'Detailed API-call matrix artifact is fresh against inventory, contract, and live-status evidence', validateGeneratedJsonArtifact({
    script: paths.electronDetailedMatrixScript,
    artifact: paths.detailedMatrix,
    label: 'detailed API-call matrix',
  }))

  addCheck(checks, problems, 'no-ungoverned-provider-surfaces', 'Known provider/action surfaces are governed, output-only, diagnostic, local/readback, or explicit live-probe work', validateNoUngovernedProviderSurfaces(detailedMatrix))

  addCheck(checks, problems, 'output-only-interface-normalization', 'Useful non-persisted provider surfaces are normalized through output-only interfaces', validateOutputOnlyInterfaces(detailedMatrix))

  addCheck(checks, problems, 'local-surface-classification', 'Local readback, derived analysis, contract census, queue control, and tool-control surfaces carry explicit non-provider classification reasons', validateLocalSurfaceClassifications(detailedMatrix))

  addCheck(checks, problems, 'output-only-probe-evidence', 'Output-only interfaces have fixture-backed success/negative contract probe evidence', [
    outputOnlyProbe.summary?.cases >= 6 ? null : `expected at least 6 output-only probe cases, got ${outputOnlyProbe.summary?.cases}`,
    outputOnlyProbe.summary?.problems === 0 ? null : `output-only probe reports ${outputOnlyProbe.summary?.problems} problems`,
    outputOnlyProbe.summary?.passed === outputOnlyProbe.summary?.cases ? null : `output-only probe passed ${outputOnlyProbe.summary?.passed}/${outputOnlyProbe.summary?.cases}`,
    ...textContains(paths.electronOutputOnlyContract, [
      'lastProbeAt:',
      'finance_output_only_api_contract_probe',
      'sampleColumns: rowFields',
      'boundedRawPreviewPath:',
    ]),
  ])

  addCheck(checks, problems, 'live-probe-backlog-policy', 'Remaining live-probe backlog is explicit, serial by default, resumable, and tied to the detailed matrix', validateLiveProbeBacklog(detailedMatrix, liveProbeBacklog))

  addCheck(checks, problems, 'live-probe-backlog-generated-artifact-fresh', 'Live-probe backlog artifact is fresh against detailed matrix and live-status evidence', validateGeneratedJsonArtifact({
    script: paths.electronLiveProbeBacklogScript,
    artifact: paths.liveProbeBacklog,
    label: 'live-probe backlog',
  }))

  addCheck(checks, problems, 'recorded-live-probe-status', 'Recorded live probe outputs are summarized into durable provider/status evidence', validateLiveStatusReport(liveStatusReport))

  addCheck(checks, problems, 'unified-data-health-report', 'Unified data health report combines interface, provider, dataset, live status, backlog, and audit evidence', validateDataHealthReport(dataHealthReport, providerMatrix, detailedMatrix, liveProbeBacklog, liveStatusReport, mobileStatus))

  addCheck(checks, problems, 'unified-data-health-generated-artifact-fresh', 'Unified data-health artifact is fresh against provider matrix, detailed matrix, live status, and backlog evidence', validateGeneratedJsonArtifact({
    script: paths.electronDataHealthReportScript,
    artifact: paths.dataHealthReport,
    label: 'unified data-health report',
  }))

  addCheck(checks, problems, 'wind-capability-audit', 'Wind capability audit joins manifest, provider contract, live evidence, and unification status', validateWindCapabilityAudit(windCapabilityAudit, providerMatrix, liveStatusReport, unificationAudit))

  addCheck(checks, problems, 'wind-capability-audit-generated-artifact-fresh', 'Wind capability audit artifact is fresh against provider matrix, live status, unification evidence, and Wind reference manifest', validateGeneratedJsonArtifact({
    script: paths.electronWindCapabilityAuditScript,
    artifact: paths.windCapabilityAudit,
    label: 'Wind capability audit',
  }))

  addCheck(checks, problems, 'yahoo-capability-audit', 'Yahoo/yfinance capability audit joins provider contract, live evidence, unification status, detailed surfaces, and A-share routing guards', validateYahooCapabilityAudit(yahooCapabilityAudit, providerMatrix, liveStatusReport, unificationAudit))

  addCheck(checks, problems, 'yahoo-capability-audit-generated-artifact-fresh', 'Yahoo/yfinance capability audit artifact is fresh against provider matrix, live status, unification evidence, detailed matrix, and routing guard source', validateGeneratedJsonArtifact({
    script: paths.electronYahooCapabilityAuditScript,
    artifact: paths.yahooCapabilityAudit,
    label: 'Yahoo capability audit',
  }))

  addCheck(checks, problems, 'eastmoney-akshare-separation-audit', 'EastMoney direct providers, AkShare sidecar providers, and EastMoney-origin AkShare wrappers are separated in provenance', validateEastmoneyAkshareSeparationAudit(eastmoneyAkshareSeparationAudit, providerMatrix, detailedMatrix))

  addCheck(checks, problems, 'eastmoney-akshare-separation-audit-generated-artifact-fresh', 'EastMoney/AkShare separation audit artifact is fresh against provider matrix, detailed matrix, contract, and provider-policy source', validateGeneratedJsonArtifact({
    script: paths.electronEastmoneyAkshareSeparationAuditScript,
    artifact: paths.eastmoneyAkshareSeparationAudit,
    label: 'EastMoney/AkShare separation audit',
  }))

  addCheck(checks, problems, 'runtime-data-health-surfaces', 'FinAgent Workstation Data Manager and compact Data widget expose provider gaps, credential activation, policy-disabled rows, and failure actions with provenance', [
    ...textContains(paths.electronDataPanel, [
      'function HealthQueues',
      'const gaps = health.providerGapQueue ?? []',
      'const activations = health.credentialActivationQueue ?? []',
      'const policyDisabled = health.policyDisabledQueue ?? []',
      'const failures = health.failureActionQueue ?? []',
      "t('providerGapQueue')",
      "t('credentialActivationQueue')",
      "t('policyDisabledQueue')",
      "t('failureActionQueue')",
      'buildFailureEvidenceText(row)',
      'row.affectedInterfaces',
      'row.affectedRows',
    ]),
    ...textContains(paths.electronDataWidget, [
      'providerGapQueue?: Array',
      'credentialActivationQueue?: Array',
      'policyDisabledQueue?: Array',
      'failureActionQueue?: Array',
      'const gapRows = [...(health.providerGapQueue ?? [])]',
      'const activationRows = [...(health.credentialActivationQueue ?? [])]',
      'const policyDisabledRows = [...(health.policyDisabledQueue ?? [])]',
      'const failureRows = [...(health.failureActionQueue ?? [])]',
      'buildFailureEvidenceText(row)',
      'failureRank',
    ]),
  ])

  addCheck(checks, problems, 'global-yahoo-symbol-coverage', 'FinAgent Workstation and shared mobile coverage report per-symbol Yahoo/global dataset hit/miss status without applying it to A-share codes', [
    ...textContains(paths.electronDataStoreQueries, [
      'globalYfinanceCoverageLines(ds, code)',
      '${spec.readbackAction} dataset:${spec.dataset}',
      'local-hit',
      'local-miss',
      'isAshareSymbol',
    ]),
    ...textContains('test/unit/market-data-persistence.test.ts', [
      'coverage-yf',
      'query_global_company_profile dataset:profile, local-hit',
      'query_global_company_profile dataset:profile, local-miss',
      "expect(ashareCoverage).not.toContain('query_yfinance dataset:profile')",
    ]),
    ...textContains('app/lib/domain/market/services/market_data_support_service.dart', [
      'globalYfinanceCoverage',
      'option_open_interest',
      'option_implied_volatility',
      'A-share symbol; use China-market interfaces instead of Yahoo/yfinance.',
    ]),
    ...textContains('app/lib/agent/data_fetcher/reusable_data_store_coverage_symbol_research.dart', [
      '_isAshareCoverageSymbol(symbol)',
      'return windRows',
    ]),
    ...textContains('app/test/domain/market/services/market_data_support_service_test.dart', [
      'globalYfinanceCoverageExcluded',
      'reports global Yahoo dataset coverage for non-A-share symbols',
      "expect(news['cacheStatus'], 'local-miss')",
    ]),
    ...textContains('app/test/agent/data_fetcher/reusable_data_store_test.dart', [
      "ashareCoverage.containsKey('yfinance_profile_fields')",
      "ashareCoverage.containsKey('yfinance_option_contracts')",
    ]),
  ])

  addCheck(checks, problems, 'cross-runtime-unification', 'FinAgent Workstation and shared mobile/FinAgent capabilities normalize into interface-owned storage', [
    unificationAudit.summary?.runtimes === 2 ? null : `expected 2 runtimes, got ${unificationAudit.summary?.runtimes}`,
    unificationAudit.summary?.interfaces >= 40 ? null : `expected at least 40 cross-runtime interfaces, got ${unificationAudit.summary?.interfaces}`,
    unificationAudit.summary?.capabilities >= 176 ? null : `expected at least 176 cross-runtime capabilities, got ${unificationAudit.summary?.capabilities}`,
    unificationAudit.summary?.unifiedCapabilities === unificationAudit.summary?.capabilities
      ? null
      : `unified capabilities mismatch: ${unificationAudit.summary?.unifiedCapabilities}/${unificationAudit.summary?.capabilities}`,
    unificationAudit.summary?.problems === 0 ? null : `unification audit reports ${unificationAudit.summary?.problems} problems`,
  ])

  addCheck(checks, problems, 'cross-runtime-unification-generated-artifact-fresh', 'Cross-runtime unification audit artifact is fresh against Electron and shared mobile contracts', validateGeneratedJsonArtifact({
    script: paths.electronUnificationAuditScript,
    artifact: paths.unificationAudit,
    label: 'cross-runtime unification audit',
  }))

  addCheck(checks, problems, 'capability-priority-contract', 'Provider capability routing priority is deterministic per interface', validateCapabilityPriorities(electronContract))

  addCheck(checks, problems, 'provider-policy-capability-alignment', 'Normal provider policy routes do not include disabled or unsupported provider-interface cells', validateProviderPolicyCapabilityAlignment(electronContract))

  addCheck(checks, problems, 'electron-provenance-fields', 'Electron returned data can expose interface/provider/cache/canonical provenance', textContains(paths.electronBaseFetcher, [
    'interfaceId?: string',
    'capabilityId?: string',
    'provider?: string',
    'canonicalSchema?: string',
    'canonicalTable?: string',
    'cacheStatus?:',
    'cacheMode?:',
    'cacheDecision?: string',
    'asOf?: string',
    'fetchedAt?: string',
  ]))

  addCheck(checks, problems, 'electron-cache-provider-separation', 'Electron cache policy is separate from provider selection', [
    ...textContains(paths.electronFetchOptions, [
      "opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first')",
      'providerConstraintFromFetchOptions',
      "providerMode: opts.providerMode ?? 'strict'",
    ]),
    ...textContains(paths.electronCachePolicy, [
      "mode === 'live-only'",
      'reads reusable local data before provider routing',
    ]),
    ...textContains(paths.electronRouter, [
      'const cached = cacheRead.readCache',
      "const cachedCapabilityId = cached.capabilityId ?? 'local.cache'",
      'provider: cachedProvider',
      'cachedProvider',
      "cacheStatus: 'cache-hit'",
      "cacheStatus: 'provider-hit'",
    ]),
  ])

  addCheck(checks, problems, 'mobile-provenance-and-cache-fields', 'Shared mobile/FinAgent router exposes the same cache/provenance semantics', textContains(paths.mobileRouter, [
    'class DataApiRouteProvenance',
    'final String interfaceId',
    'final String capabilityId',
    'final String provider',
    'final String canonicalSchema',
    'final String? canonicalTable',
    'final String cacheStatus',
    'final String cachePolicyMode',
    'final String cacheDecision',
    "final cachedCapabilityId = cached.capabilityId ?? 'local.cache'",
    'provider: cachedProvider',
    'cachedProvider',
    "cacheStatus: 'cache-hit'",
    "cacheStatus: 'provider-hit'",
  ]))

  addCheck(checks, problems, 'mobile-data-health-action-surface', 'Shared mobile/FinAgent MarketData data_health exposes provider gap, credential activation, policy-disabled, and failure action provenance', [
    ...textContains(paths.mobileDataHealthService, [
      "'action': 'data_health'",
      "'interfaceId': 'data.health'",
      "'providerGapQueue'",
      "'credentialActivationQueue'",
      "'policyDisabledQueue'",
      "'failureActionQueue'",
      "'affectedInterfaces'",
      '_interfacesForProvider',
    ]),
    ...textContains(paths.mobileMarketDataToolSchema, [
      '**data_health**',
      'section: summary|interfaces|providers|gaps|failures|all',
      'Returns providerGapQueue, credentialActivationQueue, policyDisabledQueue, and failureActionQueue',
    ]),
    ...textContains(paths.mobileDataHealthTest, [
      "expect(summary['providerGapQueue'], isA<List<dynamic>>())",
      "expect(summary['credentialActivationQueue'], isA<List<dynamic>>())",
      "expect(summary['policyDisabledQueue'], isA<List<dynamic>>())",
      "expect(summary['failureActionQueue'], isA<List<dynamic>>())",
      "expect(providerFailure['affectedInterfaces'], contains('stock.quote'))",
    ]),
  ])

  addCheck(checks, problems, 'mobile-native-provider-boundaries', 'Shared mobile/FinAgent does not advertise desktop-only sidecar providers as native supported capabilities', validateMobileNativeProviderBoundaries())

  addCheck(checks, problems, 'normal-fetchers-use-interface-cache-stage', 'Normal persisted desktop fetchers enter data API interfaces and check cache before provider calls', validateInterfaceBackedFetchers())

  addCheck(checks, problems, 'renderer-normal-routes-no-sidecar-alias', 'Normal renderer finance panels avoid compatibility sidecar aliases', scanForForbidden({
    roots: ['src/renderer'],
    pattern: /\/api\/finance\/sidecar\//,
    allow: [],
  }))

  addCheck(checks, problems, 'skills-generated-reference-present', 'Bundled data-source skills reference generated interface/capability tables', [
    ...requiredPathsExist([
      'assets/skills/data-sources/references/data-api-interfaces.md',
      'app/assets/finance/skills/data-sources/references/data-api-interfaces.md',
      'finagent/assets/finance/skills/data-sources/references/data-api-interfaces.md',
    ]),
    ...validateSkillReference('assets/skills/data-sources/references/data-api-interfaces.md'),
    ...validateSkillReference('app/assets/finance/skills/data-sources/references/data-api-interfaces.md'),
    ...validateSkillReference('finagent/assets/finance/skills/data-sources/references/data-api-interfaces.md'),
  ])

  addCheck(checks, problems, 'skills-generated-reference-fresh', 'Bundled data-source skill references are fresh against the code-owned interface contracts', validateGeneratedSkillReferences())

  addCheck(checks, problems, 'output-only-skills-generated-reference-fresh', 'Bundled output-only data-source skill references are fresh against the code-owned output-only contracts', validateGeneratedOutputOnlySkillReferences())

  addCheck(checks, problems, 'skills-no-normal-provider-direct-guidance', 'Bundled finance skills do not advertise provider-direct calls as normal workflows', validateNoNormalProviderDirectSkillGuidance())

  addCheck(checks, problems, 'skills-disabled-tushare-blocking-guidance', 'Disabled Tushare API mentions in bundled finance skills are paired with blocking guidance', validateDisabledTushareSkillGuidance())

  const summary = {
    generatedAt: new Date().toISOString(),
    checks: checks.length,
    checksPassed: checks.filter((check) => check.status === 'pass').length,
    problems: problems.length,
    providerMatrixInterfaces: providerMatrix.summary?.interfaces ?? 0,
    detailedMatrixRows: detailedMatrix.summary?.totalRows ?? 0,
    outputOnlyInterfaceRows: detailedMatrix.summary?.outputOnlyInterfaceRows ?? 0,
    ungovernedProviderRows: countUngovernedProviderSurfaces(detailedMatrix),
    crossRuntimeInterfaces: unificationAudit.summary?.interfaces ?? 0,
    crossRuntimeCapabilities: unificationAudit.summary?.capabilities ?? 0,
    liveProbeBacklogRows: liveProbeBacklog.summary?.totalBacklog ?? 0,
    liveProbeBacklogWithSpec: liveProbeBacklog.summary?.withProbeSpec ?? 0,
    liveProbeBacklogMissingSpec: liveProbeBacklog.summary?.missingProbeDefinition ?? 0,
    liveStatusRows: (liveStatusReport.summary?.total ?? 0) + mobileStatusRows(mobileStatus).length,
    liveStatusPassed: (liveStatusReport.summary?.passed ?? 0) + mobileStatusRows(mobileStatus).filter((row) => row.status === 'passed').length,
    dataHealthInterfaces: dataHealthReport.summary?.interfaces ?? 0,
    dataHealthProviders: dataHealthReport.summary?.providers ?? 0,
    dataHealthDatasets: dataHealthReport.summary?.datasets ?? 0,
    windCapabilityRows: windCapabilityAudit.summary?.windCapabilities ?? 0,
    windImplementedCredentialGated: windCapabilityAudit.summary?.decisionCounts?.['implemented-credential-gated'] ?? 0,
    windExplicitNotSupported: windCapabilityAudit.summary?.decisionCounts?.['explicit-not-supported'] ?? 0,
    windAuditProblems: windCapabilityAudit.summary?.problems ?? 0,
    yahooCapabilityRows: yahooCapabilityAudit.summary?.yahooCapabilities ?? 0,
    yahooGlobalOnlyRows: yahooCapabilityAudit.summary?.globalOnly ?? 0,
    yahooLivePassed: yahooCapabilityAudit.summary?.livePassed ?? 0,
    yahooAuditProblems: yahooCapabilityAudit.summary?.problems ?? 0,
    eastmoneyAkshareSeparationRows: eastmoneyAkshareSeparationAudit.summary?.rows ?? 0,
    eastmoneyAkshareBoundaryProblems: eastmoneyAkshareSeparationAudit.summary?.boundaryProblems ?? 0,
    eastmoneyAkshareAuditProblems: eastmoneyAkshareSeparationAudit.summary?.problems ?? 0,
  }

  return {
    generatedAt: summary.generatedAt,
    objective: 'Verify finance data API refactor completion evidence for data provenance, provider capability registration, DataStore-first routing, detailed surface classification, cache reuse, and bundled skill alignment.',
    source: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, resolve(repoRoot, value)])),
    summary,
    checks,
    problems,
  }
}

function validateDataHealthReport(report, providerMatrix, detailedMatrix, liveProbeBacklog, liveStatusReport, mobileStatus) {
  const interfaceRows = report.interfaceHealth ?? []
  const providerRows = report.providerHealth ?? []
  const liveProviderRows = report.liveProviderHealth ?? []
  const datasetRows = report.datasetHealth ?? []
  const providerGapRows = report.providerGapQueue ?? []
  const credentialActivationRows = report.credentialActivationQueue ?? []
  const credentialValidatedRows = report.credentialValidatedQueue ?? []
  const policyDisabledRows = report.policyDisabledQueue ?? []
  const mobileRows = mobileStatusRows(mobileStatus)
  const mobileFailures = mobileRows.filter((row) => row.status !== 'passed')
  const expectedLiveRows = (liveStatusReport.summary?.total ?? 0) + mobileRows.length
  const expectedFailureRows = (liveStatusReport.failures ?? []).length + mobileFailures.length
  const expectedLiveProviders = new Set([
    ...Object.keys(liveStatusReport.byProvider ?? {}),
    ...mobileRows.map((row) => row.provider).filter(Boolean),
  ])
  return [
    report.summary?.interfaces === providerMatrix.summary?.interfaces
      ? null
      : `data health interfaces ${report.summary?.interfaces} != provider matrix ${providerMatrix.summary?.interfaces}`,
    report.summary?.providers === providerMatrix.summary?.providers
      ? null
      : `data health providers ${report.summary?.providers} != provider matrix ${providerMatrix.summary?.providers}`,
    report.summary?.datasets >= 40 ? null : `expected at least 40 data health dataset groups, got ${report.summary?.datasets}`,
    report.summary?.detailedRows === detailedMatrix.summary?.totalRows
      ? null
      : `data health detailed rows ${report.summary?.detailedRows} != detailed matrix ${detailedMatrix.summary?.totalRows}`,
    report.summary?.liveStatusRows === expectedLiveRows
      ? null
      : `data health live status rows ${report.summary?.liveStatusRows} != desktop+mobile live rows ${expectedLiveRows}`,
    report.summary?.liveProbeBacklogRows === liveProbeBacklog.summary?.totalBacklog
      ? null
      : `data health backlog rows ${report.summary?.liveProbeBacklogRows} != backlog ${liveProbeBacklog.summary?.totalBacklog}`,
    report.summary?.failureActionRows === expectedFailureRows
      ? null
      : `data health failure action rows ${report.summary?.failureActionRows} != desktop+mobile live failures ${expectedFailureRows}`,
    report.summary?.problems === 0 ? null : `data health report has ${report.summary?.problems} problems`,
    interfaceRows.length === providerMatrix.summary?.interfaces
      ? null
      : `data health interface row count is ${interfaceRows.length}`,
    providerRows.length === providerMatrix.summary?.providers
      ? null
      : `data health provider row count is ${providerRows.length}`,
    liveProviderRows.length === expectedLiveProviders.size
      ? null
      : `data health live provider row count is ${liveProviderRows.length}/${expectedLiveProviders.size}`,
    [...expectedLiveProviders]
      .filter((provider) => !liveProviderRows.some((row) => row.provider === provider))
      .map((provider) => `data health live provider row is missing ${provider}`),
    datasetRows.length === report.summary?.datasets
      ? null
      : `data health dataset row count is ${datasetRows.length}/${report.summary?.datasets}`,
    (expectedFailureRows === 0 || (report.summary?.failureActionRows ?? 0) > 0)
      ? null
      : `expected failure action evidence from classified live failures, got ${JSON.stringify(report.summary ?? {})}`,
    (report.failureActionQueue ?? [])
      .filter((row) => !row.probeId || !row.provider || !row.validationState || !row.failureClass || !row.nextAction)
      .map((row) => `data health failure action row is missing required fields: ${JSON.stringify(row)}`),
    report.summary?.providerGapRows === providerGapRows.length
      ? null
      : `data health provider gap rows ${report.summary?.providerGapRows} != queue ${providerGapRows.length}`,
    (report.summary?.policyDisabledRows ?? 0) === policyDisabledRows.length
      ? null
      : `data health policy-disabled rows ${report.summary?.policyDisabledRows} != queue ${policyDisabledRows.length}`,
    (report.summary?.providerGapPromotionCandidates ?? 0) === providerGapRows.filter((row) => row.promotionCandidate).length
      ? null
      : `data health provider gap promotion count ${report.summary?.providerGapPromotionCandidates} != queue candidates ${providerGapRows.filter((row) => row.promotionCandidate).length}`,
    providerGapRows.every((row) => ['output-only', 'credential-gated', 'quota-gated', 'transport-unstable'].includes(row.status))
      ? null
      : `data health provider gap queue has unsupported statuses: ${JSON.stringify(providerGapRows.filter((row) => !['output-only', 'credential-gated', 'quota-gated', 'transport-unstable'].includes(row.status)))}`,
    providerGapRows.filter((row) => !row.interfaceId || !row.provider || !row.status || !row.gapClass || typeof row.actionPriority !== 'number' || !row.nextAction).map((row) => `data health provider gap row is missing required fields: ${JSON.stringify(row)}`),
    credentialActivationRows.filter((row) => !row.interfaceId || !row.provider || !row.status || !row.gapClass || !row.nextAction || !row.reason).map((row) => `data health credential activation row is missing action fields: ${JSON.stringify(row)}`),
    (report.summary?.credentialActivationRows ?? 0) === credentialActivationRows.length
      ? null
      : `data health credential activation rows ${report.summary?.credentialActivationRows} != queue ${credentialActivationRows.length}`,
    credentialValidatedRows.filter((row) => !row.interfaceId || !row.provider || row.liveStatus !== 'passed' || !row.normalizer || !row.canonicalTable || !row.nextAction).map((row) => `data health credential validated row is missing proof fields: ${JSON.stringify(row)}`),
    (report.summary?.credentialValidatedRows ?? 0) === credentialValidatedRows.length
      ? null
      : `data health credential validated rows ${report.summary?.credentialValidatedRows} != queue ${credentialValidatedRows.length}`,
    policyDisabledRows.filter((row) => !row.interfaceId || !row.provider || row.status !== 'disabled' || row.gapClass !== 'policy-disabled' || !row.nextAction || !row.reason).map((row) => `data health policy-disabled row is missing disabled proof fields: ${JSON.stringify(row)}`),
    interfaceRows.filter((row) => !row.interfaceId || !row.canonicalSchema || !row.cacheStatus || !row.healthState).map((row) => `data health interface row is missing required fields: ${JSON.stringify(row)}`),
    interfaceRows.flatMap((row) => (row.gapProviders ?? [])
      .filter((gap) => !String(gap.reason ?? '').trim())
      .map((gap) => `data health interface gap provider missing reason: ${row.interfaceId}/${gap.provider}/${gap.status}`)),
    providerRows.filter((row) => !row.provider || !row.healthState || typeof row.liveProbeBacklog !== 'number').map((row) => `data health provider row is missing required fields: ${JSON.stringify(row)}`),
    liveProviderRows.filter((row) => !row.provider || !row.normalizedProvider || !row.healthState || typeof row.liveProbeCount !== 'number').map((row) => `data health live provider row is missing required fields: ${JSON.stringify(row)}`),
    datasetRows.filter((row) => !row.canonicalSchema || !row.healthState || !Array.isArray(row.queryActions)).map((row) => `data health dataset row is missing required fields: ${JSON.stringify(row)}`),
  ].flat()
}

function validateWindCapabilityAudit(report, providerMatrix, liveStatusReport, unificationAudit) {
  const rows = report.rows ?? []
  const windProviderMatrixRows = (providerMatrix.rows ?? [])
    .map((row) => ({ interfaceId: row.interfaceId, capability: row.providers?.wind }))
    .filter((row) => row.capability?.capabilityId)
  const liveByProbeId = new Map((liveStatusReport.passedApis ?? []).concat(liveStatusReport.failures ?? []).map((row) => [row.id, row]))
  const unifiedWindCapabilities = (unificationAudit.rows ?? []).filter((row) => row.provider === 'wind')
  const credentialRows = rows.filter((row) => row.status === 'credential-gated')
  const notSupportedRows = rows.filter((row) => row.status === 'not-supported')
  const implementedRows = rows.filter((row) => row.decision === 'implemented-credential-gated')
  const unsupportedRows = rows.filter((row) => row.decision === 'explicit-not-supported')
  return [
    report.summary?.problems === 0 ? null : `Wind capability audit reports ${report.summary?.problems} problems`,
    rows.length === report.summary?.windCapabilities
      ? null
      : `Wind capability row count ${rows.length} != summary ${report.summary?.windCapabilities}`,
    rows.length === windProviderMatrixRows.length
      ? null
      : `Wind audit rows ${rows.length} != provider matrix Wind capabilities ${windProviderMatrixRows.length}`,
    report.summary?.referenceTools >= 30
      ? null
      : `expected at least 30 Wind reference tools, got ${report.summary?.referenceTools}`,
    credentialRows.length === (report.summary?.statusCounts?.['credential-gated'] ?? 0)
      ? null
      : `Wind credential-gated row count mismatch: ${credentialRows.length}/${report.summary?.statusCounts?.['credential-gated']}`,
    notSupportedRows.length === (report.summary?.statusCounts?.['not-supported'] ?? 0)
      ? null
      : `Wind not-supported row count mismatch: ${notSupportedRows.length}/${report.summary?.statusCounts?.['not-supported']}`,
    implementedRows.length === credentialRows.length
      ? null
      : `every credential-gated Wind row must be implemented-credential-gated: ${implementedRows.length}/${credentialRows.length}`,
    unsupportedRows.length === notSupportedRows.length
      ? null
      : `every not-supported Wind row must be explicit-not-supported: ${unsupportedRows.length}/${notSupportedRows.length}`,
    report.summary?.livePassed === credentialRows.length
      ? null
      : `Wind live-pass count ${report.summary?.livePassed} != credential-gated rows ${credentialRows.length}`,
    report.summary?.canonicalReady === credentialRows.length
      ? null
      : `Wind canonical-ready count ${report.summary?.canonicalReady} != credential-gated rows ${credentialRows.length}`,
    report.summary?.unified === rows.length
      ? null
      : `Wind unified row count ${report.summary?.unified} != rows ${rows.length}`,
    unifiedWindCapabilities.length >= rows.length
      ? null
      : `cross-runtime unification audit has only ${unifiedWindCapabilities.length} Wind rows for ${rows.length} Wind capability rows`,
    ...credentialRows
      .filter((row) => !row.capabilityId || !row.normalizer || !row.canonicalTable || !row.probeId || !row.liveStatus || row.liveStatus !== 'passed' || !row.unified)
      .map((row) => `Wind credential-gated row lacks required proof fields: ${row.interfaceId}/${row.capabilityId}`),
    ...credentialRows
      .filter((row) => !Array.isArray(row.referencedTools) || row.referencedTools.length === 0)
      .map((row) => `Wind credential-gated row does not name concrete Wind tools: ${row.interfaceId}/${row.capabilityId}`),
    ...credentialRows
      .filter((row) => row.probeId && liveByProbeId.get(row.probeId)?.status !== 'passed')
      .map((row) => `Wind credential-gated row probe is not live-passed: ${row.interfaceId}/${row.probeId}`),
    ...notSupportedRows
      .filter((row) => row.normalizer || row.canonicalTable || row.probeId || row.liveStatus)
      .map((row) => `Wind not-supported row should not advertise reusable provider proof: ${row.interfaceId}/${row.capabilityId}`),
    ...(report.unclaimedReferenceTools ?? [])
      .filter((tool) => !tool.id || tool.documented !== true)
      .map((tool) => `Wind unclaimed reference tool is missing documentation evidence: ${JSON.stringify(tool)}`),
  ].flat()
}

function validateYahooCapabilityAudit(report, providerMatrix, liveStatusReport, unificationAudit) {
  const rows = report.rows ?? []
  const yahooProviderMatrixRows = (providerMatrix.rows ?? [])
    .map((row) => ({ interfaceId: row.interfaceId, capability: row.providers?.yahoo }))
    .filter((row) => row.capability?.capabilityId)
  const liveByProbeId = new Map((liveStatusReport.passedApis ?? []).concat(liveStatusReport.failures ?? []).map((row) => [row.id, row]))
  const unifiedYahooCapabilities = (unificationAudit.rows ?? []).filter((row) => row.provider === 'yahoo' || row.provider === 'yfinance' || String(row.capabilityId ?? '').startsWith('yahoo.'))
  const globalRows = rows.filter((row) => row.status === 'global-only')
  const governedRows = rows.filter((row) => row.decision === 'global-capability-governed')
  const broadFeedRows = rows.filter((row) => row.capabilityId === 'yahoo.news.finance_feed')
  const sourceEvidence = report.sourceEvidence ?? {}
  return [
    report.summary?.problems === 0 ? null : `Yahoo capability audit reports ${report.summary?.problems} problems`,
    rows.length === report.summary?.yahooCapabilities
      ? null
      : `Yahoo capability row count ${rows.length} != summary ${report.summary?.yahooCapabilities}`,
    rows.length === yahooProviderMatrixRows.length
      ? null
      : `Yahoo audit rows ${rows.length} != provider matrix Yahoo capabilities ${yahooProviderMatrixRows.length}`,
    globalRows.length >= 13 ? null : `expected at least 13 Yahoo global-only rows, got ${globalRows.length}`,
    governedRows.length === globalRows.length
      ? null
      : `every Yahoo global-only row must be governed: ${governedRows.length}/${globalRows.length}`,
    broadFeedRows.length === 1 && broadFeedRows[0].decision === 'explicit-broad-feed-exemption'
      ? null
      : `Yahoo broad finance feed exemption is missing or ambiguous: ${JSON.stringify(broadFeedRows)}`,
    report.summary?.livePassed === globalRows.length
      ? null
      : `Yahoo live-pass count ${report.summary?.livePassed} != global-only rows ${globalRows.length}`,
    report.summary?.canonicalReady === globalRows.length
      ? null
      : `Yahoo canonical-ready count ${report.summary?.canonicalReady} != global-only rows ${globalRows.length}`,
    report.summary?.unified >= rows.length
      ? null
      : `Yahoo unified count ${report.summary?.unified} < rows ${rows.length}`,
    unifiedYahooCapabilities.length >= rows.length
      ? null
      : `cross-runtime unification audit has only ${unifiedYahooCapabilities.length} Yahoo/YFinance rows for ${rows.length} Yahoo capability rows`,
    ...globalRows
      .filter((row) => !row.capabilityId || !row.normalizer || !row.canonicalTable || !row.probeId || !row.unified)
      .map((row) => `Yahoo global-only row lacks required proof fields: ${row.interfaceId}/${row.capabilityId}`),
    ...globalRows
      .filter((row) => row.probeId && liveByProbeId.get(row.probeId)?.status !== 'passed')
      .map((row) => `Yahoo global-only row probe is not live-passed: ${row.interfaceId}/${row.probeId}`),
    ...globalRows
      .filter((row) => !['US', 'HK', 'global'].every((scope) => (row.marketScope ?? []).includes(scope)))
      .map((row) => `Yahoo global-only row lacks US/HK/global market scope: ${row.interfaceId}/${row.capabilityId}`),
    ...globalRows
      .filter((row) => !(row.queryActions ?? []).some((action) => ['query_yfinance', 'query_quote', 'query_kline'].includes(action)))
      .map((row) => `Yahoo global-only row lacks reusable readback action: ${row.interfaceId}/${row.capabilityId}`),
    ...Object.entries(sourceEvidence)
      .filter(([, value]) => value !== true)
      .map(([key]) => `Yahoo source evidence failed: ${key}`),
  ].flat()
}

function validateEastmoneyAkshareSeparationAudit(report, providerMatrix, detailedMatrix) {
  const rows = report.rows ?? []
  const providerMatrixRows = []
  for (const row of providerMatrix.rows ?? []) {
    for (const provider of ['eastmoney', 'akshare', 'sina']) {
      const capability = row.providers?.[provider]
      if (capability?.capabilityId || capability?.status === 'supported') providerMatrixRows.push({ interfaceId: row.interfaceId, provider })
    }
  }
  const detailedRows = (detailedMatrix.rows ?? []).filter((row) => ['eastmoney', 'akshare', 'sina'].includes(row.provider))
  const sourceEvidence = report.sourceEvidence ?? {}
  return [
    report.summary?.problems === 0 ? null : `EastMoney/AkShare separation audit reports ${report.summary?.problems} problems`,
    rows.length === report.summary?.rows
      ? null
      : `EastMoney/AkShare audit row count ${rows.length} != summary ${report.summary?.rows}`,
    rows.length === providerMatrixRows.length
      ? null
      : `EastMoney/AkShare audit rows ${rows.length} != provider matrix EM/AK/Sina rows ${providerMatrixRows.length}`,
    report.summary?.boundaryProblems === 0
      ? null
      : `EastMoney/AkShare audit has ${report.summary?.boundaryProblems} provider boundary problems`,
    (report.summary?.directEastmoneyRows ?? 0) > 0
      ? null
      : 'EastMoney/AkShare audit found no direct EastMoney rows',
    (report.summary?.akshareEastmoneyOriginRows ?? 0) > 0
      ? null
      : 'EastMoney/AkShare audit found no AkShare rows with EastMoney upstream origin metadata',
    detailedRows.length === report.summary?.detailedRows
      ? null
      : `EastMoney/AkShare detailed row count ${report.summary?.detailedRows} != matrix ${detailedRows.length}`,
    ...Object.entries(sourceEvidence)
      .filter(([, value]) => value !== true)
      .map(([key]) => `EastMoney/AkShare source evidence failed: ${key}`),
    ...rows
      .filter((row) => row.decision === 'provider-boundary-problem')
      .map((row) => `EastMoney/AkShare boundary problem remains: ${row.provider}.${row.interfaceId}/${row.capabilityId}`),
  ].flat()
}

function validateLiveStatusReport(report) {
  const failures = Array.isArray(report.failures) ? report.failures : []
  const allowedValidationStates = new Set([
    'valid-schema-observed',
    'valid-empty-response',
    'transport-or-provider-unstable',
    'runtime-blocked',
    'credential-gated',
    'quota-gated',
    'unsupported-by-provider',
    'invalid-parameters',
  ])
  const unclassified = failures.filter((row) => !allowedValidationStates.has(row.validationState))
  const weakFailures = failures.filter((row) => !row.failureClass || !row.error)
  const nonPassing = (report.summary?.failed ?? 0) + (report.summary?.blocked ?? 0) + (report.summary?.timeout ?? 0) + (report.summary?.skipped ?? 0)
  const allRowsPassed = (report.summary?.passed ?? 0) === (report.summary?.total ?? -1)
  return [
    report.summary?.total >= 85 ? null : `expected at least 85 recorded live probes, got ${report.summary?.total}`,
    (report.summary?.passed ?? 0) > 0 ? null : 'live status has no passing probe evidence',
    nonPassing > 0 || allRowsPassed ? null : 'live status has neither complete pass evidence nor non-passing classification evidence',
    allRowsPassed || (report.summary?.transportOrProviderUnstable ?? 0) + (report.summary?.runtimeBlocked ?? 0) + (report.summary?.credentialGated ?? 0) + (report.summary?.quotaGated ?? 0) + (report.summary?.unsupported ?? 0) + (report.summary?.invalidParameters ?? 0) === nonPassing
      ? null
      : `non-passing classifications do not add up: ${JSON.stringify(report.summary ?? {})}`,
    (report.byProvider?.eastmoney ?? 0) >= 16 ? null : `expected at least 16 EastMoney live probes, got ${report.byProvider?.eastmoney ?? 0}`,
    (report.byProvider?.tradingview ?? 0) >= 1 ? null : `expected at least 1 TradingView live probe, got ${report.byProvider?.tradingview ?? 0}`,
    (report.byProvider?.yfinance ?? 0) >= 8 ? null : `expected at least 8 yfinance live probes, got ${report.byProvider?.yfinance ?? 0}`,
    (report.byProvider?.sidecar ?? 0) >= 1 ? null : `expected at least 1 sidecar live probe, got ${report.byProvider?.sidecar ?? 0}`,
    (report.byProvider?.tdx ?? 0) >= 49 ? null : `expected at least 49 TDX live probes, got ${report.byProvider?.tdx ?? 0}`,
    (report.byProvider?.akshare ?? 0) >= 1 ? null : `expected at least 1 AkShare live probe, got ${report.byProvider?.akshare ?? 0}`,
    (report.byProvider?.ta ?? 0) >= 2 ? null : `expected at least 2 TA live probes, got ${report.byProvider?.ta ?? 0}`,
    (report.byProvider?.tushare ?? 0) >= 7 ? null : `expected at least 7 Tushare live probes, got ${report.byProvider?.tushare ?? 0}`,
    (report.byValidationState?.['valid-schema-observed'] ?? 0) === report.summary?.passed
      ? null
      : `valid-schema observations do not match pass count: ${JSON.stringify(report.byValidationState ?? {})}`,
    allRowsPassed || (
      (report.byValidationState?.['runtime-blocked'] ?? 0) +
      (report.byValidationState?.['transport-or-provider-unstable'] ?? 0) +
      (report.byValidationState?.['credential-gated'] ?? 0) +
      (report.byValidationState?.['quota-gated'] ?? 0) +
      (report.byValidationState?.['unsupported-by-provider'] ?? 0) +
      (report.byValidationState?.['invalid-parameters'] ?? 0)
    ) > 0
      ? null
      : `expected non-passing failure classification, got ${JSON.stringify(report.byValidationState ?? {})}`,
    failures.length === nonPassing
      ? null
      : `non-passing row count does not match summary: ${failures.length}`,
    unclassified.length === 0 ? null : `live status has unclassified non-passing rows: ${unclassified.map((row) => row.id).join(', ')}`,
    weakFailures.length === 0 ? null : `live status has non-passing rows without failure class or error: ${weakFailures.map((row) => row.id).join(', ')}`,
  ]
}

function validateLiveProbeBacklog(detailedMatrix, backlog) {
  const rowsNeedingProbe = (detailedMatrix.rows ?? []).filter((row) => (
    row.liveProbeRequirement === 'needs-live-probe' ||
    row.liveProbeRequirement === 'needs-live-status-evidence'
  )).length
  const staleAddProbeActions = (detailedMatrix.rows ?? []).filter((row) => row.governanceAction === 'add-live-probe')
  const recommendedCommands = [
    ...(backlog.rows ?? []).map((row) => row.recommendedCommand),
    ...(backlog.commandTemplates ?? []).map((item) => item.command),
  ].filter(Boolean)
  return [
    backlog.policy?.defaultConcurrency === 1
      ? null
      : `live probe backlog default concurrency is ${backlog.policy?.defaultConcurrency}, expected 1`,
    backlog.policy?.defaultWaitMs === 1500
      ? null
      : `live probe backlog default wait is ${backlog.policy?.defaultWaitMs}, expected 1500`,
    backlog.policy?.defaultEastmoneyTimeoutMs === 120000
      ? null
      : `live probe backlog default EastMoney timeout is ${backlog.policy?.defaultEastmoneyTimeoutMs}, expected 120000`,
    String(backlog.policy?.concurrencyRule ?? '').includes('requires --concurrency 1')
      ? null
      : 'live probe backlog concurrency rule does not require --concurrency 1',
    String(backlog.policy?.timeoutRule ?? '').includes('--eastmoney-timeout-ms 120000')
      ? null
      : 'live probe backlog timeout rule does not require the EastMoney timeout budget',
    backlog.summary?.matrixRowsNeedingLiveProbe === rowsNeedingProbe
      ? null
      : `live probe backlog source mismatch: ${backlog.summary?.matrixRowsNeedingLiveProbe}/${rowsNeedingProbe}`,
    (backlog.summary?.alreadyCoveredByLiveStatus ?? 0) + (backlog.summary?.totalBacklog ?? 0) === rowsNeedingProbe
      ? null
      : `live probe backlog coverage mismatch: covered ${backlog.summary?.alreadyCoveredByLiveStatus ?? 0} + remaining ${backlog.summary?.totalBacklog ?? 0} != ${rowsNeedingProbe}`,
    backlog.summary?.totalBacklog === 0
      ? null
      : `live probe backlog still has ${backlog.summary?.totalBacklog} rows without recorded live status evidence`,
    backlog.summary?.totalBacklog === 0 && staleAddProbeActions.length > 0
      ? `detailed matrix still has add-live-probe actions after backlog reached zero: ${staleAddProbeActions.slice(0, 20).map((row) => row.rowId).join(', ')}`
      : null,
    (backlog.summary?.withProbeSpec ?? 0) + (backlog.summary?.missingProbeDefinition ?? 0) === backlog.summary?.totalBacklog
      ? null
      : `live probe backlog status counts do not add up: ${JSON.stringify(backlog.summary ?? {})}`,
    (backlog.rows ?? []).length === backlog.summary?.totalBacklog
      ? null
      : `live probe backlog rows mismatch: ${(backlog.rows ?? []).length}/${backlog.summary?.totalBacklog}`,
    backlog.problems?.length === 0
      ? null
      : `live probe backlog reports generator problems: ${backlog.problems?.join('; ')}`,
    recommendedCommands.every((command) => command.includes('--concurrency 1'))
      ? null
      : 'one or more live-probe commands omit --concurrency 1',
    recommendedCommands.every((command) => command.includes('--wait-ms 1500'))
      ? null
      : 'one or more live-probe commands omit --wait-ms 1500',
    recommendedCommands.every((command) => command.includes('--eastmoney-timeout-ms 120000'))
      ? null
      : 'one or more live-probe commands omit --eastmoney-timeout-ms 120000',
    recommendedCommands.every((command) => command.includes('--checkpoint '))
      ? null
      : 'one or more live-probe commands omit checkpoint',
    recommendedCommands.every((command) => command.includes('--resume true'))
      ? null
      : 'one or more live-probe commands omit --resume true',
  ]
}

function validateOutputOnlyInterfaces(detailedMatrix) {
  const rows = detailedMatrix.rows ?? []
  const required = {
    provider_discovery_result: ['akshare_search', 'yfinance_search', 'ta_search'],
    provider_diagnostic_result: ['akshare', 'yfinance', 'tdx', 'tushare', 'provider_diagnostic'],
    provider_status_result: ['sidecar_status'],
  }
  const problems = []
  for (const [schemaKey, actions] of Object.entries(required)) {
    for (const action of actions) {
      const matching = rows.filter((row) => row.action === action || row.endpoint === action)
      if (matching.length === 0) {
        problems.push(`missing matrix row for output-only action ${action}`)
        continue
      }
      for (const row of matching) {
        if (row.interfaceCoverageStatus !== 'normalized-output-only-interface') {
          problems.push(`${action} row ${row.rowId} is ${row.interfaceCoverageStatus}, expected normalized-output-only-interface`)
        }
        if (!String(row.canonicalSchema ?? '').includes(schemaKey)) {
          problems.push(`${action} row ${row.rowId} schema ${row.canonicalSchema} does not include ${schemaKey}`)
        }
        if (!row.outputOnlyCategory || !row.outputOnlyReason) {
          problems.push(`${action} row ${row.rowId} is missing output-only category/reason`)
        }
      }
    }
  }
  for (const row of rows.filter((item) => item.interfaceCoverageStatus === 'normalized-output-only-interface')) {
    if (!row.outputOnlyCategory || !row.outputOnlyReason) {
      problems.push(`${row.rowId} ${row.action ?? row.endpoint} is output-only without category/reason`)
    }
    if (!['discovery', 'diagnostic', 'status', 'known-schema'].includes(row.outputOnlyCategory)) {
      problems.push(`${row.rowId} ${row.action ?? row.endpoint} has unexpected output-only category ${row.outputOnlyCategory}`)
    }
  }
  return problems
}

function validateToolActionSurfaceBoundary(detailedMatrix) {
  const allowed = new Set(['help'])
  return (detailedMatrix.rows ?? [])
    .filter((row) => row.interfaceCoverageStatus === 'tool-action-not-data-interface')
    .filter((row) => !allowed.has(String(row.action ?? row.endpoint ?? '')))
    .map((row) => `${row.rowId} ${row.family}/${row.action ?? row.endpoint} remains a generic tool-action surface`)
}

function validateLocalSurfaceClassifications(detailedMatrix) {
  const categories = {
    'local-readback-or-status-surface': 'local-readback',
    'derived-local-analysis-surface': 'derived-analysis',
    'contract-census-surface': 'contract-census',
    'queue-control-surface': 'queue-control',
    'tool-action-not-data-interface': 'tool-control',
  }
  const problems = []
  for (const row of detailedMatrix.rows ?? []) {
    const expected = categories[row.interfaceCoverageStatus]
    if (!expected) continue
    if (row.surfaceCategory !== expected) {
      problems.push(`${row.rowId} ${row.action ?? row.endpoint} surface category ${row.surfaceCategory} != ${expected}`)
    }
    if (!row.surfaceReason) {
      problems.push(`${row.rowId} ${row.action ?? row.endpoint} is missing surface reason`)
    }
  }
  return problems
}

function validateNoUngovernedProviderSurfaces(detailedMatrix) {
  const rows = ungovernedProviderSurfaceRows(detailedMatrix)
  return rows.map((row) => `${row.rowId} ${row.provider}/${row.action ?? row.endpoint ?? row.surfaceId} remains ${row.governanceAction}`)
}

function validateOperationalReasons(providerMatrix) {
  const problems = []
  for (const row of providerMatrix.rows ?? []) {
    for (const [provider, cell] of Object.entries(row.providers ?? {})) {
      if (!['not-supported', 'credential-gated', 'quota-gated', 'disabled'].includes(cell?.status) || !cell.capabilityId) continue
      if (!String(cell.reason ?? '').trim()) {
        problems.push(`${row.interfaceId}/${provider}/${cell.capabilityId} is ${cell.status} without reason`)
      }
    }
  }
  return problems
}

function countUngovernedProviderSurfaces(detailedMatrix) {
  return ungovernedProviderSurfaceRows(detailedMatrix).length
}

function ungovernedProviderSurfaceRows(detailedMatrix) {
  return (detailedMatrix.rows ?? []).filter((row) => row.governanceAction === 'promote-to-interface-or-output-only')
}

function addCheck(checks, problems, id, description, candidateProblems) {
  const flattened = [candidateProblems].flat(Infinity).filter(Boolean)
  const status = flattened.length === 0 ? 'pass' : 'fail'
  checks.push({ id, description, status, problems: flattened })
  for (const problem of flattened) problems.push(`${id}: ${problem}`)
}

function requiredPathsExist(pathList) {
  return pathList
    .filter((item) => !existsSync(resolve(repoRoot, item)) && !existsSync(resolve(parentRoot, item)))
    .map((item) => `missing required artifact: ${item}`)
}

function readJson(path) {
  const fullPath = resolve(repoRoot, path)
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return JSON.parse(readFileSync(fullPath, 'utf-8'))
    } catch (error) {
      lastError = error
      if (!(error instanceof SyntaxError)) throw error
      sleepMs(50)
    }
  }
  throw lastError
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readText(path) {
  const localPath = resolve(repoRoot, path)
  if (existsSync(localPath)) return readFileSync(localPath, 'utf-8')
  return readFileSync(resolve(parentRoot, path), 'utf-8')
}

function textContains(path, snippets) {
  const text = readText(path)
  return snippets
    .filter((snippet) => !text.includes(snippet))
    .map((snippet) => `${path} missing evidence snippet: ${snippet}`)
}

function validateCapabilityPriorities(contract) {
  const problems = []
  for (const item of contract.interfaces ?? []) {
    const seen = new Map()
    for (const capability of item.capabilities ?? []) {
      if (capability.status !== 'supported' && capability.status !== 'global-only') continue
      if (typeof capability.priority !== 'number') problems.push(`${item.id}/${capability.id} missing numeric priority`)
      if (capability.priority == null) continue
      const key = String(capability.priority)
      if (seen.has(key)) {
        problems.push(`${item.id} duplicate eligible priority ${key}: ${seen.get(key)} and ${capability.id}`)
      } else {
        seen.set(key, capability.id)
      }
    }
  }
  return problems
}

function validateProviderPolicyCapabilityAlignment(contract) {
  const problems = []
  const eligibleStatuses = new Set(['supported', 'credential-gated', 'global-only'])
  const taskInterfaces = {
    quote: 'stock.quote',
    indexQuote: 'index.quote',
    kline: 'stock.daily_kline',
    indexKline: 'index.daily_kline',
    intradayTick: 'stock.tick_chart_intraday',
    sector: 'market.sector_ranking',
    limitPool: 'market.limit_pool',
    dragonTiger: 'market.dragon_tiger',
    fundamental: 'stock.daily_valuation',
    fund: 'fund.identity_list',
    moneyFlow: 'stock.money_flow',
  }
  const providerAlias = {
    eastmoneyDirect: 'eastmoney',
    yfinance: 'yahoo',
  }
  const electronPolicy = readText(paths.electronProviderPolicy)
  const interfacesById = new Map((contract.interfaces ?? []).map((item) => [item.id, item]))
  for (const [task, interfaceId] of Object.entries(taskInterfaces)) {
    const providers = extractTsPolicyProviders(electronPolicy, task)
    if (providers.length === 0) {
      problems.push(`Electron provider policy has no providers for ${task}`)
      continue
    }
    const item = interfacesById.get(interfaceId)
    if (!item) {
      problems.push(`Electron provider policy task ${task} maps to missing interface ${interfaceId}`)
      continue
    }
    const capabilities = new Map((item.capabilities ?? []).map((capability) => [capability.provider, capability]))
    for (const rawProvider of providers) {
      const provider = providerAlias[rawProvider] ?? rawProvider
      const capability = capabilities.get(provider)
      if (!capability) {
        problems.push(`Electron provider policy routes ${task}/${interfaceId} through ${rawProvider}, but no provider capability exists`)
        continue
      }
      if (!eligibleStatuses.has(capability.status)) {
        problems.push(`Electron provider policy routes ${task}/${interfaceId} through ${rawProvider}, but capability status is ${capability.status}`)
      }
    }
  }
  const mobilePolicy = readText(paths.mobileProviderPolicy)
  const forbiddenMobileSnippets = [
    'FinanceDataTask.intradayTick: [FinanceProvider.tdx, FinanceProvider.wind]',
    'FinanceDataTask.sector: [\n      FinanceProvider.eastmoneyDirect,\n      FinanceProvider.akshare,\n      FinanceProvider.wind',
    'FinanceDataTask.dragonTiger: [\n      FinanceProvider.eastmoneyDirect,\n      FinanceProvider.wind',
    'FinanceDataTask.dragonTiger: [\n      FinanceProvider.eastmoneyDirect,\n      FinanceProvider.tushare',
    'FinanceDataTask.moneyFlow: [\n      FinanceProvider.eastmoneyDirect,\n      FinanceProvider.akshare,\n      FinanceProvider.tushare',
    'FinanceDataTask.fund: [\n      FinanceProvider.eastmoneyDirect,\n      FinanceProvider.akshare,\n      FinanceProvider.wind,\n      FinanceProvider.tushare',
  ]
  for (const snippet of forbiddenMobileSnippets) {
    if (mobilePolicy.includes(snippet)) {
      problems.push(`mobile provider policy reintroduced unsupported/disabled route snippet: ${snippet.replace(/\s+/g, ' ')}`)
    }
  }
  problems.push(...textContains(paths.mobileProviderPolicyTest, [
    'normal policy excludes unsupported provider-interface cells',
    'scoped provider order cannot re-enable unsupported providers',
    'FinanceDataTask.intradayTick',
    'FinanceDataTask.dragonTiger',
    'FinanceDataTask.moneyFlow',
  ]))
  return problems
}

function extractTsPolicyProviders(text, task) {
  const match = text.match(new RegExp(`${task}:\\s*\\[([^\\]]*)\\]`))
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

function validateMobileNativeProviderBoundaries() {
  const problems = []
  const eligibleStatuses = new Set(['supported', 'globalOnly', 'credentialGated', 'quotaGated', 'transportUnstable'])
  const mobileContract = readText(paths.mobileContract)
  const akshareCapabilities = [...mobileContract.matchAll(/DataApiProviderCapability\(\s*id: '([^']+)',[\s\S]*?provider: FinanceProvider\.akshare,[\s\S]*?status: DataApiCapabilityStatus\.([A-Za-z]+)/g)]
    .map((match) => ({ id: match[1], status: match[2] }))
  const eligibleAkshare = akshareCapabilities.filter((item) => eligibleStatuses.has(item.status))
  for (const item of eligibleAkshare) {
    problems.push(`mobile contract marks non-native AkShare capability as eligible: ${item.id}/${item.status}`)
  }
  if (akshareCapabilities.length === 0) problems.push('mobile contract has no explicit AkShare capability classifications')

  for (const path of [paths.mobileProviderPolicy, paths.finagentProviderPolicy]) {
    const policy = readText(path)
    if (!policy.includes('this.allowAkshareCompatibility = false')) {
      problems.push(`${path} must default allowAkshareCompatibility to false`)
    }
  }
  problems.push(...textContains(paths.mobileProviderBoundaryTest, [
    'mobile AkShare capabilities are explicit non-native gaps',
    'capability.provider != FinanceProvider.akshare',
    'capability.isEligible',
  ]))
  problems.push(...textContains(paths.mobileProviderPolicyTest, [
    'AkShare compatibility is opt-in on mobile',
    'FinanceDataTask.moneyFlow',
    'allowAkshareCompatibility: true',
  ]))
  return problems
}

function validateInterfaceBackedFetchers() {
  const problems = []
  for (const item of interfaceBackedFetchers) {
    const text = readText(item.path)
    if (!text.includes('runDataApiInterfaceRoute')) problems.push(`${item.path} does not call runDataApiInterfaceRoute`)
    if (!text.includes(item.interfaceId)) problems.push(`${item.path} does not mention ${item.interfaceId}`)
    if (!text.includes('readCache:')) problems.push(`${item.path} does not provide a DataStore cache reader`)
    if (!text.includes('cacheMode:')) problems.push(`${item.path} does not pass cache mode/provenance`)
    if (text.includes('runProviderRoute')) problems.push(`${item.path} still calls legacy runProviderRoute`)
  }
  return problems
}

function validateSkillReference(path) {
  const text = readText(path)
  const problems = []
  if (!/Provider parameters? are routing constraints?/.test(text)) {
    problems.push(`${path} does not explain provider routing constraint semantics`)
  }
  if (!text.includes('Cache')) {
    problems.push(`${path} does not expose cache/readback status`)
  }
  for (const line of text.split('\n').filter((item) => item.startsWith('| `'))) {
    const cells = line.split('|').map((cell) => cell.trim())
    const supported = cells[5] ?? ''
    const blocked = cells[6] ?? ''
    if (/(disabled|not-supported|output-only|credential-gated|quota-gated|transport-unstable)/.test(supported)) {
      problems.push(`${path} blocked status appears in supported column: ${line}`)
    }
    if (/(^|, )[^:,]+:(supported|global-only)(,|$)/.test(blocked)) {
      problems.push(`${path} supported status appears in blocked column: ${line}`)
    }
  }
  return problems
}

function validateGeneratedSkillReferences() {
  try {
    const output = execFileSync('node', [
      paths.electronDataApiSkillReferenceScript,
      '--check',
      'true',
      '--jsonOnly',
      'true',
      '--fail-on-problem',
      'true',
    ], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const report = JSON.parse(output)
    return [
      report.checked === 3 ? null : `expected 3 generated skill references, checked ${report.checked}`,
      ...(report.problems ?? []),
    ]
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout).trim() : ''
    const stderr = error?.stderr ? String(error.stderr).trim() : ''
    return [`skill reference freshness check failed${stdout ? `: ${stdout}` : ''}${stderr ? `; ${stderr}` : ''}`]
  }
}

function validateGeneratedOutputOnlySkillReferences() {
  try {
    const output = execFileSync('node', [
      paths.electronOutputOnlySkillReferenceScript,
      '--check',
      'true',
      '--jsonOnly',
      'true',
      '--fail-on-problem',
      'true',
    ], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const report = JSON.parse(output)
    return [
      report.checked === 3 ? null : `expected 3 generated output-only skill references, checked ${report.checked}`,
      ...(report.problems ?? []),
    ]
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout).trim() : ''
    const stderr = error?.stderr ? String(error.stderr).trim() : ''
    return [`output-only skill reference freshness check failed${stdout ? `: ${stdout}` : ''}${stderr ? `; ${stderr}` : ''}`]
  }
}

function validateNoNormalProviderDirectSkillGuidance() {
  const problems = []
  for (const path of allFinanceSkillMarkdownFiles()) {
    if (providerSpecificSkillPath.test(path)) continue
    const text = readText(path)
    for (const match of text.matchAll(directProviderCallPattern)) {
      const index = match.index ?? 0
      const context = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 500))
      if (!explicitProviderContextPattern.test(context)) {
        problems.push(`${path}: ${match[0]}`)
      }
    }
  }
  return problems
}

function validateDisabledTushareSkillGuidance() {
  const problems = []
  for (const path of allFinanceSkillMarkdownFiles()) {
    const text = readText(path)
    for (const api of disabledTushareApis) {
      const standaloneApiPattern = new RegExp(`(^|[^A-Za-z0-9_])${api}([^A-Za-z0-9_]|$)`, 'g')
      for (const match of text.matchAll(standaloneApiPattern)) {
        const index = (match.index ?? 0) + (match[1]?.length ?? 0)
        const context = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 500))
        const mention = text.slice(Math.max(0, index - 160), Math.min(text.length, index + 160))
        if (disabledTushareApiMentionPattern(api).test(mention) && !disabledTushareBlockPattern.test(context)) {
          problems.push(`${path}: ${api}`)
        }
      }
    }
  }
  return problems
}

function disabledTushareApiMentionPattern(api) {
  return new RegExp(`(Tushare|tushare)[^\\n.。]{0,120}\`?${api}\`?|\`?${api}\`?[^\\n.。]{0,120}(Tushare|tushare)`, 'i')
}

function allFinanceSkillMarkdownFiles() {
  const skillFiles = financeSkillRoots
    .flatMap((root) => listFiles(resolve(repoRoot, root)))
    .filter((file) => extname(file) === '.md')
    .map((file) => relative(repoRoot, file))
  return unique([
    ...skillFiles,
    ...financeAgentInstructionFiles.filter((file) => existsSync(resolve(repoRoot, file))),
  ])
}

function validateGeneratedJsonArtifact({ script, artifact, label }) {
  try {
    const output = execFileSync('node', [
      script,
      '--no-write',
      'true',
      '--jsonOnly',
      'true',
      '--fail-on-problem',
      'true',
    ], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const generated = normalizeGeneratedJson(JSON.parse(output))
    const checkedIn = normalizeGeneratedJson(readJson(artifact))
    return stableJson(generated) === stableJson(checkedIn)
      ? []
      : [`${label} artifact is stale against ${script}`]
  } catch (error) {
    const stdout = truncateMessage(error?.stdout ? String(error.stdout).trim() : '')
    const stderr = truncateMessage(error?.stderr ? String(error.stderr).trim() : '')
    return [`${label} freshness check failed${stdout ? `: ${stdout}` : ''}${stderr ? `; ${stderr}` : ''}`]
  }
}

function validateDatastoreMatrixGeneratedArtifact() {
  try {
    const output = execFileSync('node', [
      paths.electronDatastoreMatrixScript,
      '--json',
      'true',
    ], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const generated = normalizeGeneratedJson(JSON.parse(output))
    const checkedIn = normalizeGeneratedJson(readJson(paths.datastoreMatrix))
    return stableJson(generated) === stableJson(checkedIn)
      ? []
      : ['datastore matrix artifact is stale against finance_api_datastore_matrix.mjs']
  } catch (error) {
    const stdout = truncateMessage(error?.stdout ? String(error.stdout).trim() : '')
    const stderr = truncateMessage(error?.stderr ? String(error.stderr).trim() : '')
    return [`datastore matrix freshness check failed${stdout ? `: ${stdout}` : ''}${stderr ? `; ${stderr}` : ''}`]
  }
}

function truncateMessage(value, maxLength = 4000) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`
}

function normalizeGeneratedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeGeneratedJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'generatedAt')
        .map(([key, item]) => [key, normalizeGeneratedJson(item)]),
    )
  }
  return value
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function scanForForbidden({ roots, pattern, allow }) {
  const problems = []
  for (const root of roots) {
    for (const file of listFiles(resolve(repoRoot, root))) {
      if (!['.ts', '.tsx', '.js', '.jsx', '.md'].includes(extname(file))) continue
      const rel = relative(repoRoot, file)
      if (allow.some((allowed) => rel.includes(allowed))) continue
      const text = readFileSync(file, 'utf-8')
      const lines = text.split('\n')
      lines.forEach((line, index) => {
        if (pattern.test(line)) problems.push(`${rel}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  return problems
}

function listFiles(root) {
  if (!existsSync(root)) return []
  const out = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'out' || entry === 'dist') continue
      out.push(...listFiles(full))
    } else {
      out.push(full)
    }
  }
  return out
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Data API Completion Audit')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Objective')
  lines.push('')
  lines.push(report.objective)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- checks: ${report.summary.checks}`)
  lines.push(`- checks passed: ${report.summary.checksPassed}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push(`- provider matrix interfaces: ${report.summary.providerMatrixInterfaces}`)
  lines.push(`- detailed matrix rows: ${report.summary.detailedMatrixRows}`)
  lines.push(`- ungoverned provider/action rows: ${report.summary.ungovernedProviderRows}`)
  lines.push(`- live-probe backlog rows: ${report.summary.liveProbeBacklogRows}`)
  lines.push(`- live-probe backlog with spec: ${report.summary.liveProbeBacklogWithSpec}`)
  lines.push(`- live-probe backlog missing spec: ${report.summary.liveProbeBacklogMissingSpec}`)
  lines.push(`- live-status rows: ${report.summary.liveStatusRows}`)
  lines.push(`- live-status passed: ${report.summary.liveStatusPassed}`)
  lines.push(`- data-health interfaces: ${report.summary.dataHealthInterfaces}`)
  lines.push(`- data-health providers: ${report.summary.dataHealthProviders}`)
  lines.push(`- data-health datasets: ${report.summary.dataHealthDatasets}`)
  lines.push(`- Wind capability rows: ${report.summary.windCapabilityRows}`)
  lines.push(`- Wind implemented credential-gated: ${report.summary.windImplementedCredentialGated}`)
  lines.push(`- Wind explicit not-supported: ${report.summary.windExplicitNotSupported}`)
  lines.push(`- Wind audit problems: ${report.summary.windAuditProblems}`)
  lines.push(`- cross-runtime interfaces: ${report.summary.crossRuntimeInterfaces}`)
  lines.push(`- cross-runtime capabilities: ${report.summary.crossRuntimeCapabilities}`)
  lines.push('')
  lines.push('## Checks')
  lines.push('')
  lines.push('| Check | Status | Evidence / Problems |')
  lines.push('|---|---|---|')
  for (const check of report.checks) {
    const detail = check.problems.length === 0 ? check.description : check.problems.map((item) => escapePipe(item)).join('<br>')
    lines.push(`| \`${check.id}\` | ${check.status} | ${detail} |`)
  }
  lines.push('')
  lines.push('## Problems')
  lines.push('')
  if (report.problems.length === 0) {
    lines.push('- none')
  } else {
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  return `${lines.join('\n')}\n`
}

function escapePipe(value) {
  return String(value).replaceAll('|', '\\|')
}

function unique(values) {
  return [...new Set(values)]
}

function mobileStatusRows(mobileStatus) {
  return (mobileStatus.rows ?? [])
    .filter((row) => row.liveProbe?.id)
    .map((row) => ({
      id: row.liveProbe.id,
      provider: row.provider,
      status: row.liveProbe.status ?? row.status ?? 'unknown',
      validationState: row.liveProbe.validationState ?? row.validationState ?? 'unknown',
      failureClass: row.liveProbe.failureClass ?? row.failureClass ?? '',
    }))
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const item = values[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
    } else {
      parsed[key] = next
      i++
    }
  }
  return parsed
}
