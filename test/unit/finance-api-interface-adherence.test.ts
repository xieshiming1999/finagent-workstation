import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { eligibleCapabilitiesForInterface } from '../../src/agent/data/data-api-interface-contract'

const repoRoot = join(process.cwd(), '..')

const interfaceBackedFetchers: Array<{ path: string; interfaceId: string }> = [
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-money-flow.ts', interfaceId: 'stock.money_flow' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-index-kline.ts', interfaceId: 'index.daily_kline' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-sector.ts', interfaceId: 'market.sector_ranking' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-limit-pool.ts', interfaceId: 'market.limit_pool' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-northbound.ts', interfaceId: 'market.northbound_flow' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-holding.ts', interfaceId: 'fund.holding' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-manager.ts', interfaceId: 'fund.manager' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-calendar.ts', interfaceId: 'calendar.trade_days' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fundamental.ts', interfaceId: 'stock.daily_valuation' },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-chip-distribution.ts', interfaceId: 'stock.chip_distribution' },
]

const normalRuntimeProviderCoverage: Array<{ path: string; interfaceId: string; providers: string[] }> = [
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-money-flow.ts', interfaceId: 'stock.money_flow', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-index-kline.ts', interfaceId: 'index.daily_kline', providers: ['tdx', 'eastmoney', 'akshare', 'tencent'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-sector.ts', interfaceId: 'market.sector_ranking', providers: ['eastmoney', 'akshare', 'tdx', 'sina'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-limit-pool.ts', interfaceId: 'market.limit_pool', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-northbound.ts', interfaceId: 'market.northbound_flow', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-holding.ts', interfaceId: 'fund.holding', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-manager.ts', interfaceId: 'fund.manager', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-calendar.ts', interfaceId: 'calendar.trade_days', providers: ['szse', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fundamental.ts', interfaceId: 'stock.daily_valuation', providers: ['akshare', 'eastmoney', 'tdx'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-chip-distribution.ts', interfaceId: 'stock.chip_distribution', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-stock-list.ts', interfaceId: 'stock.identity_list', providers: ['tdx', 'sina', 'eastmoney', 'akshare', 'tencent'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-list.ts', interfaceId: 'fund.identity_list', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-list.ts', interfaceId: 'fund.performance_metrics', providers: ['eastmoney', 'akshare'] },
  { path: 'finagent_workstation/src/agent/data/fetchers/fetcher-fund-nav.ts', interfaceId: 'fund.nav_history', providers: ['eastmoney', 'akshare'] },
]

const financeSkillRoots = [
  'finagent_workstation/assets/skills',
  'app/assets/finance/skills',
  'finagent/assets/finance/skills',
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
const disabledTushareApiMentionPattern = (api: string): RegExp =>
  new RegExp(`(Tushare|tushare)[^\\n.。]{0,120}\`?${api}\`?|\`?${api}\`?[^\\n.。]{0,120}(Tushare|tushare)`, 'i')

function listMarkdownFiles(root: string): string[] {
  const abs = join(repoRoot, root)
  const entries = readdirSync(abs)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(abs, entry)
    const rel = `${root}/${entry}`
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...listMarkdownFiles(rel))
    } else if (entry.endsWith('.md')) {
      files.push(rel)
    }
  }
  return files
}

function allFinanceSkillMarkdownFiles(): string[] {
  return financeSkillRoots.flatMap(listMarkdownFiles)
}

