import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { listDataApiInterfaces } from '../../src/agent/data/data-api-interface-contract'
import { OUTPUT_ONLY_INTERFACES } from '../../src/agent/data/output-only-interfaces'

const repoRoot = process.cwd()
const workspaceRoot = join(repoRoot, '..')

function sourcePath(relativePath: string): string {
  const localPath = join(repoRoot, relativePath)
  if (existsSync(localPath)) return localPath
  return join(workspaceRoot, relativePath)
}

const normalSkillPaths = [
  'assets/skills/fund/skill.md',
  'finagent/assets/finance/skills/fund/skill.md',
  'finagent/assets/finance/skills/stock/skill.md',
  'finagent/assets/finance/skills/market-overview/skill.md',
  'finagent/assets/finance/skills/investment-workflow/skill.md',
  'finagent/assets/finance/skills/oil-war-room/skill.md',
  'finagent/assets/finance/skills/data-sources/skill.md',
  'app/assets/finance/skills/data-sources/skill.md',
  'app/assets/finance/skills/fund-dashboard/skill.md',
  'app/assets/finance/skills/stock-dashboard/skill.md',
  'app/assets/finance/skills/oil-war-room/skill.md',
  'assets/skills/data-sources/skill.md',
  'assets/skills/data-management/skill.md',
  'assets/skills/investment-workflow/skill.md',
  'assets/skills/market-overview/skill.md',
]

const legacyOrDiagnosticSkillPaths = [
  'finagent/assets/finance/skills/monitor-templates/skill.md',
]

const monitorWorkflowPaths = [
  'app/assets/finance/skills/monitor-templates/price_alert.js',
  'app/assets/finance/skills/monitor-templates/change_alert.js',
  'app/assets/finance/skills/monitor-templates/volume_surge.js',
  'app/assets/finance/skills/monitor-templates/watchlist.js',
  'app/assets/finance/skills/monitor-templates/fund_nav.js',
  'app/assets/finance/skills/monitor-templates/skill.md',
  'app/assets/finance/skills/monitor-dashboard/skill.md',
  'assets/skills/monitor-templates/price_alert.js',
  'assets/skills/monitor-templates/change_alert.js',
  'assets/skills/monitor-templates/volume_surge.js',
  'assets/skills/monitor-templates/watchlist.js',
  'assets/skills/monitor-templates/fund_nav.js',
  'assets/skills/monitor-templates/skill.md',
  'finagent/assets/finance/skills/monitor-templates/price_alert.js',
  'finagent/assets/finance/skills/monitor-templates/change_alert.js',
  'finagent/assets/finance/skills/monitor-templates/volume_surge.js',
  'finagent/assets/finance/skills/monitor-templates/watchlist.js',
  'finagent/assets/finance/skills/monitor-templates/fund_nav.js',
  'finagent/assets/finance/skills/monitor-dashboard/skill.md',
]

const providerGuidancePaths = [
  'AGENTS.md',
  '.codex/skills/cc-mobile-repo/SKILL.md',
  '.codex/skills/finagent-workstation-finance-workflows/SKILL.md',
  'assets/bundle/AGENTS.md',
  'assets/skills/data-management/skill.md',
  'assets/skills/tushare/skill.md',
  'finagent/assets/finance/skills/tushare/skill.md',
  'app/assets/finance/skills/tushare/skill.md',
  'assets/skills/yfinance/skill.md',
  'assets/skills/tradingview-scanner/skill.md',
]

const dataApiToolGuidancePaths = [
  'src/agent/tools/data-store-tool-queries.ts',
  'src/agent/tools/data-store-tool-help.ts',
  'app/lib/agent/tools/market_data_tool/market_data_tool_schema.dart',
]

const windMcpToolManifest: Record<string, string[]> = {
  stock_data: [
    'get_stock_price_indicators',
    'get_stock_kline',
    'get_stock_quote',
    'get_stock_basicinfo',
    'get_stock_fundamentals',
    'get_stock_equity_holders',
    'get_stock_events',
    'get_stock_technicals',
    'get_risk_metrics',
  ],
  global_stock_data: [
    'get_global_stock_price_indicators',
    'get_global_stock_kline',
    'get_global_stock_quote',
    'get_global_stock_basicinfo',
    'get_global_stock_fundamentals',
    'get_global_stock_equity_holders',
    'get_global_stock_events',
    'get_global_stock_technicals',
    'get_global_stock_risk_metrics',
  ],
  fund_data: [
    'get_fund_price_indicators',
    'get_fund_kline',
    'get_fund_quote',
    'get_fund_info',
    'get_fund_financials',
    'get_fund_holdings',
    'get_fund_performance',
    'get_fund_holders',
    'get_fund_company_info',
  ],
  index_data: [
    'get_index_price_indicators',
    'get_index_kline',
    'get_index_quote',
    'get_index_basicinfo',
    'get_index_fundamentals',
    'get_index_technicals',
  ],
  bond_data: [
    'get_bond_basicinfo',
    'get_bond_issuer_info',
    'get_bond_market_data',
    'get_bond_financial_data',
  ],
  financial_docs: ['get_company_announcements', 'get_financial_news'],
  economic_data: ['get_economic_data'],
  analytics_data: ['get_financial_data'],
}

