#!/usr/bin/env node
// Controlled serial live probes for FinAgent Workstation finance provider families.
//
// Usage:
//   cd finagent_workstation
//   node scripts/finance_live_probe_matrix.mjs --stage smoke --wait-ms 1500
//
// Sidecar/gotdx/Wind/Tushare probes are skipped unless the matching runtime or
// credential is available. Direct public probes still run serially.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_SIDECAR_URL = process.env.AKSHARE_SIDECAR_URL ?? 'http://127.0.0.1:19800'
const DEFAULT_GOTDX_URL = process.env.GOTDX_URL ?? 'http://127.0.0.1:19801'
const DEFAULT_OUT_DIR = join(homedir(), '.finagent-workstation', 'manual-tests', 'finance-live-matrix')
const WIND_SERVERS = {
  stock_data: 'https://mcp.wind.com.cn/vserver_stock_data/mcp/',
  global_stock_data: 'https://mcp.wind.com.cn/vserver_global_stock_data/mcp/',
  fund_data: 'https://mcp.wind.com.cn/vserver_fund_data/mcp/',
  index_data: 'https://mcp.wind.com.cn/vserver_index_data/mcp/',
  bond_data: 'https://mcp.wind.com.cn/vserver_bond_data/mcp/',
  financial_docs: 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/',
  economic_data: 'https://mcp.wind.com.cn/vserver_economic_data/mcp/',
  analytics_data: 'https://mcp.wind.com.cn/vserver_analytics_data/mcp/',
}

const STOCK_CODE = process.env.FIN_API_TEST_STOCK ?? '600519'
const FUND_CODE = process.env.FIN_API_TEST_FUND ?? '000001'
const MONEY_FUND_CODE = process.env.FIN_API_TEST_MONEY_FUND ?? '000009'
const INDEX_CODE = process.env.FIN_API_TEST_INDEX ?? '000001'
const INDUSTRY_CODE = process.env.FIN_API_TEST_INDUSTRY_CODE ?? 'BK0475'
const TRADE_DATE = compactDate(new Date())
const DASH_DATE = dashedDate(TRADE_DATE)

const args = parseArgs(process.argv.slice(2))
const stage = args.stage ?? 'smoke'
const waitMs = Number(args['wait-ms'] ?? 1500)
const concurrency = Number(args.concurrency ?? 1)
const sidecarUrl = args['sidecar-url'] ?? DEFAULT_SIDECAR_URL
const gotdxUrl = args['gotdx-url'] ?? DEFAULT_GOTDX_URL
const includeQuota = args['include-quota'] === 'true' || stage === 'quota'
const noFailOnError = args['no-fail-on-error'] === 'true'
const only = args.only
const ids = new Set(String(args.ids ?? '').split(',').map((item) => item.trim()).filter(Boolean))
const output = args.output ?? join(DEFAULT_OUT_DIR, `finance-live-probe-${new Date().toISOString().replaceAll(':', '-')}.json`)
const checkpoint = args.checkpoint ?? ''
const resume = args.resume === 'true'
const basePath = args['base-path'] ?? process.env.FINAGENT_WORKSTATION_BASE_PATH ?? ''
const registerArtifact = args['register-artifact'] === 'true' || Boolean(basePath)
const DEFAULT_PROBE_TIMEOUT_MS = 30_000
const DEFAULT_EASTMONEY_TIMEOUT_MS = 120_000
const timeoutMs = Number(args['timeout-ms'] ?? DEFAULT_PROBE_TIMEOUT_MS)
const eastmoneyTimeoutMs = Number(args['eastmoney-timeout-ms'] ?? DEFAULT_EASTMONEY_TIMEOUT_MS)
const maxProviderTransportFailures = Number(args['max-provider-transport-failures'] ?? 3)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(args['app-root'] ?? join(scriptDir, '..'))
const finElectronConfig = loadFinElectronConfig()
const tushareToken = args['tushare-token'] ?? process.env.TUSHARE_TOKEN ?? process.env.TUSHARE_API_TOKEN ?? finElectronConfig.apiKeys?.TUSHARE_TOKEN
const windApiKey = args['wind-api-key'] ?? process.env.WIND_API_KEY ?? finElectronConfig.apiKeys?.WIND_API_KEY
const bootstrapSidecars = args['bootstrap-sidecars'] === 'true'
const bootstrapPython = bootstrapSidecars || args['bootstrap-python'] === 'true'
const bootstrapGotdx = bootstrapSidecars || args['bootstrap-gotdx'] === 'true'
const keepSidecars = args['keep-sidecars'] === 'true'
const runtimeTimeoutMs = Number(args['runtime-timeout-ms'] ?? 20_000)
const startedProcesses = []

if (args.help === 'true') {
  printUsage()
  process.exit(0)
}

if (!Number.isFinite(concurrency) || concurrency !== 1) {
  console.error(`Live finance API probes must run with --concurrency 1. Received: ${args.concurrency ?? concurrency}`)
  process.exit(2)
}

const specs = probeSpecs()
const coverage = coverageReport(specs, expectedCoverage())
if (args.coverage === 'true' || args['coverage-only'] === 'true') {
  console.log(JSON.stringify(coverage, null, 2))
  if (args['coverage-only'] === 'true') process.exit(coverage.missing.length > 0 ? 1 : 0)
}

let runtime = await detectRuntime()
if (bootstrapGotdx && !runtime.gotdx.online) {
  await bootstrapGotdxRuntime()
  runtime = await detectRuntime()
}
if (bootstrapPython && !runtime.sidecar.online) {
  await bootstrapPythonRuntime()
  runtime = await detectRuntime()
}
runtime.credentials = credentialStates()
runtime.capabilities = capabilityStates(runtime)

process.on('exit', cleanupStartedProcesses)
process.on('SIGINT', () => { cleanupStartedProcesses(); process.exit(130) })
process.on('SIGTERM', () => { cleanupStartedProcesses(); process.exit(143) })

const selected = specs
  .filter((spec) => shouldRun(spec, stage))
  .filter((spec) => ids.size === 0 || ids.has(spec.id))
  .filter((spec) => !only || spec.id.includes(only))
const checkpointState = resume && checkpoint ? readCheckpoint(checkpoint) : { results: [] }
const completedById = new Map((checkpointState.results ?? []).map((result) => [result.id, result]))

console.log('FinAgent Workstation finance live probe matrix')
console.log(`  stage: ${stage}`)
console.log(`  concurrency: ${concurrency}`)
console.log(`  waitMs: ${waitMs}`)
console.log(`  timeoutMs: ${timeoutMs}`)
console.log(`  eastmoneyTimeoutMs: ${eastmoneyTimeoutMs}`)
console.log(`  sidecar: ${runtime.sidecar.online ? sidecarUrl : runtime.sidecar.status}`)
console.log(`  gotdx: ${runtime.gotdx.online ? gotdxUrl : runtime.gotdx.status}`)
console.log(`  tushare: ${runtime.credentials.tushare.status}`)
console.log(`  wind: ${runtime.credentials.wind.status}`)
if (only) console.log(`  only: ${only}`)
if (ids.size > 0) console.log(`  ids: ${ids.size}`)
console.log(`  probes: ${selected.length}/${specs.length}`)
console.log(`  coverage: ${coverage.covered}/${coverage.expected.length} expected families`)
if (checkpoint) console.log(`  checkpoint: ${checkpoint}${resume ? ' (resume)' : ''}`)
if (basePath) console.log(`  artifact registry: ${basePath}`)
console.log('')

const results = [...(checkpointState.results ?? [])]
const providerCircuit = buildProviderCircuit(results)
for (let i = 0; i < selected.length; i++) {
  const spec = selected[i]
  if (completedById.has(spec.id)) {
    const result = completedById.get(spec.id)
    printResult(i, selected.length, { ...result, resumed: true })
    continue
  }
  const cascadeDecision = cascadeDecisionFor(spec, providerCircuit)
  if (cascadeDecision) {
    const result = resultFor(spec, cascadeDecision.status, 0, {
      error: cascadeDecision.reason,
      failureClass: cascadeDecision.failureClass,
      dependency: cascadeDecision.dependency,
    })
    results.push(result)
    writeCheckpoint(checkpoint, { results, stage, concurrency, waitMs, generatedAt: new Date().toISOString() })
    printResult(i, selected.length, result)
    continue
  }
  const skipDecision = skipDecisionFor(spec)
  if (skipDecision) {
    const result = resultFor(spec, skipDecision.status, 0, {
      error: skipDecision.reason,
      failureClass: skipDecision.failureClass,
      dependency: skipDecision.dependency,
    })
    results.push(result)
    writeCheckpoint(checkpoint, { results, stage, concurrency, waitMs, generatedAt: new Date().toISOString() })
    printResult(i, selected.length, result)
    continue
  }
  if (i > 0 && waitMs > 0) await sleep(waitMs)
  const result = await runProbe(spec)
  results.push(result)
  updateProviderCircuit(providerCircuit, result)
  writeCheckpoint(checkpoint, { results, stage, concurrency, waitMs, generatedAt: new Date().toISOString() })
  printResult(i, selected.length, result)
}

const payload = {
  generatedAt: new Date().toISOString(),
  stage,
  concurrency,
  waitMs,
  sidecarUrl,
  gotdxUrl,
  runtime,
  coverage,
  summary: summarize(results),
  results,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(payload, null, 2), 'utf-8')
const artifact = registerArtifact ? registerDataSnapshotArtifact(basePath, output, payload) : null

console.log('')
console.log(`Summary: ${JSON.stringify(payload.summary)}`)
console.log(`Wrote: ${output}`)
if (artifact) console.log(`Artifact: ${artifact.stableRef}`)

const hardFailures = results.filter((r) => r.status === 'failed' || r.status === 'timeout')
process.exit(hardFailures.length > 0 && !noFailOnError ? 1 : 0)

