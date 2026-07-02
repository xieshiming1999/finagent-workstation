export interface ApiFailureClass {
  classification: string
  count: number
  examples: string[]
}

export function classifyApiFailures(rows: Array<Record<string, unknown>>): ApiFailureClass[] {
  const groups = new Map<string, ApiFailureClass>()
  for (const row of rows) {
    const classification = classifyApiFailure(row)
    const group = groups.get(classification) ?? { classification, count: 0, examples: [] }
    group.count += 1
    const endpoint = String(row.endpoint ?? row.url ?? row.action ?? '-')
    const error = String(row.error ?? row.status ?? '').slice(0, 120)
    if (group.examples.length < 3) group.examples.push(`${endpoint}${error ? `: ${error}` : ''}`)
    groups.set(classification, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

export function classifyApiFailure(row: Record<string, unknown>): string {
  const explicit = explicitFailureClass(row.failureClass ?? row.failure_class ?? row.classification)
  if (explicit) return explicit
  const status = Number(row.status ?? row.statusCode)
  if (status === 401 || status === 403) return 'auth_permission'
  if (status === 429) return 'quota_rate_limit'
  if (status === 400 || status === 422) return 'invalid_parameters'
  if (status === 0) return 'transport'
  if (status >= 500) return 'provider_outage'
  return 'unknown'
}

export function shouldStopProviderRetries(row: Record<string, unknown>): boolean {
  const classification = classifyApiFailure(row)
  return classification === 'auth_permission' || classification === 'quota_rate_limit'
}

export function isFinanceApiFailure(row: Record<string, unknown>): boolean {
  const domain = String(row.domain ?? row.category ?? '').toLowerCase().trim()
  if (domain === 'finance' || domain === 'market_data') return true
  const source = String(row.source ?? '').toLowerCase().trim()
  const financeSources = new Set([
    'akshare',
    'data_task',
    'eastmoney',
    'gotdx',
    'sidecar',
    'tdx',
    'tradingview',
    'tushare',
    'wind',
    'windmcp',
    'yahoo',
    'yfinance',
  ])
  if (financeSources.has(source)) return true
  const tool = String(row.tool ?? '').trim()
  if (new Set(['DataStore', 'MarketData', 'WindMcp']).has(tool)) return true
  try {
    const endpoint = new URL(String(row.endpoint ?? row.url ?? ''), 'http://localhost')
    return endpoint.pathname.startsWith('/api/finance/')
  } catch {
    return false
  }
}

function explicitFailureClass(value: unknown): string | null {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'auth_permission':
    case 'credential-or-permission': return 'auth_permission'
    case 'quota_rate_limit':
    case 'quota-or-rate-limit': return 'quota_rate_limit'
    case 'contract_mismatch':
    case 'schema-or-contract': return 'contract_mismatch'
    case 'invalid_parameters':
    case 'invalid-parameters': return 'invalid_parameters'
    case 'transport':
    case 'timeout':
    case 'transport-unstable': return 'transport'
    case 'provider_outage':
    case 'provider-error':
    case 'provider_unavailable': return 'provider_outage'
    case 'unknown': return 'unknown'
    default: return null
  }
}