const disabledTushareApiPattern = /api_name\s*[:=]\s*['"](?:fund_nav|fund_basic|fina_indicator|income|balancesheet|cashflow|moneyflow)['"]/i
const staleTushareCapabilityPattern = /Tushare[\s\S]{0,260}(?:money flow|fund list\s*\/\s*nav)/i

function referenceInterfaceIds(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.match(/^\| `([^`]+)` \|/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1])
}

function mobileContractInterfaceIds(text: string): string[] {
  const ids: string[] = []
  for (const block of text.split('DataApiInterfaceDefinition(').slice(1)) {
    const match = block.match(/^\s*id:\s*'([^']+)'/m)
    if (match) ids.push(match[1])
  }
  return ids
}

describe('finance skill provider contract', () => {
  it('generates skill-facing data API interface references from the code-owned contract', () => {
    execFileSync('node', ['scripts/finance_data_api_skill_reference.mjs'], {
      cwd: repoRoot,
      stdio: 'pipe',
    })
    const desktopPath = 'assets/skills/data-sources/references/data-api-interfaces.md'
    const mobilePaths = [
      'app/assets/finance/skills/data-sources/references/data-api-interfaces.md',
      'finagent/assets/finance/skills/data-sources/references/data-api-interfaces.md',
    ]
    const desktopInterfaceIds = listDataApiInterfaces().map((item) => item.id)
    const desktopText = readFileSync(sourcePath(desktopPath), 'utf-8')
    expect(desktopText).toContain('Generated from the code-owned finagent_workstation finance data API contract')
    expect(desktopText).toContain('Provider parameters are routing constraints')
    expect(referenceInterfaceIds(desktopText)).toEqual(desktopInterfaceIds)

    const mobileContractText = readFileSync(
      sourcePath('app/lib/domain/market/providers/data_api_interface_contract.dart'),
      'utf-8',
    )
    const mobileInterfaceIds = mobileContractInterfaceIds(mobileContractText)
    for (const path of mobilePaths) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      expect(text).toContain('Generated from the code-owned shared_mobile_finagent finance data API contract')
      expect(text).toContain('Provider parameters are routing constraints')
      expect(referenceInterfaceIds(text)).toEqual(mobileInterfaceIds)
    }
  })

  it('generates skill-facing output-only API interface references from code-owned contracts', () => {
    execFileSync('node', ['scripts/finance_output_only_api_skill_reference.mjs'], {
      cwd: repoRoot,
      stdio: 'pipe',
    })
    const desktopPath = 'assets/skills/data-sources/references/output-only-api-interfaces.md'
    const mobilePaths = [
      'app/assets/finance/skills/data-sources/references/output-only-api-interfaces.md',
      'finagent/assets/finance/skills/data-sources/references/output-only-api-interfaces.md',
    ]
    const desktopText = readFileSync(sourcePath(desktopPath), 'utf-8')
    expect(desktopText).toContain('Generated from the code-owned finagent_workstation finance output-only API contract')
    expect(desktopText).toContain('Unknown provider output must be rejected')
    expect(referenceInterfaceIds(desktopText.split('## Knowledge Records')[0])).toEqual(OUTPUT_ONLY_INTERFACES.map((item) => item.id))

    for (const path of mobilePaths) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      expect(text).toContain('Generated from the code-owned shared_mobile_finagent finance output-only API contract')
      expect(text).toContain('Unknown provider output must be rejected')
      expect(referenceInterfaceIds(text.split('## Knowledge Records')[0])).toEqual([
        'market.optimize_params',
        'provider.diagnostic',
        'provider.reference_dataset',
        'market.intraday_ohlcv_bars',
        'stock.transaction_count',
        'fund.dividend_factor',
        'fund.etf_daily_ohlcv_bars',
        'market.classification_nodes',
        'stock.esg_rating_multi_agency',
      ])
    }
  })

  it('points normal data-source skills at the generated data API interface reference', () => {
    const paths = [
      'assets/skills/data-sources/skill.md',
      'app/assets/finance/skills/data-sources/skill.md',
      'finagent/assets/finance/skills/data-sources/skill.md',
    ]
    for (const path of paths) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      expect(text).toContain('references/data-api-interfaces.md')
      expect(text).toContain('references/output-only-api-interfaces.md')
      expect(text).toMatch(/Provider parameters are\s+routing constraints|provider\s+参数只是 interface 的路由约束/)
    }
  })

  it('keeps Tencent data-source skill guidance aligned with governed runtime support', () => {
    const desktopText = readFileSync(sourcePath('assets/skills/data-sources/skill.md'), 'utf-8')
    for (const capability of [
      'tencent.stock.quote',
      'tencent.index.quote',
      'tencent.stock.identity_list',
      'tencent.stock.daily_kline',
      'tencent.index.daily_kline',
      'tencent.stock.transactions',
      'tencent.fund.etf_quote',
      'tencent.fund.etf_daily_ohlcv_bars',
      'tencent.fund.etf_transactions',
      'tencent.fund.listed_fund_quote',
      'tencent.bond.convertible_quote',
      'tencent.bond.convertible_daily_kline',
      'tencent.global.stock_quote',
    ]) {
      expect(desktopText).toContain(capability)
    }
    expect(desktopText).toContain('Tencent HK K-line, A+H')
    expect(desktopText).toContain('tested unsupported')

    for (const path of [
      'app/assets/finance/skills/data-sources/skill.md',
      'finagent/assets/finance/skills/data-sources/skill.md',
    ]) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      expect(text).toContain('stock.quote')
      expect(text).toContain('index.quote')
      expect(text).toContain('fund.etf_quote')
      expect(text).toContain('fund.listed_fund_quote')
      expect(text).toContain('query_listed_fund_quote')
      expect(text).toContain('quote_snapshot')
      expect(text).toContain('stock_list')
      expect(text).not.toMatch(/Tencent `fund\.etf_quote`, `index\.quote`[^.\n]+not-supported/)
    }
  })

  it('documents connected panel provenance workflows for desktop fund and news data', () => {
    const fundText = readFileSync(sourcePath('assets/skills/fund/skill.md'), 'utf-8')
    expect(fundText).toContain('Manual Fund Pulse refresh queues `fund_list`, `etf_quotes`,')
    expect(fundText).toContain('`fund_performance`, and stale ordinary `fund_nav` seeds')
    expect(fundText).toContain('money funds should use')
    expect(fundText).toContain('`fund_money_yield`')
    expect(fundText).toContain('Manual Data Manager runs and')
    expect(fundText).toContain('scheduled Data Feed runs share the same configured-feed enqueue path')
    expect(fundText).toContain('failed fetch')

    const dataSourcesText = readFileSync(sourcePath('assets/skills/data-sources/skill.md'), 'utf-8')
    expect(dataSourcesText).toContain('Runtime panels are part of the same provenance workflow')
    expect(dataSourcesText).toContain('Fund Pulse manual refresh currently covers fund list, ETF quotes,')
    expect(dataSourcesText).toContain('The News panel reads `news.finance_feed` through a governed route')
    expect(dataSourcesText).toContain('canonical `finance_news` schema/table')
  })

  it('does not advertise raw public provider URLs as normal stock/fund workflows', () => {
    const offenders: string[] = []
    for (const path of normalSkillPaths) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      if (/akshare\.akfamily\.xyz|Bridge\.fetch\(['"]https:\/\/akshare|callService\(['"]https:\/\/akshare/.test(text)) {
        offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })

  it('requires raw provider URL mentions in normal skills to be framed as diagnostic or legacy', () => {
    const offenders: string[] = []
    for (const path of [...normalSkillPaths, ...legacyOrDiagnosticSkillPaths]) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      if (
        /https:\/\/akshare\.akfamily\.xyz|https:\/\/fund\.eastmoney\.com|push2\.eastmoney\.com|push2delay\.eastmoney\.com/.test(text) &&
        !/\b(?:diagnostic|diagnostics|legacy|fallback only|调试)\b/i.test(text)
      ) {
        offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not advertise disabled Tushare interfaces as normal reusable workflows', () => {
    const offenders: string[] = []
    for (const path of normalSkillPaths) {
      const text = readFileSync(sourcePath(path), 'utf-8')
      if (disabledTushareApiPattern.test(text) || staleTushareCapabilityPattern.test(text)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

  it('uses the governed fund NAV history interface id in agent-facing guidance', () => {
    const staleFundNavInterfacePattern = /interfaceId\s*:\s*["']fund\.nav["']/
    const offenders = normalSkillPaths
      .filter((path) => staleFundNavInterfacePattern.test(readFileSync(sourcePath(path), 'utf-8')))
    expect(offenders).toEqual([])

    const fundText = readFileSync(sourcePath('finagent/assets/finance/skills/fund/skill.md'), 'utf-8')
    expect(fundText).toContain('interfaceId: "fund.nav_history"')
  })

  it('does not describe provider-specific finance data as direct normal workflow routes', () => {
    const staleDirectProviderPattern = /can go directly to EastMoney|code-owned direct EastMoney|direct EastMoney routes|use direct EastMoney routes|Use EastMoney for:|AkShare `stock_zh_a_spot_em`|Live quotes\s*\|\s*AkShare or sidecar/i
    const offenders = normalSkillPaths
      .filter((path) => staleDirectProviderPattern.test(readFileSync(sourcePath(path), 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('does not tell agents to use raw provider calls first from readback/query guidance', () => {
    const staleProviderFirstPattern = /Use\s+(?:DataStore|MarketData)\(action:\s*["'](?:tdx|akshare|tushare|yfinance|ta)["'][^\n]*\)\s+first/i
    const offenders = dataApiToolGuidancePaths
      .filter((path) => staleProviderFirstPattern.test(readFileSync(sourcePath(path), 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('keeps mobile Wind guidance on MarketData and desktop Wind guidance on DataStore', () => {
    const mobileText = readFileSync(
      sourcePath('finagent/assets/finance/skills/wind-aifinmarket/references/native-windmcp.md'),
      'utf-8',
    )
    const desktopText = readFileSync(
      sourcePath('assets/skills/wind-aifinmarket/references/native-windmcp.md'),
      'utf-8',
    )

    expect(mobileText).toContain('MarketData(action: "reusable_summary")')
    expect(mobileText).toContain('MarketData(action: "query_quote"')
    expect(mobileText).not.toContain('DataStore(action:')
    expect(desktopText).toContain('DataStore(action: "reusable_summary")')
    expect(desktopText).toContain('DataStore(action: "query_quote"')
  })

  it('keeps bundled normal monitor workflows off raw provider endpoints', () => {
    const rawMonitorProviderPattern = /https:\/\/akshare\.akfamily\.xyz|callService\(['"]\/api\/finance\/(?:tushare|sidecar\/akshare)|apiPath:\s*['"]\/api\/finance\/(?:tushare|sidecar\/akshare)|api_name\s*:\s*['"](?:daily|fund_nav|fund_basic|moneyflow|income|balancesheet|cashflow|fina_indicator)['"]/i
    const offenders = monitorWorkflowPaths
      .filter((path) => rawMonitorProviderPattern.test(readFileSync(sourcePath(path), 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('does not teach unknown provider schemas as normal successful tool output', () => {
    const staleUnknownSchemaPattern = /unknown (?:endpoint )?schemas? (?:are )?(?:returned as|remain|stay) tool output|unknown .*?tool output only until|unknown yfinance funcs are output-only/i
    const staleDiscoveryPattern = /DataStore\(action:\s*"(?:(?:akshare|yfinance|ta)_search|sidecar_status)"\)/
    const offenders = providerGuidancePaths.filter((path) => existsSync(sourcePath(path))).filter((path) => {
      const text = readFileSync(sourcePath(path), 'utf-8')
      return staleUnknownSchemaPattern.test(text) || staleDiscoveryPattern.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('keeps Electron and mobile Wind MCP provider capability lists aligned with the known manifest', () => {
    const electronTools = extractWindToolMap(
      readFileSync(sourcePath('src/agent/tools/wind-mcp.ts'), 'utf-8'),
      'WIND_TOOLS',
    )
    const mobileTools = extractWindToolMap(
      readFileSync(sourcePath('app/lib/agent/tools/wind_mcp_tool/wind_mcp_tool.dart'), 'utf-8'),
      '_windToolsByServer',
    )

    expect(electronTools).toEqual(windMcpToolManifest)
    expect(mobileTools).toEqual(windMcpToolManifest)
  })
})

function extractWindToolMap(text: string, constName: string): Record<string, string[]> {
  const start = text.indexOf(constName)
  expect(start, `${constName} declaration`).toBeGreaterThanOrEqual(0)
  const body = text.slice(start, text.indexOf('};', start))
  const result: Record<string, string[]> = {}
  const serverPattern = /['"]?([a-z_]+)['"]?\s*:\s*\[([\s\S]*?)\]/g
  let match: RegExpExecArray | null
  while ((match = serverPattern.exec(body)) != null) {
    result[match[1]] = Array.from(match[2].matchAll(/['"]([^'"]+)['"]/g)).map((item) => item[1])
  }
  return result
}
