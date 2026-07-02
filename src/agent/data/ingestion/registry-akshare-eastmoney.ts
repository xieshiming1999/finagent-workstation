import type { DataStore, KlineRow, QuoteSnapshotRow } from '../store/data-store'
import { normalizeSectorRows, normalizeSectorStockRows } from '../eastmoney-fetcher'
import type { IngestionRequest, IngestionResult } from './registry'
import {
  cleanCode,
  flowRankPeriodForIndicator,
  normalizeAdjust,
  normalizeDate,
  normalizeEventTime,
  normalizeSnapshotTimestamp,
  normalizeTdxStockMarket,
  numberField,
  outputOnlyResult,
  quoteSnapshotFromRecord,
  result,
  safeJson,
  stringField,
  today,
} from './registry-akshare-shared'
import {
  normalizeAkshareFundHoldingRow,
  normalizeAkshareFundListRow,
  normalizeAkshareFundManagerRow,
  normalizeAkshareFundNavRow,
  normalizeFundHoldingStockIdentityRow,
} from './registry-akshare-funds'

export function ingestAkshareOrEastMoney(store: DataStore, request: IngestionRequest, source: string): IngestionResult | null {
  const endpoint = request.endpoint
  const payload = request.payload as any
  const data = Array.isArray(payload?.data) ? payload.data as Array<Record<string, unknown>> : Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []
  if (request.provider === 'akshare' && isNonEquivalentAkshareCompatibilityWrapper(endpoint)) {
    return outputOnlyResult(
      request,
      'provider_diagnostic_result',
      `${endpoint} is a known AkShare compatibility wrapper but is not semantically equivalent to the requirement-level data API interface; use the EastMoney/TDX interface route for canonical persistence or DataStore(action:"provider_diagnostic") for bounded inspection.`,
    )
  }

  if (['stock_zt_pool_em', 'stock_zt_pool_dtgc_em', 'stock_zt_pool_strong_em', 'stock_zt_pool_zbgc_em'].includes(endpoint)) {
    const limitType = endpoint === 'stock_zt_pool_dtgc_em' ? 'down' : endpoint === 'stock_zt_pool_zbgc_em' ? 'failed' : endpoint === 'stock_zt_pool_strong_em' ? 'strong' : 'up'
    const rows = data.map((row) => normalizeLimitPoolRow(row, request, source, limitType)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveLimitPool(rows)
    const stockRows = data.map((row) => normalizeStockIdentityRow(row, true)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'limit_pool', 'limit_pool', rows.length)
  }
  if (['stock_board_industry_name_em', 'stock_board_concept_name_em', 'sector_ranking'].includes(endpoint)) {
    const sectorType = endpoint === 'stock_board_concept_name_em' || request.params?.type === 'concept' ? 'concept' : 'industry'
    const rows = normalizeBoardRankingRows(request.payload, request, source, sectorType)
    store.saveSectorRanking(today(), sectorType, rows)
    return result(request, 'sector_ranking', 'sector_ranking', rows.length)
  }
  if (['stock_board_industry_cons_em', 'stock_board_concept_cons_em', 'sector_cons'].includes(endpoint)) {
    const rows = normalizeIndustryMapRows(request.payload, request)
    const quoteRows = normalizeAkshareSectorConstituentQuotes(request.payload, request, source)
    if (quoteRows.length > 0) store.saveQuoteSnapshots(quoteRows)
    const stockRows = quoteRows.map((row) => ({ code: row.code, name: row.name, market: normalizeTdxStockMarket(row.code), industry: stringField(request.params ?? {}, ['sector', 'symbol']) ?? null, list_date: null, delist_date: null, stock_type: 'stock', updated_at: new Date().toISOString(), raw_json: row.raw_json ?? null }))
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    store.saveIndustryMap(rows)
    return result(request, 'industry_map', 'industry_map', rows.length)
  }
  if (endpoint === 'stock_hot_rank_em' || endpoint === 'hot_rank') return saveAkshareHotRank(store, request, source, data)
  if (endpoint === 'stock_lhb_detail_daily_sina' || endpoint === 'dragon_tiger') return saveDragonTiger(store, request, source, data)
  if (endpoint === 'stock_hsgt_hist_em') {
    const rows = data.map((row) => normalizeAkshareNorthboundFlowRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveNorthboundFlow(rows)
    return result(request, 'northbound_flow', 'northbound_flow', rows.length)
  }
  if (endpoint === 'stock_hsgt_hold_stock_em') {
    const rows = data.map((row) => normalizeAkshareNorthboundHoldingRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveNorthboundHolding(rows)
    const stockRows = data.map((row) => normalizeStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'northbound_holding', 'northbound_holding', rows.length)
  }
  if (endpoint === 'holders') {
    const rows = data.map((row, index) => normalizeAkshareStockShareholderRow(row, request, source, index)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveStockShareholders(rows as any)
    return result(request, 'stock_shareholder', 'stock_shareholder', rows.length)
  }
  if (endpoint === 'fund_portfolio_hold_em') {
    const rows = data.map((row, index) => normalizeAkshareFundHoldingRow(row, request, source, index)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveFundHolding(rows)
    const stockRows = rows.map((row) => normalizeFundHoldingStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'fund_holding', 'fund_holding', rows.length)
  }
  if (endpoint === 'fund_manager_em') {
    const rows = data.map((row) => normalizeAkshareFundManagerRow(row)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveFundManagers(rows)
    return result(request, 'fund_manager', 'fund_manager', rows.length)
  }
  if (endpoint === 'fund_open_fund_rank_em') {
    const rows = data.map((row) => normalizeAkshareFundListRow(row)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveFundList(rows)
    return result(request, 'fund_list', 'fund_list', rows.length)
  }
  if (endpoint === 'fund_open_fund_info_em') {
    const rows = data.map((row) => normalizeAkshareFundNavRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveFundNav(rows)
    return result(request, 'fund_nav', 'fund_nav', rows.length)
  }
  if (endpoint === 'stock_changes_em') {
    const rows = data.map((row) => normalizeAkshareUnusualRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveUnusualActivity(rows)
    const stockRows = data.map((row) => normalizeStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'unusual_activity', 'unusual_activity', rows.length)
  }
  if (endpoint === 'stock_individual_fund_flow') {
    const rows = data.map((row) => normalizeAkshareMoneyFlowRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveMoneyFlow(rows)
    return result(request, 'money_flow', 'money_flow', rows.length)
  }
  if (endpoint === 'stock_individual_fund_flow_rank') {
    const rows = data.map((row) => normalizeAkshareFlowRankRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveFlowRank(rows)
    const stockRows = data.map((row) => normalizeStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'flow_rank', 'flow_rank', rows.length)
  }
  if (endpoint === 'margin') {
    const rows = data.map((row) => normalizeAkshareMarginTradingRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveMarginTradingRows(rows as any)
    const stockRows = data.map((row) => normalizeStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
    return result(request, 'margin_trading', 'margin_trading', rows.length)
  }
  if (['stock_zh_a_spot', 'stock_zh_a_spot_em', 'stock_zh_index_spot_em'].includes(endpoint)) return saveSpotQuotes(store, request, source, data, endpoint)
  if (endpoint === 'stock_hk_spot_em' || endpoint === 'stock_us_spot_em') return saveGlobalSpotQuotes(store, request, source, data, endpoint)
  if (endpoint === 'stock_zh_a_hist' || endpoint === 'stock_zh_index_daily_em') {
    const rows = data.map((row) => normalizeAkshareKlineRow(row, request, source)).filter((row): row is KlineRow => !!row)
    store.saveKline(rows)
    return result(request, 'kline_daily', 'kline_daily', rows.length)
  }
  return null
}

function isNonEquivalentAkshareCompatibilityWrapper(endpoint: string): boolean {
  return [
    'stock_board_industry_cons_em',
    'stock_board_concept_cons_em',
    'stock_lhb_detail_daily_sina',
    'stock_hsgt_hold_stock_em',
    'stock_changes_em',
  ].includes(endpoint)
}

function saveAkshareHotRank(store: DataStore, request: IngestionRequest, source: string, data: Array<Record<string, unknown>>): IngestionResult {
  const rows = data.map((row, index) => normalizeHotRankRow(row, request, source, index)).filter(Boolean) as Array<Record<string, unknown>>
  store.saveHotRank(rows)
  const stockRows = data.map((row) => normalizeStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
  if (stockRows.length > 0) store.saveStockList(stockRows as any)
  return result(request, 'hot_rank', 'hot_rank', rows.length)
}

function saveDragonTiger(store: DataStore, request: IngestionRequest, source: string, data: Array<Record<string, unknown>>): IngestionResult {
  const rows = data.map((row) => normalizeDragonTigerRow(row, request, source)).filter(Boolean) as Array<Record<string, unknown>>
  store.saveDragonTiger(rows)
  const stockRows = data.map((row) => normalizeStockIdentityRow(row)).filter((row): row is Record<string, unknown> => !!row)
  if (stockRows.length > 0) store.saveStockList(stockRows as any)
  return result(request, 'dragon_tiger', 'dragon_tiger', rows.length)
}

function saveSpotQuotes(store: DataStore, request: IngestionRequest, source: string, data: Array<Record<string, unknown>>, endpoint: string): IngestionResult {
  const rows = data.map((row) => normalizeAkshareQuoteSnapshotRow(row, request, source)).filter((row): row is QuoteSnapshotRow => !!row)
  store.saveQuoteSnapshots(rows)
  if (endpoint !== 'stock_zh_index_spot_em') {
    const stockRows = data.map((row) => normalizeAkshareSpotStockListRow(row, 'A')).filter((row): row is Record<string, unknown> => !!row)
    if (stockRows.length > 0) store.saveStockList(stockRows as any)
  }
  return result(request, 'quote_snapshot', 'quote_snapshot', rows.length)
}

function saveGlobalSpotQuotes(store: DataStore, request: IngestionRequest, source: string, data: Array<Record<string, unknown>>, endpoint: string): IngestionResult {
  const market = endpoint === 'stock_hk_spot_em' ? 'HK' : 'US'
  const rows = data.map((row) => normalizeAkshareGlobalSpotQuoteRow(row, source, market)).filter((row): row is QuoteSnapshotRow => !!row)
  store.saveQuoteSnapshots(rows)
  const stockRows = data.map((row) => normalizeAkshareSpotStockListRow(row, market)).filter((row): row is Record<string, unknown> => !!row)
  if (stockRows.length > 0) store.saveStockList(stockRows as any)
  return result(request, 'quote_snapshot', 'quote_snapshot', rows.length)
}

function normalizeLimitPoolRow(row: Record<string, unknown>, request: IngestionRequest, source: string, limitType: string): Record<string, unknown> | null {
  const code = stringField(row, ['代码', 'code', 'Code'])
  if (!code) return null
  return { date: normalizeDate(row['日期'] ?? request.params?.date) ?? today(), code, name: stringField(row, ['名称', 'name', 'Name']), limit_type: limitType, change_pct: numberField(row, ['涨跌幅', 'changePct', 'change_pct']), first_limit_time: stringField(row, ['首次封板时间', 'firstLimitTime']), last_limit_time: stringField(row, ['最后封板时间', 'lastLimitTime']), open_count: numberField(row, ['炸板次数', 'openCount']), limit_reason: stringField(row, ['涨停原因类别', '所属行业', 'limitReason', 'industry']), continuous_days: numberField(row, ['连板数', 'continuousDays', 'days']), source }
}

function normalizeBoardRankingRows(payload: unknown, request: IngestionRequest, source: string, sectorType: string): Array<Record<string, unknown>> {
  const rows = normalizeSectorRows(payload)
  if (rows.length > 0) return rows.map((row, index) => ({ code: row.code, name: row.name, change_pct: row.changePct, turnover_rate: row.turnoverRate, up_count: row.upCount, down_count: row.downCount, leading_stock: row.leadingStock, leading_pct: row.leadingChangePct, rank: index + 1, source }))
  const data = Array.isArray((payload as any)?.data) ? (payload as any).data : Array.isArray(payload) ? payload : []
  return data.map((row: Record<string, unknown>, index: number) => ({ code: stringField(row, ['板块代码', 'code', 'Code']) ?? '', name: stringField(row, ['板块名称', 'name', 'Name']) ?? '', change_pct: numberField(row, ['涨跌幅', 'changePct', 'f3']), turnover_rate: numberField(row, ['换手率', 'turnoverRate', 'f8']), up_count: numberField(row, ['上涨家数', 'upCount', 'f104']), down_count: numberField(row, ['下跌家数', 'downCount', 'f105']), leading_stock: stringField(row, ['领涨股票', 'leadingStock', 'f140']), leading_pct: numberField(row, ['领涨股票-涨跌幅', 'leadingChangePct', 'f141']), rank: index + 1, source })).filter((row: Record<string, unknown>) => row.code && row.name)
}

function normalizeIndustryMapRows(payload: unknown, request: IngestionRequest): Array<Record<string, unknown>> {
  const rows = normalizeSectorStockRows(payload)
  if (rows.length > 0) return rows.map((row) => ({ code: row.code, industry_l1: String(request.params?.symbol ?? request.params?.board ?? request.params?.sector ?? ''), industry_l2: null, industry_l3: null, updated_at: new Date().toISOString() }))
  const data = Array.isArray((payload as any)?.data) ? (payload as any).data : Array.isArray(payload) ? payload : []
  const industry = String((payload as any)?.board_name ?? request.params?.symbol ?? request.params?.board ?? request.params?.sector ?? '')
  return data.map((row: Record<string, unknown>) => ({ code: stringField(row, ['代码', 'code', 'Code']) ?? '', industry_l1: industry, industry_l2: null, industry_l3: null, updated_at: new Date().toISOString() })).filter((row: Record<string, unknown>) => row.code)
}

function normalizeAkshareSectorConstituentQuotes(payload: unknown, request: IngestionRequest, source: string): QuoteSnapshotRow[] {
  const sectorRows = normalizeSectorStockRows(payload)
  if (sectorRows.length > 0) {
    return sectorRows.map((row) => quoteSnapshotFromRecord({ code: row.code, name: row.name, price: row.price, change: row.change, change_pct: row.changePct, open: row.open, high: row.high, low: row.low, prev_close: row.prevClose, volume: row.volume, amount: row.amount, pe: row.pe, pb: row.pb, market_cap: row.marketCap, turnover_rate: row.turnoverRate }, source)).filter((row): row is QuoteSnapshotRow => !!row)
  }
  const data = Array.isArray((payload as any)?.data) ? (payload as any).data : Array.isArray(payload) ? payload : []
  return data.map((row: Record<string, unknown>) => normalizeAkshareQuoteSnapshotRow(row, request, source)).filter((row: QuoteSnapshotRow | null): row is QuoteSnapshotRow => !!row)
}

function normalizeHotRankRow(row: Record<string, unknown>, request: IngestionRequest, source: string, index: number): Record<string, unknown> | null {
  const code = stringField(row, ['代码', 'code', 'Code', 'sc']); if (!code) return null
  return { date: normalizeDate(request.params?.date) ?? today(), code, name: stringField(row, ['名称', 'name', 'Name', 'sn']), rank: numberField(row, ['rank', '排名', 'rk']) ?? index + 1, heat: numberField(row, ['hotValue', '人气值', '热度', 'hv']), rank_change: numberField(row, ['rankChange', '排名变化', 'rc']), source, raw_json: safeJson(row) }
}

function normalizeAkshareNorthboundFlowRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const tradeDate = normalizeDate(stringField(row, ['日期', 'TRADE_DATE', 'trade_date', 'tradeDate'])); if (!tradeDate) return null
  const mutualType = stringField(row, ['MUTUAL_TYPE', '类型']) ?? String(request.params?.symbol ?? '北向资金')
  const netBuy = numberField(row, ['当日成交净买额', 'NET_DEAL_AMT', 'NET_BUY_AMT', 'NET_BUY'])
  const buyAmount = numberField(row, ['买入成交额', 'BUY_AMT', 'BUY_AMOUNT'])
  const sellAmount = numberField(row, ['卖出成交额', 'SELL_AMT', 'SELL_AMOUNT'])
  return { trade_date: tradeDate, mutual_type: mutualType, buy_amount: buyAmount ?? (netBuy != null && netBuy > 0 ? netBuy : null), sell_amount: sellAmount ?? (netBuy != null && netBuy < 0 ? Math.abs(netBuy) : null), net_buy: netBuy, hold_market_cap: numberField(row, ['持股市值', 'HOLD_MARKET_CAP', 'HOLD_MARKETCAP']), source, raw_json: safeJson(row) }
}

function normalizeAkshareNorthboundHoldingRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = cleanCode(stringField(row, ['代码', 'SECURITY_CODE', 'code'])); if (!code) return null
  return { trade_date: normalizeDate(stringField(row, ['日期', 'TRADE_DATE', 'trade_date', 'tradeDate'])) ?? today(), code, name: stringField(row, ['名称', 'SECURITY_NAME_ABBR', 'SECURITY_NAME', 'name']), hold_market_cap: numberField(row, ['今日持股-市值', '持股市值', 'HOLD_MARKET_CAP', 'HOLD_MARKETCAP']), hold_ratio: numberField(row, ['今日持股-占流通股比', '持股占流通股比', 'HOLD_SHARES_RATIO', 'HOLD_RATIO']), source, raw_json: safeJson(row) }
}

function normalizeAkshareStockShareholderRow(row: Record<string, unknown>, request: IngestionRequest, source: string, index: number): Record<string, unknown> | null {
  const code = cleanCode(String(request.code ?? request.params?.code ?? request.params?.symbol ?? row['代码'] ?? row.code ?? ''))
  const holderName = stringField(row, ['股东名称', 'holder_name', 'Holder', 'name'])
  const reportDate = normalizeDate(stringField(row, ['截至日期', '报告期', 'reported_date', 'Date Reported']))
  if (!code || !holderName || !reportDate) return null
  return {
    code,
    report_date: reportDate,
    holder_name: holderName,
    holder_type: stringField(row, ['股本性质', '股东类型', 'holder_type', 'type']) ?? 'top_shareholder',
    rank: numberField(row, ['编号', '排名', 'rank']) ?? index + 1,
    hold_shares: numberField(row, ['持股数量', 'shares', 'Shares']),
    hold_pct: numberField(row, ['持股比例', 'pct_held', 'pctHeld']),
    share_nature: stringField(row, ['股本性质', 'share_nature']),
    announcement_date: normalizeDate(stringField(row, ['公告日期', 'announcement_date'])),
    shareholder_note: stringField(row, ['股东说明', 'note']),
    shareholder_count: numberField(row, ['股东总数', 'shareholder_count']),
    average_holding: numberField(row, ['平均持股数', 'average_holding']),
    source,
    fetched_at: new Date().toISOString(),
    raw_json: safeJson(row),
  }
}

function normalizeAkshareUnusualRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = cleanCode(stringField(row, ['代码', 'Code', 'code'])); if (!code) return null
  return { event_date: today(), code, event_time: normalizeEventTime(stringField(row, ['时间', 'time', 'Time'])) ?? '00:00:00', event_type: stringField(row, ['板块', 'eventType', 'type']) ?? String(request.params?.symbol ?? '异动'), name: stringField(row, ['名称', 'Name', 'name']), info: stringField(row, ['相关信息', 'info', 'description', 'Desc']), source, raw_json: safeJson(row) }
}

function normalizeAkshareMoneyFlowRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = cleanCode(String(request.code ?? request.params?.stock ?? request.params?.symbol ?? ''))
  const date = normalizeDate(stringField(row, ['日期', 'date']))
  if (!code || !date) return null
  return { code, date, main_net: numberField(row, ['主力净流入-净额', 'main_net']), small_net: numberField(row, ['小单净流入-净额', 'small_net']), medium_net: numberField(row, ['中单净流入-净额', 'medium_net']), large_net: numberField(row, ['大单净流入-净额', 'large_net']), super_large_net: numberField(row, ['超大单净流入-净额', 'super_large_net']), close_price: numberField(row, ['收盘价', 'close_price']), change_pct: numberField(row, ['涨跌幅', 'change_pct']), source }
}

function normalizeAkshareMarginTradingRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = cleanCode(stringField(row, ['证券代码', '代码', 'code', 'Code']) ?? String(request.code ?? request.params?.code ?? request.params?.symbol ?? ''))
  if (!code) return null
  const tradeDate = normalizeDate(stringField(row, ['日期', 'date', 'trade_date']) ?? String((request.payload as any)?.date ?? request.params?.date ?? '')) ?? today()
  return {
    trade_date: tradeDate,
    code,
    name: stringField(row, ['证券简称', '证券名称', '名称', 'name', 'Name']),
    provider: source,
    capability_id: 'akshare.market.margin_trading',
    source_action: 'margin',
    financing_buy: numberField(row, ['融资买入额', '融资买入金额', 'financing_buy', 'rzmre']),
    financing_balance: numberField(row, ['融资余额', 'financing_balance', 'rzye']),
    margin_sell_volume: numberField(row, ['融券卖出量', 'margin_sell_volume', 'rqmcl']),
    margin_balance_volume: numberField(row, ['融券余量', 'margin_balance_volume', 'rqyl']),
    margin_balance: numberField(row, ['融券余额', 'margin_balance', 'rqye']),
    total_balance: numberField(row, ['融资融券余额', '两融余额', 'total_balance', 'rzrqye']),
    fetched_at: new Date().toISOString(),
    raw_json: safeJson(row),
  }
}

function normalizeAkshareFlowRankRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = cleanCode(stringField(row, ['代码', 'code', 'Code'])); if (!code) return null
  const indicator = String(request.params?.indicator ?? '今日')
  const prefix = indicator === '3日' ? '3日' : indicator === '5日' ? '5日' : indicator === '10日' ? '10日' : '今日'
  return { trade_date: today(), period: flowRankPeriodForIndicator(indicator), code, name: stringField(row, ['名称', 'name', 'Name']), main_net: numberField(row, [`${prefix}主力净流入-净额`]), main_pct: numberField(row, [`${prefix}主力净流入-净占比`]), super_large_net: numberField(row, [`${prefix}超大单净流入-净额`]), super_large_pct: numberField(row, [`${prefix}超大单净流入-净占比`]), large_net: numberField(row, [`${prefix}大单净流入-净额`]), large_pct: numberField(row, [`${prefix}大单净流入-净占比`]), medium_net: numberField(row, [`${prefix}中单净流入-净额`]), medium_pct: numberField(row, [`${prefix}中单净流入-净占比`]), source, raw_json: safeJson(row) }
}

function normalizeAkshareQuoteSnapshotRow(row: Record<string, unknown>, request: IngestionRequest, source: string): QuoteSnapshotRow | null {
  const code = cleanCode(stringField(row, ['代码', 'code', 'Code'])); if (!code) return null
  const fetchedAt = new Date().toISOString()
  return { code, timestamp: normalizeSnapshotTimestamp(row) ?? fetchedAt, fetched_at: fetchedAt, source, name: stringField(row, ['名称', 'name', 'Name']) ?? code, price: numberField(row, ['最新价', '收盘', 'price', 'Price']), change: numberField(row, ['涨跌额', 'change', 'Change']), change_pct: numberField(row, ['涨跌幅', 'changePct', 'change_pct']), open: numberField(row, ['今开', '开盘', 'open', 'Open']), high: numberField(row, ['最高', 'high', 'High']), low: numberField(row, ['最低', 'low', 'Low']), prev_close: numberField(row, ['昨收', 'prevClose', 'prev_close', 'PreClose']), volume: numberField(row, ['成交量', 'volume', 'Volume']), amount: numberField(row, ['成交额', 'amount', 'Amount']), pe: numberField(row, ['市盈率-动态', 'pe']), pb: numberField(row, ['市净率', 'pb']), market_cap: numberField(row, ['总市值', 'market_cap']), turnover_rate: numberField(row, ['换手率', 'turnover_rate']), raw_json: safeJson(row) }
}

function normalizeAkshareGlobalSpotQuoteRow(row: Record<string, unknown>, source: string, market: 'HK' | 'US'): QuoteSnapshotRow | null {
  const code = stringField(row, ['代码', 'code', 'Code']); if (!code) return null
  const fetchedAt = new Date().toISOString()
  return { code: String(code).trim(), timestamp: normalizeSnapshotTimestamp(row) ?? fetchedAt, fetched_at: fetchedAt, source, name: stringField(row, ['名称', 'name', 'Name']) ?? String(code).trim(), price: numberField(row, ['最新价', '收盘', 'price', 'Price']), change: numberField(row, ['涨跌额', 'change', 'Change']), change_pct: numberField(row, ['涨跌幅', 'changePct', 'change_pct']), open: numberField(row, ['今开', '开盘价', '开盘', 'open', 'Open']), high: numberField(row, ['最高', '最高价', 'high', 'High']), low: numberField(row, ['最低', '最低价', 'low', 'Low']), prev_close: numberField(row, ['昨收', '昨收价', 'prevClose', 'prev_close', 'PreClose']), volume: numberField(row, ['成交量', 'volume', 'Volume']), amount: numberField(row, ['成交额', 'amount', 'Amount']), pe: numberField(row, ['市盈率', '市盈率-动态', 'pe']), pb: numberField(row, ['市净率', 'pb']), market_cap: numberField(row, ['总市值', 'market_cap']), turnover_rate: numberField(row, ['换手率', 'turnover_rate']), raw_json: safeJson({ ...row, market }) }
}

function normalizeAkshareSpotStockListRow(row: Record<string, unknown>, market: 'A' | 'HK' | 'US'): Record<string, unknown> | null {
  const code = stringField(row, ['代码', 'code', 'Code']); const name = stringField(row, ['名称', 'name', 'Name'])
  if (!code || !name) return null
  return { code: market === 'A' ? cleanCode(code) : String(code).trim(), name: String(name).trim(), market: market === 'A' ? normalizeTdxStockMarket(cleanCode(code) ?? '') : market, industry: null, list_date: null, delist_date: null, stock_type: 'stock', updated_at: new Date().toISOString() }
}

function normalizeStockIdentityRow(row: Record<string, unknown>, includeIndustry = false): Record<string, unknown> | null {
  const code = cleanCode(stringField(row, ['代码', 'SECURITY_CODE', 'code', 'Code', 'SECUCODE']) ?? '')
  const name = stringField(row, ['名称', 'SECURITY_NAME_ABBR', 'name', 'Name'])
  if (!code || !name) return null
  return { code, name: String(name).trim(), market: normalizeTdxStockMarket(code), industry: includeIndustry ? stringField(row, ['所属行业', '行业', 'industry']) : null, list_date: null, delist_date: null, stock_type: 'stock', updated_at: new Date().toISOString() }
}

function normalizeAkshareKlineRow(row: Record<string, unknown>, request: IngestionRequest, source: string): KlineRow | null {
  const code = cleanCode(String(request.code ?? request.params?.symbol ?? row['股票代码'] ?? row.code ?? row.Code ?? ''))
  const date = normalizeDate(stringField(row, ['日期', 'date']))
  if (!code || !date) return null
  const open = numberField(row, ['开盘', 'open', 'Open']); const close = numberField(row, ['收盘', 'close', 'Close']); const high = numberField(row, ['最高', 'high', 'High']); const low = numberField(row, ['最低', 'low', 'Low'])
  if (open == null || close == null || high == null || low == null) return null
  return { code, date, open, high, low, close, volume: numberField(row, ['成交量', 'volume', 'Volume']), amount: numberField(row, ['成交额', 'amount', 'Amount']), change_pct: numberField(row, ['涨跌幅', 'change_pct']), turnover_rate: numberField(row, ['换手率', 'turnover_rate']), adjust: normalizeAdjust(request.params?.adjust), source }
}

function normalizeDragonTigerRow(row: Record<string, unknown>, request: IngestionRequest, source: string): Record<string, unknown> | null {
  const code = stringField(row, ['代码', 'code', 'Code', 'SECURITY_CODE', 'SECCODE']); if (!code) return null
  return { date: normalizeDate(row['日期'] ?? row.TRADE_DATE ?? request.params?.date) ?? today(), code, name: stringField(row, ['名称', 'name', 'Name', 'SECURITY_NAME_ABBR', 'SECURITY_NAME']), reason: stringField(row, ['上榜原因', 'reason', 'REASON', 'EXPLAIN']) ?? '', buy_amt: numberField(row, ['买入额', 'buyAmt', 'BUY', 'BUY_AMT', 'EXPLAIN_BUY']), sell_amt: numberField(row, ['卖出额', 'sellAmt', 'SELL', 'SELL_AMT', 'EXPLAIN_SELL']), net_amt: numberField(row, ['净买额', 'netAmt', 'NET_BUY', 'NET_BUY_AMT']), accum_amount: numberField(row, ['成交额', 'accumAmount', 'ACCUM_AMOUNT', 'BILLBOARD_AMOUNT']), source, raw_json: safeJson(row) }
}
