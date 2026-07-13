#!/usr/bin/env node
// Sina Finance first-level provider inventory and bounded live probe.
//
// This script is intentionally Sina-specific. It records both direct Sina
// endpoints and repo-used wrappers whose upstream origin or function name is
// Sina-related, then probes each callable surface serially.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const args = parseArgs(process.argv.slice(2))

const STOCK_CODE = args.stock ?? process.env.FIN_API_TEST_STOCK ?? '600519'
const INDEX_CODE = args.index ?? process.env.FIN_API_TEST_INDEX ?? '000001'
const QUERY = args.query ?? process.env.FIN_API_TEST_QUERY ?? 'A股'
const TRADE_DATE = args.date ?? compactDate(new Date())
const SIDECAR = args['sidecar-url'] ?? process.env.AKSHARE_SIDECAR_URL ?? 'http://127.0.0.1:19800'
const waitMs = Number(args['wait-ms'] ?? 1500)
const timeoutMs = Number(args['timeout-ms'] ?? 20_000)
const scope = args.scope ?? 'all'
const output = args.output ?? resolve(repoRoot, 'reports/integrations/finance_sina_first_level_probe_results_2026_06_22.json')
const mdOutput = args.md ?? resolve(repoRoot, 'reports/integrations/finance_sina_first_level_probe_results_2026_06_22.md')
const rawDir = args['raw-dir'] ?? resolve(repoRoot, 'reports/integrations/sina-first-level-raw')
const akshareRepo = args['akshare-repo'] ?? process.env.AKSHARE_REPO ?? ''

if (args.help === 'true') {
  printUsage()
  process.exit(0)
}

mkdirSync(rawDir, { recursive: true })

const inventory = filterInventory(buildInventory())
const results = []
for (let i = 0; i < inventory.length; i++) {
  const item = inventory[i]
  if (i > 0 && waitMs > 0) await sleep(waitMs)
  const result = await probe(item)
  results.push(result)
  console.log(`${i + 1}/${inventory.length} ${item.id}: ${result.status}${result.failureClass ? ` (${result.failureClass})` : ''} rows=${result.rowCount}`)
}

