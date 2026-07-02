import type { DataStore } from '../store/data-store'
import { ingestAkshareOrEastMoney } from './registry-akshare-eastmoney'
import { ingestTdx } from './registry-tdx'
import { ingestTushare } from './registry-tushare'
import { ingestYfinance } from './registry-yfinance'
import { ingestSina } from './registry-sina'

export type IngestionProvider = 'tdx' | 'akshare' | 'eastmoney' | 'sina' | 'yfinance' | 'tushare'

export interface IngestionRequest {
  provider: IngestionProvider
  endpoint: string
  payload: unknown
  params?: Record<string, unknown>
  code?: string
  source?: string
  request?: Record<string, unknown>
}

export interface IngestionResult {
  persisted: boolean
  rawSaved: boolean
  provider: IngestionProvider
  endpoint: string
  schema: string
  table: string
  count: number
  warning?: string
}

export interface IngestionRegistryProviderSummary {
  provider: IngestionProvider
  endpoints: string[]
  schemas: string[]
  tables: string[]
}

const INGESTION_REGISTRY_SUMMARY: IngestionRegistryProviderSummary[] = [
  {
    provider: 'tdx',
    endpoints: [
      'quote',
      'mac/quotes',
      'ex/quote',
      'quotes',
      'ex/quotes',
      'quotes_list',
      'ex/quotes_list',
      'kline',
      'kline_advanced',
      'ex/kline',
      'ex/kline2',
      'index_bars',
      'stock_list',
      'stock_list_range',
      'ex/list',
      'ex/categories',
      'tick_chart',
      'history_tick_chart',
      'ex/tick_chart',
      'transactions',
      'history_transactions',
      'history_orders',
      'ex/history_transaction',
      'volume_profile',
      'finance',
      'auction',
      'unusual',
      'index_info',
      'index_momentum',
      'top_board',
      'block',
      'ex/board_list',
      'company_info',
      'company_content',
      'company_categories',
      'xdxr',
      'count',
      'ex/count',
      'chart_sampling',
      'ex/chart_sampling',
      'ex/table',
    ],
    schemas: [
      'quote_snapshot',
      'kline_daily',
      'stock_list',
      'tick_chart_intraday',
      'transactions',
      'volume_profile',
      'fundamental',
      'stock_company_info',
      'auction_snapshot',
      'unusual_activity',
      'tdx_index_momentum',
      'tdx_top_board',
      'tdx_block_member',
      'xdxr_event',
      'tdx_security_count',
      'tdx_chart_sampling',
      'ex_category',
      'ex_table_entry',
    ],
    tables: [
      'quote_snapshot',
      'kline_daily',
      'stock_list',
      'tick_chart_intraday',
      'transactions',
      'volume_profile',
      'fundamental',
      'stock_company_info',
      'auction_snapshot',
      'unusual_activity',
      'tdx_index_momentum',
      'tdx_top_board',
      'tdx_block_member',
      'xdxr_event',
      'tdx_security_count',
      'tdx_chart_sampling',
      'ex_category',
      'ex_table_entry',
    ],
  },
  {
    provider: 'akshare',
    endpoints: [
      'stock_zt_pool_em',
      'stock_zt_pool_dtgc_em',
      'stock_zt_pool_strong_em',
      'stock_zt_pool_zbgc_em',
      'stock_board_industry_name_em',
      'stock_board_concept_name_em',
      'stock_board_industry_cons_em',
      'stock_board_concept_cons_em',
      'stock_hot_rank_em',
      'stock_lhb_detail_daily_sina',
      'stock_hsgt_hist_em',
      'stock_hsgt_hold_stock_em',
      'holders',
      'fund_portfolio_hold_em',
      'fund_manager_em',
      'fund_open_fund_rank_em',
      'fund_open_fund_info_em',
      'stock_changes_em',
      'stock_individual_fund_flow',
      'stock_individual_fund_flow_rank',
      'stock_zh_a_spot',
      'stock_zh_a_spot_em',
      'stock_zh_index_spot_em',
      'stock_hk_spot_em',
      'stock_us_spot_em',
      'stock_zh_a_hist',
      'stock_zh_index_daily_em',
      'margin',
    ],
    schemas: [
      'limit_pool',
      'sector_ranking',
      'industry_map',
      'hot_rank',
      'dragon_tiger',
      'northbound_flow',
      'northbound_holding',
      'stock_shareholder',
      'fund_holding',
      'fund_manager',
      'fund_list',
      'fund_nav',
      'unusual_activity',
      'money_flow',
      'flow_rank',
      'quote_snapshot',
      'kline_daily',
      'margin_trading',
    ],
    tables: [
      'limit_pool',
      'sector_ranking',
      'industry_map',
      'hot_rank',
      'dragon_tiger',
      'northbound_flow',
      'northbound_holding',
      'stock_shareholder',
      'fund_holding',
      'fund_manager',
      'fund_list',
      'fund_nav',
      'unusual_activity',
      'money_flow',
      'flow_rank',
      'quote_snapshot',
      'kline_daily',
      'margin_trading',
    ],
  },
  {
    provider: 'eastmoney',
    endpoints: [
      'sector_ranking',
      'sector_cons',
      'hot_rank',
      'dragon_tiger',
      'northbound_flow',
      'northbound_holding',
      'limit_pool',
      'quote',
      'kline',
    ],
    schemas: [
      'sector_ranking',
      'industry_map',
      'hot_rank',
      'dragon_tiger',
      'northbound_flow',
      'northbound_holding',
      'limit_pool',
      'quote_snapshot',
      'kline_daily',
    ],
    tables: [
      'sector_ranking',
      'industry_map',
      'hot_rank',
      'dragon_tiger',
      'northbound_flow',
      'northbound_holding',
      'limit_pool',
      'quote_snapshot',
      'kline_daily',
    ],
  },
  {
    provider: 'yfinance',
    endpoints: [
      'fast_info',
      'history',
      'info',
      'get_info',
      'financials',
      'quarterly_financials',
      'income_stmt',
      'quarterly_income_stmt',
      'balance_sheet',
      'balancesheet',
      'quarterly_balance_sheet',
      'quarterly_balancesheet',
      'cash_flow',
      'cashflow',
      'quarterly_cash_flow',
      'quarterly_cashflow',
      'earnings_dates',
      'earnings_estimate',
      'earnings_history',
      'eps_revisions',
      'eps_trend',
      'recommendations',
      'recommendations_summary',
      'upgrades_downgrades',
      'news',
      'options',
      'option_chain',
      'actions',
      'dividends',
      'splits',
      'capital_gains',
      'institutional_holders',
      'mutualfund_holders',
      'major_holders',
      'insider_transactions',
    ],
    schemas: [
      'quote_snapshot',
      'kline_daily',
      'yfinance_profile_fields',
      'yfinance_statement_items',
      'yfinance_recommendations',
      'yfinance_news',
      'yfinance_option_expiries',
      'yfinance_option_contracts',
      'yfinance_corporate_actions',
      'yfinance_holders',
      'yfinance_insider_transactions',
    ],
    tables: [
      'quote_snapshot',
      'kline_daily',
      'yfinance_profile_fields',
      'yfinance_statement_items',
      'yfinance_recommendations',
      'yfinance_news',
      'yfinance_option_expiries',
      'yfinance_option_contracts',
      'yfinance_corporate_actions',
      'yfinance_holders',
      'yfinance_insider_transactions',
    ],
  },
  {
    provider: 'tushare',
    endpoints: [
      'stock_basic',
      'daily',
      'weekly',
      'monthly',
      'index_daily',
      'daily_basic',
      'trade_cal',
    ],
    schemas: [
      'stock_list',
      'kline_daily',
      'fundamental',
      'trade_calendar',
    ],
    tables: [
      'stock_list',
      'kline_daily',
      'fundamental',
      'trade_calendar',
    ],
  },
  {
    provider: 'sina',
    endpoints: ['stock_transactions'],
    schemas: ['transactions'],
    tables: ['transactions'],
  },
]

export function getIngestionRegistrySummary(): IngestionRegistryProviderSummary[] {
  return INGESTION_REGISTRY_SUMMARY.map((provider) => ({
    provider: provider.provider,
    endpoints: [...provider.endpoints],
    schemas: [...provider.schemas],
    tables: [...provider.tables],
  }))
}

export function ingestEndpointResult(store: DataStore, request: IngestionRequest): IngestionResult | null {
  const source = request.source ?? request.provider
  if (request.provider === 'tdx') return ingestTdx(store, request, source)
  if (request.provider === 'sina') return ingestSina(store, request, source)
  if (request.provider === 'yfinance') return ingestYfinance(store, request, source)
  if (request.provider === 'tushare') return ingestTushare(store, request, source)
  return ingestAkshareOrEastMoney(store, request, source)
}
