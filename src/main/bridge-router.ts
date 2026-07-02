import { routeFinanceRequest } from '../domain/market/services/bridge-finance-route-service'

let bridgeBasePath = ''
let bridgeGetConfigValue: ((key: string) => unknown) | undefined

export function configureBridgeRouter(input: {
  basePath: string
  getConfigValue?: (key: string) => unknown
}): void {
  bridgeBasePath = input.basePath
  bridgeGetConfigValue = input.getConfigValue
}

export async function routeRequest(path: string, params: Record<string, unknown>, method: string, headers?: Record<string, string>): Promise<unknown> {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return directFetch(path, params, method, headers)
  }

  if (path.startsWith('/api/finance/')) {
    const normalized = normalizeApiPath(path, params)
    return routeFinanceRequest(normalized.path, normalized.params, {
      basePath: bridgeBasePath,
      getConfigValue: bridgeGetConfigValue,
    })
  }

  return { error: `Unknown API path: ${path}` }
}

function normalizeApiPath(path: string, params: Record<string, unknown>): { path: string; params: Record<string, unknown> } {
  const queryIndex = path.indexOf('?')
  if (queryIndex < 0) return { path, params }
  const merged: Record<string, unknown> = {}
  const search = path.slice(queryIndex + 1)
  for (const [key, value] of new URLSearchParams(search)) {
    merged[key] = value
  }
  return {
    path: path.slice(0, queryIndex),
    params: { ...merged, ...(params ?? {}) },
  }
}

async function directFetch(url: string, params: Record<string, unknown>, method: string, headers?: Record<string, string>): Promise<unknown> {
  try {
    const opts: RequestInit = { method, headers: { 'User-Agent': 'FinAgent/1.0', ...(headers ?? {}) } }
    if (method === 'POST') {
      opts.headers = { ...opts.headers as Record<string, string>, 'Content-Type': 'application/json' }
      opts.body = JSON.stringify(params)
    } else if (Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params as Record<string, string>).toString()
      url = `${url}?${qs}`
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(url, { ...opts, signal: controller.signal })
    clearTimeout(timeout)
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('json')) return await res.json()
    return { text: await res.text() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