const report = {
  generatedAt: new Date().toISOString(),
  objective: 'Sina Finance first-level provider inventory and serial live probe evidence.',
  config: {
    stock: STOCK_CODE,
    index: INDEX_CODE,
    query: QUERY,
    tradeDate: TRADE_DATE,
    waitMs,
    timeoutMs,
    scope,
    sidecarUrl: SIDECAR,
    rawDir,
    akshareRepo,
  },
  summary: summarize(results),
  inventory,
  results,
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
writeFileSync(mdOutput, renderMarkdown(report), 'utf-8')

console.log(`JSON: ${output}`)
console.log(`Markdown: ${mdOutput}`)

function buildInventory() {
  const stockSymbol = sinaStockSymbol(STOCK_CODE)
  const indexSymbol = `s_${sinaIndexSymbol(INDEX_CODE)}`
  const explicitSurfaces = [
    {
      id: 'sina.direct.stock_quote',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://hq.sinajs.cn/list=',
      params: { list: stockSymbol },
      currentCodePath: 'finagent_workstation/src/agent/data/sina-fetcher.ts; app/lib/agent/data_fetcher/cn_fetchers.dart',
      purpose: 'A-share realtime stock quote',
      candidateInterfaceId: 'stock.quote',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical quote_snapshot',
      safeToCall: true,
    },
    {
      id: 'sina.direct.index_quote',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://hq.sinajs.cn/list=',
      params: { list: indexSymbol },
      currentCodePath: 'finagent_workstation/src/domain/market/providers/bridge-finance-provider.ts; app/lib/domain/market/providers/data_api_interface_contract.dart',
      purpose: 'A-share index realtime quote',
      candidateInterfaceId: 'index.quote',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical quote_snapshot',
      safeToCall: true,
    },
    {
      id: 'sina.direct.finance_news',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://feed.mix.sina.com.cn/api/roll/get',
      params: { pageid: '153', lid: '2516', k: QUERY, num: '10', page: '1' },
      currentCodePath: 'finagent_workstation/src/domain/market/services/finance-news-data-api-service.ts; app/lib/domain/market/services/finance_news_market_data_service.dart',
      purpose: 'Sina finance news feed/search',
      candidateInterfaceId: 'news.finance_feed',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical finance_news',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_identity_list',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
      params: { page: '1', num: '20', sort: 'symbol', asc: '1', node: 'hs_a', symbol: '', _s_r_a: 'init' },
      currentCodePath: 'finagent_workstation/src/agent/data/fetchers/fetcher-stock-list.ts; app/lib/agent/data_fetcher/cn_fetchers.dart',
      purpose: 'A-share stock identity/list candidate',
      candidateInterfaceId: 'stock.identity_list',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical stock_list',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_kline_daily',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData',
      params: { symbol: stockSymbol, scale: '240', ma: 'no', datalen: '10' },
      currentCodePath: 'finagent_workstation/src/agent/data/fetchers/fetcher-kline-daily.ts; app/lib/agent/data_fetcher/cn_fetchers.dart',
      purpose: 'A-share daily historical K-line candidate',
      candidateInterfaceId: 'stock.daily_kline',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical kline_daily; unadjusted bars only',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_kline_intraday',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData',
      params: { symbol: stockSymbol, scale: '5', ma: 'no', datalen: '10' },
      currentCodePath: 'finagent_workstation/src/agent/data/output-only-interfaces.ts; app/lib/domain/market/providers/output_only_api_interface_contract.dart',
      purpose: 'A-share intraday 5-minute OHLCV bars',
      candidateInterfaceId: 'market.intraday_ohlcv_bars',
      currentGovernance: 'known-schema-output-only',
      expectedContract: 'typed output-only evidence until a dedicated intraday-bar table/readback contract exists; do not write to tick_chart_intraday',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_transaction_count',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_Bill.GetBillListCount',
      params: {
        symbol: stockSymbol,
        num: '60',
        page: '1',
        sort: 'ticktime',
        asc: '0',
        volume: '0',
        amount: '0',
        type: '0',
        day: dashedDate(TRADE_DATE),
      },
      currentCodePath: 'finagent_workstation/src/agent/data/output-only-interfaces.ts; app/lib/domain/market/providers/output_only_api_interface_contract.dart; stock.transactions fetchers use the count only as bounded pagination evidence',
      purpose: 'Sina intraday transaction count for bounded pagination',
      candidateInterfaceId: 'stock.transaction_count',
      currentGovernance: 'known-schema-output-only',
      expectedContract: 'typed output-only pagination evidence for stock.transactions; count is not persisted as canonical transaction row data',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_transactions',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_Bill.GetBillList',
      params: {
        symbol: stockSymbol,
        num: '60',
        page: '1',
        sort: 'ticktime',
        asc: '0',
        volume: '0',
        amount: '0',
        type: '0',
        day: dashedDate(TRADE_DATE),
      },
      currentCodePath: 'finagent_workstation/src/domain/market/services/transactions-market-data-service.ts; app/lib/domain/market/services/market_data_tdx_action_service.dart',
      purpose: 'Sina intraday transaction rows',
      candidateInterfaceId: 'stock.transactions',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical transactions through stock.transactions provider capability',
      safeToCall: true,
    },
    {
      id: 'sina.direct.fund_etf_quote_list',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: "https://vip.stock.finance.sina.com.cn/quotes_service/api/jsonp.php/IO.XSRV2.CallbackList['da_yPT46_Ll7K6WD']/Market_Center.getHQNodeDataSimple",
      params: { page: '1', num: '20', sort: 'symbol', asc: '0', node: 'etf_hq_fund' },
      currentCodePath: 'finagent_workstation/src/domain/market/services/fund-market-data-fetch-service.ts; app/lib/domain/market/providers/fetcher_eastmoney_market_provider.dart',
      purpose: 'ETF realtime quote/list rows',
      candidateInterfaceId: 'fund.etf_quote',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical quote_snapshot + stock_list through fund.etf_quote provider capability',
      safeToCall: true,
    },
    {
      id: 'sina.direct.fund_etf_daily_kline',
      runtime: 'finagent_workstation-candidate,shared_mobile-candidate',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://finance.sina.com.cn/realstock/company/sh510050/hisdata_klc2/klc_kl.js',
      params: {},
      currentCodePath: 'finagent_workstation/src/agent/data/output-only-interfaces.ts; app/lib/domain/market/providers/output_only_api_interface_contract.dart; local AkShare fund_etf_sina decoder reference',
      purpose: 'ETF encrypted daily historical K-line payload',
      candidateInterfaceId: 'fund.etf_daily_ohlcv_bars',
      currentGovernance: 'known-schema-output-only-with-direct-diagnostic',
      expectedContract: 'decoded ETF exchange OHLCV rows are typed output-only; direct Sina KLC_K2 payload remains diagnostic and must not be mapped to fund_nav',
      safeToCall: true,
    },
    {
      id: 'sina.direct.fund_etf_dividend',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://finance.sina.com.cn/realstock/company/sh510050/hfq.js',
      params: {},
      currentCodePath: 'finagent_workstation/src/agent/data/output-only-interfaces.ts; app/lib/domain/market/providers/output_only_api_interface_contract.dart',
      purpose: 'ETF cumulative dividend/factor rows',
      candidateInterfaceId: 'fund.dividend_factor',
      currentGovernance: 'known-schema-output-only',
      expectedContract: 'typed output-only evidence unless a fund dividend/corporate-action interface is added',
      safeToCall: true,
    },
    {
      id: 'sina.direct.market_sector_ranking_industry',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php',
      params: {},
      currentCodePath: 'finagent_workstation/src/agent/data/fetchers/fetcher-sector.ts; app/lib/domain/market/providers/fetcher_market_data_provider.dart',
      purpose: 'Sina industry sector ranking rows',
      candidateInterfaceId: 'market.sector_ranking',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical sector_rank through market.sector_ranking provider capability',
      safeToCall: true,
    },
    {
      id: 'sina.direct.market_sector_ranking_concept',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'http://money.finance.sina.com.cn/q/view/newFLJK.php',
      params: { param: 'class' },
      currentCodePath: 'finagent_workstation/src/agent/data/fetchers/fetcher-sector.ts; app/lib/domain/market/providers/fetcher_market_data_provider.dart',
      purpose: 'Sina concept board ranking rows',
      candidateInterfaceId: 'market.board_ranking',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical sector_rank through market.board_ranking provider capability',
      safeToCall: true,
    },
    {
      id: 'sina.direct.market_sector_constituents',
      runtime: 'finagent_workstation,shared_mobile_finagent',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
      params: { page: '1', num: '20', sort: 'symbol', asc: '1', node: 'gn_gfgn', symbol: '', _s_r_a: 'page' },
      currentCodePath: 'finagent_workstation/src/domain/market/services/eastmoney-market-data-service.ts; app/lib/domain/market/providers/fetcher_eastmoney_market_provider.dart',
      purpose: 'Sina sector constituent quote/member rows',
      candidateInterfaceId: 'market.board_members,market.sector_constituents',
      currentGovernance: 'supported-governed',
      expectedContract: 'canonical industry_map through market.sector_constituents provider capability',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_classify_nodes',
      runtime: 'finagent_workstation-candidate,shared_mobile-candidate',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes',
      params: {},
      currentCodePath: 'finagent_workstation/src/agent/data/output-only-interfaces.ts; app/lib/domain/market/providers/output_only_api_interface_contract.dart; AkShare stock_classify_sina broad wrapper reference',
      purpose: 'Sina stock classification tree nodes',
      candidateInterfaceId: 'market.classification_nodes',
      currentGovernance: 'known-schema-output-only',
      expectedContract: 'typed bounded classification-node evidence; broad per-node stock expansion remains separate from the node tree contract',
      safeToCall: true,
    },
    {
      id: 'sina.direct.stock_esg_rate_page',
      runtime: 'finagent_workstation-candidate,shared_mobile-candidate',
      kind: 'direct-sina',
      provider: 'sina',
      endpoint: 'https://global.finance.sina.com.cn/api/openapi.php/EsgService.getEsgStocks',
      params: { page: '1', num: '20' },
      currentCodePath: 'finagent_workstation/src/agent/data/output-only-interfaces.ts; app/lib/domain/market/providers/output_only_api_interface_contract.dart; AkShare stock_esg_rate_sina broad wrapper reference',
      purpose: 'Sina ESG rating page with multi-agency ratings',
      candidateInterfaceId: 'stock.esg_rating_multi_agency',
      currentGovernance: 'known-schema-output-only',
      expectedContract: 'typed bounded ESG evidence; full-history/page collection requires explicit batch workflow and should not be a normal lightweight probe',
      safeToCall: true,
    },
    {
      id: 'sina.wrapper.akshare_stock_zh_a_spot',
      runtime: 'finagent_workstation',
      kind: 'akshare-wrapper-sina-related',
      provider: 'akshare',
      upstreamOrigin: 'sina-or-wrapper-ambiguous',
      endpoint: `${SIDECAR}/akshare/stock_zh_a_spot`,
      params: { _priority: 'background' },
      currentCodePath: 'finagent_workstation/src/agent/data/fetchers/fetcher-stock-list.ts; ingestion registry',
      purpose: 'A-share spot/list compatibility wrapper',
      candidateInterfaceId: 'stock.identity_list,stock.quote',
      currentGovernance: 'akshare.stock.identity_list with origin metadata, not direct Sina',
      expectedContract: 'wrapper evidence only; direct Sina support requires separate adapter',
      safeToCall: true,
      requiresSidecar: true,
    },
    {
      id: 'sina.wrapper.akshare_index_stock_cons',
      runtime: 'finagent_workstation',
      kind: 'akshare-wrapper-sina-origin',
      provider: 'akshare',
      upstreamOrigin: 'sina',
      endpoint: `${SIDECAR}/akshare/index_stock_cons`,
      params: { symbol: INDEX_CODE, _priority: 'background' },
      currentCodePath: 'finagent_workstation/src/agent/data/fetchers/fetcher-index-components.ts',
      purpose: 'Index constituents via AkShare wrapper',
      candidateInterfaceId: 'index.constituents',
      currentGovernance: 'akshare.index.constituents supported with upstreamOrigin:sina',
      expectedContract: 'index_constituent through AkShare, not direct Sina',
      safeToCall: true,
      requiresSidecar: true,
    },
    {
      id: 'sina.wrapper.akshare_lhb_sina',
      runtime: 'finagent_workstation',
      kind: 'akshare-wrapper-sina-named',
      provider: 'akshare',
      endpoint: `${SIDECAR}/akshare/stock_lhb_detail_daily_sina`,
      params: { date: TRADE_DATE, _priority: 'background' },
      currentCodePath: 'finagent_workstation/sidecar/server.py; ingestion registry',
      purpose: 'Dragon-tiger compatibility route with Sina-named AkShare function',
      candidateInterfaceId: 'market.dragon_tiger',
      currentGovernance: 'akshare.market.dragon_tiger not-supported; EastMoney direct route preferred',
      expectedContract: 'explicit not-supported unless stable app-level route exists',
      safeToCall: true,
      requiresSidecar: true,
    },
  ]
  return [
    ...explicitSurfaces,
    ...discoverAkshareSinaFunctions(explicitSurfaces),
  ]
}

function filterInventory(items) {
  if (scope === 'all') return items
  if (scope === 'direct') return items.filter((item) => item.kind === 'direct-sina')
  if (scope === 'wrappers') return items.filter((item) => item.kind.startsWith('akshare-wrapper'))
  if (scope === 'references') return items.filter((item) => item.kind === 'akshare-reference-sina-function')
  if (scope.startsWith('id:')) {
    const wanted = new Set(scope.slice(3).split(',').map((value) => value.trim()).filter(Boolean))
    return items.filter((item) => wanted.has(item.id))
  }
  throw new Error(`Unsupported scope "${scope}". Use all, direct, wrappers, references, or id:<comma-separated ids>.`)
}

async function probe(item) {
  const startedAt = new Date().toISOString()
  if (!item.safeToCall) {
    return resultFor(item, {
      startedAt,
      status: 'exempt',
      failureClass: item.exemptionClass ?? 'needs_probe_profile',
      error: item.exemptionReason ?? 'Reference surface is inventoried but has no bounded probe profile yet.',
    })
  }
  if (item.requiresSidecar) {
    const available = await sidecarAvailable()
    if (!available) {
      return resultFor(item, {
        startedAt,
        status: 'exempt',
        failureClass: 'runtime_unavailable',
        error: 'AkShare sidecar is not reachable; wrapper surface remains inventoried and requires sidecar probe evidence before promotion.',
      })
    }
  }
  try {
    const url = buildUrl(item.endpoint, item.params)
    const response = await fetch(url, {
      headers: headersFor(item),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const buffer = await response.arrayBuffer()
    const body = decodeBody(buffer, response.headers.get('content-type') ?? '')
    const parsed = parseBody(item, body)
    const rawPath = `${rawDir}/${item.id}.txt`
    writeFileSync(rawPath, body.slice(0, 200_000), 'utf-8')
    const responseFailure = response.ok ? null : classifyResponseFailure(item, body, response.status)
    return resultFor(item, {
      startedAt,
      status: response.ok && parsed.rowCount > 0 ? 'passed' : response.ok ? 'failed' : 'failed',
      failureClass: response.ok && parsed.rowCount > 0 ? null : response.ok ? parsed.failureClass ?? 'empty_or_schema_unexpected' : responseFailure.failureClass,
      httpStatus: response.status,
      rowCount: parsed.rowCount,
      columns: parsed.columns,
      schema: parsed.schema,
      providerDataTime: parsed.providerDataTime,
      rawPath,
      error: response.ok ? parsed.error : responseFailure.error,
    })
  } catch (error) {
    return resultFor(item, {
      startedAt,
      status: 'failed',
      failureClass: classifyError(error),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function resultFor(item, values) {
  return {
    id: item.id,
    runtime: item.runtime,
    kind: item.kind,
    provider: item.provider,
    upstreamOrigin: item.upstreamOrigin ?? null,
    endpoint: item.endpoint,
    candidateInterfaceId: item.candidateInterfaceId,
    currentGovernance: item.currentGovernance,
    expectedContract: item.expectedContract,
    startedAt: values.startedAt,
    fetchedAt: new Date().toISOString(),
    status: values.status,
    failureClass: values.failureClass ?? null,
    httpStatus: values.httpStatus ?? null,
    rowCount: values.rowCount ?? 0,
    columns: values.columns ?? [],
    schema: values.schema ?? {},
    providerDataTime: values.providerDataTime ?? null,
    rawPath: values.rawPath ?? null,
    error: values.error ?? null,
    promotionHint: promotionHint(item, values),
  }
}

function parseBody(item, body) {
  if (item.id === 'sina.direct.stock_quote') return parseSinaStockQuote(body)
  if (item.id === 'sina.direct.index_quote') return parseSinaIndexQuote(body)
  if (item.id === 'sina.direct.finance_news') return parseSinaNews(body)
  if (item.id === 'sina.direct.stock_identity_list') return parseJsonRows(body)
  if (item.id === 'sina.direct.stock_transaction_count') return parseSinaTransactionCount(body)
  if (item.id === 'sina.direct.stock_transactions') return parseJsonRows(body)
  if (item.id === 'sina.direct.fund_etf_quote_list') return parseSinaJsonpRows(body)
  if (item.id === 'sina.direct.fund_etf_daily_kline') return parseSinaEncryptedKline(body)
  if (item.id === 'sina.direct.fund_etf_dividend') return parseSinaJsVarRows(body, 'data')
  if (item.id.includes('market_sector_ranking')) return parseSinaSectorRanking(body)
  if (item.id === 'sina.direct.market_sector_constituents') return parseJsonRows(body)
  if (item.id === 'sina.direct.stock_classify_nodes') return parseSinaClassifyNodes(body)
  if (item.id === 'sina.direct.stock_esg_rate_page') return parseSinaEsgRatePage(body)
  if (item.id.includes('stock_kline')) return parseJsonRows(body)
  if (item.kind.startsWith('akshare-wrapper') || item.kind === 'akshare-reference-sina-function') return parseWrapperJson(body)
  return { rowCount: 0, columns: [], schema: {}, error: 'no parser registered' }
}

function discoverAkshareSinaFunctions(explicitSurfaces) {
  if (!akshareRepo) {
    return [{
      id: 'sina.reference.akshare_census_unavailable',
      runtime: 'reference-only',
      kind: 'akshare-reference-census',
      provider: 'akshare',
      upstreamOrigin: 'sina',
      endpoint: '',
      params: {},
      currentCodePath: '',
      purpose: 'AkShare local source tree was not configured for Sina reference census',
      candidateInterfaceId: 'diagnostic.provider_reference',
      currentGovernance: 'reference-census-unavailable',
      expectedContract: 'pass --akshare-repo or set AKSHARE_REPO before claiming all wrapper-origin Sina functions are inventoried',
      safeToCall: false,
      exemptionClass: 'reference_unavailable',
      exemptionReason: 'AKSHARE_REPO is not configured',
    }]
  }
  const root = resolve(akshareRepo)
  let files = []
  try {
    files = walkPyFiles(root)
  } catch (error) {
    return [{
      id: 'sina.reference.akshare_census_unavailable',
      runtime: 'reference-only',
      kind: 'akshare-reference-census',
      provider: 'akshare',
      upstreamOrigin: 'sina',
      endpoint: root,
      params: {},
      currentCodePath: root,
      purpose: 'AkShare local source tree could not be read for Sina reference census',
      candidateInterfaceId: 'diagnostic.provider_reference',
      currentGovernance: 'reference-census-unavailable',
      expectedContract: 'fix local AkShare path before claiming all wrapper-origin Sina functions are inventoried',
      safeToCall: false,
      exemptionClass: 'reference_unavailable',
      exemptionReason: error instanceof Error ? error.message : String(error),
    }]
  }

  const alreadyNamed = new Set(explicitSurfaces.map((item) => item.endpoint.split('/').at(-1)))
  const rows = []
  for (const file of files) {
    const text = readFileSync(file, 'utf-8')
    for (const match of text.matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm)) {
      const functionName = match[1]
      if (functionName.startsWith('_')) continue
      const isNamedSina = functionName.includes('sina')
      const isKnownSinaOriginAlias = functionName === 'stock_zh_a_spot' || functionName === 'index_stock_cons'
      if (!isNamedSina && !isKnownSinaOriginAlias) continue
      if (alreadyNamed.has(functionName)) continue
      const modulePath = relative(root, file)
      rows.push({
        id: `sina.reference.akshare.${functionName}`,
        runtime: 'reference-only',
        kind: 'akshare-reference-sina-function',
        provider: 'akshare',
        upstreamOrigin: isNamedSina ? 'sina' : 'sina-or-wrapper-ambiguous',
        endpoint: `${SIDECAR}/akshare/${functionName}`,
        params: { ...defaultProbeParams(functionName, match[2]), _priority: 'background' },
        signature: compactSignature(match[2]),
        currentCodePath: `${akshareRepo}/${modulePath}`,
        purpose: `AkShare reference function ${functionName}`,
        candidateInterfaceId: inferCandidateInterfaceFromFunction(functionName),
        currentGovernance: 'reference-only-bounded-probe',
        expectedContract: 'bounded AkShare wrapper evidence; classify before provider promotion',
        safeToCall: true,
        requiresSidecar: true,
        probeProfile: 'akshare-generic-default-or-profiled-params',
      })
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

function defaultProbeParams(functionName, signature = '') {
  const profiles = {
    bond_cb_profile_sina: { symbol: 'sz128039' },
    bond_cb_summary_sina: { symbol: 'sh155255' },
    fund_etf_category_sina: { symbol: 'ETF基金' },
    fund_etf_dividend_sina: { symbol: 'sh510050' },
    fund_etf_hist_sina: { symbol: 'sh510050' },
    stock_financial_report_sina: { stock: STOCK_CODE, symbol: '资产负债表' },
    stock_restricted_release_queue_sina: { symbol: STOCK_CODE },
    stock_intraday_sina: { symbol: sinaStockSymbol(STOCK_CODE), date: TRADE_DATE },
    stock_classify_sina: { symbol: '热门概念' },
    futures_hold_pos_sina: { symbol: '多单持仓', contract: 'OI2501', date: '20241016' },
    index_global_hist_sina: { symbol: '英国富时100指数' },
    index_stock_cons_sina: { symbol: INDEX_CODE },
    index_stock_cons: { symbol: INDEX_CODE },
    option_sse_list_sina: { symbol: '50ETF', exchange: 'null' },
    option_sse_expire_day_sina: { trade_date: '202606', symbol: '50ETF', exchange: 'null' },
    option_sse_codes_sina: { symbol: '看涨期权', trade_date: '202606', underlying: '510050' },
    option_sse_spot_price_sina: { symbol: '10003720' },
    option_sse_underlying_spot_price_sina: { symbol: 'sh510050' },
    option_sse_greeks_sina: { symbol: '10003720' },
    option_sse_minute_sina: { symbol: '10011251' },
    option_sse_daily_sina: { symbol: '10003720' },
    option_finance_minute_sina: { symbol: '10003720' },
    stock_lhb_detail_daily_sina: { date: TRADE_DATE },
  }
  return { ...simpleDefaultParams(signature), ...(profiles[functionName] ?? {}) }
}

function simpleDefaultParams(signature) {
  const params = {}
  for (const part of splitSignatureParams(signature)) {
    const match = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*(.+?)\s*$/)
    if (!match) continue
    const [, name, rawValue] = match
    const value = parseSimpleDefaultValue(rawValue)
    if (value !== undefined) params[name] = value
  }
  return params
}

function splitSignatureParams(signature) {
  const parts = []
  let current = ''
  let quote = null
  let depth = 0
  for (const char of signature) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '[' || char === '(' || char === '{') depth += 1
    if (char === ']' || char === ')' || char === '}') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts
}

function parseSimpleDefaultValue(rawValue) {
  const trimmed = rawValue.trim()
  const stringMatch = trimmed.match(/^(['"])(.*)\1$/)
  if (stringMatch) return stringMatch[2]
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed === 'True') return 'true'
  if (trimmed === 'False') return 'false'
  if (trimmed === 'None') return 'null'
  return undefined
}

function walkPyFiles(root) {
  const out = []
  for (const entry of readdirSync(root)) {
    if (entry === '__pycache__' || entry.startsWith('.')) continue
    const path = resolve(root, entry)
    const info = statSync(path)
    if (info.isDirectory()) out.push(...walkPyFiles(path))
    else if (entry.endsWith('.py')) out.push(path)
  }
  return out
}

function compactSignature(signature) {
  return signature.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function inferCandidateInterfaceFromFunction(name) {
  if (name.includes('option')) return 'derivative.option.*'
  if (name.includes('futures')) return 'derivative.futures.*'
  if (name.includes('bond')) return 'bond.*'
  if (name.includes('fund')) return 'fund.*'
  if (name.includes('index')) return 'index.*'
  if (name.includes('lhb')) return 'market.dragon_tiger'
  if (name.includes('esg')) return 'stock.esg.*'
  if (name.includes('financial_report')) return 'stock.financial_report'
  if (name.includes('restricted_release')) return 'stock.restricted_release'
  if (name.includes('intraday')) return 'stock.intraday_tick'
  if (name.includes('stock_zh_a_spot')) return 'stock.identity_list,stock.quote'
  if (name.includes('stock')) return 'stock.*'
  if (name.includes('currency')) return 'fx.*'
  if (name.includes('trade_date')) return 'calendar.trade'
  return 'provider_specific.known_schema_candidate'
}

function parseSinaStockQuote(body) {
  const rows = []
  for (const match of body.matchAll(/hq_str_(s[hz]\d{6})="([^"]*)"/g)) {
    const parts = match[2].split(',')
    if (parts.length < 32) continue
    rows.push({
      code: match[1].slice(2),
      name: parts[0],
      open: Number(parts[1]),
      prevClose: Number(parts[2]),
      price: Number(parts[3]),
      high: Number(parts[4]),
      low: Number(parts[5]),
      volume: Number(parts[8]),
      amount: Number(parts[9]),
      providerDate: parts[30],
      providerTime: parts[31],
    })
  }
  return parsedRows(rows, rows[0]?.providerDate && rows[0]?.providerTime ? `${rows[0].providerDate} ${rows[0].providerTime}` : null)
}

function parseSinaIndexQuote(body) {
  const rows = []
  for (const match of body.matchAll(/hq_str_s_(s[hz]\d{6})="([^"]*)"/g)) {
    const parts = match[2].split(',')
    if (parts.length < 6) continue
    rows.push({
      code: match[1].slice(2),
      name: parts[0],
      price: Number(parts[1]),
      change: Number(parts[2]),
      changePct: Number(parts[3]),
      volume: Number(parts[4]),
      amount: Number(parts[5]),
    })
  }
  return parsedRows(rows)
}

function parseSinaNews(body) {
  const json = safeJson(body)
  const rows = json?.result?.data
  if (!Array.isArray(rows)) return { rowCount: 0, columns: [], schema: {}, error: 'missing result.data' }
  const normalized = rows.map((item) => ({
    title: item?.title,
    url: item?.url,
    source: item?.media_name ?? item?.source ?? '新浪财经',
    published_at: item?.ctime ?? item?.createtime,
  })).filter((item) => item.title)
  return parsedRows(normalized, latest(normalized.map((item) => item.published_at).filter(Boolean)))
}

function parseJsonRows(body) {
  const json = safeJson(body)
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.result?.data) ? json.result.data : []
  if (!Array.isArray(rows)) return { rowCount: 0, columns: [], schema: {}, error: 'json response did not contain rows' }
  return parsedRows(rows)
}

function parseSinaTransactionCount(body) {
  const json = safeJson(body)
  const count = Number(json ?? String(body).trim())
  if (!Number.isFinite(count)) {
    return {
      rowCount: 0,
      columns: [],
      schema: {},
      error: 'transaction count response was not numeric',
    }
  }
  return parsedRows([{ count }])
}

function parseSinaJsonpRows(body) {
  const json = safeJson(body)
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
  if (!Array.isArray(rows)) return { rowCount: 0, columns: [], schema: {}, error: 'jsonp response did not contain rows' }
  return parsedRows(rows)
}

function parseSinaJsVarRows(body, field) {
  const json = safeJsAssignmentJson(body)
  const rows = Array.isArray(json?.[field]) ? json[field] : []
  if (!Array.isArray(rows)) return { rowCount: 0, columns: [], schema: inferSchema(json ?? {}), error: `js assignment missing ${field} rows` }
  return parsedRows(rows, latest(rows.map((row) => row?.d ?? row?.date).filter(Boolean)))
}

function parseSinaEncryptedKline(body) {
  const encrypted = /^var\s+\w+\s*=\s*"[^"]+"/.test(body.trim())
  return {
    rowCount: 0,
    columns: encrypted ? ['encryptedPayload'] : [],
    schema: encrypted ? { encryptedPayload: 'string' } : {},
    error: encrypted ? 'Sina KLC encrypted JavaScript payload requires decoder before schema promotion' : 'unexpected K-line payload shape',
    failureClass: encrypted ? 'encrypted_payload_decoder_missing' : 'empty_or_schema_unexpected',
  }
}

function parseSinaSectorRanking(body) {
  const json = safeJsAssignmentJson(body)
  if (!json || typeof json !== 'object') return { rowCount: 0, columns: [], schema: {}, error: 'sector ranking JS object missing' }
  const rows = Object.entries(json).map(([key, value]) => {
    const parts = String(value ?? '').split(',')
    return {
      sector_code: parts[0] || key,
      sector_name: parts[1],
      company_count: numericValue(parts[2]),
      avg_price: numericValue(parts[3]),
      change: numericValue(parts[4]),
      change_pct: numericValue(parts[5]),
      total_volume: numericValue(parts[6]),
      total_amount: numericValue(parts[7]),
      leader_symbol: parts[8],
      leader_change_pct: numericValue(parts[9]),
      leader_price: numericValue(parts[10]),
      leader_change: numericValue(parts[11]),
      leader_name: parts[12],
    }
  }).filter((row) => row.sector_code && row.sector_name)
  return parsedRows(rows)
}

function parseSinaClassifyNodes(body) {
  const json = safeJson(body)
  if (!Array.isArray(json)) return { rowCount: 0, columns: [], schema: {}, error: 'classification tree JSON missing' }
  const rows = []
  function visit(node, parent = null) {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'string' && typeof node[2] === 'string') {
      rows.push({ name: stripHtml(node[0]), code: node[2], parent })
    }
    for (const child of node) {
      if (Array.isArray(child)) visit(child, typeof node[0] === 'string' ? stripHtml(node[0]) : parent)
    }
  }
  visit(json)
  return parsedRows(rows.filter((row) => row.name && row.code))
}

function parseSinaEsgRatePage(body) {
  const json = safeJson(body)
  const stocks = json?.result?.data?.info?.stocks
  if (!Array.isArray(stocks)) return { rowCount: 0, columns: [], schema: inferSchema(json ?? {}), error: 'ESG rating stocks missing' }
  const rows = []
  for (const stock of stocks) {
    const ratings = Array.isArray(stock?.esg_info) ? stock.esg_info : []
    for (const rating of ratings) {
      rows.push({
        symbol: stock?.symbol,
        market: stock?.market,
        agency: rating?.agency,
        agencyName: rating?.agency_name,
        esgScore: rating?.esg_score,
        esgDate: rating?.esg_dt,
        remark: rating?.remark ?? null,
      })
    }
  }
  return parsedRows(rows)
}

function parseWrapperJson(body) {
  const json = safeJson(body)
  if (!json) return { rowCount: 0, columns: [], schema: {}, error: 'wrapper returned non-json body' }
  if (json.error) return { rowCount: 0, columns: [], schema: inferSchema(json), error: String(json.error), failureClass: 'provider_error' }
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []
  if (rows.length === 0 && Array.isArray(json.columns) && json.columns.length > 0) {
    return {
      rowCount: 0,
      columns: json.columns,
      schema: Object.fromEntries(json.columns.map((column) => [column, 'unknown'])),
      error: 'provider returned a declared schema with zero rows',
      failureClass: 'empty_known_schema',
    }
  }
  if (rows.length === 0 && Object.prototype.hasOwnProperty.call(json, 'data')) {
    return parsedStructuredValue(json.data)
  }
  return parsedRows(rows)
}

function classifyResponseFailure(item, body, status) {
  const parsed = safeJson(body)
  const message = parsed?.error ? String(parsed.error) : `HTTP ${status}`
  if (item.kind?.startsWith('akshare-wrapper')) {
    if (/ProxyError|Unable to connect to proxy|Tunnel connection failed/i.test(message)) {
      return { failureClass: 'transport_proxy_error', error: message }
    }
    if (/No value to decode|JSONDecodeError|schema|decode/i.test(message)) {
      return { failureClass: 'wrapper_parser_error', error: message }
    }
  }
  return { failureClass: 'http_error', error: message }
}

function parsedRows(rows, providerDataTime = null) {
  const first = rows[0] && typeof rows[0] === 'object' ? rows[0] : null
  return {
    rowCount: rows.length,
    columns: first ? Object.keys(first) : [],
    schema: first ? inferSchema(first) : {},
    providerDataTime,
    error: rows.length > 0 ? null : 'parsed zero rows',
  }
}

function parsedStructuredValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rows = Object.entries(value).map(([key, item]) => ({
      key,
      value: Array.isArray(item) ? item.join(',') : item,
      valueCount: Array.isArray(item) ? item.length : null,
    }))
    return parsedRows(rows)
  }
  if (value !== null && value !== undefined && String(value).trim() !== '') {
    return parsedRows([{ value: String(value) }])
  }
  return {
    rowCount: 0,
    columns: [],
    schema: {},
    error: 'provider returned an empty scalar payload',
    failureClass: 'empty_or_schema_unexpected',
  }
}

function inferSchema(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value]))
}

