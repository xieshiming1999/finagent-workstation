#!/usr/bin/env node
// Code-derived finance API/action surface inventory.
//
// This script is intentionally source-driven: it reads the current tool schemas,
// ingestion registry, sidecar route declarations, and gotdx handlers, then
// compares them with the live probe matrix. It does not call providers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = join(scriptDir, '..')
const repoRoot = join(appRoot, '..')
const args = parseArgs(process.argv.slice(2))
const output = args.output ?? ''
const failOnMissing = args['fail-on-missing'] === 'true'
const probeResultsPath = args['probe-results'] ?? ''

const files = {
  liveProbe: read('scripts/finance_live_probe_matrix.mjs'),
  dataStoreTool: read('src/agent/tools/data-store-tool.ts'),
  marketDataSchema: read('src/agent/tools/market-data-schema.ts'),
  ingestionRegistry: read('src/agent/data/ingestion/registry.ts'),
  gotdxMain: read('sidecar/gotdx/main.go'),
  sidecarServer: read('sidecar/server.py'),
  dataApiInterfaces: read('src/agent/data/data-api-interfaces.json'),
  mobileMarketDataSchema: read('../app/lib/agent/tools/market_data_tool/market_data_tool_schema.dart'),
  mobileMarketDataActions: read('../app/lib/domain/market/services/market_data_action_service.dart'),
  mobileDataApiContract: read('../app/lib/domain/market/providers/data_api_interface_contract.dart'),
  mobileCensus: read('../app/lib/agent/data_fetcher/finance_schema_census.dart'),
}

const liveProbeRows = parseLiveProbeRows(files.liveProbe)
const probeResultRows = readProbeResults(probeResultsPath)
const baseRows = [
  ...inventoryDataStoreActions(),
  ...inventoryMarketDataActions(),
  ...inventoryIngestionRegistry(),
  ...inventoryGotdxHandlers(),
  ...inventorySidecarRoutes(),
  ...inventoryMobileActions(),
  ...inventoryMobileCensusRows(),
]
const baseCoveredProbeIds = new Set(
  dedupeRows(baseRows)
    .flatMap((row) => matchingProbeIds(row, liveProbeRows)),
)
const rows = [
  ...baseRows,
  ...inventoryProviderCapabilityRows(baseCoveredProbeIds),
]
const coveredProbeIds = new Set(dedupeRows(rows).flatMap((row) => matchingProbeIds(row, liveProbeRows)))
rows.push(...inventoryLiveProbeContractRows(coveredProbeIds))

const deduped = dedupeRows(rows).map((row) => withCoverage(row, liveProbeRows, probeResultRows))
const summary = summarize(deduped)
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'finance_api_surface_inventory',
  config: {
    credentialConfigPath: join(homedir(), '.finagent-workstation', 'config.json'),
    credentialPrecedence: ['cli', 'environment', '~/.finagent-workstation/config.json apiKeys', 'classified-gated'],
    probeResultsPath: probeResultsPath || null,
  },
  summary,
  liveProbeRows,
  rows: deduped,
}

if (output) {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(payload, null, 2), 'utf-8')
} else {
  console.log(JSON.stringify(payload, null, 2))
}

if (failOnMissing && summary.missingLiveProbe > 0) process.exit(1)

function inventoryDataStoreActions() {
  return extractStringArrayAfter(files.dataStoreTool, 'enum:')
    .map((action) => surface({
      runtime: 'finagent_workstation',
      sourceFile: 'finagent_workstation/src/agent/tools/data-store-tool.ts',
      family: 'DataStore',
      provider: providerForDataStoreAction(action),
      endpoint: action,
      action,
      kind: dataStoreActionKind(action),
      schemaStatus: dataStoreSchemaStatus(action),
    }))
}

function inventoryMarketDataActions() {
  return extractStringArrayAfter(files.marketDataSchema, 'enum:')
    .map((action) => surface({
      runtime: 'finagent_workstation',
      sourceFile: 'finagent_workstation/src/agent/tools/market-data-schema.ts',
      family: 'MarketData',
      provider: providerForMarketDataAction(action),
      endpoint: action,
      action,
      kind: marketDataActionKind(action),
      schemaStatus: marketDataSchemaStatus(action),
    }))
}

