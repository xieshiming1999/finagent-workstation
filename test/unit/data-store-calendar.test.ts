import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { queryTradeCalendar } from '../../src/agent/tools/data-store-tool-query-core-funds'

describe('DataStore calendar persistence', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-calendar-store-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('writes trade calendar rows and coverage readback for Data Manager', () => {
    store.saveCalendar([
      { date: '2026-06-12', market: 'CN', is_trading_day: 1, year: 2026, month: 6 },
      { date: '2026-06-13', market: 'CN', is_trading_day: 0, year: 2026, month: 6 },
    ])

    expect(store.query('SELECT COUNT(*) as count FROM trade_calendar')[0]).toMatchObject({ count: 2 })
    expect(store.getAllCoverage('calendar')[0]).toMatchObject({
      code: 'CN',
      data_type: 'calendar',
      earliest_date: '2026-06-12',
      latest_date: '2026-06-13',
      row_count: 2,
    })
  })

  it('exposes full calendar coverage separately from a limited default page', () => {
    const rows: Array<Record<string, unknown>> = []
    let date = new Date('2026-01-05T00:00:00Z')
    while (date <= new Date('2026-12-31T00:00:00Z')) {
      const yyyyMmDd = date.toISOString().slice(0, 10)
      rows.push({
        date: yyyyMmDd,
        market: 'CN',
        is_trading_day: date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0 : 1,
        year: 2026,
        month: date.getUTCMonth() + 1,
      })
      date = new Date(date.getTime() + 24 * 60 * 60 * 1000)
    }
    store.saveCalendar(rows)

    const summary = queryTradeCalendar(store, { market: 'CN', limit: 100 })
    expect(summary).toContain('coverage:2026-01-05..2026-12-31')
    expect(summary).toContain(`coverageRows:${rows.length}`)
    expect(summary).toContain('pageRows:100')
    expect(summary).toContain('asOf:2026-12-31')
    expect(summary).not.toContain('asOf:2026-04-')

    const exact = queryTradeCalendar(store, { market: 'CN', date: '2026-07-10' })
    expect(exact).toContain('2026-07-10 CN open')
    expect(exact).toContain('coverage:2026-01-05..2026-12-31')
  })
})
