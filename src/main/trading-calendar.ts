import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import type { DataStore } from '../agent/data/store/data-store'
import { fetchTradeCalendar, type CalendarRow } from '../agent/data/fetchers/fetcher-calendar'

export interface TradingCalendar {
  version: number
  dataYear: number | null
  lastFetched: string | null
  tradingDayCount: number
  tradingDays: string[]
  overrides: Record<string, boolean>
}

const EMPTY_CALENDAR: TradingCalendar = {
  version: 1,
  dataYear: null,
  lastFetched: null,
  tradingDayCount: 0,
  tradingDays: [],
  overrides: {},
}

export function loadCalendar(basePath: string): TradingCalendar {
  const filePath = join(basePath, 'trading_calendar.json')

  if (!existsSync(filePath)) {
    const defaultPath = join(__dirname, '../../assets/trading_calendar_default.json')
    if (existsSync(defaultPath)) {
      mkdirSync(basePath, { recursive: true })
      copyFileSync(defaultPath, filePath)
    } else {
      return { ...EMPTY_CALENDAR }
    }
  }

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return {
      ...EMPTY_CALENDAR,
      ...data,
      overrides: data.overrides ?? {},
    }
  } catch {
    return { ...EMPTY_CALENDAR }
  }
}

export function saveCalendar(basePath: string, calendar: TradingCalendar): void {
  const filePath = join(basePath, 'trading_calendar.json')
  mkdirSync(basePath, { recursive: true })
  writeFileSync(filePath, JSON.stringify(calendar, null, 2), 'utf-8')
}

export function isTradingDay(calendar: TradingCalendar, dateStr: string): boolean {
  if (dateStr in calendar.overrides) return calendar.overrides[dateStr]
  if (calendar.tradingDays.length > 0) return calendar.tradingDays.includes(dateStr)
  const d = new Date(dateStr)
  const day = d.getDay()
  return day >= 1 && day <= 5
}

export function latestTradingDay(calendar: TradingCalendar, now = new Date()): string {
  const today = localDateString(now)
  const explicitDays = calendar.tradingDays
    .filter((day) => day <= today && isTradingDay(calendar, day))
    .sort()
  if (explicitDays.length > 0) return explicitDays[explicitDays.length - 1]

  const cursor = new Date(now)
  for (let i = 0; i < 14; i++) {
    const day = localDateString(cursor)
    if (isTradingDay(calendar, day)) return day
    cursor.setDate(cursor.getDate() - 1)
  }
  return today
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type TradeCalendarFetcher = typeof fetchTradeCalendar

export async function refreshCalendarFromDataApi(
  basePath: string,
  store: DataStore | null,
  year: number,
  fetcher: TradeCalendarFetcher = fetchTradeCalendar,
): Promise<TradingCalendar | null> {
  if (!store?.isReady) return null

  const result = await fetcher(year, 'CN', {
    provider: 'szse',
    providerMode: 'strict',
    allowFallback: false,
    cacheMode: 'live-only',
  })
  if (result.data.length === 0) return null

  store.saveCalendar(result.data as unknown as Array<Record<string, unknown>>)

  const rows = store.queryCalendar({
    market: 'CN',
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    limit: 400,
  }) as unknown as CalendarRow[]
  const tradingDays = rows
    .filter((row) => Number(row.is_trading_day) === 1)
    .map((row) => String(row.date))
    .sort()

  if (tradingDays.length === 0) return null

  const calendar = loadCalendar(basePath)
  calendar.dataYear = year
  calendar.tradingDays = tradingDays
  calendar.tradingDayCount = tradingDays.length
  calendar.lastFetched = result.fetchedAt ?? new Date().toISOString()
  saveCalendar(basePath, calendar)
  return calendar
}
