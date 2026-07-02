export type FundCategory = 'money' | 'backend' | 'bond' | 'etf' | 'index' | 'fof' | 'qdii' | 'reits' | 'ordinary' | 'unknown'

export function normalizeFundCategory(input: { fund_type?: unknown; type?: unknown; name?: unknown; fund_category?: unknown; fundCategory?: unknown }): FundCategory {
  const existing = String(input.fund_category ?? input.fundCategory ?? '').trim().toLowerCase()
  if (isFundCategory(existing)) return existing
  const text = [input.fund_type, input.type, input.name].map((value) => String(value ?? '').toLowerCase()).join(' ')
  if (!text.trim()) return 'unknown'
  if (text.includes('后端') || text.includes('backend')) return 'backend'
  if (text.includes('货币') || text.includes('money') || text.includes('monetary') || text.includes('现金')) return 'money'
  if (text.includes('债') || text.includes('bond')) return 'bond'
  if (text.includes('etf')) return 'etf'
  if (text.includes('指数') || text.includes('index')) return 'index'
  if (text.includes('fof')) return 'fof'
  if (text.includes('qdii')) return 'qdii'
  if (text.includes('reit')) return 'reits'
  return 'ordinary'
}

export function isFundCategory(value: string): value is FundCategory {
  return ['money', 'backend', 'bond', 'etf', 'index', 'fof', 'qdii', 'reits', 'ordinary', 'unknown'].includes(value)
}

export function supportsOrdinaryFundNav(category: unknown): boolean {
  return !['money', 'backend', 'unknown'].includes(String(category ?? 'unknown'))
}

export function supportsMoneyFundYield(category: unknown): boolean {
  return String(category ?? '') === 'money'
}

