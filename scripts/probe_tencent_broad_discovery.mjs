import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const outJson = path.join(root, 'reports/integrations/finance_tencent_broad_probe_results_2026_06_23.json')
const outMd = path.join(root, 'reports/integrations/finance_tencent_broad_probe_results_2026_06_23.md')
const rawDir = path.join(root, 'reports/integrations/tencent-broad-raw-2026-06-23')

fs.rmSync(rawDir, { recursive: true, force: true })
fs.mkdirSync(rawDir, { recursive: true })

const probes = [
  candidate('tencent.quote.stock_single_sh', 'direct', 'stock.quote', true, 'https://qt.gtimg.cn/q=sh600519', parseQuote, 'Single A-share quote'),
  candidate('tencent.quote.stock_single_sz', 'direct', 'stock.quote', true, 'https://qt.gtimg.cn/q=sz000001', parseQuote, 'Single SZ A-share quote'),
  candidate('tencent.quote.stock_batch', 'direct', 'stock.quote', true, 'https://qt.gtimg.cn/q=sh600519,sz000001,bj430047', parseQuote, 'Batch A-share quote including BJ symbol'),
  candidate('tencent.quote.index_major', 'direct', 'index.quote', true, 'https://qt.gtimg.cn/q=sh000001,sz399001,sz399006', parseQuote, 'Major China index quote'),
  candidate('tencent.quote.index_csi_batch', 'direct', 'index.quote', true, 'https://qt.gtimg.cn/q=sh000300,sh000905,sh000852', parseQuote, 'CSI 300 / 500 / 1000 index quote batch'),
  candidate('tencent.quote.etf_batch', 'direct', 'fund.etf_quote', false, 'https://qt.gtimg.cn/q=sh510300,sh510050,sz159915', parseQuote, 'ETF quote batch'),
  candidate('tencent.quote.etf_cross_market_batch', 'direct', 'fund.etf_quote', false, 'https://qt.gtimg.cn/q=sh588000,sz159919,sz159995', parseQuote, 'Cross-market ETF quote batch'),
  candidate('tencent.quote.listed_fund_batch', 'direct', 'fund.etf_quote', false, 'https://qt.gtimg.cn/q=sh511880,sh511990,sz160222,sz161725', parseQuote, 'Listed fund / money-market fund quote batch'),
  candidate('tencent.quote.convertible_bond_batch', 'direct', 'bond.market_data', false, 'https://qt.gtimg.cn/q=sh110059,sz123018', parseQuote, 'Convertible bond quote batch'),
  candidate('tencent.quote.convertible_bond_more_batch', 'direct', 'bond.market_data', false, 'https://qt.gtimg.cn/q=sh113021,sz123018,sz127049', parseQuote, 'Additional convertible bond quote batch'),
  candidate('tencent.quote.exchange_bond_guess', 'direct', 'bond.market_data', false, 'https://qt.gtimg.cn/q=sh019694,sz149997', parseQuote, 'Exchange bond quote route probe'),
  candidate('tencent.quote.hk_single', 'direct', 'global.stock_quote', false, 'https://qt.gtimg.cn/q=hk00700', parseQuote, 'HK stock quote'),
  candidate('tencent.quote.hk_batch', 'direct', 'global.stock_quote', false, 'https://qt.gtimg.cn/q=hk00700,hk02318,hk09988', parseQuote, 'HK stock quote batch'),
  candidate('tencent.quote.hk_more_batch', 'direct', 'global.stock_quote', false, 'https://qt.gtimg.cn/q=hk00005,hk00388,hk03690', parseQuote, 'Additional HK stock quote batch'),
  candidate('tencent.quote.us_guess', 'direct', 'global.stock_quote', false, 'https://qt.gtimg.cn/q=usAAPL,usMSFT', parseQuote, 'US quote symbol format probe'),

  candidate('tencent.rank.astock_price_down', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'price', direct: 'down', offset: 0, count: 20 }), parseRankList, 'A-share rank/list by price down'),
  candidate('tencent.rank.astock_price_up', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'price', direct: 'up', offset: 0, count: 20 }), parseRankList, 'A-share rank/list by price up'),
  candidate('tencent.rank.astock_page_2', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'price', direct: 'down', offset: 20, count: 20 }), parseRankList, 'A-share rank/list second page'),
  candidate('tencent.rank.astock_page_20', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'price', direct: 'down', offset: 400, count: 20 }), parseRankList, 'A-share rank/list bounded deep page'),
  candidate('tencent.rank.astock_page_size_200', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'price', direct: 'down', offset: 0, count: 200 }), parseRankList, 'A-share rank/list larger page'),
  candidate('tencent.rank.astock_volume', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'volume', direct: 'down', offset: 0, count: 20 }), parseRankList, 'A-share rank/list by volume'),
  candidate('tencent.rank.astock_volume_page_2', 'direct', 'stock.identity_list', true, rankUrl({ sort_type: 'volume', direct: 'down', offset: 20, count: 20 }), parseRankList, 'A-share rank/list volume second page'),
  candidate('tencent.rank.astock_amount', 'direct', 'stock.identity_list', false, rankUrl({ sort_type: 'amount', direct: 'down', offset: 0, count: 20 }), parseRankList, 'A-share rank/list by amount'),
  candidate('tencent.rank.astock_change_guess', 'direct', 'stock.identity_list', false, rankUrl({ sort_type: 'increase', direct: 'down', offset: 0, count: 20 }), parseRankList, 'A-share rank/list change sort guess'),
  candidate('tencent.rank.board_hs_guess', 'direct', 'stock.identity_list', false, rankUrl({ board_code: 'hs', sort_type: 'price', direct: 'down', offset: 0, count: 20 }), parseRankList, 'Board-code rank route guess'),

  candidate('tencent.kline.stock_qfq', 'direct', 'stock.daily_kline', true, klineUrl('sh600519', 'qfq', 20), parseKline('sh600519'), 'A-share qfq daily K-line'),
  candidate('tencent.kline.stock_none', 'direct', 'stock.daily_kline', true, klineUrl('sh600519', '', 20), parseKline('sh600519'), 'A-share unadjusted daily K-line'),
  candidate('tencent.kline.stock_hfq', 'direct', 'stock.daily_kline', true, klineUrl('sh600519', 'hfq', 20), parseKline('sh600519'), 'A-share hfq daily K-line'),
  candidate('tencent.kline.stock_sz_qfq', 'direct', 'stock.daily_kline', true, klineUrl('sz000001', 'qfq', 20), parseKline('sz000001'), 'SZ A-share qfq daily K-line'),
  candidate('tencent.kline.stock_custom_range', 'direct', 'stock.daily_kline', true, klineUrl('sh600519', 'qfq', 640, '2025-01-01', '2025-12-31'), parseKline('sh600519'), 'A-share custom date range daily K-line'),
  candidate('tencent.kline.stock_older_range', 'direct', 'stock.daily_kline', true, klineUrl('sh600519', 'qfq', 640, '2024-01-01', '2024-12-31'), parseKline('sh600519'), 'A-share older date range daily K-line'),
  candidate('tencent.kline.etf_none', 'direct', 'fund.etf_daily_ohlcv_bars', false, klineUrl('sh510300', '', 120), parseKline('sh510300'), 'ETF unadjusted daily K-line'),
  candidate('tencent.kline.etf_qfq', 'direct', 'fund.etf_daily_ohlcv_bars', false, klineUrl('sh510300', 'qfq', 120), parseKline('sh510300'), 'ETF qfq daily K-line'),
  candidate('tencent.kline.etf_hfq', 'direct', 'fund.etf_daily_ohlcv_bars', false, klineUrl('sh510300', 'hfq', 120), parseKline('sh510300'), 'ETF hfq daily K-line'),
  candidate('tencent.kline.etf_sz_none', 'direct', 'fund.etf_daily_ohlcv_bars', false, klineUrl('sz159915', '', 120), parseKline('sz159915'), 'SZ ETF unadjusted daily K-line'),
  candidate('tencent.kline.etf_sz_qfq', 'direct', 'fund.etf_daily_ohlcv_bars', false, klineUrl('sz159915', 'qfq', 120), parseKline('sz159915'), 'SZ ETF qfq daily K-line'),
  candidate('tencent.kline.convertible_bond_none', 'direct', 'bond.market_data', false, klineUrl('sh110059', '', 120), parseKline('sh110059'), 'Convertible bond unadjusted daily K-line evidence'),
  candidate('tencent.kline.convertible_bond_sz_none', 'direct', 'bond.market_data', false, klineUrl('sz123018', '', 120), parseKline('sz123018'), 'SZ convertible bond unadjusted daily K-line evidence'),
  candidate('tencent.kline.stock_start_year', 'direct', 'provider.reference_dataset', false, weekTrendUrl('sh600519'), parseWeekTrends, 'Tencent start-date/weekTrends metadata for stock'),

  candidate('tencent.kline.index_qfq', 'direct', 'index.daily_kline', true, klineUrl('sh000001', 'qfq', 20), parseKline('sh000001'), 'Index qfq daily K-line'),
  candidate('tencent.kline.index_none', 'direct', 'index.daily_kline', true, klineUrl('sh000001', '', 20), parseKline('sh000001'), 'Index unadjusted daily K-line'),
  candidate('tencent.kline.index_sz_qfq', 'direct', 'index.daily_kline', true, klineUrl('sz399001', 'qfq', 20), parseKline('sz399001'), 'SZ index qfq daily K-line'),
  candidate('tencent.kline.index_csi300_qfq', 'direct', 'index.daily_kline', true, klineUrl('sh000300', 'qfq', 120), parseKline('sh000300'), 'CSI 300 index qfq daily K-line'),
  candidate('tencent.kline.index_csi500_qfq', 'direct', 'index.daily_kline', true, klineUrl('sh000905', 'qfq', 120), parseKline('sh000905'), 'CSI 500 index qfq daily K-line'),
  candidate('tencent.kline.index_chinext_qfq', 'direct', 'index.daily_kline', true, klineUrl('sz399006', 'qfq', 120), parseKline('sz399006'), 'ChiNext index qfq daily K-line'),
  candidate('tencent.kline.index_custom_range', 'direct', 'index.daily_kline', true, klineUrl('sh000001', 'qfq', 640, '2025-01-01', '2025-12-31'), parseKline('sh000001'), 'Index custom date range daily K-line'),
  candidate('tencent.kline.index_start_year', 'direct', 'provider.reference_dataset', false, weekTrendUrl('sh000001'), parseWeekTrends, 'Tencent start-date/weekTrends metadata for index'),

  candidate('tencent.transactions.stock_page_0', 'direct', 'stock.transactions', true, transactionUrl('sh600519', 0), parseTransactions, 'A-share transactions first page'),
  candidate('tencent.transactions.stock_page_1', 'direct', 'stock.transactions', true, transactionUrl('sh600519', 1), parseTransactions, 'A-share transactions second page'),
  candidate('tencent.transactions.stock_page_2', 'direct', 'stock.transactions', true, transactionUrl('sh600519', 2), parseTransactions, 'A-share transactions third page'),
  candidate('tencent.transactions.stock_sz_page_0', 'direct', 'stock.transactions', true, transactionUrl('sz000001', 0), parseTransactions, 'SZ A-share transactions first page'),
  candidate('tencent.transactions.etf_page_0', 'direct', 'fund.etf_transactions', false, transactionUrl('sh510300', 0), parseTransactions, 'ETF transactions first page'),
  candidate('tencent.transactions.etf_sz_page_0', 'direct', 'fund.etf_transactions', false, transactionUrl('sz159915', 0), parseTransactions, 'SZ ETF transactions first page'),
  candidate('tencent.transactions.convertible_bond_page_0', 'direct', 'bond.transactions', false, transactionUrl('sz123018', 0), parseTransactions, 'Convertible bond transactions first page'),

  candidate('tencent.ah.page_count', 'reference', 'provider.reference_dataset', false, ahUrl(1, 20), parseAhPageCount, 'AH rank page count'),
  candidate('tencent.ah.spot_page_1', 'reference', 'global.stock_quote', false, ahUrl(1, 20), parseAhSpot, 'AH spot quote page'),
  candidate('tencent.ah.spot_page_2', 'reference', 'global.stock_quote', false, ahUrl(2, 20), parseAhSpot, 'AH spot quote second page'),
  candidate('tencent.ah.spot_page_3', 'reference', 'global.stock_quote', false, ahUrl(3, 20), parseAhSpot, 'AH spot quote third page'),
  candidate('tencent.ah.spot_page_large', 'reference', 'global.stock_quote', false, ahUrl(1, 50), parseAhSpot, 'AH spot quote larger page'),
  candidate('tencent.ah.name_page_1', 'reference', 'global.stock_identity_list', false, ahUrl(1, 20), parseAhName, 'AH name list page'),

  candidate('tencent.hk.kline_none', 'reference', 'global.daily_kline', false, hkKlineUrl('hk02318', '', 2026), parseKline('hk02318'), 'HK daily K-line unadjusted'),
  candidate('tencent.hk.kline_hfq', 'reference', 'global.daily_kline', false, hkKlineUrl('hk02318', 'hfq', 2026), parseKline('hk02318'), 'HK daily K-line hfq'),
  candidate('tencent.hk.kline_qfq', 'reference', 'global.daily_kline', false, hkKlineUrl('hk02318', 'qfq', 2026), parseKline('hk02318'), 'HK daily K-line qfq'),
  candidate('tencent.hk.kline_second_symbol_hfq', 'reference', 'global.daily_kline', false, hkKlineUrl('hk00700', 'hfq', 2026), parseKline('hk00700'), 'HK second-symbol daily K-line hfq'),
  candidate('tencent.hk.kline_third_symbol_hfq', 'reference', 'global.daily_kline', false, hkKlineUrl('hk09988', 'hfq', 2026), parseKline('hk09988'), 'HK third-symbol daily K-line hfq'),
  candidate('tencent.hk.kline_bluechip_hfq', 'reference', 'global.daily_kline', false, hkKlineUrl('hk00005', 'hfq', 2026), parseKline('hk00005'), 'HK blue-chip daily K-line hfq'),
  candidate('tencent.hk.rank_guess', 'reference', 'global.stock_identity_list', false, 'http://stock.gtimg.cn/data/hk_rank.php?board=HK&metric=price&pageSize=20&reqPage=1&order=decs&var_name=list_data', parseAhSpot, 'HK rank board guess'),
]

