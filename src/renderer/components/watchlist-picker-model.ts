export interface StockSuggestion {
  code: string
  name: string
  market: string
  price?: number | null
  changePct?: number | null
}

export interface FundSuggestion {
  code: string
  name: string
  fund_type?: string | null
  company?: string | null
  manager?: string | null
  nav?: number | null
  nav_date?: string | null
  daily_return?: number | null
  return_1y?: number | null
  return_3y?: number | null
  return_ytd?: number | null
}

export function stockPickerRows(
  query: string,
  suggestions: StockSuggestion[],
  hotSuggestions: StockSuggestion[],
  existingCodes: Set<string>,
): { showSearch: boolean; searchRows: StockSuggestion[]; visibleHot: StockSuggestion[] } {
  const cleanSuggestions = suggestions.filter((item) => item.code && !existingCodes.has(item.code))
  const cleanHot = hotSuggestions.filter((item) => item.code && !existingCodes.has(item.code))
  const showSearch = query.trim().length >= 2
  const lowerQuery = query.trim().toLowerCase()
  const matchingHot = showSearch
    ? cleanHot.filter((item) => matchesStock(item, lowerQuery))
    : []
  const searchRows = mergeByCode(cleanSuggestions, matchingHot)
  const visibleHot = showSearch
    ? cleanHot.filter((item) => !matchingHot.some((match) => match.code === item.code))
    : cleanHot
  return { showSearch, searchRows, visibleHot }
}

export function stockPickerPrimarySelection(
  query: string,
  suggestions: StockSuggestion[],
  hotSuggestions: StockSuggestion[],
  existingCodes: Set<string>,
): StockSuggestion | undefined {
  const rows = stockPickerRows(query, suggestions, hotSuggestions, existingCodes)
  return rows.searchRows[0] ?? rows.visibleHot[0]
}

export function fundPickerRows(
  query: string,
  suggestions: FundSuggestion[],
  cachedSuggestions: FundSuggestion[],
  existingCodes: Set<string>,
): { isSearching: boolean; rows: FundSuggestion[] } {
  const text = query.trim()
  const isSearching = text.length >= 2
  const cleanSuggestions = suggestions.filter((fund) => fund.code && !existingCodes.has(fund.code))
  const cleanCached = cachedSuggestions.filter((fund) => fund.code && !existingCodes.has(fund.code))
  const matchingCached = isSearching ? cleanCached.filter((fund) => matchesFund(fund, text)) : []
  const rows = isSearching ? mergeByCode(cleanSuggestions, matchingCached) : cleanCached
  return { isSearching, rows }
}

export function fundPickerPrimarySelection(
  query: string,
  suggestions: FundSuggestion[],
  cachedSuggestions: FundSuggestion[],
  existingCodes: Set<string>,
): FundSuggestion | undefined {
  return fundPickerRows(query, suggestions, cachedSuggestions, existingCodes).rows[0]
}

export function matchesFund(fund: FundSuggestion, query: string): boolean {
  const lower = query.toLowerCase()
  return [
    fund.code,
    fund.name,
    fund.company,
    fund.manager,
    fund.fund_type,
  ].some((value) => String(value ?? '').toLowerCase().includes(lower))
}

function matchesStock(item: StockSuggestion, lowerQuery: string): boolean {
  return item.code.includes(lowerQuery) ||
    item.name.toLowerCase().includes(lowerQuery) ||
    stripMarketPrefix(item.name).toLowerCase().includes(lowerQuery)
}

function stripMarketPrefix(name: string): string {
  return name.replace(/^[NCU]/i, '')
}

function mergeByCode<T extends { code: string }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set<string>()
  const rows: T[] = []
  for (const item of [...primary, ...secondary]) {
    if (!item.code || seen.has(item.code)) continue
    seen.add(item.code)
    rows.push(item)
  }
  return rows
}
