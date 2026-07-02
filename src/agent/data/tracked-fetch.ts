import { globalRateLimiter, globalCircuitBreaker, globalApiStats, fetchWithRetry } from './resilience'
import { DEFAULT_PROVIDER_TIMEOUT_MS, EASTMONEY_RUNTIME_TIMEOUT_MS } from './provider-timeouts'

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
]

function randomUA(): string {
  return UAS[Math.floor(Math.random() * UAS.length)]
}

function detectSource(url: string): string {
  if (url.includes('eastmoney.com')) return 'eastmoney'
  if (url.includes('sinajs.cn')) return 'sina'
  if (url.includes('yahoo.com')) return 'yahoo'
  if (url.includes('tradingview.com')) return 'tradingview'
  if (url.includes('tushare.pro')) return 'tushare'
  if (url.includes('wind.com.cn')) return 'wind'
  return 'other'
}

function defaultHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': randomUA(),
  }
  if (url.includes('eastmoney.com')) {
    headers.Referer = 'https://quote.eastmoney.com/'
    headers.Accept = 'application/json,text/plain,*/*'
    headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8'
    headers.Connection = 'close'
  }
  return headers
}

export async function trackedFetch(url: string, opts?: RequestInit, timeoutMs?: number): Promise<Response> {
  const source = detectSource(url)
  const effectiveTimeoutMs = timeoutMs ?? (source === 'eastmoney' ? EASTMONEY_RUNTIME_TIMEOUT_MS : DEFAULT_PROVIDER_TIMEOUT_MS)

  if (globalCircuitBreaker.isOpen(source)) {
    throw new Error(`Circuit open for ${source}`)
  }

  await globalRateLimiter.wait()
  const start = Date.now()

  try {
    const retries = source === 'eastmoney' ? 5 : 3
    const res = await fetchWithRetry(url, {
      ...opts,
      headers: {
        ...defaultHeaders(url),
        ...(opts?.headers as Record<string, string> | undefined),
      },
    }, retries, effectiveTimeoutMs)

    const durationMs = Date.now() - start
    globalCircuitBreaker.recordSuccess(source)
    globalApiStats.record({
      source, url: url.split('?')[0], status: res.status,
      durationMs, success: res.ok, timestamp: new Date().toISOString(),
    })
    return res
  } catch (err) {
    const durationMs = Date.now() - start
    globalCircuitBreaker.recordFailure(source)
    globalApiStats.record({
      source, url: url.split('?')[0], status: 0,
      durationMs, success: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    })
    throw err
  }
}

export async function trackedFetchJSON(url: string, opts?: RequestInit, timeoutMs?: number): Promise<unknown> {
  const res = await trackedFetch(url, opts, timeoutMs)
  return res.json()
}

export { globalApiStats, globalCircuitBreaker }