function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').trim()
}

function safeJson(body) {
  const text = body.trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('(')
    const end = text.lastIndexOf(')')
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start + 1, end)) } catch { return null }
    }
    return null
  }
}

function safeJsAssignmentJson(body) {
  const text = body.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  const parenStart = text.indexOf('(')
  const parenEnd = text.lastIndexOf(')')
  if (parenStart >= 0 && parenEnd > parenStart) {
    try { return JSON.parse(text.slice(parenStart + 1, parenEnd)) } catch {}
  }
  return null
}

function numericValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function buildUrl(base, params) {
  if (!params || Object.keys(params).length === 0) return base
  if (base.endsWith('list=') && params.list) return `${base}${params.list}`
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return url.toString()
}

function headersFor(item) {
  if (item.provider === 'sina') {
    if (String(item.endpoint).includes('CN_Bill.')) {
      const symbol = item.params?.symbol ?? sinaStockSymbol(STOCK_CODE)
      return {
        Referer: `https://vip.stock.finance.sina.com.cn/quotes_service/view/cn_bill.php?symbol=${symbol}`,
        'User-Agent': 'Mozilla/5.0',
      }
    }
    return {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    }
  }
  return { 'User-Agent': 'Mozilla/5.0' }
}

function decodeBody(buffer, contentType) {
  const lower = contentType.toLowerCase()
  if (lower.includes('utf-8') || lower.includes('json')) return new TextDecoder('utf-8').decode(buffer)
  for (const encoding of ['gb18030', 'gbk', 'utf-8']) {
    try { return new TextDecoder(encoding).decode(buffer) } catch {}
  }
  return new TextDecoder().decode(buffer)
}

