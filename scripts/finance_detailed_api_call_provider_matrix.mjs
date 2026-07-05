#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const appRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))

const contractPath = resolve(appRoot, 'src/agent/data/data-api-interfaces.json')
const mobileContractPath = resolve(repoRoot, 'app/lib/domain/market/providers/data_api_interface_contract.dart')
const inventoryPath = resolve(repoRoot, args.inventory ?? 'reports/integrations/finance_api_surface_inventory_2026_06_17.json')
const liveStatusPath = resolve(repoRoot, args.liveStatus ?? 'reports/integrations/finance_live_status_report_2026_06_18.json')
const mobileStatusPath = resolve(repoRoot, args.mobileStatus ?? 'reports/integrations/finance_mobile_api_status_2026_06_17.json')
const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.md')

const contract = JSON.parse(readFileSync(contractPath, 'utf-8'))
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8'))
const liveStatus = JSON.parse(readFileSync(liveStatusPath, 'utf-8'))
const mobileStatus = JSON.parse(readFileSync(mobileStatusPath, 'utf-8'))
const report = buildReport({ contract, inventory, liveStatus, mobileStatus })

if (args['no-write'] !== 'true') {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Detailed finance API call/provider matrix: ${report.summary.totalRows} rows, ${report.summary.knownSurfaceRows} classified surfaces, ${report.summary.unclassifiedRows} unclassified`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (report.problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildReport({ contract, inventory, liveStatus, mobileStatus }) {
  const mobileContract = readMobileContract()
  const providerColumns = providerColumnsFor({ contract, inventory, mobileContract })
  const contractIndex = indexContract(contract, providerColumns, mobileContract)
  const liveStatusIndex = indexLiveStatus(liveStatus, mobileStatus)
  const rows = inventory.rows.map((row, index) => buildRow({
    row,
    index,
    providerColumns,
    contractIndex,
    liveStatusIndex,
  }))
  const summary = summarize({ rows, providerColumns, inventory, liveStatus, liveStatusIndex })
  const problems = validate({ rows, providerColumns, inventory, liveStatus })
  return {
    generatedAt: inventory.generatedAt ?? contract.version ?? 'unknown',
    source: {
      contract: contractPath,
      inventory: inventoryPath,
      liveStatus: liveStatusPath,
      mobileStatus: mobileStatusPath,
    },
    summary: {
      ...summary,
      problems: problems.length,
    },
    providerColumns,
    rows,
    problems,
  }
}

function indexContract(contract, providerColumns, mobileContract) {
  const interfaces = new Map()
  const capabilitiesByInterface = new Map()
  const interfacesByQueryAction = new Map()
  for (const item of [...contract.interfaces, ...mobileSecondWaveInterfaces(), ...outputOnlyInterfaces()]) {
    if (interfaces.has(item.id)) continue
    interfaces.set(item.id, item)
    for (const action of item.queryActions ?? []) {
      const key = String(action ?? '').trim().toLowerCase()
      if (!key) continue
      const list = interfacesByQueryAction.get(key) ?? []
      list.push(item.id)
      interfacesByQueryAction.set(key, list)
    }
    const cells = Object.fromEntries(providerColumns.map((provider) => [provider, {
      status: 'not-supported',
      capabilityId: null,
      upstreamOrigin: null,
      adapter: null,
      normalizer: null,
      canonicalTable: null,
      probeId: null,
      reason: null,
      marketScope: [],
      source: 'contract-default',
    }]))
    for (const capability of item.capabilities ?? []) {
      cells[capability.provider] = {
        status: capability.status,
        capabilityId: capability.id,
        upstreamOrigin: capability.upstreamOrigin ?? null,
        adapter: capability.adapter ?? null,
        normalizer: capability.normalizer ?? null,
        canonicalTable: capability.canonicalTable ?? null,
        probeId: capability.probeId ?? null,
        reason: capability.reason ?? null,
        marketScope: capability.marketScope ?? [],
        source: 'registered-capability',
      }
    }
    capabilitiesByInterface.set(item.id, cells)
  }
  const mobileCapabilitiesByInterface = new Map()
  for (const item of [...mobileContract.interfaces, ...mobileSecondWaveInterfaces(), ...outputOnlyInterfaces()]) {
    if (mobileCapabilitiesByInterface.has(item.id)) continue
    mobileCapabilitiesByInterface.set(item.id, providerCellsForInterface(item, providerColumns))
  }
  return { interfaces, capabilitiesByInterface, mobileCapabilitiesByInterface, interfacesByQueryAction }
}

function providerCellsForInterface(item, providerColumns) {
  const cells = Object.fromEntries(providerColumns.map((provider) => [provider, {
    status: 'not-supported',
    capabilityId: null,
    upstreamOrigin: null,
    adapter: null,
    normalizer: null,
    canonicalTable: null,
    probeId: null,
    reason: null,
    marketScope: [],
    source: 'contract-default',
  }]))
  for (const capability of item.capabilities ?? []) {
    cells[capability.provider] = {
      status: capability.status,
      capabilityId: capability.id,
      upstreamOrigin: capability.upstreamOrigin ?? null,
      adapter: capability.adapter ?? null,
      normalizer: capability.normalizer ?? null,
      canonicalTable: capability.canonicalTable ?? null,
      probeId: capability.probeId ?? null,
      reason: capability.reason ?? null,
      marketScope: capability.marketScope ?? [],
      source: 'registered-capability',
    }
  }
  return cells
}

function providerColumnsFor({ contract, inventory, mobileContract }) {
  const values = [...contract.providers]
  for (const item of mobileContract.interfaces ?? []) {
    for (const capability of item.capabilities ?? []) {
      const provider = normalizeMobileProvider(capability.provider)
      if (provider && !values.includes(provider)) values.push(provider)
    }
  }
  for (const row of inventory.rows ?? []) {
    const provider = normalizeProvider(row.provider)
    if (provider && !values.includes(provider)) values.push(provider)
  }
  return values
}

function indexLiveStatus(liveStatus, mobileStatus) {
  const byProbeId = new Map()
  const byMobileRuntimeAction = new Map()
  for (const item of [...(liveStatus.passedApis ?? []), ...(liveStatus.failures ?? [])]) {
    if (item?.id) byProbeId.set(item.id, item)
  }
  for (const row of mobileStatus.rows ?? []) {
    const liveProbe = row.liveProbe
    if (!liveProbe?.id) continue
    const item = normalizeMobileLiveStatusRow(row)
    byProbeId.set(item.id, item)
    for (const key of mobileRuntimeActionKeys(row)) byMobileRuntimeAction.set(key, item)
  }
  return {
    byProbeId,
    byMobileRuntimeAction,
    total: byProbeId.size,
  }
}

function normalizeMobileLiveStatusRow(row) {
  const liveProbe = row.liveProbe
  return {
    id: liveProbe.id,
    provider: row.provider,
    family: row.action ?? row.endpoint,
    kind: 'shared-mobile',
    runtime: row.runtime,
    status: liveProbe.status ?? row.status ?? 'unknown',
    validationState: liveProbe.validationState ?? row.validationState ?? 'unknown',
    failureClass: liveProbe.failureClass ?? row.failureClass ?? '',
    httpStatus: liveProbe.httpStatus ?? null,
    parsedCount: liveProbe.rowCount ?? liveProbe.parsedCount ?? null,
    durationMs: liveProbe.durationMs ?? null,
    providerTime: liveProbe.fetchedAt ?? null,
    columns: liveProbe.columns ?? [],
    schema: liveProbe.firstRowSchema ?? {},
    error: liveProbe.error ?? '',
    params: liveProbe.params ?? {},
  }
}

function mobileRuntimeActionKeys(row) {
  const provider = normalizeProvider(row.provider) ?? String(row.provider ?? '')
  const action = String(row.action ?? row.endpoint ?? '').trim().toLowerCase()
  const endpoint = String(row.endpoint ?? row.action ?? '').trim().toLowerCase()
  const keys = []
  for (const value of unique([action, endpoint].filter(Boolean))) {
    keys.push(mobileRuntimeActionKey({ action: value, provider }))
    for (const alias of providerProbeAliasesForEvidence(provider)) {
      keys.push(mobileRuntimeActionKey({ action: value, provider: alias }))
    }
  }
  return unique(keys)
}

function mobileRuntimeActionKey({ action, provider }) {
  return `shared_mobile:${provider}:${action}`
}

function buildRow({ row, index, providerColumns, contractIndex, liveStatusIndex }) {
  const interfaceCandidates = unique([
    ...exactInterfaceCandidates(row, contractIndex),
    ...queryActionInterfaceCandidates(row, contractIndex),
    ...inferInterfaceCandidates(row),
  ]).filter((id) => contractIndex.interfaces.has(id))
  const syntheticProviderSurface = interfaceCandidates.length === 0 ? syntheticProviderSurfaceId(row) : null
  const interfaceId = interfaceCandidates[0] ?? syntheticProviderSurface
  const interfaceDef = interfaceId ? contractIndex.interfaces.get(interfaceId) : null
  const surfaceId = interfaceId ?? localSurfaceId(row)
  const providerSupport = interfaceId
    ? interfaceDef
      ? cloneProviderCells(providerCellsForRowRuntime(row, interfaceId, contractIndex))
      : syntheticProviderCells(row, providerColumns)
    : unmappedProviderCells(row, providerColumns)
  const normalizedProvider = normalizeProvider(row.provider)
  const liveStatusEvidence = summarizeLiveStatusEvidence(row, liveStatusIndex)
  const probeSummary = summarizeProbeResults(row, liveStatusEvidence)
  const evidence = classifyEvidence({ row, normalizedProvider, providerSupport, liveStatusEvidence, liveStatusIndex })
  const interfaceCoverageStatus = interfaceDef ? interfaceCoverageStatusForInterface(interfaceDef) : syntheticProviderSurface ? syntheticSurfaceCoverageStatus(syntheticProviderSurface) : classifyUnmappedInterface(row)
  const interfaceSource = interfaceDef ? interfaceSourceForInterface(interfaceDef) : syntheticProviderSurface ? 'inventory-derived-provider-surface' : surfaceId ? 'classified-non-provider-surface' : null
  const persistenceStatus = classifyPersistenceStatus({ interfaceDef, interfaceCoverageStatus, row })
  const readbackStatus = classifyReadbackStatus({ interfaceDef, interfaceCoverageStatus, row })
  const runtimeStatus = classifyRuntimeStatus(row, liveStatusEvidence)
  const liveProbeRequirement = classifyLiveProbeRequirement({ row, interfaceCoverageStatus, runtimeStatus, liveStatusEvidence, evidence })
  const outputOnlyGovernance = interfaceDef?.persistencePolicy === 'output-only'
    ? outputOnlyGovernanceFor(interfaceDef)
    : null
  const localSurfaceGovernance = !interfaceDef && !outputOnlyGovernance
    ? localSurfaceGovernanceFor(interfaceCoverageStatus)
    : null
  return {
    rowId: `api-call-${String(index + 1).padStart(3, '0')}`,
    runtime: row.runtime,
    sourceFile: row.sourceFile,
    family: row.family,
    provider: row.provider,
    normalizedProvider,
    endpoint: row.endpoint,
    canonicalEndpoint: row.canonicalEndpoint ?? null,
    action: row.action,
    kind: row.kind,
    schemaStatus: row.schemaStatus,
    coverageStatus: row.coverageStatus,
    validationState: row.validationState,
    apiStatus: row.apiStatus ?? null,
    liveProbeIds: row.liveProbeIds ?? [],
    liveStatusEvidence,
    probeSummary,
    evidenceStatus: evidence.status,
    evidenceReason: evidence.reason,
    evidenceProbeIds: evidence.probeIds,
    runtimeStatus,
    liveProbeRequirement,
    interfaceId,
    surfaceId,
    interfaceCandidates,
    interfaceCoverageStatus,
    interfaceSource,
    interfaceGovernance: classifyInterfaceGovernance(interfaceCoverageStatus),
    outputOnlyCategory: outputOnlyGovernance?.category ?? null,
    outputOnlyReason: outputOnlyGovernance?.reason ?? null,
    surfaceCategory: localSurfaceGovernance?.category ?? null,
    surfaceReason: localSurfaceGovernance?.reason ?? null,
    persistenceStatus,
    readbackStatus,
    governanceAction: classifyGovernanceAction({
      row,
      interfaceDef,
      interfaceCoverageStatus,
      persistenceStatus,
      readbackStatus,
      runtimeStatus,
      liveProbeRequirement,
    }),
    canonicalSchema: interfaceDef?.canonicalSchema ?? null,
    dataStoreTables: interfaceDef?.dataStoreTables ?? [],
    queryActions: interfaceDef?.queryActions ?? [],
    freshnessPolicy: interfaceDef?.freshnessPolicy ?? null,
    providerSupport,
  }
}

function providerCellsForRowRuntime(row, interfaceId, contractIndex) {
  if (row.runtime === 'shared_mobile' && contractIndex.mobileCapabilitiesByInterface.has(interfaceId)) {
    return contractIndex.mobileCapabilitiesByInterface.get(interfaceId)
  }
  return contractIndex.capabilitiesByInterface.get(interfaceId)
}

function exactInterfaceCandidates(row, contractIndex) {
  const values = [row.declaredInterfaceId, row.canonicalEndpoint, row.endpoint, row.action]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  return values.filter((value) => contractIndex.interfaces.has(value))
}

function queryActionInterfaceCandidates(row, contractIndex) {
  if (row.kind !== 'query-or-local') return []
  const endpoint = String(row.canonicalEndpoint ?? row.endpoint ?? row.action ?? '').trim().toLowerCase()
  if (!endpoint) return []
  return contractIndex.interfacesByQueryAction.get(endpoint) ?? []
}

function cloneProviderCells(cells) {
  return Object.fromEntries(Object.entries(cells).map(([provider, cell]) => [provider, { ...cell, marketScope: [...(cell.marketScope ?? [])] }]))
}

function unmappedProviderCells(row, providerColumns) {
  const cells = Object.fromEntries(providerColumns.map((provider) => [provider, {
    status: 'not-supported',
    capabilityId: null,
    upstreamOrigin: null,
    adapter: null,
    normalizer: null,
    canonicalTable: null,
    probeId: null,
    reason: 'No data API interface is registered for this inventory row.',
    marketScope: [],
    source: 'unmapped-row',
  }]))
  const provider = normalizeProvider(row.provider)
  if (provider && cells[provider]) {
    cells[provider] = {
      ...cells[provider],
      status: classifyUnmappedProviderStatus(row),
      reason: rowReason(row),
      source: 'inventory-row',
    }
  }
  return cells
}

function syntheticProviderCells(row, providerColumns) {
  const cells = Object.fromEntries(providerColumns.map((provider) => [provider, {
    status: 'not-supported',
    capabilityId: null,
    upstreamOrigin: null,
    adapter: null,
    normalizer: null,
    canonicalTable: null,
    probeId: null,
    reason: 'Provider does not expose this specific API surface in the current inventory.',
    marketScope: [],
    source: 'provider-surface-default',
  }]))
  const provider = normalizeProvider(row.provider)
  if (provider && cells[provider]) {
    cells[provider] = {
      ...cells[provider],
      status: classifyUnmappedProviderStatus(row),
      capabilityId: syntheticCapabilityId(row),
      probeId: row.liveProbeIds?.[0] ?? null,
      reason: rowReason(row),
      source: 'inventory-derived-provider-surface',
    }
  }
  return cells
}

function inferInterfaceCandidates(row) {
  if (row.declaredInterfaceId) return [row.declaredInterfaceId]
  const text = [
    row.runtime,
    row.family,
    row.provider,
    row.canonicalEndpoint,
    row.endpoint,
    row.action,
    row.kind,
    row.schemaStatus,
    row.validationState,
    row.sourceFile,
  ].filter(Boolean).join(' ').toLowerCase()
  const endpoint = String(row.canonicalEndpoint ?? row.endpoint ?? row.action ?? '').toLowerCase()
  const candidates = []
  const add = (...ids) => {
    for (const id of ids) if (!candidates.includes(id)) candidates.push(id)
  }

  if (endpoint === 'sina_classification_members_batch') add('market.classification_members')
  if (endpoint === 'sina_esg_rating_collection') add('stock.esg_rating_collection')
  if (endpoint === 'sina_fund_dividend_factor') add('fund.dividend_factor')
  if (endpoint === 'finance_doctor') add('data.health')
  if (endpoint === 'holders' && normalizeProvider(row.provider) === 'akshare') add('stock.shareholders')
  if (endpoint === 'query_stock_shareholders' || endpoint === 'stock_shareholders' || endpoint === 'stock_equity_holders') add('stock.shareholders')
  if (endpoint === 'insider_transactions' || endpoint.includes('insider')) add('global.insider_transactions')
  if (endpoint === 'earnings_history') add('global.earnings_history')
  if (['earnings_dates', 'earnings_history'].includes(endpoint)) add('global.earnings_calendar')
  if (endpoint === 'eps_revisions') add('global.eps_revisions')
  if (endpoint === 'eps_trend') add('global.eps_trend')
  if (['earnings_estimate', 'eps_revisions', 'eps_trend'].includes(endpoint)) add('global.earnings_estimates')
  if (['quarterly_financials', 'quarterly_income_stmt', 'quarterly_balance_sheet', 'quarterly_balancesheet', 'quarterly_cash_flow', 'quarterly_cashflow'].includes(endpoint)) add('global.quarterly_financial_statements')
  if (endpoint === 'upgrades_downgrades') add('global.upgrade_downgrade_events')
  if (['earnings_dates', 'earnings_estimate', 'earnings_history', 'eps_revisions', 'eps_trend'].includes(endpoint)) add('global.financial_statements')
  if (endpoint === 'global_income_statement') add('global.income_statement')
  if (endpoint === 'global_cash_flow') add('global.cash_flow')
  if (endpoint === 'global_quarterly_income_statement') add('global.quarterly_income_statement')
  if (endpoint === 'global_quarterly_cash_flow') add('global.quarterly_cash_flow')
  if (endpoint === 'global_capital_gains') add('global.capital_gains')
  if (endpoint === 'bond_market_data') add('bond.market_data')
  if (endpoint === 'bond_profile') add('bond.profile')
  if (endpoint === 'index_constituents') add('index.constituents')
  if (endpoint === 'index_profile') add('index.profile')
  if (endpoint === 'option_daily_kline') add('option.daily_kline')
  if (endpoint === 'runtime_probe') add('data.runtime_probe')
  if (endpoint === 'stats') add('data.store_stats')
  if (endpoint === 'data_feeds') add('data.feed_status')
  if (endpoint === 'stock_risk_metrics') add('stock.risk_metrics')
  if (endpoint === 'earnings' && normalizeProvider(row.provider) === 'eastmoney') add('stock.daily_valuation')
  if (endpoint.includes('tick_chart') || endpoint === 'tdx_tick_chart' || endpoint === 'tdx_history_tick') add('stock.tick_chart_intraday')
  if (endpoint.includes('transaction') || endpoint === 'tdx_transactions' || endpoint === 'tdx_history_trans') add('stock.transactions')
  if (endpoint.includes('volume_profile') || endpoint === 'tdx_volume_profile') add('stock.volume_profile')
  if (endpoint.includes('xdxr') || endpoint === 'tdx_xdxr') add('stock.xdxr_events')
  if (endpoint.includes('auction') || endpoint === 'tdx_auction') add('stock.auction_snapshot')
  if (endpoint.includes('company_info') || endpoint === 'tdx_company_info') add('stock.company_info')
  if (endpoint.includes('tdx_block') || endpoint === 'block') add('market.tdx_block_member')
  if (endpoint.includes('top_board') || endpoint === 'tdx_top_board') add('market.tdx_top_board')
  if (endpoint.includes('momentum') || endpoint === 'tdx_momentum') add('index.momentum')
  if (['mac/board_list', 'stock_board_industry_name_em', 'stock_board_concept_name_em'].includes(endpoint)) add('market.board_ranking')
  if (['mac/board_members', 'mac/board_members_quotes', 'stock_board_industry_cons_em', 'stock_board_concept_cons_em'].includes(endpoint)) add('market.board_members')
  if (endpoint === 'options') add('option.expiry_calendar', 'global.options_chain')
  if (endpoint === 'option_chain') add('option.contract_list', 'option.quote', 'option.open_interest', 'option.implied_volatility', 'option.chain_snapshot', 'global.options_chain')
  if (endpoint === 'yahoo_options') add('option.chain_snapshot', 'option.contract_list', 'option.quote', 'option.open_interest', 'option.implied_volatility', 'option.expiry_calendar', 'global.options_chain')
  if (endpoint === 'yahoo_actions' || endpoint === 'actions' || endpoint === 'dividends' || endpoint === 'splits') add('global.corporate_actions')
  if (endpoint === 'yahoo_news' || (endpoint === 'news' && normalizeProvider(row.provider) === 'yahoo')) add('global.finance_news')
  if (endpoint === 'query_wind_document' || endpoint === 'financial_docs_news' || endpoint.includes('financial_docs')) add('wind.financial_document')
  if (endpoint === 'yahoo_earnings' || (endpoint === 'earnings' && normalizeProvider(row.provider) === 'yahoo')) add('global.company_profile')
  if (endpoint.includes('holder') && !candidates.includes('stock.shareholders') && !candidates.includes('fund.investor_holders')) add('global.holders')
  if (endpoint.includes('recommendation') || endpoint.includes('upgrade')) add('global.recommendations')
  if (endpoint.includes('financial') || endpoint.includes('balance') || endpoint.includes('cashflow') || endpoint.includes('income_stmt') || ['cash_flow', 'quarterly_cash_flow', 'eps_revisions', 'eps_trend'].includes(endpoint)) add('global.financial_statements')
  if (endpoint === 'capital_gains') add('global.corporate_actions')
  if (endpoint === 'global_fundamental_output') add('global.financial_statements')
  if (endpoint === 'info' || endpoint === 'get_info') add('global.company_profile')
  if (['query_quote', 'quote', 'quotes', 'quotes_list', 'tdx_quotes_list', 'price', 'fast_info', 'yahoo', 'ex/quote', 'ex/quotes', 'ex/quotes_list', 'ex_quote', 'mac/quotes', 'stock_zh_a_spot', 'stock_zh_a_spot_em', 'stock_zh_index_spot_em', 'stock_hk_spot_em', 'stock_us_spot_em'].includes(endpoint)) add('stock.quote', 'index.quote', 'fund.etf_quote')
  if (['query_kline', 'kline', 'kline_daily', 'kline_advanced', 'history', 'yahoo_history', 'daily', 'weekly', 'monthly', 'ex/kline', 'ex/kline2', 'ex_kline', 'mac/bars', 'stock_zh_a_hist', 'stock_zh_index_daily_em'].includes(endpoint)) add('stock.daily_kline')
  if (endpoint.includes('index') && (endpoint.includes('quote') || endpoint === 'index_info' || endpoint === 'tdx_index_info')) add('index.quote')
  if (endpoint.includes('index') && (endpoint.includes('kline') || endpoint.includes('daily') || endpoint.includes('bars'))) add('index.daily_kline')
  if (endpoint.includes('index_components') || endpoint.includes('index_stock_cons') || endpoint === 'query_index_constituents') add('index.constituents')
  if (endpoint.includes('stock_list') || endpoint === 'stock_basic' || endpoint === 'stock_list' || endpoint === 'ex_list' || endpoint === 'ex/list' || endpoint.includes('identity')) add('stock.identity_list')
  if (endpoint.includes('flow_rank') || endpoint === 'query_flow_rank') add('market.flow_rank')
  if (endpoint.includes('money_flow') || endpoint === 'flow' || endpoint.includes('single_flow') || endpoint === 'moneyflow' || endpoint === 'stock_individual_fund_flow') add('stock.money_flow')
  if (endpoint.includes('daily_basic') || endpoint.includes('fundamental') || endpoint.includes('valuation') || endpoint.includes('earnings') || endpoint.includes('tdx_finance') || endpoint.includes('financial_analysis')) add('stock.daily_valuation')
  if (['finance', 'company_info', 'company_content', 'company_categories'].includes(endpoint)) add('stock.company_info')
  if (endpoint.includes('chip') || endpoint === 'query_chip') add('stock.chip_distribution')
  if (endpoint.includes('fund_list') || endpoint === 'fund_basic' || endpoint.includes('fund_rank')) add('fund.identity_list')
  if (endpoint.includes('fund_performance') || endpoint.includes('fund_rank')) add('fund.performance_metrics')
  if (endpoint.includes('fund_nav') || endpoint === 'fund/nav' || endpoint === 'fund_open_fund_info_em') add('fund.nav_history')
  if (endpoint.includes('fund_holding') || endpoint.includes('portfolio_hold')) add('fund.holding')
  if (endpoint.includes('fund_manager')) add('fund.manager')
  if (endpoint.includes('etf')) add('fund.etf_quote')
  if (endpoint === 'listed_fund_quote' || endpoint === 'query_listed_fund_quote') add('fund.listed_fund_quote')
  if (endpoint.includes('sector') || endpoint.includes('industry') || endpoint.includes('board')) add('market.sector_ranking')
  if (endpoint.includes('limit') || endpoint.includes('zt_pool') || endpoint === 'limit_up' || endpoint === 'limit_down') add('market.limit_pool')
  if (endpoint.includes('northbound') || endpoint.includes('hsgt')) add('market.northbound_flow')
  if (endpoint.includes('hot_rank') || endpoint === 'query_hot_rank') add('market.hot_rank')
  if (endpoint.includes('dragon_tiger') || endpoint === 'query_dragon_tiger' || endpoint === 'stock_lhb_detail_daily_sina') add('market.dragon_tiger')
  if (endpoint.includes('unusual') || endpoint === 'query_unusual' || endpoint === 'stock_changes_em') add('market.unusual_activity')
  if (endpoint === 'stock_individual_fund_flow_rank') add('market.flow_rank')
  if (endpoint === 'history_orders') add('stock.transactions')
  if (endpoint.includes('trade_calendar') || endpoint.includes('trade_cal') || endpoint === 'calendar') add('calendar.trade_days')
  if (endpoint.includes('news') || text.includes('finance_news')) add('news.finance_feed')
  if (text.includes('query_wind_document') || text.includes('wind_document')) add('wind.financial_document')
  if (endpoint.includes('economic') || text.includes('economic_series')) add('wind.economic_series')
  if (endpoint.includes('analytics') || text.includes('analytics_result')) add('wind.analytics_result')
  if (['provider_discovery', 'akshare_search', 'yfinance_search', 'ta_search'].includes(endpoint)) add('provider.discovery')
  if (['provider_diagnostic', 'akshare', 'yfinance', 'tdx', 'tushare'].includes(endpoint) || endpoint.includes('akshare/{func_name}') || endpoint.includes('yfinance/{action}') || endpoint.includes('ta/{indicator}') || endpoint.includes('akshare_func_name') || endpoint.includes('yfinance_action') || endpoint.includes('ta_indicator')) add('provider.diagnostic')
  if (['provider_status', 'sidecar_status', 'local_cache/status'].includes(endpoint)) add('provider.status')
  if (endpoint === 'data_health' || text.includes('data_health')) add('data.health')
  if (endpoint === 'fetch_status' || text.includes('fetch_status')) add('provider.fetch_task_queue')
  if (endpoint === 'provider_coverage' || endpoint.includes('count') || endpoint.includes('sampling')) add('provider.coverage')
  if (endpoint === 'provider_table_metadata' || endpoint.includes('ex_categories') || endpoint.includes('ex_table') || endpoint.includes('ex/categories') || endpoint.includes('ex/table') || endpoint.includes('server_info') || endpoint.includes('list_extra') || endpoint === 'index/list') add('provider.table_metadata')
  if (['technical_indicator', 'ta'].includes(endpoint)) add('technical.indicator_series')
  if (endpoint === 'margin' || endpoint === 'margin_trading') add('market.margin_trading')
  if (endpoint === 'alpha/factors' || endpoint === 'alpha_factors') add('stock.alpha_factors')
  if (endpoint === 'scan' || endpoint.includes('tradingview') || endpoint.includes('screen_fund') || endpoint.includes('screen_stock') || endpoint.includes('screener')) add('market.screening')

  if (text.includes('query_fundamental')) add('stock.daily_valuation')
  if (text.includes('query_fund_nav')) add('fund.nav_history')
  if (text.includes('query_fund_list')) add('fund.identity_list')
  if (text.includes('query_fund_performance')) add('fund.performance_metrics')
  if (text.includes('query_index_constituents')) add('index.constituents')
  if (text.includes('query_trade_calendar')) add('calendar.trade_days')
  if (text.includes('query_sector')) add('market.sector_ranking')
  if (text.includes('query_limit_pool')) add('market.limit_pool')
  if (text.includes('query_northbound')) add('market.northbound_flow')
  if (text.includes('query_chip')) add('stock.chip_distribution')
  if (text.includes('query_hot_rank')) add('market.hot_rank')
  if (text.includes('query_dragon_tiger')) add('market.dragon_tiger')
  if (text.includes('query_unusual')) add('market.unusual_activity')
  if (text.includes('query_flow_rank')) add('market.flow_rank')
  if (text.includes('query_fund_holding')) add('fund.holding')
  if (text.includes('query_fund_manager')) add('fund.manager')
  if (text.includes('query_stock_shareholders')) add('stock.shareholders')
  if (text.includes('query_wind_economic')) add('wind.economic_series')
  if (text.includes('query_wind_analytics')) add('wind.analytics_result')
  if (text.includes('query_tick_chart')) add('stock.tick_chart_intraday')
  if (text.includes('query_transactions')) add('stock.transactions')
  if (text.includes('query_volume_profile')) add('stock.volume_profile')
  if (text.includes('query_xdxr')) add('stock.xdxr_events')
  if (text.includes('query_auction')) add('stock.auction_snapshot')
  if (text.includes('query_company_info')) add('stock.company_info')
  if (text.includes('query_tdx_block_member')) add('market.tdx_block_member')
  if (text.includes('query_top_board')) add('market.tdx_top_board')
  if (text.includes('query_momentum')) add('index.momentum')
  if (text.includes('query_technical_indicator')) add('technical.indicator_series')
  if (text.includes('query_yfinance')) {
    if (text.includes('profile')) add('global.company_profile')
    if (text.includes('statements')) add('global.financial_statements')
    if (text.includes('recommendations')) add('global.recommendations')
    if (text.includes('holders')) add('global.holders')
    if (text.includes('insiders')) add('global.insider_transactions')
    if (text.includes('options')) add('option.chain_snapshot', 'option.contract_list', 'option.quote', 'option.open_interest', 'option.implied_volatility', 'option.expiry_calendar', 'global.options_chain')
    if (text.includes('actions')) add('global.corporate_actions')
  }

  return candidates
}

function interfaceCoverageStatusForInterface(interfaceDef) {
  return interfaceDef.persistencePolicy === 'output-only'
    ? 'normalized-output-only-interface'
    : 'mapped-to-data-api-interface'
}

function syntheticSurfaceCoverageStatus(surfaceId) {
  return String(surfaceId).startsWith('diagnostic.')
    ? 'output-only-or-diagnostic'
    : 'known-provider-api-surface'
}

function interfaceSourceForInterface(interfaceDef) {
  return interfaceDef.persistencePolicy === 'output-only'
    ? 'registered-output-only-interface'
    : 'registered-data-api-interface'
}

function mobileSecondWaveInterfaces() {
  const tdxCapability = (interfaceId, table, adapter, normalizer) => ({
    id: `tdx.${interfaceId}`,
    provider: 'tdx',
    status: 'supported',
    adapter,
    normalizer,
    canonicalTable: table,
    priority: 1,
  })
  const yahooCapability = (interfaceId, table, adapter, normalizer) => ({
    id: `yfinance.${interfaceId}`,
    provider: 'yahoo',
    status: 'global-only',
    adapter,
    normalizer,
    canonicalTable: table,
    priority: 1,
  })
  const tradingviewCapability = (interfaceId, table, adapter, normalizer) => ({
    id: `tradingview.${interfaceId}`,
    provider: 'tradingview',
    status: 'supported',
    adapter,
    normalizer,
    canonicalTable: table,
    priority: 1,
  })
  return [
    mobileInterface('stock.tick_chart_intraday', 'tick_chart_intraday', ['tick_chart_intraday'], ['query_tick_chart'], [tdxCapability('stock.tick_chart_intraday', 'tick_chart_intraday', 'readTickChart/readHistoryTick', 'saveTickChart')]),
    mobileInterface('stock.transactions', 'transactions', ['transactions'], ['query_transactions'], [tdxCapability('stock.transactions', 'transactions', 'readTransactions/readHistoryTransactions', 'saveTransactions')]),
    mobileInterface('stock.volume_profile', 'volume_profile', ['volume_profile'], ['query_volume_profile'], [tdxCapability('stock.volume_profile', 'volume_profile', 'readVolumeProfile', 'saveVolumeProfile')]),
    mobileInterface('stock.xdxr_events', 'xdxr_event', ['xdxr_event'], ['query_xdxr'], [tdxCapability('stock.xdxr_events', 'xdxr_event', 'readXdxr', 'saveXdxrEvents')]),
    mobileInterface('stock.auction_snapshot', 'auction_snapshot', ['auction_snapshot'], ['query_auction'], [tdxCapability('stock.auction_snapshot', 'auction_snapshot', 'readAuction', 'saveAuction')]),
    mobileInterface('stock.company_info', 'stock_company_info', ['stock_company_info'], ['query_stock_company_info', 'query_company_info'], [
      tdxCapability('stock.company_info', 'stock_company_info', 'readCompanyCategories/readCompanyContent/readFinance', 'saveCompanyInfo'),
      {
        id: 'eastmoney.stock.company_info',
        provider: 'eastmoneyDirect',
        status: 'supported',
        adapter: 'EastMoney PC_HSF10 CompanySurveyAjax',
        normalizer: 'getStockCompanyInfo',
        canonicalTable: 'stock_company_info',
        priority: 2,
      },
    ]),
    mobileInterface('stock.shareholders', 'stock_shareholder', ['stock_shareholder'], ['query_stock_shareholders'], [{
      id: 'akshare.stock.shareholders',
      provider: 'akshare',
      status: 'not-supported',
      reason: 'AkShare shareholder ingestion is currently sidecar-backed in FinAgent Workstation.',
    }, {
      id: 'wind.stock.shareholders',
      provider: 'wind',
      status: 'not-supported',
      adapter: 'WindMcp stock_data.get_stock_equity_holders',
      reason: 'Requires a dedicated Wind stock-shareholder normalizer.',
    }]),
    mobileInterface('market.tdx_block_member', 'tdx_block_member', ['tdx_block_member'], ['query_tdx_block_member'], [tdxCapability('market.tdx_block_member', 'tdx_block_member', 'readBlockMembers', 'saveTdxBlockMembers')]),
    mobileInterface('market.tdx_top_board', 'tdx_top_board', ['tdx_top_board'], ['query_top_board'], [tdxCapability('market.tdx_top_board', 'tdx_top_board', 'readTopBoard', 'saveTopBoard')]),
    mobileInterface('index.momentum', 'tdx_index_momentum', ['tdx_index_momentum'], ['query_momentum'], [tdxCapability('index.momentum', 'tdx_index_momentum', 'readMomentum', 'saveIndexMomentum')]),
    mobileInterface('global.company_profile', 'yfinance_profile_fields', ['yfinance_profile_fields'], ['query_yfinance'], [yahooCapability('global.company_profile', 'yfinance_profile_fields', 'Yahoo quoteSummary profile modules', 'saveYfinanceProfileFields')]),
    mobileInterface('global.financial_statements', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.financial_statements', 'yfinance_statement_items', 'Yahoo quoteSummary statement modules', 'saveYfinanceStatementItems')]),
    mobileInterface('global.earnings_calendar', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.earnings_calendar', 'yfinance_statement_items', 'Yahoo earnings_dates / earnings_history', 'saveYfinanceStatementItems')]),
    mobileInterface('global.earnings_history', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.earnings_history', 'yfinance_statement_items', 'Yahoo earnings_history', 'saveYfinanceStatementItems')]),
    mobileInterface('global.earnings_estimates', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.earnings_estimates', 'yfinance_statement_items', 'Yahoo earnings_estimate / eps_revisions / eps_trend', 'saveYfinanceStatementItems')]),
    mobileInterface('global.eps_revisions', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.eps_revisions', 'yfinance_statement_items', 'Yahoo eps_revisions', 'saveYfinanceStatementItems')]),
    mobileInterface('global.eps_trend', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.eps_trend', 'yfinance_statement_items', 'Yahoo eps_trend', 'saveYfinanceStatementItems')]),
    mobileInterface('global.quarterly_financial_statements', 'yfinance_statement_items', ['yfinance_statement_items'], ['query_yfinance'], [yahooCapability('global.quarterly_financial_statements', 'yfinance_statement_items', 'Yahoo quarterly statement modules', 'saveYfinanceStatementItems')]),
    mobileInterface('global.recommendations', 'yfinance_recommendations', ['yfinance_recommendations'], ['query_yfinance'], [yahooCapability('global.recommendations', 'yfinance_recommendations', 'Yahoo quoteSummary recommendationTrend', 'saveYfinanceRecommendations')]),
    mobileInterface('global.holders', 'yfinance_holders', ['yfinance_holders'], ['query_yfinance'], [yahooCapability('global.holders', 'yfinance_holders', 'Yahoo quoteSummary ownership modules', 'saveYfinanceHolders')]),
    mobileInterface('global.insider_transactions', 'yfinance_insider_transactions', ['yfinance_insider_transactions'], ['query_yfinance'], [yahooCapability('global.insider_transactions', 'yfinance_insider_transactions', 'Yahoo quoteSummary insiderTransactions', 'saveYfinanceInsiderTransactions')]),
    mobileInterface('option.expiry_calendar', 'yfinance_option_expiries', ['yfinance_option_expiries'], ['query_yfinance'], [yahooCapability('option.expiry_calendar', 'yfinance_option_expiries', 'Yahoo options expiry calendar', 'saveYfinanceOptionExpiries')]),
    mobileInterface('option.contract_list', 'yfinance_option_contracts', ['yfinance_option_contracts'], ['query_yfinance'], [yahooCapability('option.contract_list', 'yfinance_option_contracts', 'Yahoo option chain contracts', 'saveYfinanceOptionContracts')]),
    mobileInterface('option.quote', 'yfinance_option_contracts', ['yfinance_option_contracts'], ['query_yfinance'], [yahooCapability('option.quote', 'yfinance_option_contracts', 'Yahoo option chain quote fields', 'saveYfinanceOptionContracts')]),
    mobileInterface('option.open_interest', 'yfinance_option_contracts', ['yfinance_option_contracts'], ['query_yfinance'], [yahooCapability('option.open_interest', 'yfinance_option_contracts', 'Yahoo option chain open interest fields', 'saveYfinanceOptionContracts')]),
    mobileInterface('option.implied_volatility', 'yfinance_option_contracts', ['yfinance_option_contracts'], ['query_yfinance'], [yahooCapability('option.implied_volatility', 'yfinance_option_contracts', 'Yahoo option chain implied volatility fields', 'saveYfinanceOptionContracts')]),
    mobileInterface('option.chain_snapshot', 'yfinance_options', ['yfinance_option_expiries', 'yfinance_option_contracts'], ['query_yfinance'], [yahooCapability('option.chain_snapshot', 'yfinance_option_contracts', 'Yahoo options chain snapshot', 'saveYfinanceOptionExpiries/saveYfinanceOptionContracts')]),
    mobileInterface('global.options_chain', 'yfinance_options', ['yfinance_option_expiries', 'yfinance_option_contracts'], ['query_yfinance'], [yahooCapability('global.options_chain', 'yfinance_option_contracts', 'Yahoo options chain', 'saveYfinanceOptionExpiries/saveYfinanceOptionContracts')]),
    mobileInterface('global.corporate_actions', 'yfinance_corporate_actions', ['yfinance_corporate_actions'], ['query_yfinance'], [yahooCapability('global.corporate_actions', 'yfinance_corporate_actions', 'Yahoo chart actions events', 'saveYfinanceCorporateActions')]),
    mobileInterface('global.finance_news', 'yfinance_news', ['yfinance_news'], ['query_yfinance'], [yahooCapability('global.finance_news', 'yfinance_news', 'Yahoo finance news', 'saveYfinanceNews')]),
    mobileInterface('fund.performance_metrics', 'fund_performance_metrics', ['fund_performance_metrics'], ['query_fund_performance'], [{
      id: 'eastmoney.fund.performance_metrics',
      provider: 'eastmoney',
      status: 'not-supported',
      reason: 'Shared mobile/FinAgent has not yet implemented the fund_performance_metrics canonical writer/readback path.',
    }, {
      id: 'akshare.fund.performance_metrics',
      provider: 'akshare',
      status: 'not-supported',
      reason: 'AkShare is sidecar-backed in FinAgent Workstation; mobile must stay native until a real mobile provider path exists.',
    }, {
      id: 'wind.fund.performance_metrics',
      provider: 'wind',
      status: 'credential-gated',
      reason: 'Requires mobile Wind credential plus canonical fund_performance_metrics normalizer/readback before support.',
    }]),
    mobileInterface('market.screening', 'screening_result', ['market_screening_snapshot'], ['query_market_screening'], [tradingviewCapability('market.screening', 'market_screening_snapshot', 'TradingviewMarketProvider.readScan', 'TradingviewMarketDataService.scan')]),
    mobileInterface('technical.indicator_series', 'technical_indicator_series', ['technical_indicator_series'], ['query_technical_indicator'], [{
      id: 'tradingview.technical.indicator_series',
      provider: 'tradingview',
      status: 'not-supported',
      adapter: null,
      normalizer: null,
      canonicalTable: null,
      reason: 'Shared mobile has technical_indicator_series storage/readback; no native TradingView/TA provider ingestion route or live evidence is registered yet.',
    }]),
  ]
}

function mobileInterface(id, canonicalSchema, dataStoreTables, queryActions, capabilities) {
  return {
    id,
    label: id,
    canonicalSchema,
    dataStoreTables,
    queryActions,
    freshnessPolicy: 'mobile-second-wave-cache-first',
    capabilities,
  }
}

function outputOnlyInterfaces() {
  const capability = (id, interfaceId, provider, adapter, normalizer, status = 'supported', priority = 1) => ({
    id,
    provider,
    status,
    adapter,
    normalizer,
    canonicalTable: null,
    priority,
  })
  return [
    outputOnlyInterface('provider.discovery', 'provider_discovery_result', [
      capability('akshare.provider.discovery', 'provider.discovery', 'akshare', 'akshare_search', 'normalizeProviderDiscovery', 'supported', 1),
      capability('yfinance.provider.discovery', 'provider.discovery', 'yahoo', 'yfinance_search', 'normalizeProviderDiscovery', 'supported', 2),
      capability('ta.provider.discovery', 'provider.discovery', 'ta', 'ta_search', 'normalizeProviderDiscovery', 'supported', 3),
    ], {
      category: 'discovery',
      reason: 'Provider search/listing surfaces help choose a concrete governed interface but do not represent reusable market data.',
    }),
    outputOnlyInterface('provider.diagnostic', 'provider_diagnostic_result', [
      capability('akshare.provider.diagnostic', 'provider.diagnostic', 'akshare', 'akshare/{func_name}', 'normalizeProviderDiagnostic', 'diagnostic-only', 1),
      capability('yfinance.provider.diagnostic', 'provider.diagnostic', 'yahoo', 'yfinance/{action}', 'normalizeProviderDiagnostic', 'diagnostic-only', 2),
      capability('tdx.provider.diagnostic', 'provider.diagnostic', 'tdx', 'gotdx/{tdx_action}', 'normalizeProviderDiagnostic', 'diagnostic-only', 3),
      capability('ta.provider.diagnostic', 'provider.diagnostic', 'ta', 'ta/{indicator}', 'normalizeProviderDiagnostic', 'diagnostic-only', 4),
      capability('tushare.provider.diagnostic', 'provider.diagnostic', 'tushare', 'tushare/{api_name}', 'normalizeProviderDiagnostic', 'credential-gated', 5),
      capability('sina.provider.diagnostic', 'provider.diagnostic', 'sina', 'Sina finance allowed URL or quote/kline shorthand', 'normalizeProviderDiagnostic', 'diagnostic-only', 6),
      capability('tencent.provider.diagnostic', 'provider.diagnostic', 'tencent', 'Tencent finance allowed URL or quote/kline shorthand', 'normalizeProviderDiagnostic', 'diagnostic-only', 7),
    ], {
      category: 'diagnostic',
      reason: 'Generic provider escape hatches are bounded inspection tools; known schemas must be promoted before normal workflow persistence.',
    }),
    outputOnlyInterface('provider.status', 'provider_status_result', [
      capability('sidecar.provider.status', 'provider.status', 'akshare', 'sidecar health/rate-limit/gotdx health', 'normalizeProviderStatus', 'supported', 1),
      capability('tdx.provider.status', 'provider.status', 'tdx', 'gotdx health', 'normalizeProviderStatus', 'supported', 2),
      capability('yfinance.provider.status', 'provider.status', 'yahoo', 'sidecar rate-limit health', 'normalizeProviderStatus', 'supported', 3),
    ], {
      category: 'status',
      reason: 'Runtime/provider health snapshots are operational status evidence, not reusable finance datasets.',
    }),
    outputOnlyInterface('provider.reference_dataset', 'provider_reference_dataset_result', [
      capability('akshare.sina.reference_dataset', 'provider.reference_dataset', 'akshare', 'akshare *_sina reference functions', 'normalizeAkshareSinaReferenceDataset', 'supported', 1),
    ], {
      category: 'known-schema',
      reason: 'AkShare/Sina reference datasets are bounded known-schema evidence; they are not canonical reusable tables until a requirement-level interface exists.',
    }),
    outputOnlyInterface('market.intraday_ohlcv_bars', 'intraday_ohlcv_bar_result', [
      capability('sina.market.intraday_ohlcv_bars', 'market.intraday_ohlcv_bars', 'sina', 'CN_MarketData.getKLineData scale=5', 'normalizeSinaIntradayOhlcvBars', 'supported', 1),
    ], {
      category: 'known-schema',
      reason: 'Sina 5-minute OHLCV bars are known schema but not equivalent to canonical tick-chart rows.',
    }),
    outputOnlyInterface('stock.transaction_count', 'stock_transaction_count_result', [
      capability('sina.stock.transaction_count', 'stock.transaction_count', 'sina', 'CN_Bill.GetBillListCount', 'normalizeSinaStockTransactionCount', 'supported', 1),
    ], {
      category: 'known-schema',
      reason: 'Sina transaction count is known schema and useful for bounded stock.transactions pagination, but it is not canonical transaction row data.',
    }),
    outputOnlyInterface('market.classification_members', 'market_classification_member_batch_result', [
      capability('sina.market.classification_members', 'market.classification_members', 'sina', 'Market_Center.getHQNodes + Market_Center.getHQNodeData bounded pages', 'normalizeSinaClassificationMemberBatch', 'supported', 1),
    ], {
      category: 'known-schema',
      reason: 'Sina classification member expansion is a bounded batch workflow with checkpoint and failed-page classification; it is not canonical sector/constituent storage.',
    }),
    outputOnlyInterface('stock.esg_rating_collection', 'stock_esg_rating_collection_result', [
      capability('sina.stock.esg_rating_collection', 'stock.esg_rating_collection', 'sina', 'EsgService.getEsgStocks bounded pages', 'normalizeSinaEsgRatingCollection', 'supported', 1),
    ], {
      category: 'known-schema',
      reason: 'Sina ESG rating collection is known schema with checkpoint and failed-page classification, but it is not canonical reusable storage.',
    }),
    outputOnlyInterface('fund.dividend_factor', 'fund_dividend_factor_result', [
      capability('sina.fund.dividend_factor', 'fund.dividend_factor', 'sina', 'FundPage fundEtfFactorInfoService', 'normalizeSinaFundDividendFactor', 'supported', 1),
    ], {
      category: 'known-schema',
      reason: 'Sina ETF dividend/factor rows are known schema but do not yet have a reusable fund corporate-action table.',
    }),
    outputOnlyInterface('fund.etf_daily_ohlcv_bars', 'fund_etf_daily_ohlcv_bar_result', [
      capability('sina.fund.etf_daily_ohlcv_bars', 'fund.etf_daily_ohlcv_bars', 'sina', 'realstock/company/{symbol}/hisdata_klc2/klc_kl.js', 'normalizeSinaFundEtfDailyOhlcvBars', 'diagnostic-only', 1),
      capability('akshare.sina.fund.etf_daily_ohlcv_bars', 'fund.etf_daily_ohlcv_bars', 'akshare', 'fund_etf_hist_sina', 'normalizeSinaFundEtfDailyOhlcvBars', 'supported', 2),
    ], {
      category: 'known-schema',
      reason: 'Decoded Sina ETF daily exchange OHLCV rows are known schema but not equivalent to fund_nav history; direct Sina remains encrypted diagnostic until a native decoder exists.',
    }),
  ]
}

function outputOnlyInterface(id, schema, capabilities, governance) {
  return {
    id,
    label: id,
    canonicalSchema: schema,
    dataStoreTables: [],
    queryActions: [],
    freshnessPolicy: 'output-only-no-canonical-cache',
    persistencePolicy: 'output-only',
    outputOnlyCategory: governance.category,
    outputOnlyReason: governance.reason,
    capabilities,
  }
}

function outputOnlyGovernanceFor(interfaceDef) {
  if (interfaceDef.outputOnlyCategory && interfaceDef.outputOnlyReason) {
    return {
      category: interfaceDef.outputOnlyCategory,
      reason: interfaceDef.outputOnlyReason,
    }
  }
  if (interfaceDef.id === 'provider.discovery') {
    return {
      category: 'discovery',
      reason: 'Provider search/listing surfaces help choose a concrete governed interface but do not represent reusable market data.',
    }
  }
  if (interfaceDef.id === 'provider.diagnostic') {
    return {
      category: 'diagnostic',
      reason: 'Generic provider escape hatches are bounded inspection tools; known schemas must be promoted before normal workflow persistence.',
    }
  }
  if (interfaceDef.id === 'provider.status') {
    return {
      category: 'status',
      reason: 'Runtime/provider health snapshots are operational status evidence, not reusable finance datasets.',
    }
  }
  return {
    category: 'output-only',
    reason: 'Typed no-persist surface; promote to a governed Data API interface before reusable storage.',
  }
}

function localSurfaceGovernanceFor(interfaceCoverageStatus) {
  const mapping = {
    'local-readback-or-status-surface': {
      category: 'local-readback',
      reason: 'Local readback/status action exposes already-governed cache or runtime state and does not fetch provider data.',
    },
    'derived-local-analysis-surface': {
      category: 'derived-analysis',
      reason: 'Derived analysis output is computed from governed input datasets and should not be treated as raw provider data.',
    },
    'contract-census-surface': {
      category: 'contract-census',
      reason: 'Schema census rows document shared-mobile contract coverage for audits; they are not callable provider workflows.',
    },
    'queue-control-surface': {
      category: 'queue-control',
      reason: 'Queue control actions schedule or inspect data tasks; they do not represent reusable finance datasets.',
    },
    'tool-action-not-data-interface': {
      category: 'tool-control',
      reason: 'Tool help/control actions are operational guidance, not finance data surfaces.',
    },
    'output-only-or-diagnostic': {
      category: 'diagnostic',
      reason: 'Diagnostic surface remains outside reusable data workflows until a stable requirement interface is registered.',
    },
    'generic-provider-diagnostic': {
      category: 'diagnostic',
      reason: 'Generic provider surface is a bounded diagnostic path; normal workflows must use registered Data API interfaces.',
    },
  }
  return mapping[interfaceCoverageStatus] ?? null
}

function readMobileContract() {
  const text = readFileSync(mobileContractPath, 'utf-8')
  const start = text.indexOf('const _interfaces')
  const blocks = extractCalls(start >= 0 ? text.slice(start) : text, 'DataApiInterfaceDefinition')
  return {
    interfaces: blocks.map((block) => ({
      id: readStringField(block, 'id'),
      label: readStringField(block, 'label') ?? readStringField(block, 'id'),
      canonicalSchema: readStringField(block, 'canonicalSchema'),
      dataStoreTables: readStringList(block, 'dataStoreTables'),
      queryActions: readStringList(block, 'queryActions'),
      params: readStringList(block, 'params'),
      freshnessPolicy: readStringField(block, 'freshnessPolicy') ?? 'mobile-cache-first',
      capabilities: extractCalls(block, 'DataApiProviderCapability').map((capability) => ({
        id: readStringField(capability, 'id'),
        provider: normalizeMobileProvider(readEnumField(capability, 'provider', 'FinanceProvider')),
        status: toWireStatus(readEnumField(capability, 'status', 'DataApiCapabilityStatus')),
        upstreamOrigin: readStringField(capability, 'upstreamOrigin'),
        adapter: readStringField(capability, 'adapter'),
        normalizer: readStringField(capability, 'normalizer'),
        canonicalTable: readStringField(capability, 'canonicalTable'),
        probeId: readStringField(capability, 'probeId'),
        reason: readStringField(capability, 'reason'),
      })).filter((capability) => capability.id && capability.provider && capability.status),
    })).filter((item) => item.id),
  }
}

function extractCalls(text, name) {
  const blocks = []
  let searchFrom = 0
  while (true) {
    const startName = text.indexOf(`${name}(`, searchFrom)
    if (startName < 0) break
    const start = text.indexOf('(', startName)
    let depth = 0
    let quote = null
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      const prev = text[i - 1]
      if (quote) {
        if (ch === quote && prev !== '\\') quote = null
        continue
      }
      if (ch === '\'' || ch === '"') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          blocks.push(text.slice(startName, i + 1))
          searchFrom = i + 1
          break
        }
      }
    }
    if (searchFrom <= startName) break
  }
  return blocks
}

function readStringField(block, field) {
  const direct = block.match(new RegExp(`${field}:\\s*'([^']*)'`))
  if (direct) return direct[1]
  const pieces = [...(block.match(new RegExp(`${field}:\\s*([\\s\\S]*?)(?:,\\n\\s*[a-zA-Z_]|,\\n\\s*\\)|\\n\\s*\\))`))?.[1] ?? '').matchAll(/'([^']*)'/g)].map((match) => match[1])
  return pieces.length > 0 ? pieces.join('') : null
}

