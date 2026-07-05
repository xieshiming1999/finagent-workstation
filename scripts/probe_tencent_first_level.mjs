import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('../..', import.meta.url).pathname)
const outJson = path.join(root, 'reports/integrations/finance_tencent_first_level_probe_results_2026_06_23.json')
const outMd = path.join(root, 'reports/integrations/finance_tencent_first_level_probe_results_2026_06_23.md')

const probes = [
  {
    id: 'tencent.direct.stock_quote',
    class: 'direct',
    interfaceId: 'stock.quote',
    persist: true,
    url: 'https://qt.gtimg.cn/q=sh600519,sz000001',
    parse: parseQuote,
  },
  {
    id: 'tencent.direct.index_quote',
    class: 'direct',
    interfaceId: 'index.quote',
    persist: true,
    url: 'https://qt.gtimg.cn/q=sh000001,sz399001',
    parse: parseQuote,
  },
  {
    id: 'tencent.direct.fund_etf_quote',
    class: 'direct',
    interfaceId: 'fund.etf_quote',
    persist: true,
    url: 'https://qt.gtimg.cn/q=sh510300,sh510050,sz159915',
    parse: parseQuote,
  },
  {
    id: 'tencent.direct.hk_quote',
    class: 'direct',
    interfaceId: 'global.stock_quote',
    persist: false,
    url: 'https://qt.gtimg.cn/q=hk00700,hk02318',
    parse: parseQuote,
  },
  {
    id: 'tencent.direct.stock_rank_list',
    class: 'direct',
    interfaceId: 'stock.identity_list',
    persist: true,
    url: 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?_appver=11.17.0&board_code=aStock&sort_type=price&direct=down&offset=0&count=20',
    parse: parseRankList,
  },
  {
    id: 'tencent.direct.stock_daily_kline',
    class: 'direct',
    interfaceId: 'stock.daily_kline',
    persist: true,
    url: 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_dayqfq&param=sh600519,day,2026-01-01,2026-12-31,20,qfq&r=0.1',
    parse: parseKline('sh600519'),
  },
  {
    id: 'tencent.direct.stock_daily_kline_none',
    class: 'direct',
    interfaceId: 'stock.daily_kline',
    persist: true,
    url: 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_day&param=sh600519,day,2026-01-01,2026-12-31,20,&r=0.1',
    parse: parseKline('sh600519'),
  },
  {
    id: 'tencent.direct.stock_daily_kline_hfq',
    class: 'direct',
    interfaceId: 'stock.daily_kline_adjusted_hfq',
    persist: false,
    url: 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_dayhfq&param=sh600519,day,2026-01-01,2026-12-31,20,hfq&r=0.1',
    parse: parseKline('sh600519'),
  },
  {
    id: 'tencent.direct.stock_week_trends',
    class: 'direct',
    interfaceId: 'market.weekly_trend',
    persist: false,
    url: 'https://web.ifzq.gtimg.cn/other/klineweb/klineWeb/weekTrends?code=sh600519&type=qfq&_var=trend_qfq&r=0.1',
    parse: parseWeekTrends,
  },
  {
    id: 'tencent.direct.index_daily_kline',
    class: 'direct',
    interfaceId: 'index.daily_kline',
    persist: true,
    url: 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_dayqfq&param=sh000001,day,2026-01-01,2026-12-31,20,qfq&r=0.1',
    parse: parseKline('sh000001'),
  },
  {
    id: 'tencent.direct.index_week_trends',
    class: 'direct',
    interfaceId: 'market.weekly_trend',
    persist: false,
    url: 'https://web.ifzq.gtimg.cn/other/klineweb/klineWeb/weekTrends?code=sh000001&type=qfq&_var=trend_qfq&r=0.1',
    parse: parseWeekTrends,
  },
  {
    id: 'tencent.direct.stock_transactions',
    class: 'direct',
    interfaceId: 'stock.transactions',
    persist: true,
    url: 'http://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=sh600519&p=0',
    parse: parseTransactions,
  },
  {
    id: 'tencent.reference.ah_spot',
    class: 'reference',
    interfaceId: 'global.stock_quote',
    persist: false,
    url: 'http://stock.gtimg.cn/data/hk_rank.php?board=A_H&metric=price&pageSize=20&reqPage=1&order=decs&var_name=list_data',
    parse: parseAhSpot,
  },
  {
    id: 'tencent.reference.ah_name',
    class: 'reference',
    interfaceId: 'global.stock_identity_list',
    persist: false,
    url: 'http://stock.gtimg.cn/data/hk_rank.php?board=A_H&metric=price&pageSize=20&reqPage=1&order=decs&var_name=list_data',
    parse: parseAhName,
  },
  {
    id: 'tencent.reference.hk_daily_kline',
    class: 'reference',
    interfaceId: 'global.daily_kline',
    persist: false,
    url: 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?_var=kline_dayhfq2026&param=hk02318,day,2026-01-01,2026-12-31,640,hfq&r=0.1',
    parse: parseKline('hk02318'),
  },
  {
    id: 'tencent.reference.hk_daily_kline_none',
    class: 'reference',
    interfaceId: 'global.daily_kline',
    persist: false,
    url: 'http://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_day2026&param=hk02318,day,2026-01-01,2026-12-31,640,&r=0.1',
    parse: parseKline('hk02318'),
  },
]

