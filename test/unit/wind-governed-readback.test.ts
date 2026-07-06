import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import type { ToolContext } from '../../src/agent/tool'

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'fin-wind-readback-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}

function makeCtx(basePath: string): ToolContext {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
    getConfigValue: () => undefined,
  }
}

describe('Wind governed readbacks', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = makeBasePath()
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb()
    if (basePath) rmSync(basePath, { recursive: true, force: true })
  })

  it('reads governed Wind fund/index readbacks through explicit actions', async () => {
    store.saveFundamental([
      {
        code: '110011',
        report_date: '2026-06-18',
        revenue: 123000000,
        net_profit: 45600000,
        source: 'Wind',
        fetched_at: '2026-06-19T08:00:00.000Z',
        raw_json: '{}',
      },
      {
        code: '000300',
        report_date: '2026-06-18',
        pe_ttm: 14.5,
        pb: 1.8,
        source: 'Wind',
        fetched_at: '2026-06-19T08:05:00.000Z',
        raw_json: '{}',
      },
      {
        code: '019521.SH',
        report_date: '2026-06-18',
        asset_turnover: 0.61,
        source: 'Wind',
        fetched_at: '2026-06-19T08:06:00.000Z',
        raw_json: '{}',
      },
    ])
    store.saveStockCompanyInfo([
      {
        code: '110011.OF',
        info_type: 'get_fund_company_info',
        title: '基金公司概况',
        content: '易方达基金管理有限公司',
        source: 'Wind',
        updated_at: '2026-06-19T08:10:00.000Z',
        raw_json: '{}',
      },
      {
        code: '110011.OF',
        info_type: 'get_fund_holders',
        title: '持有人结构',
        content: '机构投资者占比 52%',
        source: 'Wind',
        updated_at: '2026-06-19T08:11:00.000Z',
        raw_json: '{}',
      },
      {
        code: '000300',
        info_type: 'get_index_basicinfo',
        title: '指数概况',
        content: '沪深300指数',
        source: 'Wind',
        updated_at: '2026-06-19T08:12:00.000Z',
        raw_json: '{}',
      },
      {
        code: '019521.SH',
        info_type: 'get_bond_basicinfo',
        title: '债券概况',
        content: '2025 年记账式附息国债',
        source: 'Wind',
        updated_at: '2026-06-19T08:13:00.000Z',
        raw_json: '{}',
      },
      {
        code: '019521.SH',
        info_type: 'get_bond_market_data',
        title: '市场表现',
        content: '估值收益率 2.31%',
        source: 'Wind',
        updated_at: '2026-06-19T08:14:00.000Z',
        raw_json: '{}',
      },
      {
        code: '600519',
        info_type: 'get_risk_metrics',
        title: '风险指标',
        content: 'Beta 0.91, Volatility 22.4%',
        source: 'Wind',
        updated_at: '2026-06-19T08:15:00.000Z',
        raw_json: '{}',
      },
    ])

    const tool = new DataStoreTool()
    tool.setDataStore(store)
    const ctx = makeCtx(basePath)

    await expect(tool.call('wind-fund-financials', {
      action: 'query_fund_financials',
      code: '110011',
      reportDate: '2026-06-18',
    }, ctx)).resolves.toContain('interface:fund.financials')

    await expect(tool.call('wind-fund-company', {
      action: 'query_fund_company_info',
      code: '110011.OF',
    }, ctx)).resolves.toContain('interface:fund.company_info')

    await expect(tool.call('wind-fund-holders', {
      action: 'query_fund_investor_holders',
      code: '110011.OF',
    }, ctx)).resolves.toContain('interface:fund.investor_holders')

    await expect(tool.call('wind-index-profile', {
      action: 'query_index_profile',
      code: '000300',
    }, ctx)).resolves.toContain('interface:index.profile')

    await expect(tool.call('wind-index-fundamentals', {
      action: 'query_index_fundamentals',
      code: '000300',
      reportDate: '2026-06-18',
    }, ctx)).resolves.toContain('interface:index.fundamentals')

    await expect(tool.call('wind-bond-profile', {
      action: 'query_bond_profile',
      code: '019521.SH',
    }, ctx)).resolves.toContain('interface:bond.profile')

    await expect(tool.call('wind-bond-market-data', {
      action: 'query_bond_market_data',
      code: '019521.SH',
    }, ctx)).resolves.toContain('interface:bond.market_data')

    await expect(tool.call('wind-bond-financials', {
      action: 'query_bond_issuer_financials',
      code: '019521.SH',
      reportDate: '2026-06-18',
    }, ctx)).resolves.toContain('interface:bond.issuer_financials')

    await expect(tool.call('wind-stock-risk-metrics', {
      action: 'query_stock_risk_metrics',
      code: '600519',
    }, ctx)).resolves.toContain('interface:stock.risk_metrics')

    await expect(tool.call('wind-stock-risk-metrics-evidence', {
      action: 'query_stock_risk_metrics',
      code: '600519',
    }, ctx)).resolves.toContain('kind":"risk_analysis')
  })
})
