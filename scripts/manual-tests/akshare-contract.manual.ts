import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { latestTradingDay, type TradingCalendar } from '../../src/main/trading-calendar'

const SIDECAR_URL = process.env.AKSHARE_SIDECAR_URL ?? 'http://127.0.0.1:19800'
const TEST_DATE = process.env.AKSHARE_TEST_DATE ?? compactDateString(latestTradingDay(emptyTradingCalendar(), new Date()))
const DELAY_MS = Number(process.env.AKSHARE_PROBE_DELAY_MS ?? 3000)
const TIMEOUT_MS = Number(process.env.AKSHARE_PROBE_TIMEOUT_MS ?? 75000)
const OUT_DIR = process.env.AKSHARE_PROBE_OUT_DIR ?? join(homedir(), '.finagent-workstation', 'manual-tests', 'akshare')

interface Probe {
  id: string
  endpoint: string
  params?: Record<string, string>
  required?: boolean
}

const PROBES: Probe[] = [
  { id: 'limit_up', endpoint: '/akshare/stock_zt_pool_em', params: { date: TEST_DATE, _priority: 'background', _provider: 'eastmoney' }, required: true },
  { id: 'limit_down', endpoint: '/akshare/stock_zt_pool_dtgc_em', params: { date: TEST_DATE, _priority: 'background', _provider: 'eastmoney' }, required: true },
  { id: 'industry_board', endpoint: '/akshare/stock_board_industry_name_em', params: { _priority: 'background', _provider: 'eastmoney' }, required: true },
  { id: 'concept_board', endpoint: '/akshare/stock_board_concept_name_em', params: { _priority: 'background', _provider: 'eastmoney' } },
  { id: 'northbound_hold', endpoint: '/akshare/stock_hsgt_hold_stock_em', params: { market: '北向', indicator: '今日排行', _priority: 'background', _provider: 'eastmoney' }, required: true },
  { id: 'hot_rank', endpoint: '/akshare/stock_hot_rank_em', params: { _priority: 'background', _provider: 'eastmoney' } },
  { id: 'fund_flow_rank', endpoint: '/akshare/stock_individual_fund_flow_rank', params: { indicator: '今日', _priority: 'background', _provider: 'eastmoney' } },
  { id: 'index_spot', endpoint: '/akshare/stock_zh_index_spot_em', params: { _priority: 'background', _provider: 'eastmoney' }, required: true },
]

describe('manual AkShare source contract', () => {
  it('probes AkShare endpoints serially and stores response shapes', async () => {
    const report: Record<string, unknown> = {
      sidecarUrl: SIDECAR_URL,
      testDate: TEST_DATE,
      delayMs: DELAY_MS,
      timeoutMs: TIMEOUT_MS,
      startedAt: new Date().toISOString(),
      probes: [],
    }

    const health = await request('/health', {})
    report.health = health

    for (let i = 0; i < PROBES.length; i++) {
      if (i > 0 && DELAY_MS > 0) await sleep(DELAY_MS)
      const probe = PROBES[i]
      const result = await request(probe.endpoint, probe.params ?? {})
      ;(report.probes as unknown[]).push({
        id: probe.id,
        endpoint: probe.endpoint,
        params: probe.params ?? {},
        required: Boolean(probe.required),
        ...result,
      })
    }

    report.finishedAt = new Date().toISOString()
    const outFile = writeReport(report)
    console.log(JSON.stringify({ outFile, summary: summarize(report) }, null, 2))

    expect((report.probes as unknown[]).length).toBe(PROBES.length)
    expect((health as { ok?: boolean }).ok).toBe(true)
  }, 10 * 60_000)
})

async function request(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params)
  const url = `${SIDECAR_URL}${endpoint}${qs.size > 0 ? '?' + qs : ''}`
  const started = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const bodyText = await res.text()
    const parsed = parseJson(bodyText)
    const data = (parsed as { data?: unknown } | null)?.data
    const rows = Array.isArray(data) ? data : Array.isArray(parsed) ? parsed : []
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - started,
      provider: (parsed as { provider?: unknown } | null)?.provider,
      rowCount: rows.length,
      columns: Array.isArray((parsed as { columns?: unknown } | null)?.columns) ? (parsed as { columns: unknown[] }).columns : Object.keys((rows[0] ?? {}) as Record<string, unknown>),
      schema: schemaOf(rows[0]),
      sample: rows[0] ?? parsed,
      error: res.ok ? undefined : errorOf(parsed, bodyText),
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      rowCount: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function errorOf(value: unknown, fallback: string): string {
  const err = (value as { error?: unknown } | null)?.error
  return err ? String(err) : fallback.slice(0, 500)
}

function schemaOf(row: unknown): Record<string, string> {
  if (!row || typeof row !== 'object') return {}
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value]))
}

function writeReport(report: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `akshare-contract-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8')
  return file
}

function summarize(report: Record<string, unknown>): Array<Record<string, unknown>> {
  return ((report.probes as Array<Record<string, unknown>>) ?? []).map((probe) => ({
    id: probe.id,
    ok: probe.ok,
    status: probe.status,
    durationMs: probe.durationMs,
    rowCount: probe.rowCount,
    error: probe.error,
  }))
}

function compactDateString(date: string): string {
  return date.replaceAll('-', '')
}

function emptyTradingCalendar(): TradingCalendar {
  return {
    version: 1,
    dataYear: null,
    lastFetched: null,
    tradingDayCount: 0,
    tradingDays: [],
    overrides: {},
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
