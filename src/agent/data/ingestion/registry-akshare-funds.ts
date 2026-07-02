import type { IngestionRequest } from './registry'
import {
  cleanCode,
  normalizeDate,
  normalizeFundHoldingReportDate,
  normalizeTdxStockMarket,
  numberField,
  safeJson,
  stringField,
} from './registry-akshare-shared'

export function normalizeAkshareFundHoldingRow(
  row: Record<string, unknown>,
  request: IngestionRequest,
  source: string,
  index: number,
): Record<string, unknown> | null {
  const fundCode = String(request.code ?? request.params?.symbol ?? request.params?.fund ?? '').trim()
  const stockCode = cleanCode(stringField(row, ['股票代码', 'stock_code', 'code']))
  if (!fundCode || !stockCode) return null
  return {
    fund_code: fundCode,
    report_date: normalizeFundHoldingReportDate(stringField(row, ['截止日期', '季度', 'report_date'])) ?? '',
    stock_code: stockCode,
    stock_name: stringField(row, ['股票名称', 'stock_name', 'name']) ?? '',
    hold_shares: numberField(row, ['持股数', 'hold_shares']),
    hold_value: numberField(row, ['持仓市值', 'hold_value']),
    hold_pct: numberField(row, ['占净值比例', 'hold_pct']),
    rank: numberField(row, ['序号', 'rank']) ?? index + 1,
    source,
  }
}

export function normalizeFundHoldingStockIdentityRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const code = cleanCode(stringField(row, ['stock_code', 'code']))
  const name = stringField(row, ['stock_name', 'name'])
  if (!code || !name) return null
  return {
    code,
    name,
    market: normalizeTdxStockMarket(code),
    industry: null,
    list_date: null,
    delist_date: null,
    stock_type: 'stock',
    updated_at: new Date().toISOString(),
    raw_json: safeJson(row),
  }
}

export function normalizeAkshareFundManagerRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const name = stringField(row, ['姓名', 'name'])
  if (!name) return null
  const fundCount = numberField(row, ['基金数量', 'fund_count'])
  return {
    manager_id: stringField(row, ['经理ID', 'ID', 'manager_id']) ?? `mgr_${name}_${stringField(row, ['基金公司', 'company']) ?? ''}`,
    name,
    company: stringField(row, ['基金公司', 'company']),
    start_date: normalizeDate(stringField(row, ['起始日期', 'start_date'])),
    total_size: numberField(row, ['管理规模', 'total_size']),
    fund_count: fundCount == null ? null : Math.round(fundCount),
    best_return: numberField(row, ['最佳回报', 'best_return']),
    experience_years: numberField(row, ['从业年限', 'experience_years']),
    updated_at: new Date().toISOString(),
  }
}

export function normalizeAkshareFundListRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const code = stringField(row, ['基金代码', 'code', 'symbol'])
  if (!code) return null
  return {
    code,
    name: stringField(row, ['基金简称', 'name']) ?? code,
    fund_type: stringField(row, ['基金类型', 'fund_type', 'type']),
    company: stringField(row, ['基金公司', 'company', 'management']),
    manager: stringField(row, ['基金经理', 'manager']),
    setup_date: normalizeDate(stringField(row, ['成立日期', 'setup_date', 'found_date'])),
    total_size: numberField(row, ['最新规模', 'total_size']),
    nav: numberField(row, ['单位净值', 'nav']),
    nav_date: normalizeDate(stringField(row, ['日期', '净值日期', 'nav_date'])),
    return_1y: numberField(row, ['近1年', 'return_1y']),
    return_3y: numberField(row, ['近3年', 'return_3y']),
    return_ytd: numberField(row, ['今年来', 'return_ytd']),
    updated_at: new Date().toISOString(),
  }
}

export function normalizeAkshareFundNavRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = String(request.code ?? request.params?.symbol ?? request.params?.code ?? stringField(row, ['基金代码', 'code', 'symbol']) ?? '').trim()
  const date = normalizeDate(stringField(row, ['净值日期', '日期', 'date']))
  if (!code || !date) return null
  return {
    code,
    date,
    nav: numberField(row, ['单位净值', 'net_value', 'nav']),
    acc_nav: numberField(row, ['累计净值', 'acc_nav']),
    daily_return: numberField(row, ['日增长率', 'daily_return']),
    source,
  }
}