const rows = []
for (const [index, probe] of probes.entries()) {
  const started = Date.now()
  try {
    const res = await fetch(probe.url, {
      headers: {
        Referer: 'https://stockapp.finance.qq.com/mstats/',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(30_000),
    })
    const body = await decodeResponse(res)
    fs.writeFileSync(path.join(rawDir, `${String(index + 1).padStart(2, '0')}-${probe.id}.txt`), body.slice(0, 200_000), 'utf-8')
    const parsed = probe.parse(body)
    const status = res.ok && parsed.rowCount > 0 ? 'passed' : 'failed'
    const governanceDecision = governanceDecisionFor(probe, status)
    const exportPolicy = exportPolicyFor(probe, governanceDecision, status, parsed)
    rows.push({
      id: probe.id,
      class: probe.class,
      sourceFamily: sourceFamilyFor(probe),
      interfaceId: probe.interfaceId,
      persist: probe.persist,
      description: probe.description,
      status,
      classification: classifyProbe(probe, status, parsed),
      governanceDecision,
      normalWorkflowEligible: exportPolicy === 'normal-workflow',
      exportPolicy,
      exportReason: exportReasonFor(governanceDecision),
      httpStatus: res.status,
      durationMs: Date.now() - started,
      rowCount: parsed.rowCount,
      schema: parsed.schema,
      providerTime: parsed.providerTime ?? null,
      sample: parsed.sample,
      failureClass: status === 'passed' ? null : failureClassFor(probe, res, parsed),
      url: probe.url,
    })
  } catch (error) {
    const governanceDecision = 'defer: transport or parser failure must be fixed before promotion.'
    rows.push({
      id: probe.id,
      class: probe.class,
      sourceFamily: sourceFamilyFor(probe),
      interfaceId: probe.interfaceId,
      persist: probe.persist,
      description: probe.description,
      status: 'failed',
      classification: 'transport-or-parser-failure',
      governanceDecision,
      normalWorkflowEligible: false,
      exportPolicy: 'diagnostic-only',
      exportReason: exportReasonFor(governanceDecision),
      httpStatus: 0,
      durationMs: Date.now() - started,
      rowCount: 0,
      schema: [],
      providerTime: null,
      sample: null,
      failureClass: 'transport_or_parser_error',
      error: error instanceof Error ? error.message : String(error),
      url: probe.url,
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
}

const inventory = probes.map((probe) => ({
  id: probe.id,
  class: probe.class,
  sourceFamily: sourceFamilyFor(probe),
  interfaceId: probe.interfaceId,
  persistCandidate: probe.persist,
  description: probe.description,
  urlFamily: new URL(probe.url).hostname,
  url: probe.url,
}))

const summary = {
  generatedAt: new Date().toISOString(),
  candidates: inventory.length,
  probed: rows.length,
  passed: rows.filter((row) => row.status === 'passed').length,
  failed: rows.filter((row) => row.status !== 'passed').length,
  directRows: rows.filter((row) => row.class === 'direct').length,
  referenceRows: rows.filter((row) => row.class === 'reference').length,
  persistCandidatesPassed: rows.filter((row) => row.persist && row.status === 'passed').length,
  normalWorkflowEligible: rows.filter((row) => row.normalWorkflowEligible).length,
  evidenceOnlyRows: rows.filter((row) => !row.normalWorkflowEligible).length,
  classifications: countBy(rows, (row) => row.classification),
  failureClasses: countBy(rows.filter((row) => row.failureClass), (row) => row.failureClass),
  governanceDecisions: countBy(rows, (row) => row.governanceDecision.split(':')[0]),
  exportPolicies: countBy(rows, (row) => row.exportPolicy),
  candidateInterfaces: [...new Set(rows.map((row) => row.interfaceId))].sort(),
}

fs.writeFileSync(outJson, `${JSON.stringify({ summary, inventory, rows }, null, 2)}\n`)
fs.writeFileSync(outMd, markdown(summary, rows, inventory), 'utf-8')
console.log(JSON.stringify(summary, null, 2))

function candidate(id, klass, interfaceId, persist, url, parse, description) {
  return { id, class: klass, interfaceId, persist, url, parse, description }
}

function sourceFamilyFor(probe) {
  if (probe.id.startsWith('tencent.quote.')) return 'quote'
  if (probe.id.startsWith('tencent.rank.')) return 'rank-list'
  if (probe.id.startsWith('tencent.kline.')) return 'daily-kline'
  if (probe.id.startsWith('tencent.transactions.')) return 'transactions'
  if (probe.id.startsWith('tencent.ah.')) return 'ah-reference'
  if (probe.id.startsWith('tencent.hk.')) return 'hk-reference'
  return 'other'
}

function rankUrl(params) {
  return `https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?${new URLSearchParams({
    _appver: '11.17.0',
    board_code: 'aStock',
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  })}`
}

function klineUrl(symbol, adjust, count, start = '2026-01-01', end = '2026-12-31') {
  const varName = `kline_day${adjust}`
  return `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?${new URLSearchParams({
    _var: varName,
    param: `${symbol},day,${start},${end},${count},${adjust}`,
    r: '0.1',
  })}`
}

function weekTrendUrl(symbol) {
  return `https://web.ifzq.gtimg.cn/other/klineweb/klineWeb/weekTrends?${new URLSearchParams({
    code: symbol,
    type: 'qfq',
    _var: 'trend_qfq',
    r: '0.1',
  })}`
}

function transactionUrl(symbol, page) {
  return `http://stock.gtimg.cn/data/index.php?${new URLSearchParams({
    appn: 'detail',
    action: 'data',
    c: symbol,
    p: String(page),
  })}`
}

function ahUrl(page, pageSize) {
  return `http://stock.gtimg.cn/data/hk_rank.php?${new URLSearchParams({
    board: 'A_H',
    metric: 'price',
    pageSize: String(pageSize),
    reqPage: String(page),
    order: 'decs',
    var_name: 'list_data',
  })}`
}

function hkKlineUrl(symbol, adjust, year) {
  if (!adjust) {
    return `http://web.ifzq.gtimg.cn/appstock/app/kline/kline?${new URLSearchParams({
      _var: `kline_day${year}`,
      param: `${symbol},day,${year}-01-01,${year + 1}-12-31,640,`,
      r: '0.1',
    })}`
  }
  return `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?${new URLSearchParams({
    _var: `kline_day${adjust}${year}`,
    param: `${symbol},day,${year}-01-01,${year + 1}-12-31,640,${adjust}`,
    r: '0.1',
  })}`
}

function parseQuote(text) {
  const rows = [...text.matchAll(/v_[A-Za-z_]{2,12}\d{0,6}="([^"]*)"/g)]
    .map((match) => match[1].split('~'))
    .filter((parts) => parts.length >= 30)
  return parsed(rows.length, ['code', 'name', 'price', 'prevClose', 'open', 'high', 'low', 'volume', 'amount', 'timestamp'], rows[0]?.slice(0, 50) ?? null, quoteTime(rows[0]))
}

function parseRankList(text) {
  const json = JSON.parse(text)
  const rows = Array.isArray(json?.data?.rank_list) ? json.data.rank_list : []
  return parsed(rows.length, Object.keys(rows[0] ?? {}), rows[0] ?? json?.msg ?? null)
}

function parseKline(symbol) {
  return (text) => {
    const json = parseJsonObject(text)
    const data = json?.data?.[symbol] ?? {}
    const rows = data.qfqday ?? data.hfqday ?? data.day ?? []
    return parsed(Array.isArray(rows) ? rows.length : 0, ['date', 'open', 'close', 'high', 'low', 'volume', 'amount'], rows[0] ?? null, rows.at?.(-1)?.[0] ?? null)
  }
}

function parseWeekTrends(text) {
  const json = parseJsonObject(text)
  const rows = Array.isArray(json?.data) ? json.data : []
  return parsed(rows.length, ['date', 'open', 'close', 'high', 'low', 'volume'], rows[0] ?? null, rows.at?.(-1)?.[0] ?? null)
}

function parseTransactions(text) {
  const quoted = /\[\d+,"([^"]*)"/.exec(text)?.[1] ?? ''
  const rows = quoted.split('|').filter(Boolean)
  return parsed(rows.length, ['time', 'price', 'change', 'volume', 'amount', 'direction'], rows[0] ?? null)
}

function parseAhPageCount(text) {
  const json = parseJsonObject(text)
  const count = Number(json?.data?.page_count ?? 0)
  return parsed(count > 0 ? 1 : 0, ['page_count'], { page_count: count })
}

function parseAhSpot(text) {
  const json = parseJsonObject(text)
  const rows = Array.isArray(json?.data?.page_data) ? json.data.page_data : []
  return parsed(rows.length, ['code', 'name', 'price', 'changePct', 'change', 'bid', 'ask', 'volume', 'amount', 'open', 'prevClose', 'high', 'low'], rows[0] ?? failureSample(json))
}

function parseAhName(text) {
  const json = parseJsonObject(text)
  const rows = Array.isArray(json?.data?.page_data) ? json.data.page_data : []
  return parsed(rows.length, ['code', 'name'], rows[0] ?? null)
}

function parsed(rowCount, schema, sample, providerTime = null) {
  return { rowCount, schema, sample, providerTime }
}

function quoteTime(parts) {
  return Array.isArray(parts) ? parts.find((part) => /^\d{14}$/.test(String(part))) ?? null : null
}

function classifyProbe(probe, status, parsedResult) {
  if (status !== 'passed') {
    if (isUnsupportedFailure(probe, parsedResult)) return 'tested-unsupported-route'
    return 'failed-needs-root-cause'
  }
  if (probe.persist) return 'governed-or-promotable-reusable'
  if (probe.class === 'reference') return 'reference-only-known-schema'
  if (probe.interfaceId === 'provider.reference_dataset') return 'known-schema-output-only'
  if (String(probe.id).includes('guess')) return 'tested-guess-known-schema'
  if (parsedResult.rowCount > 0) return 'known-schema-output-only'
  return 'diagnostic'
}

function governanceDecisionFor(probe, status) {
  if (status !== 'passed') return 'unsupported: tested provider route is rejected or returned no usable schema; do not register as normal capability.'
  if (probe.id.startsWith('tencent.quote.stock_')) return 'governed: stock.quote existing Tencent capability; broad evidence expands symbol/batch coverage, no new interface.'
  if (probe.id === 'tencent.quote.index_major' || probe.id === 'tencent.quote.index_csi_batch') return 'governed: index.quote existing Tencent capability; broad evidence expands index quote coverage, no new interface.'
  if (probe.id === 'tencent.quote.etf_batch' || probe.id === 'tencent.quote.etf_cross_market_batch') return 'governed: fund.etf_quote existing Tencent capability for a bounded ETF symbol universe; rows normalize to quote_snapshot and stock_list.'
  if (probe.id === 'tencent.quote.listed_fund_batch') return 'defer: listed-fund and money-market fund quote schema is known, but the current Tencent governed fund.etf_quote route should not silently broaden beyond ETF semantics until product naming/readback are explicit.'
  if (probe.id.startsWith('tencent.quote.convertible_bond_') || probe.id === 'tencent.quote.exchange_bond_guess') return 'defer: bond quote schema is known when rows are returned, but Tencent bond.market_data adapter/readback is not implemented; keep evidence-only until promoted.'
  if (probe.id === 'tencent.rank.board_hs_guess') return 'defer: board-code rank route is only discovery evidence; no broad Tencent board-rank interface is implemented.'
  if (probe.id.startsWith('tencent.rank.astock_')) return 'governed: stock.identity_list existing Tencent capability for supported sort/page variants; unsupported sort variants stay rejected.'
  if (probe.id.startsWith('tencent.kline.stock_') && !probe.id.endsWith('_start_year')) return 'governed: stock.daily_kline existing Tencent capability; adjustment/date-range variants share canonical kline_daily.'
  if (probe.id.startsWith('tencent.kline.etf_')) return 'output-only: ETF daily OHLCV schema is known, but Tencent ETF K-line provider capability/readback is not implemented.'
  if (probe.id.startsWith('tencent.kline.convertible_bond_')) return 'defer: convertible bond daily K-line schema needs a distinct bond time-series interface/readback before promotion.'
  if (probe.id.startsWith('tencent.kline.index_') && !probe.id.endsWith('_start_year')) return 'governed: index.daily_kline existing Tencent capability; adjustment/date-range variants share canonical kline_daily.'
  if (probe.id.startsWith('tencent.transactions.stock_')) return 'governed: stock.transactions existing Tencent capability; pagination/symbol variants share canonical transactions.'
  if (probe.id.startsWith('tencent.transactions.etf_')) return 'defer: ETF transaction schema is known, but no Tencent ETF transaction interface/readback is implemented.'
  if (probe.id === 'tencent.transactions.convertible_bond_page_0') return 'defer: convertible bond transaction schema is known when rows are returned, but no bond transaction interface/readback is implemented.'
  if (probe.id.includes('_start_year')) return 'output-only: start-date/weekTrends metadata has known schema but is provider reference metadata, not reusable business rows.'
  if (probe.id.startsWith('tencent.quote.hk_')) return 'defer: HK quote schema is known, but no Tencent global quote adapter/readback contract is implemented; keep output-only/reference until global quote governance is added.'
  if (probe.id === 'tencent.quote.us_guess') return 'defer: US quote symbol format works, but Tencent global quote is not a governed provider path in this runtime.'
  if (probe.id.startsWith('tencent.ah.')) return 'reference: AH rows are Tencent-origin known-schema evidence; keep as reference-only until a stable AH interface/table/readback is justified.'
  if (probe.id.startsWith('tencent.hk.kline_')) return 'reference: HK K-line rows are known schema, but Tencent global daily K-line governance is not implemented.'
  return 'defer: known schema requires explicit interface/provider contract before normal workflow.'
}

function exportPolicyFor(probe, governanceDecision, status, parsedResult) {
  if (status !== 'passed') {
    return isUnsupportedFailure(probe, parsedResult) ? 'unsupported' : 'diagnostic-only'
  }
  if (governanceDecision.startsWith('governed:')) return 'normal-workflow'
  if (governanceDecision.startsWith('output-only:')) return 'typed-output-only'
  if (governanceDecision.startsWith('reference:')) return 'reference-only'
  if (governanceDecision.startsWith('unsupported:')) return 'unsupported'
  return 'deferred'
}

function exportReasonFor(governanceDecision) {
  return governanceDecision.replace(/^[^:]+:\s*/, '')
}

function failureClassFor(probe, res, parsedResult) {
  if (!res.ok) return `http_${res.status}`
  if (isUnsupportedFailure(probe, parsedResult)) {
    return 'provider_rejected_or_unsupported_route'
  }
  if (parsedResult.rowCount === 0) return 'empty_or_schema_unexpected'
  return 'unknown'
}

async function decodeResponse(res) {
  const bytes = await res.arrayBuffer()
  return new TextDecoder('gb18030').decode(bytes)
}

function parseJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('JSON object not found')
  return JSON.parse(text.slice(start, end + 1))
}

function failureSample(json) {
  if (json && typeof json === 'object' && ('code' in json || 'msg' in json)) {
    return `code=${json.code ?? ''} msg=${json.msg ?? ''}`
  }
  return json?.msg ?? null
}

function isProviderUnsupported(sample) {
  return typeof sample === 'string' && /sort_type error|code=2003|code.+2003|unsupported|not support|不支持|参数错误|board_code error|metric error/.test(sample)
}

function isUnsupportedFailure(probe, parsedResult) {
  if (isProviderUnsupported(parsedResult.sample)) return true
  if (probe.id === 'tencent.quote.exchange_bond_guess' && parsedResult.rowCount === 0) return true
  if (probe.id === 'tencent.rank.board_hs_guess' && parsedResult.rowCount === 0) return true
  if (probe.id === 'tencent.transactions.convertible_bond_page_0' && parsedResult.rowCount === 0) return true
  return false
}

function countBy(rows, fn) {
  const counts = {}
  for (const row of rows) {
    const key = fn(row) ?? 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort())
}

function markdown(summary, rows, inventory) {
  return [
    '# Tencent Broad API Discovery Probe Results',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Summary',
    '',
    `- candidates: ${summary.candidates}`,
    `- probed: ${summary.probed}`,
    `- passed: ${summary.passed}`,
    `- failed: ${summary.failed}`,
    `- direct rows: ${summary.directRows}`,
    `- reference rows: ${summary.referenceRows}`,
    `- persist candidates passed: ${summary.persistCandidatesPassed}`,
    `- normal workflow eligible: ${summary.normalWorkflowEligible}`,
    `- evidence-only rows: ${summary.evidenceOnlyRows}`,
    '',
    table('Classifications', ['Classification', 'Count'], Object.entries(summary.classifications)),
    table('Failure Classes', ['Failure class', 'Count'], Object.entries(summary.failureClasses)),
    table('Governance Decisions', ['Decision', 'Count'], Object.entries(summary.governanceDecisions)),
    table('Export Policies', ['Export policy', 'Count'], Object.entries(summary.exportPolicies)),
    '## Source Coverage',
    '',
    '- Repo usage: existing FinAgent Workstation Tencent fetchers, route services, runtime probe scripts, provider matrix rows, and FinAgent/shared-mobile provider contracts were used to keep governed support limited to implemented interface/provider paths.',
    '- AkShare Tencent wrappers inspected: `stock_zh_a_tx.py`, `stock_zh_a_tick_tx.py`, `stock_zh_ah_tx.py`, `index_stock_zh.py`, `stock_hist_tx.py`, and `stock/cons.py`.',
    '- Tencent endpoint families covered by real probes: `qt.gtimg.cn`, `proxy.finance.qq.com`, `stock.gtimg.cn`, and `web.ifzq.gtimg.cn`.',
    '- Tencent page-derived families covered: `stockapp.finance.qq.com/mstats` A-share rank, A+H, HK quote/K-line, and tick transaction routes reflected by AkShare and current repo usage.',
    '- AkShare wrapper evidence remains reference evidence unless the direct Tencent endpoint, schema, normalizer, persistence/readback, provenance, and tests are implemented in this repo.',
    '',
    '## Candidate Inventory',
    '',
    '| ID | Source family | Class | Interface | Persist candidate | URL family | Description |',
    '|---|---|---|---|---:|---|---|',
    ...inventory.map((row) => `| \`${escapePipe(row.id)}\` | ${escapePipe(row.sourceFamily)} | ${escapePipe(row.class)} | \`${escapePipe(row.interfaceId)}\` | ${row.persistCandidate ? 'yes' : 'no'} | ${escapePipe(row.urlFamily)} | ${escapePipe(row.description)} |`),
    '',
    '## Probe Results',
    '',
    '| ID | Status | Classification | Rows | Interface | Persist | Normal workflow | Export policy | Failure | Governance decision | Description |',
    '|---|---|---|---:|---|---:|---:|---|---|---|---|',
    ...rows.map((row) => `| \`${escapePipe(row.id)}\` | ${escapePipe(row.status)} | ${escapePipe(row.classification)} | ${row.rowCount} | \`${escapePipe(row.interfaceId)}\` | ${row.persist ? 'yes' : 'no'} | ${row.normalWorkflowEligible ? 'yes' : 'no'} | ${escapePipe(row.exportPolicy)} | ${escapePipe(row.failureClass ?? '')} | ${escapePipe(row.governanceDecision)} | ${escapePipe(row.description)} |`),
    '',
    '## Notes',
    '',
    '- Passed rows are evidence, not automatic promotion. Persistent workflow still requires interface capability, normalizer, cache/readback, provenance, tests, and report updates.',
    '- Failed rows remain in the artifact for root-cause follow-up; they are not silently removed from Tencent provider scope.',
    '- `normalWorkflowEligible=false` rows must stay out of provider capabilities, normal provider routing, and normal workflow skills until a complete interface/provider contract exists.',
    '',
  ].join('\n')
}

function table(title, headers, rows) {
  return [
    `## ${title}`,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map((_, index) => index === headers.length - 1 ? '---:' : '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => escapePipe(String(cell))).join(' | ')} |`),
    '',
  ].join('\n')
}

function escapePipe(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
