import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { buildMarketSnapshot, saveSnapshot } from '../agent/data/market-snapshot'
import type { DataStore } from '../agent/data/store/data-store'
import { latestTradingDay, loadCalendar } from './trading-calendar'
import { startGotdx, startSidecar, stopGotdx } from './sidecar'

export function startAppServices(basePath: string, getDataStore?: () => DataStore | null): void {
  const appRoot = app.isPackaged ? process.resourcesPath : join(__dirname, '../..')

  startSidecar(appRoot, basePath).then((ok) => {
    if (ok) console.log('Python sidecar started on port 19800')
  })
  startGotdx(appRoot).then((ok) => {
    if (ok) console.log('gotdx sidecar started on port 19801')
  })

  setInterval(() => {
    console.log('[TDX] Daily connectivity re-test...')
    stopGotdx()
    startGotdx(appRoot).then((ok) => {
      if (ok) console.log('[TDX] Reconnected to best server')
    })
  }, 24 * 60 * 60 * 1000)

  const buildSnapshot = async () => {
    try {
      const tradingDate = latestTradingDay(loadCalendar(basePath))
      const snapshot = await buildMarketSnapshot(tradingDate, getDataStore?.() ?? null)
      saveSnapshot(basePath, snapshot)
    } catch { /* silent */ }
  }
  buildSnapshot()
  setInterval(buildSnapshot, 300_000)
}

export function reOpenWindowIfNeeded(createWindow: () => BrowserWindow): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