function probeSpecs() {
  const direct = 'direct-http'
  const gotdx = 'gotdx'
  const sidecar = 'sidecar'
  const wind = 'wind-direct'
  return [
    spec('electron_tdx_quote', gotdx, 'tdx', 'quote', `${gotdxUrl}/quote`, { code: STOCK_CODE, market: tdxMarketForCode(STOCK_CODE) }, ['smoke', 'standard', 'all'], { minRows: 1 }),
    spec('electron_tdx_kline', gotdx, 'tdx', 'kline_daily', `${gotdxUrl}/kline`, { code: STOCK_CODE, market: tdxMarketForCode(STOCK_CODE), category: '9', count: '20' }, ['standard', 'all'], { minRows: 10 }),
    spec('electron_tdx_index_quote', gotdx, 'tdx', 'index_quote', `${gotdxUrl}/quote`, { code: INDEX_CODE, market: tdxMarketForCode(INDEX_CODE, true) }, ['smoke', 'standard', 'all'], { minRows: 1 }),
    spec('electron_tdx_index_bars', gotdx, 'tdx', 'index_kline', `${gotdxUrl}/index_bars`, { code: '399001', market: '0', category: '9', count: '20' }, ['standard', 'all'], { minRows: 5 }),
    spec('electron_tdx_tick_chart', gotdx, 'tdx', 'tick_chart', `${gotdxUrl}/tick_chart`, { code: STOCK_CODE }, ['standard', 'all']),
    spec('electron_tdx_transactions', gotdx, 'tdx', 'transactions', `${gotdxUrl}/transactions`, { code: STOCK_CODE, count: '20' }, ['standard', 'all']),
    spec('electron_tdx_finance', gotdx, 'tdx', 'finance', `${gotdxUrl}/finance`, { code: STOCK_CODE }, ['standard', 'all']),
    spec('electron_tdx_stock_list', gotdx, 'tdx', 'stock_list', `${gotdxUrl}/stock_list_range`, { market: '1', start: '0', count: '20' }, ['standard', 'all']),
    spec('electron_tdx_xdxr', gotdx, 'tdx', 'xdxr', `${gotdxUrl}/xdxr`, { code: STOCK_CODE }, ['standard', 'all']),
    spec('electron_tdx_auction', gotdx, 'tdx', 'auction', `${gotdxUrl}/auction`, { code: STOCK_CODE }, ['standard', 'all']),
    spec('electron_tdx_top_board', gotdx, 'tdx', 'top_board', `${gotdxUrl}/top_board`, { category: '0', limit: '20' }, ['standard', 'all']),

    spec('electron_eastmoney_stock_list', direct, 'eastmoney', 'stock_list', eastmoneyClistUrl({ fid: 'f12', fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048', fields: 'f12,f14,f2,f3', pz: '5' }), {}, ['smoke', 'standard', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_quote', direct, 'eastmoney', 'quote', eastmoneyStockGetUrl(STOCK_CODE), {}, ['smoke', 'standard', 'all'], { minRows: 1 }),
    spec('electron_sina_quote', direct, 'sina', 'quote', 'https://hq.sinajs.cn/list=', { _sinaList: sinaStockSymbol(STOCK_CODE) }, ['smoke', 'standard', 'all'], {
      headers: { Referer: 'https://finance.sina.com.cn/' },
      minRows: 1,
    }),
    spec('electron_sina_index_quote', direct, 'sina', 'index_quote', 'https://hq.sinajs.cn/list=', { _sinaList: `s_${sinaIndexSymbol(INDEX_CODE)}` }, ['smoke', 'standard', 'all'], {
      headers: { Referer: 'https://finance.sina.com.cn/' },
      minRows: 1,
    }),
    spec('sina.direct.stock_transactions', direct, 'sina', 'transactions', sinaTransactionsUrl(STOCK_CODE), {}, ['standard', 'all'], {
      headers: {
        Referer: `https://vip.stock.finance.sina.com.cn/quotes_service/view/cn_bill.php?symbol=${sinaStockSymbol(STOCK_CODE)}`,
      },
      minRows: 1,
    }),
    spec('tencent.direct.stock_quote', direct, 'tencent', 'quote', 'https://qt.gtimg.cn/q=', { _tencentList: tencentStockSymbol(STOCK_CODE) }, ['smoke', 'standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 1,
    }),
    spec('tencent.direct.index_quote', direct, 'tencent', 'index_quote', 'https://qt.gtimg.cn/q=', { _tencentList: tencentIndexSymbol(INDEX_CODE) }, ['smoke', 'standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 1,
    }),
    spec('tencent.direct.fund_etf_quote', direct, 'tencent', 'quote', 'https://qt.gtimg.cn/q=', { _tencentList: 'sh510300,sh510050,sz159915' }, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 1,
    }),
    spec('tencent.direct.stock_rank_list', direct, 'tencent', 'stock_list', tencentRankListUrl(), {}, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 1,
    }),
    spec('tencent.direct.stock_daily_kline', direct, 'tencent', 'kline_daily', tencentKlineUrl(tencentStockSymbol(STOCK_CODE), false), {}, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 5,
    }),
    spec('tencent.direct.stock_daily_kline_none', direct, 'tencent', 'kline_daily', tencentKlineUrl(tencentStockSymbol(STOCK_CODE), false, ''), {}, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 5,
    }),
    spec('tencent.direct.stock_daily_kline_hfq', direct, 'tencent', 'kline_daily', tencentKlineUrl(tencentStockSymbol(STOCK_CODE), false, 'hfq'), {}, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 5,
    }),
    spec('tencent.direct.index_daily_kline', direct, 'tencent', 'index_kline', tencentKlineUrl(tencentIndexSymbol(INDEX_CODE), true), {}, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 5,
    }),
    spec('tencent.direct.stock_transactions', direct, 'tencent', 'transactions', tencentTransactionsUrl(STOCK_CODE), {}, ['standard', 'all'], {
      headers: { Referer: 'https://stockapp.finance.qq.com/mstats/' },
      minRows: 1,
    }),
    spec('electron_eastmoney_index_daily', direct, 'eastmoney', 'index_kline', eastmoneyIndexKlineUrl('399001'), {}, ['standard', 'all'], { minRows: 5 }),
    spec('electron_eastmoney_hot_rank', direct, 'eastmoney', 'hot_rank', 'https://emappdata.eastmoney.com/stockrank/getAllCurrentList', {}, ['smoke', 'standard', 'all'], {
      method: 'POST',
      body: { appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38', marketType: '', pageNo: 1, pageSize: 20 },
      headers: { 'Content-Type': 'application/json' },
      minRows: 1,
    }),
    spec('electron_eastmoney_sector_industry', direct, 'eastmoney', 'sector_rank', eastmoneyClistUrl({ fid: 'f3', fs: 'm:90 t:2 f:!50', fields: 'f2,f3,f4,f8,f12,f14,f104,f105,f128,f140,f141' }), {}, ['standard', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_sector_cons', direct, 'eastmoney', 'sector_cons', eastmoneyClistUrl({ fid: 'f3', fs: `b:${INDUSTRY_CODE} f:!50`, fields: 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20', pz: '200' }), {}, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_flow_rank', direct, 'eastmoney', 'money_flow', eastmoneyClistUrl({ fid: 'f62', fs: 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2', fields: 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124', ut: 'b2884a393a59ad64002292a3e90d46a5' }), {}, ['standard', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_limit_up', direct, 'eastmoney', 'limit_pool', push2exUrl('getTopicZTPool', { date: TRADE_DATE, Ession: TRADE_DATE, sort: 'fbt:asc', pagesize: '10000' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_limit_down', direct, 'eastmoney', 'limit_pool', push2exUrl('getTopicDTPool', { date: TRADE_DATE, sort: 'fund:asc', pagesize: '10000' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_dragon_tiger', direct, 'eastmoney', 'dragon_tiger', datacenterUrl({ reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW', columns: 'ALL', filter: `(TRADE_DATE>='${DASH_DATE}')`, sortColumns: 'ACCUM_AMOUNT', sortTypes: '-1', pageNumber: '1', pageSize: '50' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_northbound_flow', direct, 'eastmoney', 'northbound', datacenterUrl({ reportName: 'RPT_MUTUAL_DEAL_HISTORY', columns: 'ALL', filter: '', sortColumns: 'TRADE_DATE', sortTypes: '-1', pageNumber: '1', pageSize: '20' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_northbound_holding', direct, 'eastmoney', 'northbound_holding', datacenterUrl({ reportName: 'RPT_MUTUAL_STOCKHOLDDETAILS', columns: 'ALL', filter: `(SECURITY_CODE="${STOCK_CODE}")`, sortColumns: 'HOLD_MARKETCAP', sortTypes: '-1', pageNumber: '1', pageSize: '20' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_unusual', direct, 'eastmoney', 'unusual', push2exUrl('getAllStockChanges', { dpt: 'wzchanges', type: '', pageindex: '1', pagesize: '50' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_chip', direct, 'eastmoney', 'chip', datacenterUrl({ reportName: 'RPT_F10_CHIP_DISTRIBUTION', columns: 'ALL', filter: `(SECUCODE="${STOCK_CODE}.${STOCK_CODE.startsWith('6') ? 'SH' : 'SZ'}")`, sortColumns: 'TRADE_DATE', sortTypes: '-1', pageNumber: '1', pageSize: '5' }), {}, ['standard', 'all']),
    spec('electron_eastmoney_etf', direct, 'eastmoney', 'etf', eastmoneyClistUrl({ fid: 'f3', fs: 'b:MK0021,b:MK0022,b:MK0023,b:MK0024', fields: 'f12,f14,f2,f3,f5', pz: '30' }), {}, ['standard', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_earnings', direct, 'eastmoney', 'earnings', `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${STOCK_CODE.startsWith('6') ? 'SH' : 'SZ'}${STOCK_CODE}`, {}, ['standard', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_kline', direct, 'eastmoney', 'kline', eastmoneyKlineUrl(STOCK_CODE), {}, ['exhaustive', 'all'], { minRows: 5 }),
    spec('electron_eastmoney_fund_list', direct, 'eastmoney', 'fund_list', 'https://fund.eastmoney.com/js/fundcode_search.js', {}, ['standard', 'all'], { minRows: 20 }),
    spec('electron_eastmoney_fund_nav', direct, 'eastmoney', 'fund_nav', `https://fund.eastmoney.com/pingzhongdata/${FUND_CODE}.js`, {}, ['standard', 'all'], { minRows: 20 }),
    spec('electron_eastmoney_fund_money_yield', direct, 'eastmoney', 'fund_money_yield', `https://fund.eastmoney.com/pingzhongdata/${MONEY_FUND_CODE}.js`, {}, ['standard', 'all'], {
      minRows: 1,
      expectedText: 'Data_millionCopiesIncome',
    }),
    spec('electron_eastmoney_fund_performance', direct, 'eastmoney', 'fund_performance', eastmoneyFundRankUrl(), {}, ['standard', 'all'], {
      minRows: 20,
      headers: { Referer: 'https://fund.eastmoney.com/data/fundranking.html' },
    }),
    spec('electron_eastmoney_fund_holding', direct, 'eastmoney', 'fund_holding', eastmoneyFundHoldingUrl(FUND_CODE), {}, ['standard', 'all'], {
      minRows: 1,
      headers: { Referer: `https://fundf10.eastmoney.com/ccmx_${FUND_CODE}.html` },
    }),
    spec('electron_eastmoney_fund_manager', direct, 'eastmoney', 'fund_manager', eastmoneyFundManagerUrl(), {}, ['standard', 'all'], {
      minRows: 20,
      headers: { Referer: 'https://fund.eastmoney.com/manager/default.html' },
    }),

    spec('electron_sidecar_quote', sidecar, 'akshare', 'quote', `${sidecarUrl}/quote`, { code: STOCK_CODE }, ['standard', 'all']),
    spec('electron_sidecar_a_kline', sidecar, 'akshare', 'kline_daily', `${sidecarUrl}/akshare/stock_zh_a_hist`, { symbol: STOCK_CODE, period: 'daily', adjust: 'qfq', start_date: '20260101', end_date: TRADE_DATE, _priority: 'background' }, ['standard', 'all']),
    spec('electron_sidecar_index_components', sidecar, 'akshare', 'index_components', `${sidecarUrl}/akshare/index_stock_cons`, { symbol: INDEX_CODE, _priority: 'background' }, ['standard', 'all'], { minRows: 1 }),
    spec('electron_sidecar_sector', sidecar, 'akshare', 'sector_rank', `${sidecarUrl}/akshare/stock_board_industry_name_em`, { _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_limit_strong', sidecar, 'akshare', 'continuous_limit', `${sidecarUrl}/akshare/stock_zt_pool_strong_em`, { date: TRADE_DATE, _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_limit_failed', sidecar, 'akshare', 'failed_limit', `${sidecarUrl}/akshare/stock_zt_pool_zbgc_em`, { date: TRADE_DATE, _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_fund_rank', sidecar, 'akshare', 'fund_list', `${sidecarUrl}/akshare/fund_open_fund_rank_em`, { symbol: '全部', _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_fund_nav', sidecar, 'akshare', 'fund_nav', `${sidecarUrl}/akshare/fund_open_fund_info_em`, { symbol: FUND_CODE, indicator: '单位净值走势', _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_fund_holding', sidecar, 'akshare', 'fund_holding', `${sidecarUrl}/akshare/fund_portfolio_hold_em`, { symbol: FUND_CODE, _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_fund_manager', sidecar, 'akshare', 'fund_manager', `${sidecarUrl}/akshare/fund_manager_em`, { _priority: 'background', _provider: 'eastmoney' }, ['standard', 'all']),
    spec('electron_sidecar_fund_screener', sidecar, 'sidecar', 'fund_screener', `${sidecarUrl}/screener/fund`, {}, ['standard', 'all'], {
      method: 'POST',
      body: { mode: '4433', limit: 10 },
    }),
    spec('electron_sidecar_news', sidecar, 'akshare', 'finance_news', `${sidecarUrl}/news`, { keyword: '贵州茅台', enrich: 'false', _priority: 'background' }, ['smoke', 'standard', 'all']),

    spec('electron_tradingview_scan', direct, 'tradingview', 'scan', 'https://scanner.tradingview.com/america/scan', {}, ['standard', 'all'], {
      method: 'POST',
      body: {
        symbols: { tickers: ['NASDAQ:AAPL'], query: { types: [] } },
        columns: ['close', 'volume', 'RSI', 'Recommend.All'],
      },
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
      },
      minRows: 1,
    }),

    spec('electron_yahoo_price', sidecar, 'yfinance', 'price', `${sidecarUrl}/yfinance/fast_info`, { symbol: 'AAPL' }, ['smoke', 'standard', 'all']),
    spec('electron_yahoo_history', sidecar, 'yfinance', 'history', `${sidecarUrl}/yfinance/history`, { symbol: 'AAPL', period: '1mo' }, ['standard', 'all']),
    spec('electron_yahoo_news', sidecar, 'yfinance', 'news', `${sidecarUrl}/yfinance/news`, { symbol: 'AAPL' }, ['standard', 'all']),
    spec('electron_yahoo_options', sidecar, 'yfinance', 'options', `${sidecarUrl}/yfinance/options`, { symbol: 'AAPL' }, ['standard', 'all']),
    spec('electron_yahoo_earnings', sidecar, 'yfinance', 'earnings', `${sidecarUrl}/yfinance/earnings_dates`, { symbol: 'AAPL' }, ['standard', 'all']),
    spec('electron_yahoo_dividends', sidecar, 'yfinance', 'corporate_actions', `${sidecarUrl}/yfinance/dividends`, { symbol: 'AAPL' }, ['standard', 'all']),
    spec('electron_yahoo_splits', sidecar, 'yfinance', 'corporate_actions', `${sidecarUrl}/yfinance/splits`, { symbol: 'AAPL' }, ['standard', 'all']),

    spec('electron_tushare_trade_cal', direct, 'tushare', 'trade_calendar', 'https://api.tushare.pro', {}, ['quota', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('trade_cal', { exchange: 'SSE', start_date: '20260101', end_date: '20260110' }, 'exchange,cal_date,is_open') }),

    spec('electron_wind_quote', wind, 'wind', 'quote', WIND_SERVERS.stock_data, {}, ['quota', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_quote', windArguments: { windcode: '600519.SH' } }),
    spec('electron_wind_news', wind, 'wind', 'financial_docs_news', WIND_SERVERS.financial_docs, {}, ['quota', 'all'], { quota: true, requiresWind: true, windServer: 'financial_docs', windTool: 'get_financial_news', windArguments: { query: '贵州茅台', top_k: 3 } }),
    spec('electron_wind_market_screening', wind, 'wind', 'market_screening', WIND_SERVERS.stock_data, {}, ['quota', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'search_stocks', windArguments: { question: '筛选沪深市场市值较高且基本面稳健的股票' } }),
    ...tdxExhaustiveSpecs(gotdx),
    ...sidecarExhaustiveSpecs(sidecar),
    ...akshareExhaustiveSpecs(sidecar),
    ...yfinanceExhaustiveSpecs(sidecar),
    ...tushareExhaustiveSpecs(direct),
    ...windExhaustiveSpecs(wind),
  ]
}

function tdxExhaustiveSpecs(kind) {
  const exCode = process.env.FIN_API_TEST_EX_CODE ?? 'RBL8'
  const exCategory = process.env.FIN_API_TEST_EX_CATEGORY ?? '30'
  const boardSymbol = process.env.FIN_API_TEST_TDX_BOARD ?? ''
  return [
    spec('electron_tdx_quotes', kind, 'tdx', 'quotes', `${gotdxUrl}/quotes`, { codes: `${STOCK_CODE},000001` }, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_tdx_kline_advanced', kind, 'tdx', 'kline_advanced', `${gotdxUrl}/kline_advanced`, { code: STOCK_CODE, market: tdxMarketForCode(STOCK_CODE), category: '9', start: '0', count: '20', times: '1', adjust: '0' }, ['exhaustive', 'all'], { minRows: 5 }),
    spec('electron_tdx_count_sh', kind, 'tdx', 'count', `${gotdxUrl}/count`, { market: '1' }, ['exhaustive', 'all']),
    spec('electron_tdx_stock_list_full', kind, 'tdx', 'stock_list', `${gotdxUrl}/stock_list`, { market: '1', start: '0' }, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_tdx_volume_profile', kind, 'tdx', 'volume_profile', `${gotdxUrl}/volume_profile`, { code: STOCK_CODE }, ['exhaustive', 'all']),
    spec('electron_tdx_quotes_list', kind, 'tdx', 'quotes_list', `${gotdxUrl}/quotes_list`, { category: '0', start: '0', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_unusual_full', kind, 'tdx', 'unusual', `${gotdxUrl}/unusual`, { market: '1', start: '0', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_history_tick_chart', kind, 'tdx', 'history_tick_chart', `${gotdxUrl}/history_tick_chart`, { code: STOCK_CODE, date: TRADE_DATE }, ['exhaustive', 'all']),
    spec('electron_tdx_history_transactions', kind, 'tdx', 'history_transactions', `${gotdxUrl}/history_transactions`, { code: STOCK_CODE, date: TRADE_DATE, start: '0', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_history_orders', kind, 'tdx', 'history_orders', `${gotdxUrl}/history_orders`, { code: STOCK_CODE, date: TRADE_DATE }, ['exhaustive', 'all']),
    spec('electron_tdx_chart_sampling', kind, 'tdx', 'chart_sampling', `${gotdxUrl}/chart_sampling`, { code: STOCK_CODE }, ['exhaustive', 'all']),
    spec('electron_tdx_company_categories', kind, 'tdx', 'company_categories', `${gotdxUrl}/company_categories`, { code: STOCK_CODE }, ['exhaustive', 'all']),
    spec('electron_tdx_company_content', kind, 'tdx', 'company_content', `${gotdxUrl}/company_content`, { code: STOCK_CODE, filename: '600519.txt', start: '0', length: '1000' }, ['exhaustive', 'all']),
    spec('electron_tdx_company_info', kind, 'tdx', 'company_info', `${gotdxUrl}/company_info`, { code: STOCK_CODE }, ['exhaustive', 'all']),
    spec('electron_tdx_block', kind, 'tdx', 'block', `${gotdxUrl}/block`, { filename: 'block_zs.dat' }, ['exhaustive', 'all']),
    spec('electron_tdx_index_info', kind, 'tdx', 'index_info', `${gotdxUrl}/index_info`, { code: '399001', market: '0' }, ['exhaustive', 'all']),
    spec('electron_tdx_index_momentum', kind, 'tdx', 'index_momentum', `${gotdxUrl}/index_momentum`, { code: '399001', market: '0' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_categories', kind, 'tdx', 'ex/categories', `${gotdxUrl}/ex/categories`, {}, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_tdx_ex_count', kind, 'tdx', 'ex/count', `${gotdxUrl}/ex/count`, {}, ['exhaustive', 'all']),
    spec('electron_tdx_ex_list', kind, 'tdx', 'ex/list', `${gotdxUrl}/ex/list`, { start: '0', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_list_extra', kind, 'tdx', 'ex/list_extra', `${gotdxUrl}/ex/list_extra`, { a: '0', b: '0', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_quote', kind, 'tdx', 'ex/quote', `${gotdxUrl}/ex/quote`, { code: exCode, category: exCategory }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_quotes', kind, 'tdx', 'ex/quotes', `${gotdxUrl}/ex/quotes`, { codes: exCode, category: exCategory }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_kline', kind, 'tdx', 'ex/kline', `${gotdxUrl}/ex/kline`, { code: exCode, category: exCategory, period: '9', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_kline2', kind, 'tdx', 'ex/kline2', `${gotdxUrl}/ex/kline2`, { code: exCode, category: exCategory, period: '9', count: '20', times: '1' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_quotes_list', kind, 'tdx', 'ex/quotes_list', `${gotdxUrl}/ex/quotes_list`, { category: exCategory, start: '0', count: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_history_transaction', kind, 'tdx', 'ex/history_transaction', `${gotdxUrl}/ex/history_transaction`, { code: exCode, category: exCategory, date: TRADE_DATE }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_tick_chart', kind, 'tdx', 'ex/tick_chart', `${gotdxUrl}/ex/tick_chart`, { code: exCode, category: exCategory }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_history_tick_chart', kind, 'tdx', 'ex/history_tick_chart', `${gotdxUrl}/ex/history_tick_chart`, { code: exCode, category: exCategory, date: TRADE_DATE }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_chart_sampling', kind, 'tdx', 'ex/chart_sampling', `${gotdxUrl}/ex/chart_sampling`, { code: exCode, category: exCategory }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_board_list', kind, 'tdx', 'ex/board_list', `${gotdxUrl}/ex/board_list`, { board_type: '0', start: '0', page_size: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_ex_table', kind, 'tdx', 'ex/table', `${gotdxUrl}/ex/table`, {}, ['exhaustive', 'all']),
    spec('electron_tdx_ex_server_info', kind, 'tdx', 'ex/server_info', `${gotdxUrl}/ex/server_info`, {}, ['exhaustive', 'all']),
    spec('electron_tdx_mac_board_count', kind, 'tdx', 'mac/board_count', `${gotdxUrl}/mac/board_count`, { board_type: '0' }, ['exhaustive', 'all']),
    spec('electron_tdx_mac_board_list', kind, 'tdx', 'mac/board_list', `${gotdxUrl}/mac/board_list`, { board_type: '0', start: '0', page_size: '20' }, ['exhaustive', 'all']),
    spec('electron_tdx_mac_symbol_belong_board', kind, 'tdx', 'mac/symbol_belong_board', `${gotdxUrl}/mac/symbol_belong_board`, { code: STOCK_CODE }, ['exhaustive', 'all']),
    spec('electron_tdx_mac_quotes', kind, 'tdx', 'mac/quotes', `${gotdxUrl}/mac/quotes`, { code: STOCK_CODE }, ['exhaustive', 'all']),
    spec('electron_tdx_mac_bars', kind, 'tdx', 'mac/bars', `${gotdxUrl}/mac/bars`, { code: STOCK_CODE, period: '9', count: '20' }, ['exhaustive', 'all']),
    ...(boardSymbol ? [
      spec('electron_tdx_mac_board_members', kind, 'tdx', 'mac/board_members', `${gotdxUrl}/mac/board_members`, { symbol: boardSymbol, start: '0', page_size: '20' }, ['exhaustive', 'all']),
      spec('electron_tdx_mac_board_members_quotes', kind, 'tdx', 'mac/board_members_quotes', `${gotdxUrl}/mac/board_members_quotes`, { symbol: boardSymbol, start: '0', page_size: '20' }, ['exhaustive', 'all']),
    ] : []),
  ]
}

function sidecarExhaustiveSpecs(kind) {
  return [
    spec('electron_sidecar_local_cache_status', kind, 'sidecar', 'local_cache/status', `${sidecarUrl}/local_cache/status`, {}, ['exhaustive', 'all']),
    spec('electron_sidecar_kline_first_class', kind, 'akshare', 'kline_daily', `${sidecarUrl}/kline`, { code: STOCK_CODE, period: 'daily', adjust: 'qfq', limit: '20', _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_index_list', kind, 'akshare', 'index_list', `${sidecarUrl}/index/list`, {}, ['exhaustive', 'all']),
    spec('electron_sidecar_index_quotes', kind, 'akshare', 'index_quote', `${sidecarUrl}/index/quotes`, { code: '000001,399001,399006' }, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_sidecar_margin', kind, 'akshare', 'margin', `${sidecarUrl}/margin`, { code: STOCK_CODE, date: TRADE_DATE, _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_holders', kind, 'akshare', 'holders', `${sidecarUrl}/holders`, { code: STOCK_CODE, _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_alpha_factors', kind, 'akshare', 'alpha/factors', `${sidecarUrl}/alpha/factors`, { code: STOCK_CODE, period: 'daily', limit: '60', _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_chip_first_class', kind, 'akshare', 'chip', `${sidecarUrl}/chip`, { code: STOCK_CODE, _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_akshare_search', kind, 'akshare', 'akshare_search', `${sidecarUrl}/akshare_search`, { q: 'stock_zh_a' }, ['exhaustive', 'all']),
    spec('electron_sidecar_yfinance_search', kind, 'yfinance', 'yfinance_search', `${sidecarUrl}/yfinance_search`, { q: 'history' }, ['exhaustive', 'all']),
    spec('electron_sidecar_ta_search', kind, 'ta', 'ta_search', `${sidecarUrl}/ta_search`, { q: 'rsi' }, ['exhaustive', 'all']),
    spec('electron_sidecar_ta_rsi', kind, 'ta', 'ta/rsi', `${sidecarUrl}/ta/rsi`, { symbol: STOCK_CODE, length: '14', _priority: 'background' }, ['exhaustive', 'all']),
  ]
}

function akshareExhaustiveSpecs(kind) {
  return [
    spec('electron_sidecar_concept_rank', kind, 'akshare', 'stock_board_concept_name_em', `${sidecarUrl}/akshare/stock_board_concept_name_em`, { _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_industry_cons', kind, 'akshare', 'stock_board_industry_cons_em', `${sidecarUrl}/akshare/stock_board_industry_cons_em`, { symbol: INDUSTRY_CODE, _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_concept_cons', kind, 'akshare', 'stock_board_concept_cons_em', `${sidecarUrl}/akshare/stock_board_concept_cons_em`, { symbol: '机器人概念', _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_hot_rank', kind, 'akshare', 'stock_hot_rank_em', `${sidecarUrl}/akshare/stock_hot_rank_em`, { _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_lhb', kind, 'akshare', 'stock_lhb_detail_daily_sina', `${sidecarUrl}/akshare/stock_lhb_detail_daily_sina`, { date: TRADE_DATE, _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_hsgt_hist', kind, 'akshare', 'stock_hsgt_hist_em', `${sidecarUrl}/akshare/stock_hsgt_hist_em`, { symbol: '沪股通', _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_hsgt_holding', kind, 'akshare', 'stock_hsgt_hold_stock_em', `${sidecarUrl}/akshare/stock_hsgt_hold_stock_em`, { market: '沪股通', indicator: '今日排行', _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_changes', kind, 'akshare', 'stock_changes_em', `${sidecarUrl}/akshare/stock_changes_em`, { symbol: '大笔买入', _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_single_flow', kind, 'akshare', 'stock_individual_fund_flow', `${sidecarUrl}/akshare/stock_individual_fund_flow`, { stock: STOCK_CODE, _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_spot_a', kind, 'akshare', 'stock_zh_a_spot_em', `${sidecarUrl}/akshare/stock_zh_a_spot_em`, { _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_eastmoney_index_quote', kind, 'eastmoney', 'stock_zh_index_spot_em', `${sidecarUrl}/akshare/stock_zh_index_spot_em`, { symbol: 'all', _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all'], { minRows: 1 }),
    spec('electron_sidecar_spot_hk', kind, 'akshare', 'stock_hk_spot_em', `${sidecarUrl}/akshare/stock_hk_spot_em`, { _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_spot_us', kind, 'akshare', 'stock_us_spot_em', `${sidecarUrl}/akshare/stock_us_spot_em`, { _priority: 'background' }, ['exhaustive', 'all']),
    spec('electron_sidecar_index_daily', kind, 'akshare', 'stock_zh_index_daily_em', `${sidecarUrl}/akshare/stock_zh_index_daily_em`, { symbol: 'sz399001', start_date: '20260101', end_date: TRADE_DATE, _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_limit_pool', kind, 'akshare', 'stock_zt_pool_em', `${sidecarUrl}/akshare/stock_zt_pool_em`, { date: TRADE_DATE, _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_limit_down_pool', kind, 'akshare', 'stock_zt_pool_dtgc_em', `${sidecarUrl}/akshare/stock_zt_pool_dtgc_em`, { date: TRADE_DATE, _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
    spec('electron_sidecar_flow_rank', kind, 'akshare', 'stock_individual_fund_flow_rank', `${sidecarUrl}/akshare/stock_individual_fund_flow_rank`, { indicator: '今日', _priority: 'background', _provider: 'eastmoney' }, ['exhaustive', 'all']),
  ]
}

function yfinanceExhaustiveSpecs(kind) {
  const common = { symbol: 'AAPL', _priority: 'background' }
  return [
    spec('electron_yahoo_info', kind, 'yfinance', 'info', `${sidecarUrl}/yfinance/info`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_get_info', kind, 'yfinance', 'get_info', `${sidecarUrl}/yfinance/get_info`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_financials', kind, 'yfinance', 'financials', `${sidecarUrl}/yfinance/financials`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_quarterly_financials', kind, 'yfinance', 'quarterly_financials', `${sidecarUrl}/yfinance/quarterly_financials`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_income_stmt', kind, 'yfinance', 'income_stmt', `${sidecarUrl}/yfinance/income_stmt`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_quarterly_income_stmt', kind, 'yfinance', 'quarterly_income_stmt', `${sidecarUrl}/yfinance/quarterly_income_stmt`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_balance_sheet', kind, 'yfinance', 'balance_sheet', `${sidecarUrl}/yfinance/balance_sheet`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_balancesheet', kind, 'yfinance', 'balancesheet', `${sidecarUrl}/yfinance/balancesheet`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_quarterly_balance_sheet', kind, 'yfinance', 'quarterly_balance_sheet', `${sidecarUrl}/yfinance/quarterly_balance_sheet`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_quarterly_balancesheet', kind, 'yfinance', 'quarterly_balancesheet', `${sidecarUrl}/yfinance/quarterly_balancesheet`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_cash_flow', kind, 'yfinance', 'cash_flow', `${sidecarUrl}/yfinance/cash_flow`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_cashflow', kind, 'yfinance', 'cashflow', `${sidecarUrl}/yfinance/cashflow`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_quarterly_cash_flow', kind, 'yfinance', 'quarterly_cash_flow', `${sidecarUrl}/yfinance/quarterly_cash_flow`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_quarterly_cashflow', kind, 'yfinance', 'quarterly_cashflow', `${sidecarUrl}/yfinance/quarterly_cashflow`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_earnings_estimate', kind, 'yfinance', 'earnings_estimate', `${sidecarUrl}/yfinance/earnings_estimate`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_earnings_history', kind, 'yfinance', 'earnings_history', `${sidecarUrl}/yfinance/earnings_history`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_eps_revisions', kind, 'yfinance', 'eps_revisions', `${sidecarUrl}/yfinance/eps_revisions`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_eps_trend', kind, 'yfinance', 'eps_trend', `${sidecarUrl}/yfinance/eps_trend`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_recommendations', kind, 'yfinance', 'recommendations', `${sidecarUrl}/yfinance/recommendations`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_recommendations_summary', kind, 'yfinance', 'recommendations_summary', `${sidecarUrl}/yfinance/recommendations_summary`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_upgrades_downgrades', kind, 'yfinance', 'upgrades_downgrades', `${sidecarUrl}/yfinance/upgrades_downgrades`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_option_chain', kind, 'yfinance', 'option_chain', `${sidecarUrl}/yfinance/option_chain`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_actions', kind, 'yfinance', 'actions', `${sidecarUrl}/yfinance/actions`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_capital_gains', kind, 'yfinance', 'capital_gains', `${sidecarUrl}/yfinance/capital_gains`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_institutional_holders', kind, 'yfinance', 'institutional_holders', `${sidecarUrl}/yfinance/institutional_holders`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_mutualfund_holders', kind, 'yfinance', 'mutualfund_holders', `${sidecarUrl}/yfinance/mutualfund_holders`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_major_holders', kind, 'yfinance', 'major_holders', `${sidecarUrl}/yfinance/major_holders`, common, ['exhaustive', 'all']),
    spec('electron_yahoo_insider_transactions', kind, 'yfinance', 'insider_transactions', `${sidecarUrl}/yfinance/insider_transactions`, common, ['exhaustive', 'all']),
  ]
}

function tushareExhaustiveSpecs(kind) {
  const code = `${STOCK_CODE}.${STOCK_CODE.startsWith('6') ? 'SH' : 'SZ'}`
  return [
    spec('electron_tushare_stock_basic', kind, 'tushare', 'stock_basic', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('stock_basic', { list_status: 'L' }, 'ts_code,symbol,name,area,industry,list_date,market') }),
    spec('electron_tushare_daily', kind, 'tushare', 'daily', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('daily', { ts_code: code, start_date: '20260101', end_date: TRADE_DATE }, 'ts_code,trade_date,open,high,low,close,vol,amount') }),
    spec('electron_tushare_weekly', kind, 'tushare', 'weekly', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('weekly', { ts_code: code, start_date: '20260101', end_date: TRADE_DATE }, 'ts_code,trade_date,open,high,low,close,vol,amount') }),
    spec('electron_tushare_monthly', kind, 'tushare', 'monthly', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('monthly', { ts_code: code, start_date: '20260101', end_date: TRADE_DATE }, 'ts_code,trade_date,open,high,low,close,vol,amount') }),
    spec('electron_tushare_index_daily', kind, 'tushare', 'index_daily', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('index_daily', { ts_code: '000001.SH', start_date: '20260101', end_date: TRADE_DATE }, 'ts_code,trade_date,open,high,low,close,vol,amount') }),
    spec('electron_tushare_index_weight', kind, 'tushare', 'index_weight', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('index_weight', { index_code: '000300.SH', start_date: '20260101', end_date: TRADE_DATE }, 'index_code,con_code,trade_date,weight') }),
    spec('electron_tushare_daily_basic', kind, 'tushare', 'daily_basic', 'https://api.tushare.pro', {}, ['exhaustive', 'all'], { quota: true, requiresTushare: true, method: 'POST', body: tushareBody('daily_basic', { ts_code: code, start_date: '20260101', end_date: TRADE_DATE }, 'ts_code,trade_date,close,turnover_rate,volume_ratio,pe,pb,total_mv') }),
  ]
}

function windExhaustiveSpecs(kind) {
  return [
    spec('electron_wind_stock_price_indicators', kind, 'wind', 'stock_price_indicators', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_price_indicators', windArguments: { windcode: '600519.SH', indexes: '中文简称,最新成交价,涨跌幅,成交量' } }),
    spec('electron_wind_stock_kline', kind, 'wind', 'stock_kline', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_kline', windArguments: { windcode: '600519.SH', begin_date: '20260101', end_date: TRADE_DATE } }),
    spec('electron_wind_stock_basicinfo', kind, 'wind', 'stock_basicinfo', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_basicinfo', windArguments: { question: '600519.SH公司基本档案' } }),
    spec('electron_wind_stock_equity_holders', kind, 'wind', 'stock_equity_holders', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_equity_holders', windArguments: { windcode: '600519.SH', question: '贵州茅台主要股东持股结构' } }),
    spec('electron_wind_stock_events', kind, 'wind', 'stock_events', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_events', windArguments: { windcode: '600519.SH', question: '贵州茅台分红除权事件' } }),
    spec('electron_wind_stock_technicals', kind, 'wind', 'stock_technicals', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_stock_technicals', windArguments: { windcode: '600519.SH', question: '贵州茅台资金流向技术指标' } }),
    spec('electron_wind_stock_risk_metrics', kind, 'wind', 'stock_risk_metrics', WIND_SERVERS.stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'stock_data', windTool: 'get_risk_metrics', windArguments: { question: '贵州茅台过去1年Beta和波动率' } }),
    spec('electron_wind_global_basicinfo', kind, 'wind', 'global_stock_basicinfo', WIND_SERVERS.global_stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'global_stock_data', windTool: 'get_global_stock_basicinfo', windArguments: { windcode: 'AAPL.O', question: 'AAPL.O公司基本资料' } }),
    spec('electron_wind_global_fundamentals', kind, 'wind', 'global_stock_fundamentals', WIND_SERVERS.global_stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'global_stock_data', windTool: 'get_global_stock_fundamentals', windArguments: { windcode: 'AAPL.O', question: 'AAPL.O最近财务报表主要指标' } }),
    spec('electron_wind_global_holders', kind, 'wind', 'global_stock_holders', WIND_SERVERS.global_stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'global_stock_data', windTool: 'get_global_stock_equity_holders', windArguments: { windcode: 'AAPL.O', question: 'AAPL.O主要持有人结构' } }),
    spec('electron_wind_global_events', kind, 'wind', 'global_stock_events', WIND_SERVERS.global_stock_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'global_stock_data', windTool: 'get_global_stock_events', windArguments: { windcode: 'AAPL.O', question: 'AAPL.O分红拆股事件' } }),
    spec('electron_wind_fund_quote', kind, 'wind', 'fund_quote', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_quote', windArguments: { windcode: '588200.SH' } }),
    spec('electron_wind_fund_price_indicators', kind, 'wind', 'fund_price_indicators', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_price_indicators', windArguments: { windcode: '588200.SH', indexes: '中文简称,最新成交价,IOPV,贴水率' } }),
    spec('electron_wind_fund_info', kind, 'wind', 'fund_info', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_info', windArguments: { windcode: '110011.OF', question: '110011.OF基金基本资料' } }),
    spec('electron_wind_fund_financials', kind, 'wind', 'fund_financials', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_financials', windArguments: { windcode: '110011.OF', question: '110011.OF基金财务指标' } }),
    spec('electron_wind_fund_company_info', kind, 'wind', 'fund_company_info', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_company_info', windArguments: { windcode: '110011.OF', question: '110011.OF基金公司资料' } }),
    spec('electron_wind_fund_holders', kind, 'wind', 'fund_holders', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_holders', windArguments: { windcode: '110011.OF', question: '110011.OF基金持有人结构' } }),
    spec('electron_wind_fund_holdings', kind, 'wind', 'fund_holdings', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_holdings', windArguments: { windcode: '110011.OF', question: '110011.OF基金持仓' } }),
    spec('electron_wind_fund_performance', kind, 'wind', 'fund_performance', WIND_SERVERS.fund_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'fund_data', windTool: 'get_fund_performance', windArguments: { windcode: '110011.OF', question: '110011.OF基金业绩表现' } }),
    spec('electron_wind_index_quote', kind, 'wind', 'index_quote', WIND_SERVERS.index_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'index_data', windTool: 'get_index_quote', windArguments: { windcode: '000300.SH' } }),
    spec('electron_wind_index_price_indicators', kind, 'wind', 'index_price_indicators', WIND_SERVERS.index_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'index_data', windTool: 'get_index_price_indicators', windArguments: { windcode: '000300.SH', indexes: '中文简称,最新成交价,涨跌幅,成交量' } }),
    spec('electron_wind_index_kline', kind, 'wind', 'index_kline', WIND_SERVERS.index_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'index_data', windTool: 'get_index_kline', windArguments: { windcode: '000300.SH', begin_date: '20260101', end_date: TRADE_DATE } }),
    spec('electron_wind_index_technicals', kind, 'wind', 'index_technicals', WIND_SERVERS.index_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'index_data', windTool: 'get_index_technicals', windArguments: { windcode: '000300.SH', question: '沪深300指数RSI和MACD技术指标' } }),
    spec('electron_wind_index_basicinfo', kind, 'wind', 'index_basicinfo', WIND_SERVERS.index_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'index_data', windTool: 'get_index_basicinfo', windArguments: { question: '沪深300指数档案、发布机构、基日、基点和成份数量' } }),
    spec('electron_wind_index_fundamentals', kind, 'wind', 'index_fundamentals', WIND_SERVERS.index_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'index_data', windTool: 'get_index_fundamentals', windArguments: { question: '沪深300指数PE、PB、PS和历史分位' } }),
    spec('electron_wind_bond_basicinfo', kind, 'wind', 'bond_basicinfo', WIND_SERVERS.bond_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'bond_data', windTool: 'get_bond_basicinfo', windArguments: { question: '国债2601基本信息' } }),
    spec('electron_wind_bond_market_data', kind, 'wind', 'bond_market_data', WIND_SERVERS.bond_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'bond_data', windTool: 'get_bond_market_data', windArguments: { windcode: '2400001.IB', question: '2400001.IB债券市场行情和估值' } }),
    spec('electron_wind_bond_financial_data', kind, 'wind', 'bond_financial_data', WIND_SERVERS.bond_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'bond_data', windTool: 'get_bond_financial_data', windArguments: { question: '国债2601主体2024年营收' } }),
    spec('electron_wind_company_announcements', kind, 'wind', 'company_announcements', WIND_SERVERS.financial_docs, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'financial_docs', windTool: 'get_company_announcements', windArguments: { query: '贵州茅台公告', top_k: 3 } }),
    spec('electron_wind_economic_data', kind, 'wind', 'economic_data', WIND_SERVERS.economic_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'economic_data', windTool: 'get_economic_data', windArguments: { metricIdsStr: '中国CPI同比', freq: '月', beginDate: '20260101', endDate: TRADE_DATE } }),
    spec('electron_wind_analytics_data', kind, 'wind', 'analytics_data', WIND_SERVERS.analytics_data, {}, ['exhaustive', 'all'], { quota: true, requiresWind: true, windServer: 'analytics_data', windTool: 'get_financial_data', windArguments: { question: '查询贵州茅台最近一个交易日收盘价和涨跌幅' } }),
  ]
}

function spec(id, kind, provider, family, url, params = {}, stages = ['standard', 'all'], extra = {}) {
  return {
    id,
    runtime: 'finagent_workstation',
    kind,
    provider,
    family,
    url,
    params,
    stages,
    timeoutMs: timeoutMsForSpec({ provider, url, params, timeoutMs: extra.timeoutMs }),
    ...extra,
  }
}

function timeoutMsForSpec({ provider, url, params, timeoutMs: explicitTimeoutMs }) {
  if (explicitTimeoutMs != null) return explicitTimeoutMs
  return isEastmoneyBackedSpec(provider, url, params) ? eastmoneyTimeoutMs : timeoutMs
}

function isEastmoneyBackedSpec(provider, url, params = {}) {
  if (provider === 'eastmoney') return true
  const text = `${url} ${JSON.stringify(params)}`
  return /eastmoney\.com|_provider["=:]eastmoney|_provider=eastmoney/.test(text)
}

function expectedCoverage() {
  return [
    'tdx:quote', 'tdx:kline_daily', 'tdx:index_quote', 'tdx:index_kline',
    'tdx:tick_chart', 'tdx:transactions', 'tdx:finance', 'tdx:stock_list',
    'tdx:xdxr', 'tdx:auction', 'tdx:top_board',
    'eastmoney:stock_list', 'eastmoney:quote', 'eastmoney:index_kline', 'eastmoney:hot_rank',
    'eastmoney:sector_rank', 'eastmoney:money_flow', 'eastmoney:limit_pool',
    'eastmoney:dragon_tiger', 'eastmoney:northbound', 'eastmoney:northbound_holding',
    'eastmoney:unusual', 'eastmoney:chip', 'eastmoney:etf', 'eastmoney:earnings',
    'eastmoney:fund_list', 'eastmoney:fund_nav', 'eastmoney:fund_performance',
    'eastmoney:fund_holding', 'eastmoney:fund_manager',
    'sina:quote', 'sina:index_quote', 'sina:transactions',
    'tencent:quote', 'tencent:index_quote', 'tencent:stock_list', 'tencent:kline_daily', 'tencent:index_kline', 'tencent:transactions',
    'akshare:quote', 'akshare:kline_daily', 'akshare:sector_rank',
    'akshare:continuous_limit', 'akshare:failed_limit', 'akshare:fund_list',
    'akshare:fund_nav', 'akshare:fund_holding', 'akshare:fund_manager',
    'akshare:finance_news',
    'yfinance:price', 'yfinance:history', 'yfinance:news', 'yfinance:options',
    'yfinance:earnings', 'yfinance:corporate_actions',
    'tushare:trade_calendar',
    'tradingview:scan',
    'wind:quote', 'wind:financial_docs_news', 'wind:market_screening', 'wind:company_announcements',
    'wind:stock_price_indicators', 'wind:stock_kline', 'wind:stock_basicinfo',
    'wind:stock_equity_holders', 'wind:stock_events', 'wind:stock_technicals',
    'wind:stock_risk_metrics',
    'wind:global_stock_basicinfo', 'wind:global_stock_fundamentals',
    'wind:global_stock_holders', 'wind:global_stock_events',
    'wind:fund_quote', 'wind:fund_info', 'wind:fund_financials',
    'wind:fund_company_info', 'wind:fund_holders', 'wind:fund_holdings',
    'wind:fund_performance', 'wind:fund_price_indicators',
    'wind:index_quote', 'wind:index_price_indicators', 'wind:index_kline',
    'wind:index_technicals', 'wind:index_basicinfo', 'wind:index_fundamentals',
    'wind:bond_basicinfo', 'wind:bond_market_data',
    'wind:bond_financial_data', 'wind:economic_data', 'wind:analytics_data',
  ]
}

function coverageReport(specs, expected) {
  const byFamily = new Map()
  for (const item of specs) {
    const key = `${item.provider}:${item.family}`
    const ids = byFamily.get(key) ?? []
    ids.push(item.id)
    byFamily.set(key, ids)
  }
  const families = [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, ids]) => ({ family, ids }))
  const missing = expected.filter((family) => !byFamily.has(family))
  return { expected, covered: expected.length - missing.length, missing, families }
}

async function runProbe(spec) {
  const started = Date.now()
  try {
    if (spec.unsupported) return resultFor(spec, 'skipped', Date.now() - started, { error: spec.unsupported })
    if (spec.kind === 'wind-direct') return await runWindProbe(spec, started)
    const url = spec.method === 'POST' ? spec.url : urlWithParams(spec.url, spec.params)
    const res = await fetch(url, {
      method: spec.method ?? 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Referer: 'https://quote.eastmoney.com/',
        Accept: 'application/json,text/plain,*/*',
        ...(spec.headers ?? {}),
      },
      body: spec.method === 'POST' ? JSON.stringify(spec.body ?? {}) : undefined,
      signal: AbortSignal.timeout(spec.timeoutMs),
    })
    const text = await res.text()
    const parsed = parseJson(text)
    const rows = rowsOf(parsed)
    const textEvidenceCount = spec.expectedText && text.includes(spec.expectedText)
      ? Math.max(1, occurrences(text, spec.expectedText))
      : 0
    const count = rows.length || scalarCount(parsed) || textEvidenceCount
    const minRows = spec.minRows ?? 0
    const expectedTextOk = !spec.expectedText || text.includes(spec.expectedText)
    const ok = res.ok && count >= minRows && expectedTextOk && !apiError(parsed)
    return resultFor(spec, ok ? 'passed' : 'failed', Date.now() - started, {
      httpStatus: res.status,
      parsedCount: count,
      error: ok ? undefined : apiError(parsed) ?? (expectedTextOk ? `HTTP ${res.status}; rows ${count} < min ${minRows}` : `HTTP ${res.status}; missing expected text ${spec.expectedText}`),
      preview: preview(parsed, text),
      columns: columnsOf(parsed, rows),
      schema: schemaOf(rows[0]),
      providerTime: providerTimeOf(parsed, rows[0]),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return resultFor(spec, message.includes('aborted') || message.includes('timeout') ? 'timeout' : 'failed', Date.now() - started, { error: message })
  }
}

async function runWindProbe(spec, started) {
  const headers = {
    Authorization: `Bearer ${windApiKey}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  }
  await postWindJson(spec.url, headers, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'finagent-workstation-live-probe', version: '1.0.0' },
    },
  }, 30_000)
  const body = await postWindJson(spec.url, headers, {
    jsonrpc: '2.0',
    id: Date.now() + 1,
    method: 'tools/call',
    params: {
      name: spec.windTool,
      arguments: spec.windArguments ?? {},
      _meta: { clientVersion: '1.6.1' },
    },
  }, 60_000)
  const text = parseWindText(body)
  const parsed = parseJson(text)
  const rows = rowsOf(parsed)
  return resultFor(spec, 'passed', Date.now() - started, {
    httpStatus: 200,
    parsedCount: rows.length || scalarCount(parsed),
    preview: preview(parsed, text),
    columns: columnsOf(parsed, rows),
    schema: schemaOf(rows[0]),
    providerTime: providerTimeOf(parsed, rows[0]),
  })
}

async function postWindJson(url, headers, payload, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Wind HTTP ${res.status}: ${singleLine(body)}`)
  return body
}

function skipReasonFor(spec) {
  return skipDecisionFor(spec)?.reason ?? null
}

function cascadeDecisionFor(spec, circuit) {
  const key = providerCircuitKey(spec)
  if (!key) return null
  const state = circuit.get(key)
  if (!state || state.transportFailures < maxProviderTransportFailures) return null
  return {
    status: 'blocked',
    failureClass: 'runtime_unavailable',
    reason: `Provider runtime circuit open for ${key} after ${state.transportFailures} transport failures. Last failure: ${state.lastError}`,
    dependency: { providerCircuit: key, transportFailures: state.transportFailures, lastError: state.lastError },
  }
}

function buildProviderCircuit(previousResults) {
  const circuit = new Map()
  for (const result of previousResults) updateProviderCircuit(circuit, result)
  return circuit
}

function updateProviderCircuit(circuit, result) {
  const key = providerCircuitKey(result)
  if (!key) return
  if (result.status === 'passed') {
    circuit.set(key, { transportFailures: 0, lastError: '' })
    return
  }
  const failureClass = result.failureClass ?? classifyProbeFailure(result)
  if (!['transport', 'runtime_unavailable', 'provider_outage'].includes(failureClass)) return
  const previous = circuit.get(key) ?? { transportFailures: 0, lastError: '' }
  circuit.set(key, {
    transportFailures: previous.transportFailures + 1,
    lastError: result.error ?? failureClass,
  })
}

function providerCircuitKey(spec) {
  if (spec.kind === 'gotdx') {
    const family = String(spec.family ?? '')
    if (family.startsWith('ex/')) return 'gotdx:ex'
    if (family.startsWith('mac/')) return 'gotdx:mac'
    return 'gotdx:standard'
  }
  if (spec.kind === 'wind-direct') return `wind:${spec.windServer ?? spec.provider}`
  return null
}

function skipDecisionFor(spec) {
  if (spec.kind === 'gotdx' && !runtime.gotdx.online) return {
    status: 'blocked',
    reason: runtime.gotdx.reason ?? `gotdx unavailable at ${gotdxUrl}`,
    failureClass: 'runtime_unavailable',
    dependency: runtime.gotdx,
  }
  if (spec.kind === 'sidecar' && !runtime.sidecar.online) return {
    status: 'blocked',
    reason: runtime.sidecar.reason ?? `Python sidecar unavailable at ${sidecarUrl}`,
    failureClass: 'runtime_unavailable',
    dependency: runtime.sidecar,
  }
  if (spec.quota && !includeQuota) return {
    status: 'quota-gated',
    reason: 'quota-sensitive probe skipped; rerun with --include-quota or --stage quota',
    failureClass: 'quota_rate_limit',
  }
  if (spec.requiresTushare && !tushareToken) return {
    status: 'credential-gated',
    reason: 'TUSHARE_TOKEN missing. Configure Settings > Finance or pass --tushare-token.',
    failureClass: 'auth_permission',
    dependency: runtime.credentials.tushare,
  }
  if (spec.requiresWind && !windApiKey) return {
    status: 'credential-gated',
    reason: 'WIND_API_KEY missing. Configure Settings > Finance or pass --wind-api-key.',
    failureClass: 'auth_permission',
    dependency: runtime.credentials.wind,
  }
  return null
}

function shouldRun(spec, selectedStage) {
  if (selectedStage === 'all') return true
  if (selectedStage === 'exhaustive') return spec.stages.includes('exhaustive') || spec.stages.includes('standard') || spec.stages.includes('smoke') || spec.quota
  if (selectedStage === 'quota') return spec.quota || spec.stages.includes('quota')
  return spec.stages.includes(selectedStage)
}

function resultFor(spec, status, durationMs, data = {}) {
  const error = data.error ? String(data.error) : ''
  return {
    id: spec.id,
    runtime: spec.runtime,
    provider: spec.provider,
    family: spec.family,
    kind: spec.kind,
    url: redact(spec.url),
    params: spec.params,
    status,
    validationState: validationStateForResult(status, data, error),
    durationMs,
    ...(data.httpStatus != null ? { httpStatus: data.httpStatus } : {}),
    ...(data.parsedCount != null ? { parsedCount: data.parsedCount } : {}),
    ...(data.columns ? { columns: data.columns } : {}),
    ...(data.schema ? { schema: data.schema } : {}),
    ...(data.providerTime ? { providerTime: data.providerTime } : {}),
    ...(data.dependency ? { dependency: data.dependency } : {}),
    ...(error ? { error } : {}),
    ...(error ? { failureClass: data.failureClass ?? classifyProbeFailure({ ...spec, ...data, error }) } : {}),
    preview: data.preview ?? '',
  }
}

function validationStateForResult(status, data, error) {
  if (status === 'passed') {
    const count = Number(data.parsedCount ?? 0)
    return count > 0 ? 'valid-schema-observed' : 'valid-empty-response'
  }
  if (status === 'credential-gated') return 'credential-gated'
  if (status === 'quota-gated') return 'quota-gated'
  if (status === 'blocked') return 'runtime-blocked'
  const failureClass = data.failureClass ?? classifyProbeFailure({ ...data, error })
  if (failureClass === 'auth_permission') return 'credential-gated'
  if (failureClass === 'quota_rate_limit') return 'quota-gated'
  if (failureClass === 'runtime_unavailable') return 'runtime-blocked'
  if (failureClass === 'invalid_parameters') return 'invalid-parameters'
  if (failureClass === 'provider_outage' || failureClass === 'transport') return 'transport-or-provider-unstable'
  if (failureClass === 'contract_mismatch') return 'unsupported-by-provider'
  return 'transport-or-provider-unstable'
}

function classifyProbeFailure(row) {
  const status = Number(row.httpStatus ?? row.status ?? 0)
  const text = [
    row.error,
    row.url,
    row.family,
    row.provider,
    row.id,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ')
  if (status === 401 || status === 403 || /auth|permission|权限|没有接口|forbidden|unauthorized|invalid key|api key/.test(text)) return 'auth_permission'
  if (status === 429 || /rate limit|too many|quota|balance_insufficient|rate_limit_daily|frequency/.test(text)) return 'quota_rate_limit'
  if (isRuntimeUnavailableFailure(text)) return 'runtime_unavailable'
  if (/timeout|aborted|socket|econnreset|fetch failed|network|proxy|blocked|hang up|remote.*disconnect|und_err|unavailable/.test(text) || status === 0) return 'transport'
  if (/contract mismatch|schema|parser|parse|decode|validation|field|rows \d+ < min/.test(text)) return 'contract_mismatch'
  if (/invalid param|invalid argument|unexpected keyword|bad request|参数|parameter/.test(text) || status === 400) return 'invalid_parameters'
  if (status >= 500) return 'provider_outage'
  return 'unknown'
}

function isRuntimeUnavailableFailure(text) {
  return /runtime_unavailable/.test(text) ||
    /provider runtime circuit open/.test(text) ||
    /python sidecar unavailable/.test(text) ||
    /gotdx unavailable/.test(text) ||
    /127\.0\.0\.1:1980[01].*(connection refused|econnrefused|failed to fetch)/.test(text)
}

function rowsOf(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.List)) return value.List
  if (Array.isArray(value?.list)) return value.list
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.data?.rank_list)) return value.data.rank_list
  if (Array.isArray(value?.data?.diff)) return value.data.diff
  if (Array.isArray(value?.data?.pool)) return value.data.pool
  if (Array.isArray(value?.data?.allstock)) return value.data.allstock
  if (Array.isArray(value?.data?.klines)) return value.data.klines
  if (Array.isArray(value?.result?.data)) return value.result.data
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.news)) return value.news
  return []
}

function scalarCount(value) {
  if (value && typeof value === 'object' && Object.keys(value).length > 0 && !value.error) return 1
  return 0
}

function columnsOf(parsed, rows) {
  if (Array.isArray(parsed?.columns)) return parsed.columns.map(String)
  if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) return Object.keys(rows[0])
  return []
}

function schemaOf(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {}
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value]))
}

function providerTimeOf(parsed, row) {
  const candidates = [
    row,
    parsed?.data,
    parsed?.result,
    parsed,
  ].filter((value) => value && typeof value === 'object' && !Array.isArray(value))
  const keys = [
    'trade_date',
    'TRADE_DATE',
    'date',
    'DATE',
    'datetime',
    'time',
    'timestamp',
    'quote_time',
    'f124',
    'updateTime',
    'updated_at',
    'nav_date',
  ]
  for (const source of candidates) {
    for (const key of keys) {
      const value = source[key]
      if (value != null && String(value).trim()) return normalizeProviderTime(value)
    }
  }
  return null
}

function normalizeProviderTime(value) {
  if (typeof value === 'number') {
    if (value > 1_000_000_000 && value < 10_000_000_000) return new Date(value * 1000).toISOString()
    if (value > 1_000_000_000_000) return new Date(value).toISOString()
  }
  return String(value)
}

function apiError(value) {
  if (value?.error) return String(value.error)
  if (value?.code && String(value.code) !== '0' && value?.msg) return `${value.code}: ${value.msg}`
  return null
}

function parseWindText(body) {
  const payload = JSON.parse(extractWindJson(body))
  if (payload.error) throw new Error(`Wind JSON-RPC error: ${JSON.stringify(payload.error)}`)
  const result = payload.result
  if (!result || typeof result !== 'object') return JSON.stringify(payload)
  if (result.isError) throw new Error(windContentText(result))
  const text = windContentText(result)
  const innerError = windInnerError(text)
  if (innerError) throw new Error(innerError)
  return text || JSON.stringify(result)
}

function extractWindJson(body) {
  const dataLines = String(body)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]')
  return dataLines.length > 0 ? dataLines[dataLines.length - 1] : body
}

function windContentText(result) {
  const content = result.content
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0]
    if (first && typeof first === 'object' && first.text != null) return String(first.text)
  }
  return JSON.stringify(result)
}

function windInnerError(text) {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      if (parsed.mcp_tool_error_code != null && parsed.mcp_tool_error_code !== 0) {
        return `Wind tool returned mcp_tool_error_code=${parsed.mcp_tool_error_code}: ${text}`
      }
      if (parsed.error) return `Wind tool returned error: ${JSON.stringify(parsed.error)}`
    }
  } catch {}
  return null
}

async function isHealthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

async function detectRuntime() {
  const sidecarOnline = await isHealthy(`${sidecarUrl}/health`)
  const gotdxOnline = await isHealthy(`${gotdxUrl}/health`)
  return {
    appRoot,
    bootstrap: {
      requested: bootstrapSidecars || bootstrapPython || bootstrapGotdx,
      python: bootstrapPython,
      gotdx: bootstrapGotdx,
      keepSidecars,
    },
    sidecar: sidecarOnline
      ? { name: 'python-sidecar', status: 'online', online: true, url: sidecarUrl }
      : {
          name: 'python-sidecar',
          status: 'blocked',
          online: false,
          url: sidecarUrl,
          reason: `Python sidecar unavailable at ${sidecarUrl}. Start with: cd ${join(appRoot, 'sidecar')} && uv run server.py 19800`,
        },
    gotdx: gotdxOnline
      ? { name: 'gotdx', status: 'online', online: true, url: gotdxUrl }
      : {
          name: 'gotdx',
          status: 'blocked',
          online: false,
          url: gotdxUrl,
          reason: `gotdx unavailable at ${gotdxUrl}. Build with: ${join(appRoot, 'scripts', 'build_gotdx.sh')}; start ${join(appRoot, 'sidecar', 'gotdx', process.platform === 'win32' ? 'gotdx-server.exe' : 'gotdx-server')} 19801`,
        },
  }
}

function credentialStates() {
  return {
    tushare: tushareToken
      ? { name: 'TUSHARE_TOKEN', status: 'configured', configured: true, source: credentialSource('tushare-token', ['TUSHARE_TOKEN', 'TUSHARE_API_TOKEN'], 'TUSHARE_TOKEN') }
      : {
          name: 'TUSHARE_TOKEN',
          status: 'credential-gated',
          configured: false,
          source: 'missing',
          reason: `TUSHARE_TOKEN missing. Configure Settings > Finance, pass --tushare-token, set env, or add apiKeys.TUSHARE_TOKEN to ${finElectronConfig.path}.`,
        },
    wind: windApiKey
      ? { name: 'WIND_API_KEY', status: 'configured', configured: true, source: credentialSource('wind-api-key', ['WIND_API_KEY'], 'WIND_API_KEY') }
      : {
          name: 'WIND_API_KEY',
          status: 'credential-gated',
          configured: false,
          source: 'missing',
          reason: `WIND_API_KEY missing. Configure Settings > Finance, pass --wind-api-key, set env, or add apiKeys.WIND_API_KEY to ${finElectronConfig.path}.`,
        },
  }
}

function credentialSource(cliKey, envKeys, configKey) {
  if (args[cliKey]) return 'cli'
  for (const key of envKeys) if (process.env[key]) return `env:${key}`
  if (finElectronConfig.apiKeys?.[configKey]) return finElectronConfig.path
  return 'missing'
}

function loadFinElectronConfig() {
  const path = join(homedir(), '.finagent-workstation', 'config.json')
  if (!existsSync(path)) return { path, apiKeys: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return { path, apiKeys: parsed.apiKeys ?? {} }
  } catch {
    return { path, apiKeys: {} }
  }
}

function capabilityStates(currentRuntime) {
  return {
    gotdx: currentRuntime.gotdx.online ? 'probeable' : 'blocked',
    akshare: currentRuntime.sidecar.online ? 'probeable' : 'blocked',
    yfinance: currentRuntime.sidecar.online ? 'probeable' : 'blocked',
    tushare: currentRuntime.credentials.tushare.configured ? 'probeable' : 'credential-gated',
    wind: currentRuntime.credentials.wind.configured ? 'probeable' : 'credential-gated',
    eastmoneyDirect: 'probeable',
  }
}

async function bootstrapGotdxRuntime() {
  const binary = join(appRoot, 'sidecar', 'gotdx', process.platform === 'win32' ? 'gotdx-server.exe' : 'gotdx-server')
  if (!existsSync(binary)) {
    const buildScript = join(appRoot, 'scripts', 'build_gotdx.sh')
    if (!existsSync(buildScript)) return
    const build = await runCommand('bash', [buildScript], { cwd: appRoot, timeoutMs: 120_000 })
    if (build.code !== 0) return
  }
  if (!existsSync(binary)) return
  const child = spawn(binary, ['19801'], {
    cwd: join(appRoot, 'sidecar', 'gotdx'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  startedProcesses.push(child)
  await waitForHealth(`${gotdxUrl}/health`, runtimeTimeoutMs)
}

async function bootstrapPythonRuntime() {
  const sidecarDir = join(appRoot, 'sidecar')
  const serverPy = join(sidecarDir, 'server.py')
  if (!existsSync(serverPy)) return
  const child = spawn('uv', ['run', 'server.py', '19800'], {
    cwd: sidecarDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FINDATA_DB_PATH: basePath ? join(basePath, 'data', 'market.db') : process.env.FINDATA_DB_PATH ?? '' },
  })
  startedProcesses.push(child)
  await waitForHealth(`${sidecarUrl}/health`, runtimeTimeoutMs)
}

async function waitForHealth(url, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return true
    await sleep(500)
  }
  return false
}

function runCommand(command, commandArgs, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 124, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms` })
    }, timeoutMs)
    child.stdout?.on('data', (data) => { stdout += data.toString() })
    child.stderr?.on('data', (data) => { stderr += data.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 0, stdout, stderr })
    })
  })
}

function cleanupStartedProcesses() {
  if (keepSidecars) return
  for (const child of startedProcesses.splice(0)) {
    try { child.kill() } catch {}
  }
}

function printResult(index, total, result) {
  const count = result.parsedCount == null ? '' : ` rows=${result.parsedCount}`
  const error = result.error ? ` error=${singleLine(result.error)}` : ''
  console.log(`[${index + 1}/${total}] ${result.status.toUpperCase().padEnd(16)} ${result.id} (${result.durationMs}ms)${count}${error}`)
}

function summarize(results) {
  const summary = { passed: 0, failed: 0, skipped: 0, timeout: 0, blocked: 0, 'credential-gated': 0, 'quota-gated': 0, total: results.length }
  for (const result of results) summary[result.status] = (summary[result.status] ?? 0) + 1
  return summary
}

function printUsage() {
  console.log('Usage: node scripts/finance_live_probe_matrix.mjs [options]')
  console.log('')
  console.log('  --stage smoke|standard|exhaustive|quota|all')
  console.log('  --concurrency 1              Required for live finance probes')
  console.log('  --wait-ms 1500')
  console.log('  --timeout-ms 30000')
  console.log('  --eastmoney-timeout-ms 120000  Timeout budget for EastMoney-backed direct/sidecar probes')
  console.log('  --sidecar-url http://127.0.0.1:19800')
  console.log('  --gotdx-url http://127.0.0.1:19801')
  console.log('  --output <path>')
  console.log('  --checkpoint <path>             Write resumable checkpoint after each probe')
  console.log('  --resume                        Skip probe ids already present in checkpoint')
  console.log('  --base-path <path>              Register output as data_snapshot artifact under this runtime root')
  console.log('  --register-artifact             Register output as data_snapshot artifact when --base-path is set')
  console.log('  --only <id-substring>')
  console.log('  --include-quota')
  console.log('  --tushare-token <token>')
  console.log('  --wind-api-key <key>')
  console.log('  --bootstrap-sidecars           Start gotdx and Python sidecar before probing')
  console.log('  --bootstrap-gotdx              Start/build gotdx sidecar before probing')
  console.log('  --bootstrap-python             Start Python sidecar before probing')
  console.log('  --app-root <path>              FinAgent Workstation root for sidecar bootstrap')
  console.log('  --runtime-timeout-ms 20000')
  console.log('  --keep-sidecars                Leave bootstrapped child processes running')
  console.log('  --max-provider-transport-failures 3')
  console.log('  --coverage                    Print expected-family coverage before running')
  console.log('  --coverage-only               Print coverage and exit non-zero if a family is missing')
  console.log('  --no-fail-on-error')
}

function readCheckpoint(path) {
  if (!path || !existsSync(path)) return { results: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return Array.isArray(parsed?.results) ? parsed : { results: [] }
  } catch {
    return { results: [] }
  }
}

function writeCheckpoint(path, state) {
  if (!path) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}

function registerDataSnapshotArtifact(root, outputPath, payload) {
  if (!root) return null
  const registryPath = join(root, 'memory', 'artifacts', 'registry.json')
  const now = new Date().toISOString()
  const id = `data_snapshot:finance_schema_census:${payload.stage}`
  const previousRecords = readArtifactRecords(registryPath)
  const previous = previousRecords.find((record) => record.id === id)
  const record = {
    id,
    kind: 'data_snapshot',
    stableRef: `artifact:${id}`,
    path: outputPath,
    title: `Finance schema census (${payload.stage})`,
    source: 'finance_live_probe_matrix',
    ownerTask: 'data_schema_live_probe',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    expiresAt: null,
    verificationStatus: payload.summary.failed > 0 || payload.summary.timeout > 0 ? 'failed' : 'verified',
    freshness: {
      sourceTime: providerTimeSummary(payload.results),
      fetchedAt: payload.generatedAt,
      status: payload.summary.failed > 0 || payload.summary.timeout > 0 ? 'unknown' : 'fresh',
    },
    provenance: {
      source: 'finance_live_probe_matrix',
      stage: payload.stage,
      waitMs: payload.waitMs,
      runtime: payload.runtime,
      capabilities: payload.runtime?.capabilities,
      coverage: payload.coverage,
      outputPath,
    },
    links: [
      `artifact:${id}`,
      outputPath,
      relative(root, outputPath).startsWith('..') ? outputPath : relative(root, outputPath),
    ],
    metadata: {
      total: payload.summary.total,
      passed: payload.summary.passed,
      failed: payload.summary.failed,
      skipped: payload.summary.skipped,
      blocked: payload.summary.blocked,
      credentialGated: payload.summary['credential-gated'],
      quotaGated: payload.summary['quota-gated'],
      timeout: payload.summary.timeout,
      providers: uniqueStrings(payload.results.map((result) => result.provider)),
      families: uniqueStrings(payload.results.map((result) => `${result.provider}:${result.family}`)),
    },
  }
  mkdirSync(dirname(registryPath), { recursive: true })
  writeFileSync(registryPath, `${JSON.stringify([record, ...previousRecords.filter((item) => item.id !== id)], null, 2)}\n`, 'utf-8')
  return record
}

function readArtifactRecords(path) {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : []
  } catch {
    return []
  }
}

function providerTimeSummary(results) {
  return results.map((result) => result.providerTime).filter(Boolean).sort().at(-1) ?? null
}

function uniqueStrings(values) {
  const out = []
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || out.includes(value)) continue
    out.push(value)
  }
  return out
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const arg = values[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = 'true'
      continue
    }
    if (!arg.startsWith('--')) continue
    const raw = arg.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) parsed[raw.slice(0, eq)] = raw.slice(eq + 1)
    else if (i + 1 < values.length && !values[i + 1].startsWith('--')) parsed[raw] = values[++i]
    else parsed[raw] = 'true'
  }
  return parsed
}

function urlWithParams(base, params) {
  if (params?._sinaList) return `${base}${params._sinaList}`
  if (params?._tencentList) return `${base}${params._tencentList}`
  const qs = new URLSearchParams(params)
  return qs.size === 0 ? base : `${base}?${qs}`
}

function sinaStockSymbol(code) {
  return `${String(code).startsWith('6') ? 'sh' : 'sz'}${code}`
}

function sinaIndexSymbol(code) {
  return `${String(code).startsWith('0') ? 'sh' : 'sz'}${code}`
}

function sinaTransactionsUrl(code) {
  return urlWithParams('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_Bill.GetBillList', {
    symbol: sinaStockSymbol(code),
    num: '60',
    page: '1',
    sort: 'ticktime',
    asc: '0',
    volume: '0',
    amount: '0',
    type: '0',
    day: DASH_DATE,
  })
}

function tencentStockSymbol(code) {
  return `${String(code).startsWith('6') ? 'sh' : 'sz'}${code}`
}

function tencentIndexSymbol(code) {
  return `${String(code).startsWith('0') ? 'sh' : 'sz'}${code}`
}

function tencentRankListUrl() {
  return urlWithParams('https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList', {
    _appver: '11.17.0',
    board_code: 'aStock',
    sort_type: 'price',
    direct: 'down',
    offset: '0',
    count: '20',
  })
}

function tencentKlineUrl(symbol, index = false, adjust = 'qfq') {
  const suffix = adjust || ''
  return urlWithParams('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get', {
    _var: `kline_day${suffix}`,
    param: `${symbol},day,2026-01-01,2026-12-31,20,${suffix}`,
    r: index ? '0.2' : '0.1',
  })
}

function tencentTransactionsUrl(code) {
  return urlWithParams('http://stock.gtimg.cn/data/index.php', {
    appn: 'detail',
    action: 'data',
    c: tencentStockSymbol(code),
    p: '0',
  })
}

function push2exUrl(endpoint, params) {
  return urlWithParams(`https://push2ex.eastmoney.com/${endpoint}`, {
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    ...params,
  })
}

function datacenterUrl(params) {
  return urlWithParams('https://datacenter-web.eastmoney.com/api/data/v1/get', {
    source: 'WEB',
    client: 'WEB',
    ...params,
  })
}

function eastmoneyClistUrl(params, host = 'push2delay.eastmoney.com') {
  return urlWithParams(`https://${host}/api/qt/clist/get`, {
    pn: '1',
    pz: params.pz ?? '100',
    po: '1',
    np: '1',
    ut: params.ut ?? 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: params.fid,
    fs: params.fs,
    fields: params.fields,
  })
}

function eastmoneyStockGetUrl(code) {
  return urlWithParams('https://push2delay.eastmoney.com/api/qt/stock/get', {
    fltt: '2',
    invt: '2',
    fields: 'f43,f44,f45,f46,f47,f48,f51,f55,f57,f58,f60,f116,f168,f169,f170',
    secid: `${code.startsWith('6') ? '1' : '0'}.${code}`,
  })
}

function eastmoneyKlineUrl(code) {
  return urlWithParams('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
    secid: `${code.startsWith('6') ? '1' : '0'}.${code}`,
    klt: '101',
    fqt: '1',
    beg: '20260101',
    end: TRADE_DATE,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  })
}

function eastmoneyIndexKlineUrl(code) {
  return urlWithParams('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
    secid: `${code.startsWith('399') ? '0' : '1'}.${code}`,
    klt: '101',
    fqt: '0',
    beg: '20260101',
    end: TRADE_DATE,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  })
}

function tdxMarketForCode(code, index = false) {
  if (index && code === '000001') return '1'
  if (code.startsWith('6')) return '1'
  return '0'
}

function tushareBody(apiName, params, fields) {
  return { token: tushareToken ?? '', api_name: apiName, params, fields }
}

function compactDate(date) {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

function dashedDate(compact) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function parseJson(text) {
  if (/v_[a-z]{2}\d{6}=/.test(text)) {
    return { data: tencentQuoteRows(text) }
  }
  if (/\[0,"[^"]*"\]/.test(text) && /\d{2}:\d{2}:\d{2}/.test(text)) {
    return { data: tencentTransactionRows(text) }
  }
  if (/^\s*\w+\s*=/.test(text) && text.includes('"data"')) {
    const objectText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    try {
      const parsed = JSON.parse(objectText)
      const klineRows = tencentKlineRows(parsed)
      if (klineRows.length > 0) return { data: klineRows }
      return parsed
    } catch {
      return { text: text.slice(0, 2000) }
    }
  }
  if (/hq_str_(?:s_)?s[hz]\d{6}=/.test(text)) {
    return { data: sinaQuoteRows(text) }
  }
  const fundCodeSearch = text.match(/var\s+r\s*=\s*(\[[\s\S]*\])\s*;?/)
  if (fundCodeSearch) {
    try {
      return { data: JSON.parse(fundCodeSearch[1]) }
    } catch {
      return { text: text.slice(0, 2000) }
    }
  }
  const fundNav = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (fundNav) {
    try {
      return { data: JSON.parse(fundNav[1]) }
    } catch {
      return { text: text.slice(0, 2000) }
    }
  }
  const fundRank = text.match(/datas\s*:\s*(\[[\s\S]*?\])\s*,\s*allRecords/)
  if (fundRank) {
    try {
      return { data: JSON.parse(fundRank[1]).map(eastmoneyFundRankLineToRow).filter(Boolean) }
    } catch {
      return { text: text.slice(0, 2000) }
    }
  }
  if (/var\s+apidata\s*=/.test(text) && /FundArchivesDatas/.test(text + ' FundArchivesDatas')) {
    const rows = eastmoneyFundHoldingRows(text)
    if (rows.length > 0) return { data: rows }
  }
  const fundManager = text.match(/data\s*:\s*(\[[\s\S]*?\])\s*,\s*record/)
  if (fundManager) {
    try {
      return { data: JSON.parse(fundManager[1]).map(eastmoneyFundManagerRow).filter(Boolean) }
    } catch {
      return { text: text.slice(0, 2000) }
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return { text: text.slice(0, 2000) }
  }
}

function sinaQuoteRows(text) {
  const rows = []
  for (const match of text.matchAll(/hq_str_s_(s[hz]\d{6})="([^"]*)"/g)) {
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
  for (const match of text.matchAll(/hq_str_(s[hz]\d{6})="([^"]*)"/g)) {
    const parts = match[2].split(',')
    if (parts.length < 32) continue
    const price = Number(parts[3])
    const prevClose = Number(parts[2])
    rows.push({
      code: match[1].slice(2),
      name: parts[0],
      price,
      change: price - prevClose,
      changePct: prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0,
      open: Number(parts[1]),
      high: Number(parts[4]),
      low: Number(parts[5]),
      prevClose,
      volume: Number(parts[8]),
      amount: Number(parts[9]),
      providerTime: `${parts[30] ?? ''} ${parts[31] ?? ''}`.trim(),
    })
  }
  return rows
}

function tencentQuoteRows(text) {
  const rows = []
  for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
    const parts = match[2].split('~')
    if (parts.length < 45) continue
    rows.push({
      code: parts[2] || match[1].slice(2),
      name: parts[1],
      price: Number(parts[3]),
      prevClose: Number(parts[4]),
      open: Number(parts[5]),
      volume: Number(parts[6]),
      high: Number(parts[33]),
      low: Number(parts[34]),
      providerTime: parts[30],
    })
  }
  return rows
}

function tencentKlineRows(parsed) {
  const data = parsed?.data
  if (!data || typeof data !== 'object') return []
  const rows = []
  for (const [symbol, value] of Object.entries(data)) {
    const payload = value && typeof value === 'object' ? value : {}
    const rawRows = payload.qfqday ?? payload.day ?? payload.hfqday ?? []
    if (!Array.isArray(rawRows)) continue
    for (const row of rawRows) {
      if (!Array.isArray(row) || row.length < 6) continue
      rows.push({
        symbol,
        date: row[0],
        open: Number(row[1]),
        close: Number(row[2]),
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5]),
      })
    }
  }
  return rows
}

function tencentTransactionRows(text) {
  const quoted = /\[0,"([^"]*)"/.exec(text)?.[1] ?? ''
  return quoted.split('|').filter(Boolean).map((line) => {
    const parts = line.split('/')
    return {
      time: parts[1],
      price: Number(parts[2]),
      change: Number(parts[3]),
      volume: Number(parts[4]),
      amount: Number(parts[5]),
      direction: parts[6],
    }
  })
}

function eastmoneyFundRankUrl() {
  return `https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=zzf&st=desc&sd=2000-01-01&ed=${DASH_DATE}&qdii=&tabSubtype=,,,,,&pi=1&pn=50&dx=1&v=${Date.now()}`
}

function eastmoneyFundHoldingUrl(code) {
  return `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${encodeURIComponent(code)}&topline=10000&year=${new Date().getFullYear()}&month=&rt=${Date.now()}`
}

function eastmoneyFundManagerUrl() {
  return 'https://fund.eastmoney.com/Data/FundDataPortfolio_Interface.aspx?dt=14&mc=returnjson&ft=all&pn=50&pi=1&sc=abbname&st=asc'
}

function eastmoneyFundRankLineToRow(line) {
  const parts = String(line ?? '').split(',')
  const code = parts[0]?.trim()
  if (!code) return null
  return {
    code,
    name: parts[1]?.trim() ?? '',
    date: parts[3]?.trim() ?? '',
    nav: parts[4]?.trim() ?? '',
    return_1w: parts[6]?.trim() ?? '',
    return_1m: parts[7]?.trim() ?? '',
    return_3m: parts[8]?.trim() ?? '',
    return_6m: parts[9]?.trim() ?? '',
    return_1y: parts[10]?.trim() ?? '',
    return_2y: parts[11]?.trim() ?? '',
    return_3y: parts[12]?.trim() ?? '',
    return_ytd: parts[14]?.trim() ?? '',
    return_since_inception: parts[15]?.trim() ?? '',
  }
}

function eastmoneyFundHoldingRows(text) {
  const rows = []
  const sections = String(text).split(/<h4 class='t'>/).slice(1)
  for (const section of sections) {
    const report_date = section.match(/截止至：<font[^>]*>([^<]+)<\/font>/)?.[1] ?? ''
    const rowPattern = /<tr><td>(\d+)<\/td><td><a[^>]*>(\d{6})<\/a><\/td><td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>([^<]*)<\/td><td class='tor'>([^<]*)<\/td><td class='tor'>([^<]*)<\/td><\/tr>/g
    let match
    while ((match = rowPattern.exec(section))) {
      rows.push({
        rank: match[1],
        stock_code: match[2],
        stock_name: match[3],
        report_date,
        hold_pct: match[4],
        hold_shares: match[5],
        hold_value: match[6],
      })
    }
  }
  return rows
}

function eastmoneyFundManagerRow(row) {
  if (!Array.isArray(row) || !row[1]) return null
  return {
    manager_id: row[0],
    name: row[1],
    company: row[3],
    fund_codes: row[4],
    fund_names: row[5],
    experience_days: row[6],
    total_size: row[10],
    best_return: row[11] ?? row[7],
  }
}

function preview(parsed, raw) {
  return singleLine(JSON.stringify(rowsOf(parsed)[0] ?? parsed ?? raw)).slice(0, 500)
}

function singleLine(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function occurrences(text, pattern) {
  const source = String(text ?? '')
  const needle = String(pattern ?? '')
  if (!needle) return 0
  return source.split(needle).length - 1
}

function redact(url) {
  return String(url).replace(sidecarUrl, '<sidecar>').replace(gotdxUrl, '<gotdx>')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
