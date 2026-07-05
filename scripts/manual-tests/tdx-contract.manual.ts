import { describe, expect, it } from 'vitest'
import { normalizeTdxEndpoint, tdxList, tdxMarketForCode } from '../../src/agent/data/normalizers/tdx-normalizer'

const GOTDX_URL = process.env.GOTDX_URL ?? 'http://127.0.0.1:19801'
const CODE = process.env.TDX_CODE ?? '600519'
const INDEX_CODE = process.env.TDX_INDEX_CODE ?? '000001'
const INDEX_BARS_CODE = process.env.TDX_INDEX_BARS_CODE ?? '399001'
const DELAY_MS = Number(process.env.TDX_PROBE_DELAY_MS ?? 1500)

interface Probe {
  stage: string
  endpoint: string
  params: Record<string, string>
  canonical: boolean
  expectedCode?: string
  minRows?: number
}

const PROBES: Probe[] = [
  { stage: 'stock-quote', endpoint: 'quote', params: { code: CODE, market: tdxMarketForCode(CODE) }, canonical: true, expectedCode: CODE, minRows: 1 },
  { stage: 'stock-kline', endpoint: 'kline', params: { code: CODE, market: tdxMarketForCode(CODE), category: '9', count: '20' }, canonical: true, expectedCode: CODE, minRows: 10 },
  { stage: 'index-info-validated', endpoint: 'index_info', params: tdxIndexParams(INDEX_CODE), canonical: true, expectedCode: publicIndexCode(INDEX_CODE), minRows: 1 },
  { stage: 'index-bars-validated', endpoint: 'index_bars', params: { code: INDEX_BARS_CODE, market: tdxMarketForCode(INDEX_BARS_CODE, true), category: '9', count: '20' }, canonical: true, expectedCode: INDEX_BARS_CODE, minRows: 5 },
  { stage: 'index-momentum-validated', endpoint: 'index_momentum', params: tdxIndexParams(INDEX_CODE), canonical: false },
  { stage: 'tick-chart', endpoint: 'tick_chart', params: { code: CODE }, canonical: false },
  { stage: 'transactions', endpoint: 'transactions', params: { code: CODE, count: '20' }, canonical: false },
  { stage: 'finance', endpoint: 'finance', params: { code: CODE }, canonical: false },
  { stage: 'stock-list', endpoint: 'stock_list_range', params: { market: '1', start: '0', count: '20' }, canonical: false },
]

describe('manual TDX source contract', () => {
  it('retrieves TDX through FinAgent Workstation sidecar in serial stages and validates endpoint contracts', async () => {
    const reports: Array<Record<string, unknown>> = []
    const abnormalities: string[] = []

    await waitForHealth()

    for (let i = 0; i < PROBES.length; i++) {
      if (i > 0 && DELAY_MS > 0) await sleep(DELAY_MS)
      const probe = PROBES[i]
      let raw: unknown
      try {
        raw = await fetchJsonWithRetry(probe)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        reports.push({ stage: probe.stage, endpoint: probe.endpoint, canonical: probe.canonical, error: message })
        if (probe.canonical) abnormalities.push(`${probe.endpoint}: ${message}`)
        continue
      }
      const normalized = normalizeTdxEndpoint(probe.endpoint, raw, probe.params)
      const rawRows = tdxList(raw)
      const data = Array.isArray(normalized.data) ? normalized.data : []
      const report = {
        stage: probe.stage,
        endpoint: probe.endpoint,
        canonical: probe.canonical,
        rawRows: rawRows.length,
        normalizedRows: data.length,
        schema: normalized.schema,
        warning: normalized.warning,
        sample: data[0] ?? rawRows[0] ?? raw,
      }
      reports.push(report)

      if (probe.canonical) {
        if (normalized.normalized !== true) abnormalities.push(`${probe.endpoint}: not normalized`)
        if (data.length < (probe.minRows ?? 1)) abnormalities.push(`${probe.endpoint}: normalized rows ${data.length} < ${probe.minRows ?? 1}`)
        if (probe.expectedCode && String((data[0] as Record<string, unknown> | undefined)?.code ?? '') !== probe.expectedCode) {
          abnormalities.push(`${probe.endpoint}: expected code ${probe.expectedCode}, received ${String((data[0] as Record<string, unknown> | undefined)?.code ?? '')}`)
        }
        if (rawRows.length > 0 && data.length < rawRows.length) abnormalities.push(`${probe.endpoint}: rejected ${rawRows.length - data.length}/${rawRows.length} raw rows`)
      }
    }

    console.log(JSON.stringify({ gotdxUrl: GOTDX_URL, code: CODE, indexCode: INDEX_CODE, indexBarsCode: INDEX_BARS_CODE, delayMs: DELAY_MS, reports, abnormalities }, null, 2))
    expect(abnormalities).toEqual([])
  }, 60_000)
})

async function fetchJson(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${GOTDX_URL}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function fetchJsonWithRetry(probe: Probe): Promise<unknown> {
  const attempts = probe.canonical ? 2 : 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && DELAY_MS > 0) await sleep(DELAY_MS)
    try {
      return await fetchJson(probe.endpoint, probe.params)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${GOTDX_URL}/health`, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) return
    } catch {}
    await sleep(300)
  }
  throw new Error(`gotdx health check failed: ${GOTDX_URL}/health`)
}

function tdxIndexParams(code: string): Record<string, string> {
  if (code === '000001') return { code: '000001', market: '1' }
  return { code, market: tdxMarketForCode(code, true) }
}

function publicIndexCode(code: string): string {
  return code === '999999' ? '000001' : code
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
