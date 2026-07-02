export type FinanceDataTask =
  | 'quote'
  | 'indexQuote'
  | 'kline'
  | 'indexKline'
  | 'intradayTick'
  | 'sector'
  | 'limitPool'
  | 'dragonTiger'
  | 'fundamental'
  | 'macro'
  | 'fund'
  | 'moneyFlow'

export type FinanceProvider =
  | 'tdx'
  | 'eastmoneyDirect'
  | 'akshare'
  | 'wind'
  | 'tushare'
  | 'sina'
  | 'tencent'
  | 'yfinance'

export interface ProviderGates {
  windConfigured?: boolean
  windQuotaAvailable?: boolean
  tushareConfigured?: boolean
  tusharePermissionLikely?: boolean
  allowAkshareCompatibility?: boolean
  allowBroadAkshare?: boolean
  temporarilyBlockedProviders?: FinanceProvider[]
}

const orders: Record<FinanceDataTask, FinanceProvider[]> = {
  quote: ['tdx', 'eastmoneyDirect', 'akshare'],
  indexQuote: ['tdx', 'sina', 'akshare'],
  kline: ['tdx', 'eastmoneyDirect', 'akshare'],
  indexKline: ['tdx', 'eastmoneyDirect', 'akshare'],
  intradayTick: ['tdx'],
  sector: ['eastmoneyDirect', 'akshare', 'tdx'],
  limitPool: ['eastmoneyDirect', 'akshare'],
  dragonTiger: ['eastmoneyDirect'],
  fundamental: ['wind', 'tushare', 'eastmoneyDirect', 'tdx'],
  macro: ['wind', 'tushare', 'akshare'],
  fund: ['eastmoneyDirect', 'akshare', 'wind'],
  moneyFlow: ['eastmoneyDirect', 'akshare', 'wind'],
}

export function providerOrder(
  task: FinanceDataTask,
  gates: ProviderGates = {},
  preferredProviders: FinanceProvider[] = [],
): FinanceProvider[] {
  const {
    windConfigured = false,
    windQuotaAvailable = true,
    tushareConfigured = false,
    tusharePermissionLikely = true,
    allowAkshareCompatibility = true,
    temporarilyBlockedProviders = [],
  } = gates
  const blocked = new Set(temporarilyBlockedProviders)
  const allowed = orders[task].filter((provider) => {
    if (blocked.has(provider)) return false
    if (provider === 'wind') return windConfigured && windQuotaAvailable
    if (provider === 'tushare')
      return tushareConfigured && tusharePermissionLikely
    if (provider === 'akshare') return allowAkshareCompatibility
    return true
  })
  if (preferredProviders.length === 0) return allowed
  const preferred = preferredProviders.filter((provider) => allowed.includes(provider))
  return preferred.length > 0 ? preferred : allowed
}

export function normalizeFinanceProviders(values: unknown): FinanceProvider[] {
  const raw = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? parseProviderString(values)
      : []
  const providers: FinanceProvider[] = []
  const seen = new Set<FinanceProvider>()
  for (const item of raw) {
    const provider = normalizeProviderName(String(item))
    if (!provider || seen.has(provider)) continue
    seen.add(provider)
    providers.push(provider)
  }
  return providers
}

function parseProviderString(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
    } catch {
      return []
    }
  }
  return text.split(/(?:->|→|,|\s+)/).map((item) => item.trim()).filter(Boolean)
}

function normalizeProviderName(value: string): FinanceProvider | null {
  const key = value.trim()
  if (!key) return null
  if (key === 'eastmoney') return 'eastmoneyDirect'
  if (key === 'yahoo') return 'yfinance'
  if (key === 'tdx' || key === 'eastmoneyDirect' || key === 'akshare' || key === 'wind' ||
      key === 'tushare' || key === 'sina' || key === 'tencent' || key === 'yfinance') {
    return key
  }
  return null
}

export function requiresSerialCalls(provider: FinanceProvider): boolean {
  return (
    provider === 'akshare' ||
    provider === 'eastmoneyDirect' ||
    provider === 'sina' ||
    provider === 'tencent' ||
    provider === 'wind' ||
    provider === 'tushare'
  )
}

export function broadAkshareAllowed(gates: ProviderGates = {}): boolean {
  return gates.allowBroadAkshare === true
}