const rows = []
for (const probe of probes) {
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
    const parsed = probe.parse(body)
    rows.push({
      id: probe.id,
      class: probe.class,
      interfaceId: probe.interfaceId,
      persist: probe.persist,
      status: res.ok && parsed.rowCount > 0 ? 'passed' : 'failed',
      httpStatus: res.status,
      durationMs: Date.now() - started,
      rowCount: parsed.rowCount,
      schema: parsed.schema,
      sample: parsed.sample,
      failureClass: res.ok && parsed.rowCount > 0 ? null : 'empty_or_schema_unexpected',
      url: probe.url,
    })
  } catch (error) {
    rows.push({
      id: probe.id,
      class: probe.class,
      interfaceId: probe.interfaceId,
      persist: probe.persist,
      status: 'failed',
      httpStatus: 0,
      durationMs: Date.now() - started,
      rowCount: 0,
      schema: [],
      sample: null,
      failureClass: 'transport_or_parser_error',
      error: error instanceof Error ? error.message : String(error),
      url: probe.url,
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
}

const summary = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  passed: rows.filter((row) => row.status === 'passed').length,
  failed: rows.filter((row) => row.status !== 'passed').length,
  directRows: rows.filter((row) => row.class === 'direct').length,
  referenceRows: rows.filter((row) => row.class === 'reference').length,
  promotedInterfaces: [...new Set(rows.filter((row) => row.persist && row.status === 'passed').map((row) => row.interfaceId))].sort(),
}

fs.writeFileSync(outJson, `${JSON.stringify({ summary, rows }, null, 2)}\n`)
fs.writeFileSync(outMd, markdown(summary, rows))
console.log(JSON.stringify(summary, null, 2))

function parseQuote(text) {
  const rows = [...text.matchAll(/v_[a-z_]{2,5}\d{5,6}="([^"]*)"/g)]
    .map((match) => match[1].split('~'))
    .filter((parts) => parts.length >= 45)
  return parsed(rows.length, ['code', 'name', 'price', 'prevClose', 'open', 'high', 'low', 'volume', 'amount', 'pe', 'turnoverRate'], rows[0]?.slice(0, 45))
}

function parseRankList(text) {
  const json = JSON.parse(text)
  const rows = Array.isArray(json?.data?.rank_list) ? json.data.rank_list : []
  return parsed(rows.length, Object.keys(rows[0] ?? {}), rows[0] ?? null)
}

function parseKline(symbol) {
  return (text) => {
    const json = parseJsonObject(text)
    const data = json?.data?.[symbol] ?? {}
    const rows = data.qfqday ?? data.hfqday ?? data.day ?? []
    return parsed(Array.isArray(rows) ? rows.length : 0, ['date', 'open', 'close', 'high', 'low', 'volume', 'amount'], rows[0] ?? null)
  }
}

function parseWeekTrends(text) {
  const json = parseJsonObject(text)
  const rows = Array.isArray(json?.data) ? json.data : []
  return parsed(rows.length, ['date', 'open', 'close', 'high', 'low', 'volume'], rows[0] ?? null)
}

function parseTransactions(text) {
  const quoted = /\[0,"([^"]*)"/.exec(text)?.[1] ?? ''
  const rows = quoted.split('|').filter(Boolean)
  return parsed(rows.length, ['time', 'price', 'change', 'volume', 'amount', 'direction'], rows[0] ?? null)
}

function parseAhSpot(text) {
  const json = parseJsonObject(text)
  const rows = Array.isArray(json?.data?.page_data) ? json.data.page_data : []
  return parsed(rows.length, ['code', 'name', 'price', 'changePct', 'change', 'bid', 'ask', 'volume', 'amount', 'open', 'prevClose', 'high', 'low'], rows[0] ?? null)
}

function parseAhName(text) {
  const json = parseJsonObject(text)
  const rows = Array.isArray(json?.data?.page_data) ? json.data.page_data : []
  return parsed(rows.length, ['code', 'name'], rows[0] ?? null)
}

function parsed(rowCount, schema, sample) {
  return { rowCount, schema, sample }
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

function markdown(summary, rows) {
  const lines = [
    '# Tencent First-Level Provider Probe Results',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Total | ${summary.total} |`,
    `| Passed | ${summary.passed} |`,
    `| Failed | ${summary.failed} |`,
    `| Direct rows | ${summary.directRows} |`,
    `| Reference rows | ${summary.referenceRows} |`,
    '',
    '| API surface | Class | Interface | Persist | Status | Rows | Failure | Schema |',
    '|---|---|---|---:|---|---:|---|---|',
    ...rows.map((row) => `| \`${row.id}\` | ${row.class} | \`${row.interfaceId}\` | ${row.persist ? 'yes' : 'no'} | ${row.status} | ${row.rowCount} | ${row.failureClass ?? '-'} | ${row.schema.map((item) => `\`${item}\``).join(', ')} |`),
    '',
    'Direct Tencent rows that passed and have reusable schemas are eligible for provider-interface capabilities. Reference rows preserve known Tencent-origin evidence but are not promoted until a runtime interface, normalizer, readback and product need are explicit.',
    '',
  ]
  return `${lines.join('\n')}\n`
}