function inventoryIngestionRegistry() {
  const providers = parseRegistryProviders(files.ingestionRegistry)
  const rows = []
  for (const provider of providers) {
    for (const endpoint of provider.endpoints) {
      rows.push(surface({
        runtime: 'finagent_workstation',
        sourceFile: 'finagent_workstation/src/agent/data/ingestion/registry.ts',
        family: 'ingestion-registry',
        provider: provider.provider,
        endpoint,
        kind: 'registered-provider-endpoint',
        schemaStatus: 'registered-reusable',
        canonicalSchemas: provider.schemas,
        canonicalTables: provider.tables,
      }))
    }
  }
  return rows
}

function inventoryGotdxHandlers() {
  return [...files.gotdxMain.matchAll(/http\.HandleFunc\("([^"]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path !== '/health' && path !== '/help' && path !== '/rate_limit/status')
    .map((path) => {
      const endpoint = path.replace(/^\//, '')
      const canonicalEndpoint = canonicalGotdxEndpoint(endpoint)
      return surface({
        runtime: 'finagent_workstation',
        sourceFile: 'finagent_workstation/sidecar/gotdx/main.go',
        family: 'gotdx-http',
        provider: 'tdx',
        endpoint,
        canonicalEndpoint: canonicalEndpoint === endpoint ? null : canonicalEndpoint,
        kind: path.startsWith('/api/') ? 'backward-compat-alias' : 'finite-provider-endpoint',
        schemaStatus: files.ingestionRegistry.includes(`'${canonicalEndpoint}'`) ? 'registered-reusable' : 'diagnostic-or-output-only',
        sampleParams: sampleParamsForGotdx(path),
      })
    })
}

function inventorySidecarRoutes() {
  return [...files.sidecarServer.matchAll(/@app\.get\("([^"]+)"\)/g)]
    .map((match) => match[1])
    .filter((path) => path !== '/health' && path !== '/help' && path !== '/rate_limit/status')
    .map((path) => {
      const generic = path.includes('{')
      return surface({
        runtime: 'finagent_workstation',
        sourceFile: 'finagent_workstation/sidecar/server.py',
        family: 'python-sidecar',
        provider: sidecarProvider(path),
        endpoint: path.replace(/^\//, ''),
        kind: generic ? 'generic-proxy' : 'finite-sidecar-route',
        schemaStatus: generic ? 'generic-output-only-unbounded' : sidecarSchemaStatus(path),
        sampleParams: sampleParamsForSidecar(path),
      })
    })
}

function inventoryMobileActions() {
  const schemaActions = extractStringArrayAfter(files.mobileMarketDataSchema, "'enum':")
  const serviceActions = [
    ...extractDartConstSet(files.mobileMarketDataActions, '_queryActions'),
    ...extractDartConstSet(files.mobileMarketDataActions, '_marketActions'),
    ...extractDartConstSet(files.mobileMarketDataActions, '_tdxActions'),
    ...extractDartConstSet(files.mobileMarketDataActions, '_backtestActions'),
    ...extractDartConstSet(files.mobileMarketDataActions, '_tushareActions'),
  ]
  return uniqueStrings([...schemaActions, ...serviceActions])
    .map((action) => surface({
      runtime: 'shared_mobile',
      sourceFile: 'app/lib/agent/tools/market_data_tool/market_data_tool_schema.dart',
      family: 'MarketData',
      provider: providerForMarketDataAction(action),
      endpoint: action,
      action,
      kind: marketDataActionKind(action),
      schemaStatus: marketDataSchemaStatus(action),
    }))
}

function inventoryMobileCensusRows() {
  return uniqueStrings([
    ...extractMobileDataApiInterfaceIds(),
    ...extractDartConstListObjectIds(files.mobileCensus, 'mobileOperationalSchemaSurfaces'),
  ])
    .map((match) => surface({
      runtime: 'shared_mobile',
      sourceFile: 'app/lib/agent/data_fetcher/finance_schema_census.dart',
      family: 'mobile-schema-census',
      provider: 'contract',
      endpoint: match,
      kind: 'schema-census-row',
      schemaStatus: 'classified-contract-row',
    }))
}

function extractMobileDataApiInterfaceIds() {
  return [...files.mobileDataApiContract.matchAll(/DataApiInterfaceDefinition\(\s*id:\s*'([^']+)'/g)]
    .map((match) => match[1])
}

function extractDartConstListObjectIds(source, listName) {
  const start = source.indexOf(`${listName} = [`)
  if (start < 0) return []
  const end = source.indexOf('\n];', start)
  const body = source.slice(start, end < 0 ? undefined : end)
  return [...body.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1])
}

function inventoryProviderCapabilityRows(baseCoveredProbeIds) {
  const contract = JSON.parse(files.dataApiInterfaces)
  const probeById = new Map(liveProbeRows.map((probe) => [probe.id, probe]))
  const rows = []
  for (const item of contract.interfaces ?? []) {
    for (const capability of item.capabilities ?? []) {
      if (!capability.probeId || baseCoveredProbeIds.has(capability.probeId)) continue
      const probe = probeById.get(capability.probeId)
      rows.push(surface({
        runtime: 'finagent_workstation',
        sourceFile: 'finagent_workstation/src/agent/data/data-api-interfaces.json',
        family: 'provider-capability',
        provider: normalizeCapabilityProvider(capability.provider),
        endpoint: probe?.family ?? capability.id,
        kind: 'registered-provider-capability',
        schemaStatus: item.persistencePolicy === 'output-only' ? 'registered-output-only' : 'registered-reusable',
        declaredInterfaceId: item.id,
        capabilityId: capability.id,
        canonicalSchemas: item.canonicalSchema ? [item.canonicalSchema] : [],
        canonicalTables: item.dataStoreTables ?? [],
      }))
    }
  }
  return rows
}

function inventoryLiveProbeContractRows(coveredProbeIds) {
  const rows = []
  for (const probe of liveProbeRows) {
    if (coveredProbeIds.has(probe.id)) continue
    const declaredInterfaceId = interfaceForLiveProbe(probe)
    if (!declaredInterfaceId) continue
    rows.push(surface({
      runtime: 'finagent_workstation',
      sourceFile: 'finagent_workstation/scripts/finance_live_probe_matrix.mjs',
      family: 'live-probe-contract',
      provider: probe.provider,
      endpoint: probe.family,
      kind: 'live-probe-contract-row',
      schemaStatus: 'registered-reusable',
      declaredInterfaceId,
      capabilityId: `${probe.provider}.${declaredInterfaceId}.${probe.family}`,
    }))
  }
  return rows
}

function withCoverage(row, probes, probeResults) {
  const liveProbeIds = matchingProbeIds(row, probes)
  const matchedProbeResults = probeResults
    .filter((result) => liveProbeIds.includes(result.id))
    .map((result) => ({
      id: result.id,
      status: result.status ?? 'unknown',
      validationState: result.validationState ?? 'unknown',
      failureClass: result.failureClass ?? null,
      httpStatus: result.httpStatus ?? null,
      parsedCount: result.parsedCount ?? null,
      durationMs: result.durationMs ?? null,
      providerTime: result.providerTime ?? null,
      columns: result.columns ?? [],
      schema: result.schema ?? {},
      error: result.error ?? '',
    }))
  const needsLiveProbe = row.runtime === 'finagent_workstation'
    && ['finite-provider-endpoint', 'finite-sidecar-route', 'registered-provider-endpoint'].includes(row.kind)
    && !['query', 'local-tool', 'fetch-only', 'generic-output-only-unbounded', 'diagnostic-or-output-only', 'discovery-output-only'].includes(row.schemaStatus)
  const coverageStatus = liveProbeIds.length > 0
    ? 'live-probed'
    : needsLiveProbe ? 'missing-live-probe' : 'classified-no-live-probe-required'
  const validationState = validationStateFor(row, liveProbeIds, needsLiveProbe)
  return {
    ...row,
    liveProbeIds,
    coverageStatus,
    validationState,
    apiStatus: apiStatusFor({ coverageStatus, validationState, matchedProbeResults }),
    probeResults: matchedProbeResults,
  }
}

function matchingProbeIds(row, probes) {
  if (row.provider === 'sina' && row.family === 'ingestion-registry' && row.endpoint === 'stock_transactions') {
    return ['sina.direct.stock_transactions']
  }
  if (row.provider === 'tencent' && row.family === 'provider-capability' && row.endpoint === 'kline_daily') {
    return [
      'tencent.direct.stock_daily_kline',
      'tencent.direct.stock_daily_kline_none',
      'tencent.direct.stock_daily_kline_hfq',
    ]
  }
  return probes
    .filter((probe) => probeMatches(row, probe))
    .map((probe) => probe.id)
}

function interfaceForLiveProbe(probe) {
  const provider = String(probe.provider ?? '').toLowerCase()
  const family = String(probe.family ?? '').toLowerCase()
  if (provider === 'sidecar' && family === 'fund_screener') return 'market.screening'
  if (provider === 'wind' && family === 'company_announcements') return 'wind.financial_document'
  if (provider === 'wind' && family === 'fund_info') return 'fund.company_info'
  if (provider === 'wind' && family === 'global_stock_basicinfo') return 'global.company_profile'
  if (provider === 'wind' && family === 'global_stock_events') return 'global.corporate_actions'
  if (provider === 'wind' && family === 'global_stock_fundamentals') return 'global.financial_statements'
  if (provider === 'wind' && family === 'global_stock_holders') return 'global.holders'
  if (provider === 'wind' && family === 'index_quote') return 'index.quote'
  if (provider === 'akshare' && family === 'index_components') return 'index.constituents'
  if (provider === 'tencent' && family === 'kline_daily') return 'stock.daily_kline'
  return null
}

function apiStatusFor({ coverageStatus, validationState, matchedProbeResults }) {
  if (matchedProbeResults.length === 0) {
    return {
      recorded: true,
      status: coverageStatus === 'missing-live-probe' ? 'not-probed' : 'classified-without-live-call',
      validationState,
    }
  }
  const failures = matchedProbeResults.filter((result) => !['passed'].includes(result.status))
  return {
    recorded: true,
    status: failures.length === 0 ? 'all-matched-probes-passed' : 'matched-probes-have-non-pass-status',
    validationState: failures.length === 0 ? 'valid-schema-observed' : failures[0].validationState,
    passed: matchedProbeResults.length - failures.length,
    nonPass: failures.length,
  }
}

function probeMatches(row, probe) {
  const rowEndpoint = canonicalEndpointForRow(row)
  if (row.provider !== probe.provider) return false
  if (rowEndpoint === probe.family) return true
  if (endpointAliases(rowEndpoint).includes(probe.endpoint)) return true
  if (endpointAliases(probe.endpoint).includes(rowEndpoint)) return true
  if (row.family === 'gotdx-http' && (probe.urlPath === `/${row.endpoint}` || probe.urlPath === `/${rowEndpoint}`)) return true
  if (row.family === 'python-sidecar' && probe.urlPath === `/${row.endpoint}`) return true
  if (row.family === 'ingestion-registry' && rowEndpoint === probe.endpoint) return true
  if (row.family === 'provider-capability' && row.endpoint === probe.family) return true
  return false
}

function endpointAliases(endpoint) {
  const aliases = {
    quote: ['quote', 'price'],
    fast_info: ['quote', 'price'],
    kline: ['kline_daily', 'history'],
    kline_advanced: ['kline_daily'],
    index_bars: ['index_kline', 'kline_daily'],
    'ex/kline': ['kline_daily'],
    'ex/kline2': ['kline_daily'],
    'ex/list': ['stock_list'],
    'ex/quote': ['quote'],
    'ex/quotes': ['quote'],
    'ex/categories': ['ex_category'],
    'ex/board_list': ['tdx_block_member'],
    stock_list_range: ['stock_list'],
    history_tick_chart: ['tick_chart'],
    history_transactions: ['transactions'],
    history_orders: ['transactions'],
    company_categories: ['stock_company_info'],
    company_content: ['stock_company_info'],
    sector_ranking: ['sector_rank'],
    sector_cons: ['industry_map'],
    northbound_flow: ['northbound'],
    fund_basic: ['fund_list'],
    trade_cal: ['trade_calendar'],
    'fund/nav': ['fund_nav'],
    stock_zh_a_spot: ['quote'],
    stock_zh_a_spot_em: ['quote', 'stock_list'],
    stock_zh_a_hist: ['kline_daily'],
    stock_zh_index_daily_em: ['index_kline', 'kline_daily'],
    stock_zh_index_spot_em: ['index_quote'],
    stock_hot_rank_em: ['hot_rank'],
    stock_lhb_detail_daily_sina: ['dragon_tiger'],
    stock_transactions: ['transactions'],
    stock_hsgt_hist_em: ['northbound'],
    stock_hsgt_hold_stock_em: ['northbound_holding'],
    stock_individual_fund_flow: ['money_flow'],
    stock_individual_fund_flow_rank: ['money_flow', 'flow_rank'],
    stock_changes_em: ['unusual'],
    stock_zt_pool_em: ['limit_pool', 'continuous_limit'],
    stock_zt_pool_dtgc_em: ['limit_pool'],
    stock_zt_pool_strong_em: ['limit_pool', 'continuous_limit'],
    stock_zt_pool_zbgc_em: ['limit_pool', 'failed_limit'],
    stock_board_industry_name_em: ['sector_rank'],
    stock_board_concept_name_em: ['sector_rank'],
    stock_board_industry_cons_em: ['industry_map'],
    stock_board_concept_cons_em: ['industry_map'],
    fund_open_fund_rank_em: ['fund_list'],
    fund_open_fund_info_em: ['fund_nav'],
    fund_portfolio_hold_em: ['fund_holding'],
    fund_manager_em: ['fund_manager'],
    earnings_dates: ['earnings'],
    dividends: ['corporate_actions'],
    splits: ['corporate_actions'],
    actions: ['corporate_actions'],
    option_chain: ['options'],
  }
  return aliases[endpoint] ?? []
}

function validationStateFor(row, liveProbeIds, needsLiveProbe) {
  if (liveProbeIds.length > 0) return 'validation-probe-defined'
  if (row.schemaStatus === 'generic-output-only-unbounded') return 'generic-proxy-unbounded'
  if (row.schemaStatus.includes('output-only') || row.schemaStatus === 'fetch-only') return 'output-only-by-design'
  if (row.kind === 'query-or-local' || row.schemaStatus === 'query') return 'local-readback-action'
  if (row.kind === 'derived-analysis') return 'derived-local-analysis'
  if (needsLiveProbe) return 'needs-real-api-validation'
  return 'classified-no-runtime-api'
}

function parseLiveProbeRows(text) {
  const rows = []
  const regex = /spec\('([^']+)',\s*([^,]+),\s*'([^']+)',\s*'([^']+)',\s*([^,]+),/g
  for (const match of text.matchAll(regex)) {
    const urlExpr = match[5]
    rows.push({
      id: match[1],
      kindVar: match[2].trim(),
      provider: match[3],
      family: match[4],
      endpoint: match[4],
      urlPath: urlPathFromExpr(urlExpr),
    })
  }
  return rows
}

function readProbeResults(path) {
  if (!path) return []
  const byId = new Map()
  for (const part of path.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!existsSync(part)) throw new Error(`Missing probe results file: ${part}`)
    const parsed = JSON.parse(readFileSync(part, 'utf-8'))
    for (const result of Array.isArray(parsed?.results) ? parsed.results : []) {
      if (result?.id) byId.set(result.id, result)
    }
  }
  return [...byId.values()]
}

function urlPathFromExpr(expr) {
  const templatePath = expr.match(/`\$\{(?:gotdxUrl|sidecarUrl)\}([^`?]*)/)
  if (templatePath) return templatePath[1]
  const direct = expr.match(/'https?:\/\/[^/]+([^'?]*)/)
  return direct?.[1] ?? ''
}