async function sidecarAvailable() {
  try {
    const response = await fetch(`${SIDECAR}/health`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

function promotionHint(item, values) {
  if (values.status === 'exempt' && values.failureClass === 'needs_probe_profile') return 'reference-inventory-only-add-bounded-probe-before-promotion'
  if (item.id === 'sina.direct.fund_etf_daily_kline' && values.failureClass === 'encrypted_payload_decoder_missing') {
    return 'classified-output-only-fund.etf_daily_ohlcv_bars-direct-encrypted-diagnostic'
  }
  if (values.status !== 'passed') return 'do-not-promote-until-probe-passes'
  if (item.id === 'sina.direct.stock_quote') return 'already-promoted-stock.quote'
  if (item.id === 'sina.direct.index_quote') return 'already-promoted-index.quote'
  if (item.id === 'sina.direct.finance_news') return 'already-promoted-news.finance_feed'
  if (item.id === 'sina.direct.stock_identity_list') return 'already-promoted-stock.identity_list'
  if (item.id === 'sina.direct.stock_kline_daily') return 'already-promoted-stock.daily_kline-unadjusted'
  if (item.id === 'sina.direct.stock_kline_intraday') return 'classified-output-only-minute-ohlcv-not-tick-chart'
  if (item.id === 'sina.direct.stock_transaction_count') return 'classified-output-only-stock.transaction_count'
  if (item.id === 'sina.direct.stock_transactions') return 'already-promoted-stock.transactions'
  if (item.id === 'sina.direct.fund_etf_quote_list') return 'already-promoted-fund.etf_quote'
  if (item.id === 'sina.direct.fund_etf_dividend') return 'classified-output-only-fund.dividend_factor'
  if (item.id === 'sina.direct.market_sector_ranking_industry') return 'already-promoted-market.sector_ranking'
  if (item.id === 'sina.direct.market_sector_ranking_concept') return 'already-promoted-market.board_ranking'
  if (item.id === 'sina.direct.market_sector_constituents') return 'already-promoted-market.sector_constituents-and-market.board_members'
  if (item.id === 'sina.direct.stock_classify_nodes') return 'classified-output-only-market.classification_nodes'
  if (item.id === 'sina.direct.stock_esg_rate_page') return 'classified-output-only-stock.esg_rating_multi_agency'
  if (item.id.startsWith('sina.direct.fund_')) return 'candidate-promote-after-normalizer-readback'
  if (item.id.startsWith('sina.direct.market_sector_')) return 'candidate-promote-after-sector-mapping-normalizer-readback'
  return 'wrapper-evidence-keep-separated-from-direct-sina-provider'
}

function classifyError(error) {
  const text = error instanceof Error ? error.message : String(error)
  if (/timeout|aborted/i.test(text)) return 'transport_timeout'
  if (/fetch failed|ECONN|socket|network/i.test(text)) return 'transport_or_network'
  return 'runtime_error'
}

function summarize(rows) {
  const byStatus = countBy(rows, (row) => row.status)
  const byFailureClass = countBy(rows.filter((row) => row.failureClass), (row) => row.failureClass)
  return {
    total: rows.length,
    passed: byStatus.passed ?? 0,
    failed: byStatus.failed ?? 0,
    exempt: byStatus.exempt ?? 0,
    byStatus,
    byFailureClass,
    directSinaRows: rows.filter((row) => row.kind === 'direct-sina').length,
    wrapperRows: rows.filter((row) => row.kind.startsWith('akshare-wrapper')).length,
    akshareReferenceRows: rows.filter((row) => row.kind === 'akshare-reference-sina-function').length,
    needsProbeProfile: rows.filter((row) => row.failureClass === 'needs_probe_profile').length,
    promotionCandidates: rows.filter((row) => String(row.promotionHint).startsWith('candidate')).length,
  }
}

function countBy(rows, keyFn) {
  const out = {}
  for (const row of rows) {
    const key = keyFn(row) ?? 'unknown'
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Sina Finance First-Level Provider Probe Results')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Metric | Count |')
  lines.push('|---|---:|')
  for (const [key, value] of Object.entries(report.summary)) {
    if (typeof value === 'object') continue
    lines.push(`| ${key} | ${value} |`)
  }
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| API | Runtime | Kind | Interface | Status | Rows | Failure | Promotion hint |')
  lines.push('|---|---|---|---|---|---:|---|---|')
  for (const row of report.results) {
    lines.push(`| \`${row.id}\` | ${row.runtime} | ${row.kind} | \`${row.candidateInterfaceId}\` | ${row.status} | ${row.rowCount} | ${row.failureClass ?? '-'} | ${row.promotionHint} |`)
  }
  lines.push('')
  lines.push('## Inventory')
  lines.push('')
  lines.push('| API | Purpose | Current governance | Expected contract |')
  lines.push('|---|---|---|---|')
  for (const item of report.inventory) {
    lines.push(`| \`${item.id}\` | ${item.purpose} | ${item.currentGovernance} | ${item.expectedContract} |`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function sinaStockSymbol(code) {
  const clean = String(code).replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
  return `${clean.startsWith('6') ? 'sh' : 'sz'}${clean}`
}

function sinaIndexSymbol(code) {
  const clean = String(code).replace(/\.(SH|SZ)$/i, '').replace(/^(SH|SZ)/i, '')
  return `${clean.startsWith('399') ? 'sz' : 'sh'}${clean}`
}

function compactDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function dashedDate(value) {
  const clean = String(value).replace(/\D/g, '')
  if (clean.length !== 8) return String(value)
  return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
}

function latest(values) {
  return values.sort().at(-1) ?? null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const raw = arg.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) {
      out[raw.slice(0, eq)] = raw.slice(eq + 1)
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[raw] = argv[++i]
    } else {
      out[raw] = 'true'
    }
  }
  return out
}

function printUsage() {
  console.log(`Usage:
  node scripts/finance_sina_first_level_probe.mjs --wait-ms 1500 --timeout-ms 20000
  node scripts/finance_sina_first_level_probe.mjs --scope direct --wait-ms 300 --timeout-ms 20000
  node scripts/finance_sina_first_level_probe.mjs --scope id:sina.direct.stock_transactions --wait-ms 300

Optional reference census:
  --akshare-repo <path> or AKSHARE_REPO=<path>

Writes:
  reports/integrations/finance_sina_first_level_probe_results_2026_06_22.json
  reports/integrations/finance_sina_first_level_probe_results_2026_06_22.md`)
}
