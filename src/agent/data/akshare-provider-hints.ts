export type AkshareProvider = 'eastmoney'

export const EASTMONEY_AKSHARE_FUNCTIONS = new Set([
  'stock_zt_pool_em',
  'stock_zt_pool_dtgc_em',
  'stock_zt_pool_strong_em',
  'stock_zt_pool_zbgc_em',
  'stock_board_industry_name_em',
  'stock_board_concept_name_em',
  'stock_board_industry_cons_em',
  'stock_hsgt_hold_stock_em',
  'stock_hsgt_hist_em',
  'stock_hot_rank_em',
  'stock_individual_fund_flow',
  'stock_individual_fund_flow_rank',
  'stock_changes_em',
  'stock_zh_index_spot_em',
  'stock_zh_index_daily_em',
  'stock_zh_a_spot_em',
  'stock_zh_a_hist',
  'stock_hk_spot_em',
  'stock_us_spot_em',
  'stock_individual_info_em',
  'fund_open_fund_rank_em',
  'fund_open_fund_info_em',
  'fund_portfolio_hold_em',
  'fund_manager_em',
  'fund_etf_spot_em',
  'fund_etf_hist_em',
])

export function providerForAkshareFunc(func: string): AkshareProvider | undefined {
  return EASTMONEY_AKSHARE_FUNCTIONS.has(func) ? 'eastmoney' : undefined
}

export function providerForAksharePath(path: string): AkshareProvider | undefined {
  if (!path.startsWith('/akshare/')) return undefined
  const func = path.replace('/akshare/', '').split('?')[0]
  return providerForAkshareFunc(func)
}
