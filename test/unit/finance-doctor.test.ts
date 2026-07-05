import { describe, expect, it, vi } from 'vitest'
import { buildFinanceDoctorReport } from '../../src/main/finance-doctor'
import type { DataStore } from '../../src/agent/data/store/data-store'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/main/sidecar', () => ({
  getSidecarUrl: () => null,
  getGotdxUrl: () => null,
}))

function fakeStore(opts: {
  ready?: boolean
  recentApiCalls?: Array<Record<string, unknown>>
  taskRows?: Array<Record<string, unknown>>
  staleRows?: Array<Record<string, unknown>>
  reusable?: Array<{ name: string; count: number; latest: string | null }>
  feeds?: Array<Record<string, unknown>>
} = {}): DataStore {
  return {
    isReady: opts.ready ?? true,
    getRecentApiCalls: () => opts.recentApiCalls ?? [],
    query: (sql: string) => {
      if (sql.includes('FROM fetch_tasks GROUP BY status')) return opts.taskRows ?? []
      if (sql.includes('FROM fetch_tasks') && sql.includes('GROUP BY status')) return opts.taskRows ?? []
      if (sql.includes('created_at < ?')) return opts.staleRows ?? [{ count: 0, oldest: null }]
      return []
    },
    getReusableDataSummary: () => opts.reusable ?? [
      { name: 'stock_list', count: 20, latest: '2026-06-15' },
      { name: 'fund_list', count: 10, latest: '2026-06-15' },
      { name: 'quote_snapshot', count: 30, latest: '2026-06-15T09:30:00.000Z' },
      { name: 'kline_daily', count: 100, latest: '2026-06-14' },
    ],
    getFeedConfigs: () => opts.feeds ?? [],
  } as unknown as DataStore
}

describe('finance doctor report', () => {
  it('returns critical when DataStore is not initialized', () => {
    const report = buildFinanceDoctorReport({ dataStore: fakeStore({ ready: false }) })

    expect(report.status).toBe('critical')
    expect(report.checks).toEqual([
      expect.objectContaining({ id: 'datastore', status: 'critical' }),
    ])
  })

  it('flags recent API failures, failed tasks, missing caches, and stopped services without live probes', () => {
    const report = buildFinanceDoctorReport({
      dataStore: fakeStore({
        recentApiCalls: [
          { source: 'eastmoney', success: 0, status: 0, failure_class: 'transport', error: 'network/proxy blocked upstream request' },
          { source: 'eastmoney', success: 0, status: 0, failure_class: 'contract_mismatch', error: 'provider contract mismatch' },
          { source: 'tdx', success: 1 },
        ],
        taskRows: [
          { status: 'failed', count: 1 },
          { status: 'pending', count: 2 },
        ],
        staleRows: [{ count: 1, oldest: '2026-06-15T09:00:00.000Z' }],
        reusable: [
          { name: 'stock_list', count: 0, latest: null },
          { name: 'fund_list', count: 5, latest: '2026-06-15' },
          { name: 'quote_snapshot', count: 0, latest: null },
          { name: 'kline_daily', count: 8, latest: '2026-06-14' },
        ],
        feeds: [
          { enabled: 1, status: 'failed', last_error: 'timeout' },
          { enabled: 0, status: 'idle', last_error: null },
        ],
      }),
    })

    expect(report.status).toBe('warning')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'api_failures', status: 'warning' }),
      expect.objectContaining({ id: 'queue', status: 'warning' }),
      expect.objectContaining({ id: 'stock_identity', status: 'warning' }),
      expect.objectContaining({ id: 'quote_cache', status: 'warning' }),
      expect.objectContaining({ id: 'feeds', status: 'warning' }),
      expect.objectContaining({ id: 'schema_registry', status: 'ok' }),
      expect.objectContaining({ id: 'desktop_services', status: 'warning' }),
    ]))
    const queue = report.checks.find((check) => check.id === 'queue')!
    expect(queue.detail).toContain('1 stale active')
    expect(queue.metrics?.stale).toBe(1)
    const apiFailures = report.checks.find((check) => check.id === 'api_failures')!
    expect(apiFailures.metrics?.classes).toBe('transport:1, contract_mismatch:1')
    expect(apiFailures.detail).toContain('classes transport:1, contract_mismatch:1')
  })

  it('keeps provider routes healthy when gated professional sources are absent but public fallbacks exist', () => {
    const report = buildFinanceDoctorReport({ dataStore: fakeStore() })

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_routes', status: 'ok' }),
    ]))
  })

  it('does not count waiting, missing-scope, or recovered stale feed states as actionable failures', () => {
    const report = buildFinanceDoctorReport({
      dataStore: fakeStore({
        feeds: [
          { enabled: 1, status: 'waiting_prerequisite', last_error: 'Feed 基金持仓 is waiting for prerequisite data: fund_list is required to resolve all-fund feed scope. The target feed has not run yet.' },
          { enabled: 1, status: 'idle', last_error: 'Feed 基金持仓 needs codes. Add items to the related watchlist or set scope_codes.' },
          { enabled: 1, status: 'failed', last_error: 'manual data-feed verification recovered stale active task' },
          { enabled: 0, status: 'failed', last_error: 'All providers failed' },
        ],
      }),
    })

    const feeds = report.checks.find((check) => check.id === 'feeds')!
    expect(feeds.status).toBe('ok')
    expect(feeds.detail).toContain('0 actionable error')
    expect(feeds.detail).toContain('3 waiting/non-actionable')
    expect(feeds.metrics).toMatchObject({ enabled: 3, total: 4, failed: 0, ignored: 3 })
  })

  it('checks runtime path and session/history recoverability without mutating directories', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-doctor-runtime-'))
    try {
      mkdirSync(join(basePath, 'sessions', 'history'), { recursive: true })
      mkdirSync(join(basePath, 'sessions', 'archive'), { recursive: true })
      writeFileSync(join(basePath, 'sessions', 'current.jsonl'), '', 'utf-8')

      const report = buildFinanceDoctorReport({ dataStore: fakeStore(), basePath })

      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'runtime_paths', status: 'ok' }),
        expect.objectContaining({ id: 'session_history', status: 'ok' }),
        expect.objectContaining({ id: 'session_index', status: 'warning' }),
      ]))
      expect(report.checks.find((check) => check.id === 'session_index')?.detail).toContain('missing')
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('warns when session/history paths are missing under an otherwise valid runtime root', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-doctor-runtime-'))
    try {
      const report = buildFinanceDoctorReport({ dataStore: fakeStore(), basePath })

      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'runtime_paths', status: 'ok' }),
        expect.objectContaining({ id: 'session_history', status: 'warning' }),
      ]))
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })
})