function surface(input) {
  return {
    runtime: input.runtime,
    sourceFile: input.sourceFile,
    family: input.family,
    provider: input.provider,
    endpoint: input.endpoint,
    ...(input.canonicalEndpoint ? { canonicalEndpoint: input.canonicalEndpoint } : {}),
    ...(input.action ? { action: input.action } : {}),
    kind: input.kind,
    schemaStatus: input.schemaStatus,
    ...(input.sampleParams ? { sampleParams: input.sampleParams } : {}),
    ...(input.canonicalSchemas ? { canonicalSchemas: input.canonicalSchemas } : {}),
    ...(input.canonicalTables ? { canonicalTables: input.canonicalTables } : {}),
    ...(input.declaredInterfaceId ? { declaredInterfaceId: input.declaredInterfaceId } : {}),
    ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
  }
}

function canonicalEndpointForRow(row) {
  return String(row.canonicalEndpoint ?? row.endpoint ?? '').trim()
}

function canonicalGotdxEndpoint(endpoint) {
  return String(endpoint ?? '').replace(/^api\//, '')
}

function normalizeCapabilityProvider(provider) {
  const value = String(provider ?? '').toLowerCase()
  if (value === 'yahoo') return 'yfinance'
  return value
}

function parseRegistryProviders(text) {
  const providers = []
  const providerRegex = /provider:\s*'([^']+)'[\s\S]*?endpoints:\s*\[([\s\S]*?)\][\s\S]*?schemas:\s*\[([\s\S]*?)\][\s\S]*?tables:\s*\[([\s\S]*?)\]/g
  for (const match of text.matchAll(providerRegex)) {
    providers.push({
      provider: match[1],
      endpoints: extractStrings(match[2]),
      schemas: extractStrings(match[3]),
      tables: extractStrings(match[4]),
    })
  }
  return providers
}