function readStringList(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) return []
  return [...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1])
}

function readEnumField(block, field, enumName) {
  const match = block.match(new RegExp(`${field}:\\s*${enumName}\\.([a-zA-Z0-9_]+)`))
  return match ? match[1] : null
}

function toWireStatus(status) {
  if (!status) return null
  return status.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

function normalizeMobileProvider(provider) {
  const map = {
    eastmoneyDirect: 'eastmoney',
    yfinance: 'yahoo',
  }
  return map[provider] ?? provider
}

function normalizeProvider(provider) {
  const value = String(provider ?? '').toLowerCase()
  if (value === 'yfinance') return 'yahoo'
  if (value === 'sidecar') return 'akshare'
  if (value === 'local' || value === 'contract') return null
  return value
}

function syntheticProviderSurfaceId(row) {
  const provider = normalizeProvider(row.provider)
  if (!provider) return null
  const endpoint = slug(row.endpoint ?? row.action ?? row.family)
  if (!endpoint) return null
  if (String(row.kind ?? '').includes('generic') || String(row.schemaStatus ?? '').includes('output-only') || String(row.validationState ?? '').includes('output-only')) {
    return `diagnostic.${provider}.${endpoint}`
  }
  if (row.kind === 'query-or-local') return null
  return `provider.${provider}.${endpoint}`
}

function syntheticCapabilityId(row) {
  const provider = normalizeProvider(row.provider)
  const endpoint = slug(row.endpoint ?? row.action ?? row.family)
  return provider && endpoint ? `${provider}.${endpoint}` : null
}

function localSurfaceId(row) {
  const endpoint = slug(row.endpoint ?? row.action ?? row.family)
  if (!endpoint) return null
  const status = classifyUnmappedInterface(row)
  const prefix = {
    'local-readback-or-status-surface': 'local.readback',
    'derived-local-analysis-surface': 'local.analysis',
    'contract-census-surface': 'contract.census',
    'queue-control-surface': 'local.queue',
    'tool-action-not-data-interface': 'local.tool',
    'output-only-or-diagnostic': 'diagnostic.output',
    'generic-provider-diagnostic': 'diagnostic.generic',
  }[status]
  return prefix ? `${prefix}.${endpoint}` : null
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^\/*api\//, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function summarizeLiveStatusEvidence(row, liveStatusIndex) {
  const directMobile = mobileLiveStatusForRow(row, liveStatusIndex)
  const ids = unique([...(row.liveProbeIds ?? []), ...(directMobile ? [directMobile.id] : [])])
  const matched = ids
    .map((id) => liveStatusIndex.byProbeId.get(id))
    .filter(Boolean)
  const statuses = matched.map((item) => String(item.status ?? item.validationState ?? 'unknown').toLowerCase())
  const failureClasses = matched
    .map((item) => item.failureClass)
    .filter(Boolean)
  return {
    probeIds: ids,
    matched: matched.length,
    missing: Math.max(0, ids.length - matched.length),
    statuses,
    passed: statuses.filter(isPassStatus).length,
    failed: statuses.filter(isFailStatus).length,
    blocked: statuses.filter(isBlockedStatus).length,
    timeout: matched.filter((item) => String(item.failureClass ?? '').toLowerCase().includes('timeout') || String(item.validationState ?? '').toLowerCase().includes('timeout')).length,
    failureClasses: unique(failureClasses),
    lastStatus: matched.at(-1)?.status ?? null,
    lastValidationState: matched.at(-1)?.validationState ?? null,
    lastFailureClass: matched.at(-1)?.failureClass || null,
    lastError: matched.at(-1)?.error || null,
  }
}

function mobileLiveStatusForRow(row, liveStatusIndex) {
  if (row.runtime !== 'shared_mobile') return null
  const provider = normalizeProvider(row.provider)
  const action = String(row.action ?? row.endpoint ?? '').trim().toLowerCase()
  const endpoint = String(row.endpoint ?? row.action ?? '').trim().toLowerCase()
  for (const value of unique([action, endpoint].filter(Boolean))) {
    for (const candidateProvider of providerProbeAliasesForEvidence(provider)) {
      const item = liveStatusIndex.byMobileRuntimeAction.get(mobileRuntimeActionKey({
        action: value,
        provider: candidateProvider,
      }))
      if (item) return item
    }
    const item = liveStatusIndex.byMobileRuntimeAction.get(mobileRuntimeActionKey({
      action: value,
      provider: provider ?? String(row.provider ?? ''),
    }))
    if (item) return item
  }
  return null
}

function isPassStatus(status) {
  return ['passed', 'success', 'ok'].includes(String(status ?? '').toLowerCase())
}

function isFailStatus(status) {
  const value = String(status ?? '').toLowerCase()
  return value === 'failed' || value === 'error' || value.includes('unstable')
}

function isBlockedStatus(status) {
  const value = String(status ?? '').toLowerCase()
  return value === 'blocked' || value.includes('blocked')
}

function summarizeProbeResults(row, liveStatusEvidence) {
  const results = row.probeResults ?? []
  const statuses = results.map((item) => item.status ?? item.validationState ?? 'unknown')
  return {
    count: results.length,
    statuses,
    passed: statuses.filter(isPassStatus).length,
    failed: statuses.filter(isFailStatus).length,
    durableCount: liveStatusEvidence.matched,
    durablePassed: liveStatusEvidence.passed,
    durableFailed: liveStatusEvidence.failed,
    durableBlocked: liveStatusEvidence.blocked,
    durableTimeout: liveStatusEvidence.timeout,
    durableFailureClasses: liveStatusEvidence.failureClasses,
  }
}

function classifyEvidence({ row, normalizedProvider, providerSupport, liveStatusEvidence, liveStatusIndex }) {
  if (liveStatusEvidence.matched > 0) {
    return {
      status: liveStatusEvidence.failed > 0 || liveStatusEvidence.blocked > 0 || liveStatusEvidence.timeout > 0
        ? 'direct-live-non-pass'
        : 'direct-live-pass',
      reason: 'Row has direct durable live-status evidence.',
      probeIds: liveStatusEvidence.probeIds.filter((id) => liveStatusIndex.byProbeId.has(id)),
    }
  }

  const capabilityEvidence = capabilityLiveEvidence({ row, normalizedProvider, providerSupport, liveStatusIndex })
  if (capabilityEvidence.probeIds.length > 0) {
    return {
      status: capabilityEvidence.nonPass > 0 ? 'capability-live-non-pass' : 'capability-live-pass',
      reason: 'Row is covered by registered provider-interface capability live evidence.',
      probeIds: capabilityEvidence.probeIds,
    }
  }

  const validation = String(row.validationState ?? '').toLowerCase()
  const kind = String(row.kind ?? '').toLowerCase()
  const coverage = String(row.coverageStatus ?? '').toLowerCase()
  const provider = String(row.provider ?? '').toLowerCase()
  if (row.kind === 'query-or-local' || provider === 'local') {
    return { status: 'exempt-local-readback', reason: 'Local/readback/status surface does not call an upstream provider.', probeIds: [] }
  }
  if (kind.includes('schema-census-row')) {
    return { status: 'exempt-contract-census', reason: 'Schema census rows prove contract shape and are not live provider calls.', probeIds: [] }
  }
  if (kind.includes('fetch-queue') || kind.includes('tool-action')) {
    return { status: 'exempt-control-surface', reason: 'Queue/tool control surface is not an upstream provider call.', probeIds: [] }
  }
  if (kind.includes('derived-analysis')) {
    return { status: 'exempt-derived-local', reason: 'Derived analysis consumes governed data but is not itself a provider call.', probeIds: [] }
  }
  if (validation.includes('output-only')) {
    return { status: 'exempt-output-only-contract', reason: 'Output-only surface is governed by typed no-persist contract instead of live-provider reuse evidence.', probeIds: [] }
  }
  if (kind.includes('generic') || validation.includes('generic-proxy') || coverage.includes('no-live-probe-required')) {
    return { status: 'exempt-diagnostic', reason: 'Generic or diagnostic provider surface is not a normal reusable workflow.', probeIds: [] }
  }
  if (validation.includes('no-runtime-api')) {
    return { status: 'exempt-provider-action-contract', reason: 'Provider action is represented by registered capability or contract classification rather than a standalone live call.', probeIds: [] }
  }
  return { status: 'missing-provider-evidence', reason: 'Provider-facing surface has no live evidence, capability evidence, or exemption.', probeIds: [] }
}

function capabilityLiveEvidence({ row, normalizedProvider, providerSupport, liveStatusIndex }) {
  const includeAllSupportedProviders = row.kind === 'query-or-local' || String(row.runtimeStatus ?? '') === 'local-readback'
  const eligibleProviders = new Set(providerProbeAliasesForEvidence(normalizedProvider))
  const probeIds = []
  let nonPass = 0
  for (const [providerKey, support] of Object.entries(providerSupport ?? {})) {
    if (!support || typeof support !== 'object') continue
    const provider = normalizeProvider(support.provider ?? providerKey) ?? String(providerKey)
    if (!includeAllSupportedProviders && !eligibleProviders.has(provider)) continue
    if (!['supported', 'global-only', 'credential-gated'].includes(String(support.status))) continue
    if (!support.probeId) continue
    const status = liveStatusIndex.byProbeId.get(String(support.probeId))
    if (!status) continue
    probeIds.push(String(support.probeId))
    if (!isPassStatus(status.status)) nonPass += 1
  }
  return { probeIds: unique(probeIds), nonPass }
}

function providerProbeAliasesForEvidence(provider) {
  if (provider === 'yahoo') return ['yahoo', 'yfinance']
  if (provider === 'akshare') return ['akshare', 'sidecar', 'ta']
  if (provider === 'tushare') return ['tushare', 'sidecar']
  if (!provider) return []
  return [provider]
}

function classifyRuntimeStatus(row, liveStatusEvidence) {
  if (liveStatusEvidence.matched > 0) {
    if (liveStatusEvidence.failed > 0 || liveStatusEvidence.blocked > 0 || liveStatusEvidence.timeout > 0) return 'failed-or-blocked'
    if (liveStatusEvidence.passed === liveStatusEvidence.matched) return 'succeeded'
    return 'live-evidence-mixed'
  }
  const apiStatus = String(row.apiStatus?.status ?? '').toLowerCase()
  const coverage = String(row.coverageStatus ?? '').toLowerCase()
  const validation = String(row.validationState ?? '').toLowerCase()
  if (apiStatus.includes('all-matched-probes-passed')) return 'succeeded'
  if (apiStatus.includes('matched-probes-have-non-pass-status')) return 'failed-or-blocked'
  if (apiStatus.includes('classified-without-live-call') || coverage.includes('no-live-probe-required')) {
    if (validation.includes('local-readback')) return 'local-readback'
    if (validation.includes('output-only')) return 'output-only-classified'
    if (validation.includes('derived')) return 'derived-local'
    if (validation.includes('no-runtime-api')) return 'classified-no-runtime-api'
    return 'classified-not-live-probed'
  }
  if (coverage.includes('live-probed')) return apiStatusToDetailedStatus(row.apiStatus?.status)
  return 'unknown'
}

function classifyLiveProbeRequirement({ row, interfaceCoverageStatus, runtimeStatus, liveStatusEvidence, evidence }) {
  if (String(row.coverageStatus ?? '').includes('live-probed')) {
    return liveStatusEvidence.matched > 0 ? 'live-tested' : 'needs-live-status-evidence'
  }
  if (runtimeStatus === 'succeeded' || runtimeStatus === 'failed-or-blocked') return 'live-tested'
  if (evidence?.status === 'capability-live-pass' || evidence?.status === 'capability-live-non-pass') {
    return 'live-tested-via-capability'
  }
  if (String(evidence?.status ?? '').startsWith('exempt-')) {
    return 'not-required-local-or-control'
  }
  if (row.kind === 'query-or-local' || String(row.provider ?? '').toLowerCase() === 'local') return 'not-required-local-or-control'
  if ([
    'local-readback-or-status-surface',
    'derived-local-analysis-surface',
    'contract-census-surface',
    'queue-control-surface',
    'tool-action-not-data-interface',
    'output-only-or-diagnostic',
  ].includes(interfaceCoverageStatus)) return 'not-required-local-or-control'
  if (String(row.kind ?? '').includes('schema-census-row')) return 'not-required-local-or-control'
  if (String(row.kind ?? '').includes('fetch-queue')) return 'not-required-local-or-control'
  if (String(row.kind ?? '').includes('derived-analysis')) return 'not-required-local-or-control'
  return 'needs-live-probe'
}

function classifyInterfaceGovernance(interfaceCoverageStatus) {
  if (interfaceCoverageStatus === 'mapped-to-data-api-interface') return 'data-api-interface'
  if (interfaceCoverageStatus === 'normalized-output-only-interface') return 'output-only-interface'
  if (interfaceCoverageStatus.includes('local') || interfaceCoverageStatus.includes('queue') || interfaceCoverageStatus.includes('tool')) return 'local-or-tool-surface'
  if (interfaceCoverageStatus.includes('known-provider')) return 'known-provider-surface'
  if (interfaceCoverageStatus.includes('diagnostic')) return 'diagnostic-surface'
  if (interfaceCoverageStatus === 'missing-data-api-interface') return 'missing-interface'
  return 'classified-surface'
}

function classifyPersistenceStatus({ interfaceDef, interfaceCoverageStatus, row }) {
  if (interfaceDef?.persistencePolicy === 'output-only') return 'not-persisted-output-only'
  if ((interfaceDef?.dataStoreTables?.length ?? 0) > 0) return 'persistable'
  if (interfaceCoverageStatus === 'mapped-to-data-api-interface') return 'interface-without-table'
  if (String(row.schemaStatus ?? '').includes('registered-reusable')) return 'registered-reusable'
  return 'not-persisted'
}

function classifyReadbackStatus({ interfaceDef, interfaceCoverageStatus, row }) {
  if ((interfaceDef?.queryActions?.length ?? 0) > 0) return 'readback-defined'
  if (interfaceCoverageStatus.includes('local-readback')) return 'readback-surface'
  if (interfaceDef?.persistencePolicy === 'output-only') return 'not-required-output-only'
  if (interfaceCoverageStatus === 'output-only-or-diagnostic') return 'not-required-diagnostic'
  if (interfaceCoverageStatus === 'derived-local-analysis-surface') return 'not-required-derived'
  if (interfaceCoverageStatus === 'contract-census-surface') return 'not-required-contract'
  if (interfaceCoverageStatus === 'queue-control-surface') return 'not-required-control'
  if (interfaceCoverageStatus === 'tool-action-not-data-interface') return 'not-required-tool'
  if (String(row.kind ?? '').includes('generic')) return 'not-required-diagnostic'
  if (String(row.provider ?? '').toLowerCase() === 'local') return 'not-required-local'
  return 'missing-readback'
}

function classifyGovernanceAction({ row, interfaceDef, interfaceCoverageStatus, persistenceStatus, readbackStatus, runtimeStatus, liveProbeRequirement }) {
  if (interfaceCoverageStatus === 'missing-data-api-interface') return 'add-interface-or-mark-unsupported'
  if (interfaceCoverageStatus === 'known-provider-api-surface') return 'promote-to-interface-or-output-only'
  if (runtimeStatus === 'failed-or-blocked') return 'inspect-live-failure'
  if (persistenceStatus === 'persistable' && readbackStatus === 'readback-defined') return 'governed'
  if (interfaceDef?.persistencePolicy === 'output-only') return 'governed-output-only'
  if (liveProbeRequirement === 'needs-live-probe') return 'add-live-probe'
  if (persistenceStatus === 'not-persisted-output-only') return 'keep-output-only'
  if (interfaceCoverageStatus === 'output-only-or-diagnostic') return 'keep-diagnostic'
  if (String(row.kind ?? '').includes('generic')) return 'keep-diagnostic'
  if (interfaceCoverageStatus === 'local-readback-or-status-surface') return 'governed-local'
  if (interfaceCoverageStatus === 'derived-local-analysis-surface') return 'governed-derived'
  if (interfaceCoverageStatus === 'contract-census-surface') return 'governed-contract'
  if (interfaceCoverageStatus === 'queue-control-surface') return 'governed-control'
  if (interfaceCoverageStatus === 'tool-action-not-data-interface') return 'governed-tool'
  if (readbackStatus === 'missing-readback') return 'add-readback'
  return 'review'
}

function classifyUnmappedInterface(row) {
  const endpoint = String(row.canonicalEndpoint ?? row.endpoint ?? row.action ?? '').toLowerCase()
  if (['interfaces', 'interface_describe', 'interface_availability'].includes(endpoint)) return 'local-readback-or-status-surface'
  if (row.kind === 'query-or-local') return 'local-readback-or-status-surface'
  if (String(row.kind ?? '').includes('derived-analysis')) return 'derived-local-analysis-surface'
  if (String(row.kind ?? '').includes('schema-census-row')) return 'contract-census-surface'
  if (String(row.kind ?? '').includes('fetch-queue')) return 'queue-control-surface'
  if (String(row.validationState ?? '').includes('output-only') || String(row.schemaStatus ?? '').includes('output-only')) return 'output-only-or-diagnostic'
  if (String(row.kind ?? '').includes('generic')) return 'generic-provider-diagnostic'
  if (String(row.kind ?? '').includes('tool-action')) return 'tool-action-not-data-interface'
  return 'missing-data-api-interface'
}

function classifyUnmappedProviderStatus(row) {
  if (row.kind === 'query-or-local') return 'local-readback'
  if (String(row.validationState ?? '').includes('output-only') || String(row.schemaStatus ?? '').includes('output-only')) return 'output-only'
  if (String(row.kind ?? '').includes('generic')) return 'diagnostic-only'
  if (String(row.coverageStatus ?? '').includes('live-probed')) return apiStatusToDetailedStatus(row.apiStatus?.status)
  return 'observed-inventory-row'
}

function apiStatusToDetailedStatus(status) {
  const value = String(status ?? '').toLowerCase()
  if (value.includes('passed') || value.includes('success')) return 'observed-passed'
  if (value.includes('credential')) return 'credential-gated'
  if (value.includes('quota')) return 'quota-gated'
  if (value.includes('transport') || value.includes('runtime') || value.includes('blocked')) return 'transport-unstable'
  if (value.includes('fail') || value.includes('error')) return 'observed-failed'
  return 'observed-probed'
}

function rowReason(row) {
  if (row.kind === 'query-or-local') return 'Local/readback/status action; no external provider capability is needed.'
  if (String(row.kind ?? '').includes('derived-analysis')) return 'Derived local analysis action; it consumes requirement-level market data but is not itself an external provider capability.'
  if (String(row.kind ?? '').includes('schema-census-row')) return 'Schema/governance census row; it records contract coverage and is not a callable provider surface.'
  if (String(row.kind ?? '').includes('fetch-queue')) return 'Queue/control action; it schedules registered requirement tasks and is not an external provider capability.'
  if (String(row.validationState ?? '').includes('output-only') || String(row.schemaStatus ?? '').includes('output-only')) return 'Diagnostic or output-only surface until a requirement schema and normalizer are registered.'
  if (String(row.kind ?? '').includes('generic')) return 'Generic provider diagnostic surface; normal workflows should use a data API interface.'
  return 'Inventory row exists, but no requirement-level interface is registered yet.'
}

function summarize({ rows, providerColumns, inventory, liveStatus, liveStatusIndex }) {
  const countBy = (selector) => {
    const counts = {}
    for (const row of rows) {
      const key = selector(row) ?? 'unknown'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).sort())
  }
  const statusCounts = {}
  for (const row of rows) {
    for (const provider of providerColumns) {
      const status = row.providerSupport[provider]?.status ?? 'missing-cell'
      statusCounts[status] = (statusCounts[status] ?? 0) + 1
    }
  }
  const providerRowsWithoutSurface = rows.filter((row) => isProviderLike(row.provider) && !row.surfaceId).length
  const rowsWithDurableLiveEvidence = rows.filter((row) => row.liveStatusEvidence.matched > 0).length
  const rowsWithNoDurableLiveEvidence = rows.filter((row) => (row.liveProbeIds?.length ?? 0) > 0 && row.liveStatusEvidence.matched === 0).length
  const rowsWithPartialDurableLiveEvidence = rows.filter((row) => row.liveStatusEvidence.matched > 0 && row.liveStatusEvidence.missing > 0).length
  const observedProbeIds = new Set(rows.flatMap((row) => [
    ...(row.liveProbeIds ?? []),
    ...(row.liveStatusEvidence?.probeIds ?? []),
    ...Object.values(row.providerSupport ?? {}).map((cell) => cell?.probeId).filter(Boolean),
  ]))
  const unreferencedLiveStatusRows = [...liveStatusIndex.byProbeId.values()]
    .filter((item) => item?.id && !observedProbeIds.has(item.id))
    .length
  return {
    totalRows: rows.length,
    inventoryRows: inventory.rows.length,
    liveStatusRows: liveStatusIndex.total ?? liveStatus.summary?.total ?? rows.reduce((sum, row) => sum + row.liveStatusEvidence.matched, 0),
    providerColumns: providerColumns.length,
    mappedRows: rows.filter((row) => row.surfaceId).length,
    unmappedRows: rows.filter((row) => !row.surfaceId).length,
    dataInterfaceRows: rows.filter((row) => row.interfaceSource === 'registered-data-api-interface').length,
    outputOnlyInterfaceRows: rows.filter((row) => row.interfaceSource === 'registered-output-only-interface').length,
    knownSurfaceRows: rows.filter((row) => row.surfaceId).length,
    unclassifiedRows: rows.filter((row) => !row.surfaceId).length,
    providerRowsWithoutSurface,
    rowsWithDurableLiveEvidence,
    rowsWithMissingDurableLiveEvidence: rowsWithNoDurableLiveEvidence,
    rowsWithNoDurableLiveEvidence,
    rowsWithPartialDurableLiveEvidence,
    unreferencedLiveStatusRows,
    durableLivePassedRows: rows.filter((row) => row.liveStatusEvidence.passed > 0).length,
    durableLiveFailedOrBlockedRows: rows.filter((row) => row.liveStatusEvidence.failed > 0 || row.liveStatusEvidence.blocked > 0 || row.liveStatusEvidence.timeout > 0).length,
    durableFailureClassCounts: countBy((row) => row.liveStatusEvidence.lastFailureClass || (row.liveStatusEvidence.matched > 0 ? 'none' : 'no-durable-live-evidence')),
    rowsByRuntime: countBy((row) => row.runtime),
    rowsByProvider: countBy((row) => row.provider),
    rowsByKind: countBy((row) => row.kind),
    rowsByRuntimeStatus: countBy((row) => row.runtimeStatus),
    rowsByLiveProbeRequirement: countBy((row) => row.liveProbeRequirement),
    rowsByEvidenceStatus: countBy((row) => row.evidenceStatus),
    rowsByGovernanceAction: countBy((row) => row.governanceAction),
    rowsByInterfaceCoverageStatus: countBy((row) => row.interfaceCoverageStatus),
    providerCellStatusCounts: Object.fromEntries(Object.entries(statusCounts).sort()),
  }
}

function validate({ rows, providerColumns, inventory, liveStatus }) {
  const problems = []
  if (rows.length !== inventory.rows.length) {
    problems.push(`row count mismatch: matrix=${rows.length} inventory=${inventory.rows.length}`)
  }
  for (const row of rows) {
    const cellProviders = Object.keys(row.providerSupport ?? {}).sort()
    const expected = [...providerColumns].sort()
    if (cellProviders.join('|') !== expected.join('|')) {
      problems.push(`${row.rowId}: provider cell columns do not match contract providers`)
    }
    if (!row.endpoint && !row.action) problems.push(`${row.rowId}: missing endpoint/action`)
    if (row.interfaceSource === 'registered-data-api-interface' && row.interfaceCandidates.length === 0) problems.push(`${row.rowId}: registered interface without candidates`)
    if (!row.surfaceId) problems.push(`${row.rowId}: row missing known API surface`)
    if (isProviderLike(row.provider) && !row.surfaceId) problems.push(`${row.rowId}: provider row missing known API surface`)
    if (row.evidenceStatus === 'missing-provider-evidence') problems.push(`${row.rowId}: provider-facing row lacks live evidence, capability evidence, or exemption`)
  }
  return problems
}

function isProviderLike(provider) {
  return new Set(['eastmoney', 'akshare', 'tdx', 'tushare', 'wind', 'yfinance', 'sidecar', 'tradingview', 'ta']).has(String(provider ?? '').toLowerCase())
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Detailed Finance API Call Provider Matrix')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Contract: \`${report.source.contract}\``)
  lines.push(`Inventory: \`${report.source.inventory}\``)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- inventory rows: ${report.summary.inventoryRows}`)
  lines.push(`- matrix rows: ${report.summary.totalRows}`)
  lines.push(`- durable live-status rows: ${report.summary.liveStatusRows}`)
  lines.push(`- rows with durable live evidence: ${report.summary.rowsWithDurableLiveEvidence}`)
  lines.push(`- rows with no durable live evidence: ${report.summary.rowsWithNoDurableLiveEvidence}`)
  lines.push(`- rows with partial durable live evidence: ${report.summary.rowsWithPartialDurableLiveEvidence}`)
  lines.push(`- unreferenced durable live-status rows: ${report.summary.unreferencedLiveStatusRows}`)
  lines.push(`- durable live passed rows: ${report.summary.durableLivePassedRows}`)
  lines.push(`- durable live failed/blocked rows: ${report.summary.durableLiveFailedOrBlockedRows}`)
  lines.push(`- provider columns: ${report.summary.providerColumns}`)
  lines.push(`- known surface rows: ${report.summary.knownSurfaceRows}`)
  lines.push(`- unclassified rows: ${report.summary.unclassifiedRows}`)
  lines.push(`- data interface rows: ${report.summary.dataInterfaceRows}`)
  lines.push(`- normalized output-only interface rows: ${report.summary.outputOnlyInterfaceRows}`)
  lines.push(`- provider rows without known API surface: ${report.summary.providerRowsWithoutSurface}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push('')
  lines.push('## Provider Cell Status Counts')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.providerCellStatusCounts)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Interface Coverage Status')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.rowsByInterfaceCoverageStatus)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Runtime Status')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.rowsByRuntimeStatus)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Durable Live Failure Classes')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.durableFailureClassCounts)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Live Probe Requirement')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.rowsByLiveProbeRequirement)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Evidence Status')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.rowsByEvidenceStatus)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Governance Action')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.rowsByGovernanceAction)) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Matrix')
  lines.push('')
  const header = ['Row', 'Runtime', 'Family', 'Action', 'Provider', 'Live', 'Durable Probe', 'Evidence', 'Failure Class', 'Probe Need', 'Surface', 'Interface', 'Governance', 'Output-only reason', 'Persist', 'Readback', 'Schema', 'Fix', ...report.providerColumns]
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of report.rows) {
    lines.push(`| ${row.rowId} | ${row.runtime} | ${row.family} | ${row.action ?? row.endpoint} | ${row.provider} | ${row.runtimeStatus} | ${compactLiveEvidence(row.liveStatusEvidence)} | ${compactEvidence(row)} | ${row.liveStatusEvidence.lastFailureClass || '-'} | ${row.liveProbeRequirement} | ${row.surfaceId ? `\`${row.surfaceId}\`` : '-'} | ${row.interfaceId && row.interfaceSource === 'registered-data-api-interface' ? `\`${row.interfaceId}\`` : '-'} | ${row.interfaceGovernance} | ${compactOutputOnlyReason(row)} | ${row.persistenceStatus} | ${row.readbackStatus} | ${row.canonicalSchema ? `\`${row.canonicalSchema}\`` : '-'} | ${row.governanceAction} | ${report.providerColumns.map((provider) => compactCell(row.providerSupport[provider])).join(' | ')} |`)
  }
  lines.push('')
  lines.push('## Problems')
  lines.push('')
  if (report.problems.length === 0) {
    lines.push('- none')
  } else {
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function compactCell(cell) {
  if (!cell) return 'missing'
  if (cell.capabilityId) {
    const parts = [cell.status, cell.capabilityId]
    if (cell.upstreamOrigin) parts.push(`origin:${cell.upstreamOrigin}`)
    return parts.join('<br>')
  }
  return cell.status
}

function compactOutputOnlyReason(row) {
  if (row.interfaceCoverageStatus === 'normalized-output-only-interface') {
    return `${row.outputOnlyCategory ?? 'output-only'}: ${row.outputOnlyReason ?? 'no reason recorded'}`
  }
  if (row.surfaceCategory || row.surfaceReason) {
    return `${row.surfaceCategory ?? 'surface'}: ${row.surfaceReason ?? 'no reason recorded'}`
  }
  return '-'
}

function compactLiveEvidence(evidence) {
  if (!evidence || evidence.matched === 0) return '-'
  const parts = []
  if (evidence.passed) parts.push(`pass:${evidence.passed}`)
  if (evidence.failed) parts.push(`fail:${evidence.failed}`)
  if (evidence.blocked) parts.push(`blocked:${evidence.blocked}`)
  if (evidence.timeout) parts.push(`timeout:${evidence.timeout}`)
  if (evidence.missing) parts.push(`missing:${evidence.missing}`)
  return parts.join('<br>') || `observed:${evidence.matched}`
}

function compactEvidence(row) {
  if (!row?.evidenceStatus) return '-'
  if (row.evidenceProbeIds?.length) return `${row.evidenceStatus}<br>${row.evidenceProbeIds.join('<br>')}`
  return row.evidenceStatus
}

function unique(values) {
  return [...new Set(values)]
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
