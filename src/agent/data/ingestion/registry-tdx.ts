import type { DataStore, FundamentalRow, KlineRow, QuoteSnapshotRow } from '../store/data-store'
import { normalizeTdxEndpoint, tdxList } from '../normalizers/tdx-normalizer'
import type { IngestionRequest, IngestionResult } from './registry'
import {
  asRecord,
  normalizeDate,
  normalizeTdxStockMarket,
  normalizeTime,
  normalizeTimestamp,
  numberField,
  quoteSnapshotFromRecord,
  result,
  safeJson,
  splitDateTime,
  stringField,
  today,
} from './registry-common'

export function ingestTdx(store: DataStore, request: IngestionRequest, source: string): IngestionResult | null {
  const endpoint = request.endpoint
  const normalized = normalizeTdxEndpoint(endpoint, request.payload, { ...(request.params ?? {}), code: request.code ?? request.params?.code })
  const schema = String(normalized.schema ?? '')
  const data = Array.isArray(normalized.data) ? normalized.data as Array<Record<string, unknown>> : []

  if (schema === 'quote_snapshot') {
    const rows = data.map((q) => quoteSnapshotFromRecord(q, source)).filter((row): row is QuoteSnapshotRow => !!row)
    store.saveQuoteSnapshots(rows)
    if (endpoint === 'quotes_list' || endpoint === 'ex/quotes_list') {
      const stockRows = tdxList(request.payload).map((row) => normalizeTdxStockListRow(row, request)).filter((row): row is Record<string, unknown> => !!row)
      if (stockRows.length > 0) store.saveStockList(stockRows as any)
    }
    return result(request, 'quote_snapshot', 'quote_snapshot', rows.length)
  }
  if (schema === 'kline_daily' || schema === 'index_kline') {
    const rows = data.map((row) => ({ ...row, source }) as unknown as KlineRow)
    store.saveKline(rows)
    return result(request, schema, 'kline_daily', rows.length)
  }
  if (schema === 'stock_list') {
    const rows = data.map((row) => normalizeTdxStockListRow(row, request)).filter((row): row is Record<string, unknown> => !!row)
    store.saveStockList(rows as any)
    return result(request, 'stock_list', 'stock_list', rows.length)
  }
  if (schema === 'sector_rank') {
    const sectorType = String(request.params?.sector_type ?? request.params?.type ?? 'industry')
    store.saveSectorRanking(today(), sectorType, data)
    return result(request, 'sector_rank', 'sector_ranking', data.length)
  }
  if (endpoint === 'ex/categories') {
    const rows = normalizeExCategoryRows(request.payload, source)
    store.saveExCategories(rows as any)
    return result(request, 'ex_category', 'ex_category', rows.length)
  }

  const rows = tdxList(request.payload)
  if (['tick_chart', 'history_tick_chart', 'ex/tick_chart'].includes(endpoint)) {
    const mapped = rows.map((row) => normalizeTickChartRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveTickChartIntraday(mapped)
    return result(request, 'tick_chart_intraday', 'tick_chart_intraday', mapped.length)
  }
  if (['transactions', 'history_transactions', 'history_orders', 'ex/history_transaction'].includes(endpoint)) {
    const mapped = rows.map((row) => normalizeTransactionRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveTransactions(mapped)
    return result(request, 'transactions', 'transactions', mapped.length)
  }
  if (endpoint === 'volume_profile') {
    const mapped = rows.map((row) => normalizeVolumeProfileRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveVolumeProfile(mapped)
    return result(request, 'volume_profile', 'volume_profile', mapped.length)
  }
  if (endpoint === 'finance') {
    const financeRow = normalizeTdxFinanceFundamentalRow(request.payload, request, source)
    if (financeRow) store.saveFundamental([financeRow as FundamentalRow])
    const mapped = normalizeCompanyInfoRows(request.payload, request, source)
    store.saveStockCompanyInfo(mapped)
    return result(request, 'stock_company_info', 'stock_company_info', mapped.length)
  }
  if (endpoint === 'auction') {
    const mapped = rows.map((row, index) => normalizeAuctionRow(row, request, source, index)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveAuctionSnapshots(mapped as any)
    return result(request, 'auction_snapshot', 'auction_snapshot', mapped.length)
  }
  if (endpoint === 'unusual') {
    const mapped = rows.map((row) => normalizeTdxUnusualRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveUnusualActivity(mapped)
    const stockRows = rows.map((row) => normalizeTdxUnusualStockRow(row)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'unusual_activity', 'unusual_activity', mapped.length)
  }
  if (endpoint === 'index_momentum') {
    const mapped = normalizeIndexMomentumRows(request.payload, request, source)
    store.saveIndexMomentumRows(mapped as any)
    return result(request, 'tdx_index_momentum', 'tdx_index_momentum', mapped.length)
  }
  if (endpoint === 'top_board') {
    const mapped = normalizeTopBoardRows(request.payload, request, source)
    store.saveTopBoardRows(mapped as any)
    return result(request, 'tdx_top_board', 'tdx_top_board', mapped.length)
  }
  if (['block', 'ex/board_list'].includes(endpoint)) {
    const mapped = rows.map((row) => normalizeBlockMemberRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveTdxBlockMembers(mapped)
    return result(request, 'tdx_block_member', 'tdx_block_member', mapped.length)
  }
  if (['company_info', 'company_content', 'company_categories'].includes(endpoint)) {
    const mapped = normalizeCompanyInfoRows(request.payload, request, source)
    store.saveStockCompanyInfo(mapped)
    return result(request, 'stock_company_info', 'stock_company_info', mapped.length)
  }
  if (endpoint === 'xdxr') {
    const mapped = rows.map((row) => normalizeXdxrRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveXdxrEvents(mapped as any)
    return result(request, 'xdxr_event', 'xdxr_event', mapped.length)
  }
  if (endpoint === 'count' || endpoint === 'ex/count') {
    const mapped = normalizeTdxCountRows(request.payload, request, source)
    store.saveTdxSecurityCounts(mapped as any)
    return result(request, 'tdx_security_count', 'tdx_security_count', mapped.length)
  }
  if (endpoint === 'chart_sampling' || endpoint === 'ex/chart_sampling') {
    const mapped = normalizeTdxChartSamplingRows(request.payload, request, source)
    store.saveTdxChartSampling(mapped as any)
    return result(request, 'tdx_chart_sampling', 'tdx_chart_sampling', mapped.length)
  }
  if (endpoint === 'ex/table') {
    if (request.params?.detail === true || request.params?.detail === 'true') return null
    const mapped = normalizeExTableRows(request.payload, source)
    store.saveExTableEntries(mapped as any)
    return result(request, 'ex_table_entry', 'ex_table_entry', mapped.length)
  }
  return null
}

function normalizeTickChartRow(row: unknown, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']) ?? request.code
  const dateTime = splitDateTime(stringField(r, ['DateTime', 'datetime', 'dateTime', 'time', 'Time']) ?? '')
  if (!code || !dateTime.time) return null
  return { code, trade_date: dateTime.date ?? normalizeDate(request.params?.date) ?? today(), time: dateTime.time, price: numberField(r, ['Price', 'price', 'Close', 'close']), avg_price: numberField(r, ['AvgPrice', 'avgPrice', 'Average', 'average']), volume: numberField(r, ['Vol', 'Volume', 'volume', 'vol']), amount: numberField(r, ['Amount', 'amount']), source, raw_json: safeJson(row) }
}

function normalizeTransactionRow(row: unknown, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']) ?? request.code
  const dateTime = splitDateTime(stringField(r, ['DateTime', 'datetime', 'dateTime', 'time', 'Time']) ?? '')
  const price = numberField(r, ['Price', 'price'])
  if (!code || !dateTime.time || price == null) return null
  const volume = numberField(r, ['Vol', 'Volume', 'volume', 'vol'])
  return { code, trade_date: dateTime.date ?? normalizeDate(request.params?.date) ?? today(), time: dateTime.time, price, volume, amount: numberField(r, ['Amount', 'amount']) ?? (price != null && volume != null ? price * volume : null), direction: stringField(r, ['Direction', 'direction', 'BuyOrSell', 'buyOrSell', 'BSFlag']), source, raw_json: safeJson(row) }
}

function normalizeVolumeProfileRow(row: unknown, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']) ?? request.code
  const price = numberField(r, ['Price', 'price', 'Cost', 'cost'])
  if (!code || price == null) return null
  return { code, trade_date: normalizeDate(stringField(r, ['Date', 'date']) ?? request.params?.date) ?? today(), price, volume: numberField(r, ['Vol', 'Volume', 'volume', 'vol']), pct: numberField(r, ['Pct', 'pct', 'Percent', 'percent']), source, raw_json: safeJson(row) }
}

function normalizeAuctionRow(row: unknown, request: IngestionRequest, source: string, index: number): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']) ?? request.code
  const time = normalizeTime(stringField(r, ['time', 'Time']) ?? '')
  if (!code || !time) return null
  return { code, trade_date: normalizeDate(stringField(r, ['date', 'Date']) ?? request.params?.date) ?? today(), time, sequence: Math.trunc(numberField(r, ['index', 'sequence', 'Sequence']) ?? index), source, fetched_at: new Date().toISOString(), price: numberField(r, ['price', 'Price']), volume: numberField(r, ['volume', 'Volume', 'vol', 'Vol']), raw_json: safeJson(r) }
}

function normalizeBlockMemberRow(row: unknown, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code', 'StockCode', 'stockCode'])
  const blockName = stringField(r, ['BlockName', 'blockName', 'CategoryName', 'categoryName'])
  const filename = stringField(request.params ?? {}, ['filename'])
  const derivedBlockCode = filename && blockName ? `${filename}:${blockName}` : null
  const blockCode = stringField(r, ['BlockCode', 'blockCode', 'Category', 'category']) ?? String(request.params?.block ?? request.params?.category ?? derivedBlockCode ?? '')
  if (!code || !blockCode) return null
  return { block_code: blockCode, block_name: blockName, code, name: stringField(r, ['Name', 'name', 'StockName', 'stockName']), block_type: stringField(r, ['Type', 'type']) ?? stringField(request.params ?? {}, ['type']), source, updated_at: new Date().toISOString(), raw_json: safeJson(row) }
}

function normalizeTdxStockListRow(row: unknown, request: IngestionRequest): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']); const name = stringField(r, ['name', 'Name'])
  if (!code || !name) return null
  const isEx = request.endpoint === 'ex/list' || request.endpoint === 'ex/quotes_list'
  const marketValue = stringField(r, ['market', 'Market'])
  const categoryValue = stringField(r, ['category', 'Category']) ?? stringField(request.params ?? {}, ['category'])
  return { code, name, market: isEx ? `EXT:${categoryValue ?? 'unknown'}` : normalizeTdxStockMarket(code, marketValue ?? stringField(request.params ?? {}, ['market'])), industry: null, list_date: null, delist_date: null, stock_type: isEx ? 'extended' : 'stock', updated_at: new Date().toISOString() }
}

function normalizeTdxUnusualRow(row: unknown, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']) ?? request.code
  const eventTime = stringField(r, ['time', 'Time'])
  if (!code || !eventTime) return null
  return { event_date: normalizeDate(request.params?.date) ?? today(), code, event_time: eventTime, event_type: stringField(r, ['eventType', 'event_type', 'unusual_type', 'UnusualType']) ?? 'tdx_unusual', name: stringField(r, ['name', 'Name']), info: stringField(r, ['eventName', 'event_name', 'desc', 'Desc', 'description', 'Description', 'value', 'Value']), source, raw_json: safeJson(row) }
}

function normalizeTdxUnusualStockRow(row: unknown): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField(r, ['code', 'Code']); const name = stringField(r, ['name', 'Name'])
  if (!code || !name) return null
  return { code, name, market: normalizeTdxStockMarket(code, stringField(r, ['market', 'Market'])), industry: null, list_date: null, delist_date: null, stock_type: 'stock', updated_at: new Date().toISOString(), raw_json: safeJson(row) }
}

function normalizeCompanyInfoRows(payload: unknown, request: IngestionRequest, source: string): Array<Record<string, unknown>> {
  const code = request.code ?? stringField(asRecord(payload) ?? {}, ['code', 'Code']) ?? 'unknown'
  const titleHint = stringField(request.params ?? {}, ['title', 'Title'])
  const infoType = request.endpoint === 'company_content' && titleHint ? `${request.endpoint}:${titleHint}` : request.endpoint
  const rows = tdxList(payload)
  if (rows.length > 0) return rows.map((row, index) => ({ code, info_type: infoType, title: stringField(asRecord(row) ?? {}, ['Title', 'title', 'Name', 'name']) ?? titleHint ?? `${request.endpoint}#${index + 1}`, content: typeof row === 'string' ? row : safeJson(row), source, updated_at: new Date().toISOString(), raw_json: safeJson(row) }))
  return [{ code, info_type: infoType, title: titleHint ?? request.endpoint, content: typeof payload === 'string' ? payload : safeJson(payload), source, updated_at: new Date().toISOString(), raw_json: safeJson(payload) }]
}

function normalizeTdxFinanceFundamentalRow(payload: unknown, request: IngestionRequest, source: string): FundamentalRow | null {
  const row = asRecord(payload)
  const code = request.code ?? stringField(row ?? {}, ['code', 'Code'])
  const reportDate = normalizeDate(stringField(row ?? {}, ['updatedDate', 'UpdatedDate', 'report_date', 'reportDate', 'date', 'Date']))
  if (!row || !code || !reportDate) return null
  const totalAssets = numberField(row, ['totalAssets', 'TotalAssets'])
  const currentLiabilities = numberField(row, ['currentLiabilities', 'CurrentLiabilities'])
  const longTermLiabilities = numberField(row, ['longTermLiabilities', 'LongTermLiabilities'])
  const totalLiabilities = currentLiabilities == null && longTermLiabilities == null ? null : (currentLiabilities ?? 0) + (longTermLiabilities ?? 0)
  return { code, report_date: reportDate, pe_ttm: null, pb: null, ps_ttm: null, roe: null, gross_margin: null, net_margin: null, revenue: numberField(row, ['operatingRevenue', 'OperatingRevenue']), revenue_yoy: null, net_profit: numberField(row, ['netProfit', 'NetProfit']), profit_yoy: null, total_assets: totalAssets, total_liabilities: totalLiabilities, debt_ratio: totalLiabilities != null && totalAssets != null && totalAssets !== 0 ? totalLiabilities / totalAssets * 100 : null, dividend_yield: null, market_cap: null, circ_cap: null, source, updated_at: new Date().toISOString() }
}

function normalizeXdxrRow(row: unknown, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const r = asRecord(row); if (!r) return null
  const code = stringField({ ...(request.params ?? {}), code: request.code }, ['code']) ?? stringField(r, ['Code', 'code'])
  const eventDate = normalizeDate(stringField(r, ['date', 'Date', 'dateTime', 'DateTime']))
  const categoryNum = numberField(r, ['category', 'Category'])
  if (!code || !eventDate || categoryNum == null) return null
  return { code, event_date: eventDate, category: Math.trunc(categoryNum), source, fetched_at: new Date().toISOString(), category_name: stringField(r, ['categoryName', 'category_name', 'CategoryName']), a: numberField(r, ['a', 'A']), b: numberField(r, ['b', 'B']), c: numberField(r, ['c', 'C']), d: numberField(r, ['d', 'D']), raw_json: safeJson(r) }
}

function normalizeIndexMomentumRows(payload: unknown, request: IngestionRequest, source: string): Array<Record<string, unknown>> {
  const root = asRecord(payload)
  const values = Array.isArray(root?.momentum) ? root?.momentum as unknown[] : []
  const code = request.code ?? stringField(root ?? {}, ['code', 'Code']) ?? ''
  if (!code || values.length === 0) return []
  const tradeDate = normalizeDate(stringField(root ?? {}, ['date', 'Date']) ?? request.params?.date) ?? today()
  const fetchedAt = new Date().toISOString()
  return values.map((value, index) => ({ code, trade_date: tradeDate, sequence: index, source, fetched_at: fetchedAt, value: typeof value === 'number' ? value : Number(value), raw_json: safeJson({ value, sequence: index, payload: root }) })).filter((row) => Number.isFinite(Number(row.value)))
}

function normalizeTopBoardRows(payload: unknown, request: IngestionRequest, source: string): Array<Record<string, unknown>> {
  const root = asRecord(payload); if (!root) return []
  const boardDate = normalizeDate(stringField(root, ['date', 'Date']) ?? request.params?.date) ?? today()
  const category = stringField(root, ['category', 'Category']) ?? stringField(request.params ?? {}, ['category']) ?? '0'
  const fetchedAt = new Date().toISOString()
  const out: Array<Record<string, unknown>> = []
  const pushSide = (side: string, rawRows: unknown) => {
    const rows = Array.isArray(rawRows) ? rawRows : []
    for (let i = 0; i < rows.length; i += 1) {
      const r = asRecord(rows[i]); if (!r) continue
      const code = stringField(r, ['code', 'Code']); if (!code) continue
      out.push({ board_date: boardDate, category, side, rank: i + 1, code, source, fetched_at: fetchedAt, market: numberField(r, ['market', 'Market']), price: numberField(r, ['price', 'Price']), value: numberField(r, ['value', 'Value']), raw_json: safeJson(r) })
    }
  }
  pushSide('increase', root.increase); pushSide('decrease', root.decrease)
  return out
}

function normalizeExCategoryRows(payload: unknown, source: string): Array<Record<string, unknown>> {
  const list = Array.isArray((payload as any)?.List) ? (payload as any).List as Array<Record<string, unknown>> : Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []
  const updatedAt = new Date().toISOString()
  const out: Array<Record<string, unknown>> = []
  for (const row of list) {
    const category = numberField(row, ['category', 'Category']); const name = stringField(row, ['name', 'Name'])
    if (category == null || !name) continue
    out.push({ category, name, abbr: stringField(row, ['abbr', 'Abbr']), source, updated_at: updatedAt, raw_json: safeJson(row) })
  }
  return out
}

function normalizeTdxCountRows(payload: unknown, request: IngestionRequest, source: string): Array<Record<string, unknown>> {
  const row = asRecord(payload) ?? {}
  const count = numberField(row, ['Count', 'count'])
  if (!Number.isFinite(count)) return []
  return [{ scope: request.endpoint === 'ex/count' ? 'ex' : 'main', market: request.endpoint === 'ex/count' ? 'all' : String(request.params?.market ?? request.request?.market ?? '0'), source, fetched_at: new Date().toISOString(), count, raw_json: safeJson(payload) }]
}

function normalizeTdxChartSamplingRows(payload: unknown, request: IngestionRequest, source: string): Array<Record<string, unknown>> {
  const row = asRecord(payload) ?? {}
  const prices = Array.isArray(row?.Prices) ? row.Prices : []
  const preClose = numberField(row, ['PreClose', 'preClose'])
  const scope = request.endpoint === 'ex/chart_sampling' ? 'ex' : 'main'
  const fetchedAt = new Date().toISOString()
  return prices.map((price, index) => {
    const n = Number(price)
    if (!Number.isFinite(n)) return null
    return { scope, code: String(request.code ?? request.params?.code ?? ''), sequence: index, source, fetched_at: fetchedAt, market: request.endpoint === 'chart_sampling' ? String(request.params?.market ?? request.request?.market ?? '') : null, category: request.endpoint === 'ex/chart_sampling' ? String(request.params?.category ?? request.request?.category ?? '') : null, pre_close: Number.isFinite(preClose) ? preClose : null, price: n, change: preClose != null ? n - preClose : null, raw_json: safeJson({ price: n }) }
  }).filter(Boolean) as Array<Record<string, unknown>>
}

function normalizeExTableRows(payload: unknown, source: string): Array<Record<string, unknown>> {
  if (typeof payload !== 'string' || payload.trim() === '') return []
  const updatedAt = new Date().toISOString()
  return payload.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const parts = entry.split('|')
    const entryKey = parts[0] ?? ''
    let category: string | null = null
    let code = entryKey
    const idx = entryKey.indexOf('#')
    if (idx >= 0) { category = entryKey.slice(0, idx); code = entryKey.slice(idx + 1) }
    return { entry_key: entryKey, category, code, name: parts[1] ?? null, source, updated_at: updatedAt, raw_json: JSON.stringify({ entry }) }
  })
}
