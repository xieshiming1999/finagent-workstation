import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

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
})