describe('finance API interface adherence', () => {
  it('routes normal persisted market-family fetchers through data API interfaces', () => {
    const offenders: string[] = []
    for (const item of interfaceBackedFetchers) {
      const text = readFileSync(join(repoRoot, item.path), 'utf-8')
      if (!text.includes('runDataApiInterfaceRoute') || !text.includes(item.interfaceId)) {
        offenders.push(`${item.path}:${item.interfaceId}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps legacy provider router out of normal market data fetchers', () => {
    const offenders = interfaceBackedFetchers
      .filter((item) => readFileSync(join(repoRoot, item.path), 'utf-8').includes('runProviderRoute'))
      .map((item) => item.path)
    expect(offenders).toEqual([])
  })

  it('checks DataStore cache before provider calls for persisted interface fetchers', () => {
    const offenders = interfaceBackedFetchers
      .filter((item) => {
        const text = readFileSync(join(repoRoot, item.path), 'utf-8')
        return !text.includes('readCache:') || !text.includes('cacheMode:')
      })
      .map((item) => item.path)
    expect(offenders).toEqual([])
  })

  it('keeps normal eligible capabilities aligned with runtime provider branches', () => {
    const offenders: string[] = []
    for (const item of normalRuntimeProviderCoverage) {
      const eligible = eligibleCapabilitiesForInterface(item.interfaceId).map((capability) => capability.provider)
      expect(eligible).toEqual(item.providers)

      const text = readFileSync(join(repoRoot, item.path), 'utf-8')
      for (const provider of item.providers) {
        if (!text.includes(`'${provider}'`) && !text.includes(`"${provider}"`)) {
          offenders.push(`${item.interfaceId}:${provider}:${item.path}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('logs market-family provider failures with data API interface endpoints', () => {
    const text = readFileSync(join(repoRoot, 'finagent_workstation/src/domain/market/services/eastmoney-market-data-action-service.ts'), 'utf-8')
    const rawEndpointNames = [
      'sector',
      'limit_up',
      'dragon_tiger',
      'northbound_flow',
      'northbound_holding',
      'hot_rank',
      'flow_rank',
      'limit_down',
      'unusual',
    ]
    const offenders = rawEndpointNames.filter((name) => text.includes(`endpoint: '${name}'`))
    expect(offenders).toEqual([])
  })

  it('keeps normal renderer panels on requirement-level finance routes', () => {
    const guardedPaths = [
      'finagent_workstation/src/renderer/components/NewsFeedWidget.tsx',
    ]
    const offenders = guardedPaths
      .filter((path) => /\/api\/finance\/sidecar\//.test(readFileSync(join(repoRoot, path), 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('routes market-pulse snapshot provider data through data API interfaces', () => {
    const text = readFileSync(join(repoRoot, 'finagent_workstation/src/agent/data/market-snapshot.ts'), 'utf-8')
    expect(text).toContain("fetchLimitUpPool(tradingDate)")
    expect(text).toContain("fetchLimitDownPool(tradingDate)")
    expect(text).toContain('fetchNorthbound(50)')
    expect(text).toContain("runDataApiInterfaceRoute(\n    'market.hot_rank'")
    expect(text).not.toMatch(/adv\.fetch(?:LimitUpPool|LimitDownPool|NorthboundFlow)\(/)
  })

  it('keeps the legacy data-manager market facade on interface-backed fetchers', () => {
    const text = readFileSync(join(repoRoot, 'finagent_workstation/src/agent/data/data-manager-market.ts'), 'utf-8')
    expect(text).toContain("from './fetchers/fetcher-kline-daily'")
    expect(text).toContain("from './fetchers/fetcher-money-flow'")
    expect(text).toContain("from './fetchers/fetcher-sector'")
    expect(text).not.toMatch(/sidecarGet\(`\/(?:kline|akshare\/stock_individual_fund_flow)/)
    expect(text).not.toContain('fetchEastmoneySectors')
  })

  it('rejects non-daily kline periods in the legacy data-manager market facade', async () => {
    const { getKline } = await import('../../src/agent/data/data-manager-market')

    await expect(getKline('600519', 'weekly')).rejects.toThrow(
      'data-manager getKline supports only governed daily K-line',
    )
  })

  it('keeps bundled data-source skills aligned with cache/provider routing semantics', () => {
    const skillPaths = [
      'finagent_workstation/assets/skills/data-sources/skill.md',
      'finagent_workstation/assets/skills/data-sources/references/data-api-interfaces.md',
      'app/assets/finance/skills/data-sources/skill.md',
      'app/assets/finance/skills/data-sources/references/data-api-interfaces.md',
      'finagent/assets/finance/skills/data-sources/skill.md',
      'finagent/assets/finance/skills/data-sources/references/data-api-interfaces.md',
    ]
    const offenders = skillPaths
      .filter((path) => {
        const text = readFileSync(join(repoRoot, path), 'utf-8')
        return /providerMode:\s*strict[`"']?\s*(?:bypasses|绕过)/i.test(text) ||
          /providerMode:\s*strict[\s\S]{0,80}绕过本地缓存/.test(text)
      })
    expect(offenders).toEqual([])
  })

  it('generates data-source skill references from capability contracts without status drift', () => {
    execFileSync('node', ['scripts/finance_data_api_skill_reference.mjs'], {
      cwd: join(repoRoot, 'finagent_workstation'),
      stdio: 'pipe',
    })
    const referencePaths = [
      'finagent_workstation/assets/skills/data-sources/references/data-api-interfaces.md',
      'app/assets/finance/skills/data-sources/references/data-api-interfaces.md',
      'finagent/assets/finance/skills/data-sources/references/data-api-interfaces.md',
    ]
    const offenders: string[] = []
    for (const path of referencePaths) {
      const text = readFileSync(join(repoRoot, path), 'utf-8')
      for (const line of text.split('\n').filter((item) => item.startsWith('| `'))) {
        const cells = line.split('|').map((cell) => cell.trim())
        const supported = cells[5] ?? ''
        const blocked = cells[6] ?? ''
        if (/(disabled|not-supported|output-only|credential-gated|quota-gated|transport-unstable)/.test(supported)) {
          offenders.push(`${path}: blocked status in supported column: ${line}`)
        }
        if (/(^|, )[^:,]+:(supported|global-only)(,|$)/.test(blocked)) {
          offenders.push(`${path}: supported status in blocked column: ${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not advertise disabled Tushare APIs as shared-mobile supported workflows', () => {
    const text = readFileSync(join(repoRoot, 'app/assets/finance/skills/tushare/skill.md'), 'utf-8')
    const coverage = text.match(/当前结构化持久化覆盖：([\s\S]*?)。/)?.[1] ?? ''
    expect(coverage).not.toMatch(/fina_indicator|income|balancesheet|cashflow|moneyflow|fund_basic|fund_nav/)
    expect(text).not.toMatch(/\|\s*`(?:moneyflow|fund_nav|income|balancesheet|cashflow|fina_indicator|fund_basic)`\s*\|/)
    expect(text).not.toMatch(/财务质量:\s*`income`/)
    expect(text).not.toMatch(/基金研究:\s*`fund_basic`/)
    expect(text).toContain('不要调用 `fina_indicator`')
  })

  it('keeps bundled finance skills from advertising provider-direct examples as normal workflows', () => {
    const offenders: string[] = []
    for (const path of allFinanceSkillMarkdownFiles()) {
      if (providerSpecificSkillPath.test(path)) continue
      const text = readFileSync(join(repoRoot, path), 'utf-8')
      for (const match of text.matchAll(directProviderCallPattern)) {
        const index = match.index ?? 0
        const context = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 500))
        if (!explicitProviderContextPattern.test(context)) {
          offenders.push(`${path}: ${match[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps disabled Tushare API mentions paired with blocking guidance in finance skills', () => {
    const offenders: string[] = []
    for (const path of allFinanceSkillMarkdownFiles()) {
      const text = readFileSync(join(repoRoot, path), 'utf-8')
      for (const api of disabledTushareApis) {
        const standaloneApiPattern = new RegExp(`(^|[^A-Za-z0-9_])${api}([^A-Za-z0-9_]|$)`, 'g')
        for (const match of text.matchAll(standaloneApiPattern)) {
          const index = (match.index ?? 0) + (match[1]?.length ?? 0)
          const context = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 500))
          const mention = text.slice(Math.max(0, index - 160), Math.min(text.length, index + 160))
          if (disabledTushareApiMentionPattern(api).test(mention) && !disabledTushareBlockPattern.test(context)) {
            offenders.push(`${path}: ${api}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps credential-gated Tushare index_weight out of normal raw examples', () => {
    const skillPaths = [
      'finagent_workstation/assets/skills/tushare/skill.md',
      'app/assets/finance/skills/tushare/skill.md',
      'finagent/assets/finance/skills/tushare/skill.md',
    ]
    const offenders: string[] = []
    for (const path of skillPaths) {
      const text = readFileSync(join(repoRoot, path), 'utf-8')
      if (/DataStore\(action:\s*["']tushare["'],\s*api_name:\s*["']index_weight["']/.test(text)) {
        offenders.push(`${path}: raw DataStore index_weight example`)
      }
      if (/MarketData\(action:\s*["']tushare["'][\s\S]{0,160}api_name:\s*["']index_weight["']/.test(text)) {
        offenders.push(`${path}: raw MarketData index_weight example`)
      }
      const index = text.indexOf('index_weight')
      const context = index >= 0 ? text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900)) : ''
      if (index >= 0 && !/interface_availability|API Health|live-validated|credential-gated|可用性|验证通过/i.test(context)) {
        offenders.push(`${path}: index_weight lacks availability gate`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps top-level agent guidance aligned with disabled Tushare policy', () => {
    const text = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf-8')
    const offenders: string[] = []
    const mobileTushareParagraph = text
      .split('\n')
      .find((line) => line.includes('FinAgent/mobile exposes the equivalent Tushare path')) ?? ''
    const registeredClause = mobileTushareParagraph.split('Do not advertise or call disabled Tushare')[0] ?? ''
    for (const api of disabledTushareApis) {
      if (new RegExp(`Registered mobile Tushare schemas[^\\n]*${api}`).test(registeredClause)) {
        offenders.push(`AGENTS.md registered disabled ${api}`)
      }
      if (!new RegExp(`disabled Tushare[\\s\\S]{0,180}${api}|${api}[\\s\\S]{0,180}disabled Tushare`, 'i').test(text)) {
        offenders.push(`AGENTS.md missing disabled guidance for ${api}`)
      }
    }
    expect(mobileTushareParagraph).toContain('query_index_constituents')
    expect(mobileTushareParagraph).toContain('tushare.index.constituents')
    expect(offenders).toEqual([])
  })

  it('keeps top-level agent guidance aligned with gated mobile Yahoo evidence', () => {
    const text = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf-8')
    const mobileYahooParagraph = text
      .split('\n')
      .find((line) => line.includes('FinAgent/mobile does not run the Python yfinance sidecar')) ?? ''
    expect(mobileYahooParagraph).toContain('interface_availability')
    expect(mobileYahooParagraph).toContain('401/403 credential-or-permission')
    expect(mobileYahooParagraph).toContain('query_yfinance')
    expect(mobileYahooParagraph).toContain('query_global_*')
    expect(mobileYahooParagraph).toContain('query_option_*')
    expect(mobileYahooParagraph).toContain('reuse cache/readback')
  })

  it('keeps mobile Tushare API reference scoped to supported or diagnostic use', () => {
    const text = readFileSync(join(repoRoot, 'app/assets/finance/skills/tushare/api_reference.md'), 'utf-8')
    expect(text).toContain('正常 workflow 只能使用当前已登记的 app surface')
    expect(text).toContain('provider diagnostic / bounded research')
    expect(text).toContain('index.constituents / tushare')
  })

  it('does not leave direct public-provider URL fallbacks in finance skill guidance', () => {
    const offenders = allFinanceSkillMarkdownFiles().filter((path) => {
      const text = readFileSync(join(repoRoot, path), 'utf-8')
      return /(public provider URLs?|Yahoo public URLs?)[\s\S]{0,160}unless/i.test(text)
    })
    expect(offenders).toEqual([])
  })
})
