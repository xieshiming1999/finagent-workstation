#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const contractPath = resolve(appRoot, 'src/agent/data/data-api-interfaces.json')
const cacheCoveragePath = resolve(appRoot, 'src/agent/data/data-api-cache-coverage.json')
const args = parseArgs(process.argv.slice(2))
const jsonOut = resolve(appRoot, args.json ?? 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json')
const mdOut = resolve(appRoot, args.md ?? 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.md')
const categoryOrder = [
  'stock',
  'index',
  'fund_etf',
  'market_structure',
  'technical_analysis',
  'calendar',
  'news',
  'wind_professional',
  'global_assets',
  'provider_diagnostics',
  'other',
]

const contract = JSON.parse(readFileSync(contractPath, 'utf-8'))
const cacheCoverage = JSON.parse(readFileSync(cacheCoveragePath, 'utf-8'))
const report = buildReport(contract, cacheCoverage)

if (args['no-write'] !== 'true') {
  mkdirSync(dirname(jsonOut), { recursive: true })
  mkdirSync(dirname(mdOut), { recursive: true })
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance data API provider matrix: ${report.summary.interfaces} interfaces, ${report.summary.capabilities} capabilities`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (report.problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildReport(input, cacheCoverageInput) {
  const providers = input.providers
  const problems = validate(input, cacheCoverageInput)
  const rows = input.interfaces.map((item) => {
    const providerCells = Object.fromEntries(providers.map((provider) => [provider, {
      status: 'not-supported',
      capabilityId: null,
      adapter: null,
      normalizer: null,
      canonicalTable: null,
      probeId: null,
      reason: implicitNotSupportedReason(provider, item.id),
      marketScope: [],
    }]))
    for (const capability of item.capabilities) {
      providerCells[capability.provider] = {
        status: capability.status,
        capabilityId: capability.id,
        upstreamOrigin: capability.upstreamOrigin ?? null,
        adapter: capability.adapter ?? null,
        normalizer: capability.normalizer ?? null,
        canonicalTable: capability.canonicalTable ?? null,
        probeId: capability.probeId ?? null,
        reason: capability.reason ?? null,
        marketScope: capability.marketScope ?? [],
      }
    }
    return {
      interfaceId: item.id,
      category: categoryForInterface(item.id),
      chinesePurpose: chinesePurposeForInterface(item),
      label: item.label,
      canonicalSchema: item.canonicalSchema,
      dataStoreTables: item.dataStoreTables,
      queryActions: item.queryActions,
      freshnessPolicy: item.freshnessPolicy,
      cacheLookup: cacheCoverageInput.interfaces?.[item.id] ?? {
        status: 'not-implemented',
        reader: null,
        policy: 'missing cache coverage declaration',
      },
      params: item.params,
      providers: providerCells,
    }
  }).sort(compareInterfaceRows)
  const capabilities = input.interfaces.flatMap((item) => item.capabilities.map((capability) => ({
    interfaceId: item.id,
    ...capability,
  })))
  const statusCounts = {}
  for (const capability of capabilities) statusCounts[capability.status] = (statusCounts[capability.status] ?? 0) + 1
  const cacheStatusCounts = {}
  for (const row of rows) cacheStatusCounts[row.cacheLookup.status] = (cacheStatusCounts[row.cacheLookup.status] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    source: {
      contract: contractPath,
      cacheCoverage: cacheCoveragePath,
    },
    summary: {
      interfaces: input.interfaces.length,
      providers: providers.length,
      capabilities: capabilities.length,
      statusCounts,
      cacheStatusCounts,
      problems: problems.length,
    },
    providerColumns: providers,
    rows,
    capabilities,
    problems,
  }
}

function implicitNotSupportedReason(provider, interfaceId) {
  return `No ${provider} provider capability is registered for ${interfaceId}; keep this implicit not-supported cell out of routing unless a provider-specific adapter, normalizer, canonical persistence, readback, and evidence are added.`
}

function validate(input, cacheCoverageInput) {
  const problems = []
  const providers = new Set(input.providers)
  const validStatuses = new Set([
    'supported',
    'disabled',
    'credential-gated',
    'quota-gated',
    'transport-unstable',
    'not-supported',
    'output-only',
    'global-only',
  ])
  const ids = new Set()
  for (const item of input.interfaces) {
    if (ids.has(item.id)) problems.push(`duplicate interface id: ${item.id}`)
    ids.add(item.id)
    if (!item.params?.includes('provider')) problems.push(`${item.id}: provider param required`)
    if (!item.params?.includes('providerMode')) problems.push(`${item.id}: providerMode param required`)
    const cache = cacheCoverageInput.interfaces?.[item.id]
    if (!cache) problems.push(`${item.id}: cache coverage declaration required`)
    if (cache && !['implemented', 'not-implemented', 'none'].includes(cache.status)) {
      problems.push(`${item.id}: invalid cache coverage status ${cache.status}`)
    }
    if (cache?.status === 'implemented' && !cache.reader) {
      problems.push(`${item.id}: implemented cache coverage requires reader`)
    }
    if ((item.dataStoreTables?.length ?? 0) > 0 && cache?.status === 'none') {
      problems.push(`${item.id}: DataStore-backed interface cannot declare cache coverage as none`)
    }
    const eligiblePriorityOwners = new Map()
    for (const capability of item.capabilities ?? []) {
      if (!providers.has(capability.provider)) problems.push(`${item.id}: unknown provider ${capability.provider}`)
      if (!validStatuses.has(capability.status)) problems.push(`${item.id}/${capability.id}: invalid status ${capability.status}`)
      if (capability.status === 'supported' || capability.status === 'global-only') {
        const priority = capability.priority ?? 999
        const existing = eligiblePriorityOwners.get(priority)
        if (existing) {
          problems.push(`${item.id}: duplicate eligible provider priority ${priority}: ${existing} and ${capability.id}`)
        } else {
          eligiblePriorityOwners.set(priority, capability.id)
        }
      }
      if (requiresCanonicalProviderShape(capability.status) && !capability.normalizer) {
        problems.push(`${item.id}/${capability.id}: normalizer required for reusable provider capability`)
      }
      if (requiresCanonicalProviderShape(capability.status) && item.dataStoreTables?.length > 0 && !capability.canonicalTable) {
        problems.push(`${item.id}/${capability.id}: canonicalTable required for reusable provider capability`)
      }
      if (requiresCanonicalProviderShape(capability.status) && capability.canonicalTable && item.dataStoreTables?.length > 0 && !item.dataStoreTables.includes(capability.canonicalTable)) {
        problems.push(`${item.id}/${capability.id}: canonicalTable ${capability.canonicalTable} is not owned by interface tables ${item.dataStoreTables.join(',')}`)
      }
    }
  }
  for (const interfaceId of Object.keys(cacheCoverageInput.interfaces ?? {})) {
    if (!ids.has(interfaceId)) problems.push(`cache coverage references unknown interface: ${interfaceId}`)
  }
  return problems
}

function requiresCanonicalProviderShape(status) {
  return status === 'supported' ||
    status === 'global-only' ||
    status === 'credential-gated' ||
    status === 'quota-gated' ||
    status === 'transport-unstable'
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Data API Provider Matrix')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Source contract: \`${report.source.contract}\``)
  lines.push(`Source cache coverage: \`${report.source.cacheCoverage}\``)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- interfaces: ${report.summary.interfaces}`)
  lines.push(`- providers: ${report.summary.providers}`)
  lines.push(`- capabilities: ${report.summary.capabilities}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push('')
  lines.push('Status counts:')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.statusCounts).sort()) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('Cache lookup status counts:')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.cacheStatusCounts).sort()) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('Category counts:')
  lines.push('')
  for (const [category, count] of Object.entries(categoryCounts(report.rows))) {
    lines.push(`- ${category}: ${count}`)
  }
  lines.push('')
  lines.push('## Matrix')
  lines.push('')
  const header = ['Category', 'Data API Interface', 'Chinese Purpose', 'Canonical Schema', 'DataStore Table', 'Cache Lookup', ...report.providerColumns]
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of report.rows) {
    lines.push(`| ${row.category} | \`${row.interfaceId}\` | ${row.chinesePurpose} | \`${row.canonicalSchema}\` | ${row.dataStoreTables.map((table) => `\`${table}\``).join(', ') || '-'} | ${cacheCell(row.cacheLookup)} | ${report.providerColumns.map((provider) => cell(row.providers[provider])).join(' | ')} |`)
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

function categoryForInterface(interfaceId) {
  if (interfaceId.startsWith('stock.')) return 'stock'
  if (interfaceId.startsWith('index.')) return 'index'
  if (interfaceId.startsWith('fund.')) return 'fund_etf'
  if (interfaceId.startsWith('market.')) return 'market_structure'
  if (interfaceId.startsWith('technical.')) return 'technical_analysis'
  if (interfaceId.startsWith('calendar.')) return 'calendar'
  if (interfaceId.startsWith('news.')) return 'news'
  if (interfaceId.startsWith('wind.')) return 'wind_professional'
  if (interfaceId.startsWith('global.')) return 'global_assets'
  if (interfaceId.startsWith('provider.')) return 'provider_diagnostics'
  return 'other'
}

function compareInterfaceRows(a, b) {
  const category = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
  if (category !== 0) return category
  return a.interfaceId.localeCompare(b.interfaceId)
}

function categoryCounts(rows) {
  const counts = {}
  for (const row of rows) counts[row.category] = (counts[row.category] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0])))
}

function chinesePurposeForInterface(item) {
  const id = item.id
  const map = {
    'stock.quote': 'A股/股票实时行情快照',
    'stock.daily_kline': '股票日线K线历史行情',
    'stock.identity_list': '股票代码、名称与上市状态基础表',
    'stock.money_flow': '个股资金流向',
    'stock.daily_valuation': '个股估值与基础财务指标',
    'stock.chip_distribution': '个股筹码分布',
    'stock.tick_chart_intraday': '个股日内分时走势',
    'stock.transactions': '个股逐笔/成交明细',
    'stock.volume_profile': '个股成交量价分布',
    'stock.xdxr_events': '个股除权除息与公司行动事件',
    'stock.auction_snapshot': '个股集合竞价快照',
    'stock.company_info': '个股公司资料与F10信息',
    'stock.shareholders': '个股股东与持股结构',
    'index.quote': '指数实时行情快照',
    'index.daily_kline': '指数日线K线历史行情',
    'index.constituents': '指数成分股与权重',
    'index.momentum': '指数动量与强弱指标',
    'fund.identity_list': '基金/ETF代码与基础资料',
    'fund.nav_history': '基金净值历史',
    'fund.performance_metrics': '基金业绩指标',
    'fund.holding': '基金持仓',
    'fund.manager': '基金经理信息',
    'fund.etf_quote': 'ETF实时行情快照',
    'market.sector_ranking': '行业/概念/地域板块排行',
    'market.sector_constituents': '板块成分与行业映射',
    'market.board_ranking': '板块列表与排行',
    'market.board_members': '板块成员列表',
    'market.limit_pool': '涨跌停池',
    'market.northbound_flow': '北向资金流向',
    'market.northbound_holding': '北向持股',
    'market.hot_rank': '市场热度/人气排行',
    'market.dragon_tiger': '龙虎榜数据',
    'market.unusual_activity': '盘口异动事件',
    'market.flow_rank': '全市场资金流排行',
    'market.margin_trading': '融资融券余额与交易明细',
    'market.tdx_block_member': '通达信板块成员',
    'market.tdx_top_board': '通达信榜单/强弱排行',
    'technical.indicator_series': '技术指标序列',
    'calendar.trade_days': '交易日历',
    'news.finance_feed': '财经新闻流',
    'wind.financial_document': 'Wind公告、研报、新闻文档',
    'wind.economic_series': 'Wind宏观经济序列',
    'wind.analytics_result': 'Wind自然语言结构化分析结果',
    'global.company_profile': '全球股票公司画像',
    'global.financial_statements': '全球股票财务报表',
    'global.earnings_calendar': '全球股票业绩日历',
    'global.earnings_history': '全球股票历史业绩',
    'global.earnings_estimates': '全球股票盈利预测',
    'global.eps_revisions': '全球股票 EPS 预测修正',
    'global.eps_trend': '全球股票 EPS 趋势',
    'global.quarterly_financial_statements': '全球股票季度财务报表',
    'global.recommendations': '全球股票分析师建议',
    'global.upgrade_downgrade_events': '全球股票评级调整事件',
    'global.holders': '全球股票持有人结构',
    'global.insider_transactions': '全球股票内部人交易',
    'option.expiry_calendar': '期权到期日历',
    'option.contract_list': '期权合约列表',
    'option.quote': '期权报价',
    'option.open_interest': '期权未平仓量',
    'option.implied_volatility': '期权隐含波动率',
    'option.chain_snapshot': '期权链快照',
    'global.options_chain': '全球期权链',
    'global.corporate_actions': '全球股票分红拆股等公司行动',
    'global.finance_news': '全球财经新闻',
  }
  return map[id] ?? item.label
}

function cacheCell(value) {
  const status = value?.status ?? 'not-implemented'
  const parts = [status]
  if (value?.reader) parts.push(value.reader)
  if (value?.policy) parts.push(value.policy)
  return parts.join('<br>')
}

function cell(value) {
  const status = value?.status ?? 'not-supported'
  if (!value?.capabilityId) return status
  const parts = [status]
  if (value.upstreamOrigin) parts.push(`origin:${value.upstreamOrigin}`)
  if (value.marketScope?.length) parts.push(`scope:${value.marketScope.join('/')}`)
  if (value.reason) parts.push(value.reason)
  return parts.join('<br>')
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
