import type { ApiCallLogRow, ApiResultCacheRow, FundamentalRow, IndexMomentumRow, KlineRow, QuoteSnapshotRow, XdxrEventRow } from '../store/data-store'

export type QuoteSnapshot = QuoteSnapshotRow
export type KlineBar = KlineRow
export type FundamentalFact = FundamentalRow
export type XdxrEvent = XdxrEventRow
export type IndexMomentum = IndexMomentumRow
export type ApiCallLog = ApiCallLogRow
export type ApiResultCacheEntry = ApiResultCacheRow

export interface SectorRanking {
  date: string
  sector_type: string
  code: string
  name: string
  change_pct: number | null
  turnover_rate: number | null
  up_count: number | null
  down_count: number | null
  leading_stock: string | null
  leading_pct: number | null
  rank: number | null
  source: string | null
}

export interface MoneyFlow {
  code: string
  date: string
  main_net: number | null
  small_net: number | null
  medium_net: number | null
  large_net: number | null
  super_large_net: number | null
  close_price: number | null
  change_pct: number | null
  source: string | null
}

export interface LimitPoolItem {
  date: string
  code: string
  name: string | null
  limit_type: string
  change_pct: number | null
  first_limit_time: string | null
  last_limit_time: string | null
  open_count: number | null
  limit_reason: string | null
  continuous_days: number | null
  source: string | null
}
