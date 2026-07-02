export interface KlineRow {
  code: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  amount: number | null
  change_pct: number | null
  turnover_rate: number | null
  adjust: string
  source: string | null
}

export interface StockInfo {
  code: string
  name: string
  market: string
  industry: string | null
  list_date: string | null
  delist_date: string | null
  stock_type: string
  updated_at: string
}

export interface FundamentalRow {
  code: string
  report_date: string
  pe_ttm: number | null
  pb: number | null
  roe: number | null
  revenue_yoy: number | null
  profit_yoy: number | null
  market_cap: number | null
  [key: string]: unknown
}

export interface DataCoverage {
  code: string
  data_type: string
  earliest_date: string | null
  latest_date: string | null
  row_count: number
  last_updated: string | null
}

export interface FeedConfig {
  feed_id: string
  display_name: string
  feed_type: string
  enabled: number
  scope: string
  scope_codes: string | null
  history_years: number
  update_frequency: string
  trigger_time: string
  source_priority: string
  status: string
  last_run_at: string | null
  last_error: string | null
  config_json: string | null
  updated_at: string | null
}

export interface ApiCallLogRow {
  source: string
  provider?: string | null
  interface_id?: string | null
  capability_id?: string | null
  tool?: string | null
  action?: string | null
  endpoint?: string | null
  status?: number | null
  success: boolean
  failure_class?: string | null
  duration_ms?: number | null
  error?: string | null
  created_at?: string
}

export interface ApiResultCacheRow {
  source: string
  tool: string
  action: string
  request_hash: string
  request_json: string
  response_json: string | null
  is_error: boolean
  created_at: string
  expires_at: string
}

export interface QuoteSnapshotRow {
  code: string
  timestamp?: string
  fetched_at?: string | null
  source: string
  name?: string | null
  price?: number | null
  change?: number | null
  change_pct?: number | null
  open?: number | null
  high?: number | null
  low?: number | null
  prev_close?: number | null
  volume?: number | null
  amount?: number | null
  pe?: number | null
  pb?: number | null
  market_cap?: number | null
  turnover_rate?: number | null
  raw_json?: string | null
}

export interface WindDocumentRow {
  doc_id: string
  tool: string
  query?: string | null
  title?: string | null
  publisher?: string | null
  published_at?: string | null
  url?: string | null
  summary?: string | null
  entity_code?: string | null
  entity_name?: string | null
  source: string
  updated_at: string
  raw_json?: string | null
}

export interface WindEconomicSeriesRow {
  series_key: string
  metric_query: string
  metric_name: string
  metric_code?: string | null
  date: string
  value_num?: number | null
  value_text?: string | null
  unit?: string | null
  frequency?: string | null
  currency?: string | null
  source: string
  updated_at: string
  raw_json?: string | null
}

export interface WindAnalyticsResultRow {
  result_id: string
  question: string
  entity_code?: string | null
  entity_name?: string | null
  value_date?: string | null
  title?: string | null
  content?: string | null
  value_num?: number | null
  value_text?: string | null
  unit?: string | null
  source: string
  updated_at: string
  raw_json?: string | null
}

export interface FinanceNewsRow {
  news_id: string
  title?: string | null
  summary?: string | null
  content?: string | null
  publisher?: string | null
  published_at?: string | null
  url?: string | null
  source: string
  fetched_at: string
  raw_json?: string | null
}

export interface MarketScreeningSnapshotRow {
  provider: string
  capability_id: string
  source_action: string
  symbol: string
  screened_at: string
  fetched_at: string
  name?: string | null
  market?: string | null
  rank?: number | null
  score?: number | null
  universe_json?: string | null
  filters_json?: string | null
  sort_json?: string | null
  fields_json?: string | null
  raw_json?: string | null
}

export interface MarginTradingRow {
  trade_date: string
  code: string
  provider: string
  fetched_at: string
  name?: string | null
  capability_id?: string | null
  source_action?: string | null
  financing_buy?: number | null
  financing_balance?: number | null
  margin_sell_volume?: number | null
  margin_balance_volume?: number | null
  margin_balance?: number | null
  total_balance?: number | null
  raw_json?: string | null
}

export interface TechnicalIndicatorSeriesRow {
  provider: string
  capability_id: string
  source_action: string
  symbol: string
  indicator: string
  field_name: string
  params_hash: string
  source_date: string
  value: number | null
  fetched_at: string
  params_json?: string | null
  raw_json?: string | null
}

export interface AlphaFactorRow {
  provider: string
  capability_id: string
  source_action: string
  symbol: string
  factor_name: string
  params_hash: string
  source_date: string
  value: number | null
  bars?: number | null
  fetched_at: string
  params_json?: string | null
  raw_json?: string | null
}

export interface StockShareholderRow {
  code: string
  report_date: string
  holder_name: string
  holder_type: string
  rank?: number | null
  hold_shares?: number | null
  hold_pct?: number | null
  share_nature?: string | null
  announcement_date?: string | null
  shareholder_note?: string | null
  shareholder_count?: number | null
  average_holding?: number | null
  source: string
  fetched_at: string
  raw_json?: string | null
}

export interface FundPerformanceMetricRow {
  code: string
  metric_date: string
  provider: string
  capability_id: string
  source_action: string
  nav?: number | null
  return_ytd?: number | null
  return_1w?: number | null
  return_1m?: number | null
  return_3m?: number | null
  return_6m?: number | null
  return_1y?: number | null
  return_2y?: number | null
  return_3y?: number | null
  return_since_inception?: number | null
  fetched_at: string
  raw_json?: string | null
}

export interface IndexConstituentRow {
  index_code: string
  stock_code: string
  stock_name?: string | null
  weight?: number | null
  as_of_date: string
  provider: string
  capability_id?: string | null
  source_action?: string | null
  fetched_at: string
  raw_json?: string | null
}

export interface ExCategoryRow {
  category: number
  name: string
  abbr?: string | null
  source?: string | null
  updated_at: string
  raw_json?: string | null
}

export interface XdxrEventRow {
  code: string
  event_date: string
  category: number
  source: string
  fetched_at: string
  category_name?: string | null
  a?: number | null
  b?: number | null
  c?: number | null
  d?: number | null
  raw_json?: string | null
}

export interface AuctionSnapshotRow {
  code: string
  trade_date: string
  time: string
  sequence: number
  source: string
  fetched_at: string
  price?: number | null
  volume?: number | null
  raw_json?: string | null
}

export interface IndexMomentumRow {
  code: string
  trade_date: string
  sequence: number
  source: string
  fetched_at: string
  value?: number | null
  raw_json?: string | null
}

export interface TopBoardRow {
  board_date: string
  category: string
  side: string
  rank: number
  code: string
  source: string
  fetched_at: string
  market?: number | null
  price?: number | null
  value?: number | null
  raw_json?: string | null
}

export interface TdxSecurityCountRow {
  scope: string
  market: string
  source: string
  fetched_at: string
  count: number
  raw_json?: string | null
}

export interface TdxChartSamplingRow {
  scope: string
  code: string
  sequence: number
  source: string
  fetched_at: string
  market?: string | null
  category?: string | null
  pre_close?: number | null
  price?: number | null
  change?: number | null
  raw_json?: string | null
}

export interface ExTableEntryRow {
  entry_key: string
  category?: string | null
  code: string
  name?: string | null
  source: string
  updated_at: string
  raw_json?: string | null
}

export interface RawApiPayloadRow {
  source: string
  endpoint: string
  request_hash: string
  request_json: string
  response_json: string | null
  is_error: boolean
  created_at: string
  expires_at?: string | null
}