function extractStringArrayAfter(text, marker) {
  const start = text.indexOf(marker)
  if (start < 0) return []
  const open = text.indexOf('[', start)
  if (open < 0) return []
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++
    if (text[i] === ']') depth--
    if (depth === 0) return extractStrings(text.slice(open + 1, i))
  }
  return []
}

function extractDartConstSet(text, name) {
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`)
  const match = text.match(regex)
  return match ? extractStrings(match[1]) : []
}

function extractStrings(text) {
  return [...text.matchAll(/'([^']+)'|"([^"]+)"/g)].map((match) => match[1] ?? match[2])
}

function providerForDataStoreAction(action) {
  if (['screen_stock', 'screen_fund'].includes(action)) return 'local'
  if (action.includes('wind')) return 'wind'
  if (action.includes('yfinance') || action === 'yfinance' || action === 'yfinance_search' || action === 'global_fundamental_output') return 'yfinance'
  if (action.includes('tdx') || action.startsWith('query_ex') || action === 'tdx') return 'tdx'
  if (action.includes('fund') || action.includes('trade_calendar') || action.includes('fundamental') || action === 'tushare') return 'tushare'
  if (['akshare', 'akshare_search', 'ta', 'ta_search', 'sidecar_status'].includes(action)) return 'akshare'
  if (['query_sector', 'query_industry_map', 'query_northbound', 'query_limit_pool', 'query_unusual', 'query_flow_rank', 'query_chip', 'query_hot_rank', 'query_dragon_tiger'].includes(action)) return 'eastmoney'
  return 'local'
}

function providerForMarketDataAction(action) {
  if (action.startsWith('yahoo') || action === 'price') return 'yfinance'
  if (action.startsWith('tdx') || action.startsWith('ex_') || action.startsWith('query_tdx') || action.startsWith('query_ex') || ['query_tick_chart', 'query_transactions', 'query_volume_profile', 'query_xdxr', 'query_auction', 'query_momentum', 'query_top_board', 'query_tdx_block_member', 'query_company_info'].includes(action)) return 'tdx'
  if (action === 'tushare' || action.includes('fund') || action.includes('trade_calendar') || action.includes('fundamental') || action.includes('money_flow')) return 'tushare'
  if (action.startsWith('query_wind')) return 'wind'
  if (['flow', 'flow_rank', 'sector', 'chip', 'etf', 'earnings', 'limit_up', 'limit_down', 'hot_rank', 'dragon_tiger', 'northbound', 'unusual', 'query_industry_map', 'query_hot_rank', 'query_dragon_tiger', 'query_limit_pool', 'query_northbound', 'query_unusual', 'query_flow_rank', 'query_sector', 'query_chip'].includes(action)) return 'eastmoney'
  if (action === 'scan') return 'tradingview'
  return 'local'
}

function dataStoreActionKind(action) {
  if (action.startsWith('query_') || ['coverage', 'reusable_summary', 'stock_list', 'fund_list', 'search', 'stats', 'fetch_status', 'sidecar_status'].includes(action)) return 'query-or-local'
  if (action === 'backtest') return 'derived-analysis'
  if (['akshare', 'yfinance', 'tdx', 'tushare'].includes(action)) return 'generic-provider-call'
  if (['akshare_search', 'yfinance_search', 'ta_search', 'ta'].includes(action)) return 'generic-proxy-or-discovery'
  if (action === 'fetch') return 'fetch-queue'
  return 'tool-action'
}

function marketDataActionKind(action) {
  if (action.startsWith('query_') || ['coverage', 'reusable_summary', 'sources', 'data_health', 'help'].includes(action)) return 'query-or-local'
  if (action.startsWith('backtest') || action === 'optimize_params') return 'derived-analysis'
  return 'provider-action'
}

function dataStoreSchemaStatus(action) {
  if (action.startsWith('query_') || ['coverage', 'reusable_summary', 'stock_list', 'fund_list', 'search', 'stats', 'fetch_status', 'sidecar_status', 'help'].includes(action)) return 'query'
  if (['akshare_search', 'yfinance_search', 'ta_search'].includes(action)) return 'discovery-output-only'
  if (action === 'ta') return 'derived-output-only'
  if (action === 'backtest') return 'derived-output'
  if (action === 'fetch') return 'fetch-queue'
  if (['akshare', 'yfinance', 'tdx', 'tushare'].includes(action)) return 'generic-call-known-schemas-persist-unknown-output-only'
  return 'tool-output'
}

function marketDataSchemaStatus(action) {
  if (action.startsWith('query_') || ['coverage', 'reusable_summary', 'sources', 'data_health', 'help'].includes(action)) return 'query'
  if (action === 'scan') return 'supported-provider-action'
  if (action.startsWith('backtest') || action === 'optimize_params') return 'derived-output'
  return 'supported-provider-action'
}

function sidecarProvider(path) {
  if (path === '/local_cache/status') return 'sidecar'
  if (path === '/alpha/factors') return 'akshare'
  if (path.startsWith('/yfinance')) return 'yfinance'
  if (path.startsWith('/ta')) return 'ta'
  if (path.includes('fund') || path.includes('quote') || path.includes('kline') || path.includes('index') || path.includes('news') || path.includes('margin') || path.includes('holders') || path.includes('chip') || path.includes('akshare')) return 'akshare'
  return 'sidecar'
}

function sidecarSchemaStatus(path) {
  if (path === '/yfinance' || path === '/ta') return 'discovery-output-only'
  return 'code-used-route'
}

function sampleParamsForGotdx(path) {
  if (path.includes('kline')) return { code: '600519', category: '9', count: '20' }
  if (path.includes('index')) return { code: '399001', category: '9', count: '20' }
  if (path.includes('ex/')) return { code: 'RBL8', category: '30', count: '5' }
  if (path.includes('history')) return { code: '600519', date: compactDate(new Date()), count: '20' }
  if (path.includes('block')) return { filename: 'block_zs.dat' }
  if (path.includes('company_content')) return { code: '600519', filename: '600519.txt', start: '0', length: '1000' }
  if (path.includes('count') || path.includes('list') || path.includes('table') || path.includes('board') || path.includes('server')) return {}
  return { code: '600519' }
}

function sampleParamsForSidecar(path) {
  if (path === '/quote' || path === '/kline' || path === '/margin' || path === '/holders' || path === '/alpha/factors' || path === '/chip') return { code: '600519' }
  if (path === '/fund/nav') return { code: '000001' }
  if (path === '/index/quotes') return { code: '000001,399001,399006' }
  if (path === '/news') return { keyword: '贵州茅台', enrich: 'false' }
  return {}
}

function dedupeRows(rows) {
  const seen = new Map()
  for (const row of rows) {
    const key = `${row.runtime}:${row.family}:${row.provider}:${row.endpoint}`
    if (!seen.has(key)) seen.set(key, row)
  }
  return [...seen.values()]
}

function summarize(rows) {
  const by = (field) => Object.fromEntries([...groupCount(rows, field).entries()].sort())
  return {
    total: rows.length,
    byRuntime: by('runtime'),
    byKind: by('kind'),
    bySchemaStatus: by('schemaStatus'),
    byCoverageStatus: by('coverageStatus'),
    byValidationState: by('validationState'),
    byApiStatus: Object.fromEntries([...groupCount(rows.map((row) => ({ apiStatus: row.apiStatus?.status ?? 'unknown' })), 'apiStatus').entries()].sort()),
    liveProbed: rows.filter((row) => row.coverageStatus === 'live-probed').length,
    missingLiveProbe: rows.filter((row) => row.coverageStatus === 'missing-live-probe').length,
    classifiedNoLiveProbeRequired: rows.filter((row) => row.coverageStatus === 'classified-no-live-probe-required').length,
  }
}

function groupCount(rows, field) {
  const map = new Map()
  for (const row of rows) map.set(row[field], (map.get(row[field]) ?? 0) + 1)
  return map
}

function uniqueStrings(values) {
  return [...new Set(values)].sort()
}

function compactDate(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

function read(relativePath) {
  const fullPath = join(appRoot, relativePath)
  if (!existsSync(fullPath)) throw new Error(`Missing source file: ${relativePath}`)
  return readFileSync(fullPath, 'utf-8')
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('--')) continue
    const key = raw.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) parsed[key] = 'true'
    else {
      parsed[key] = next
      i++
    }
  }
  return parsed
}
