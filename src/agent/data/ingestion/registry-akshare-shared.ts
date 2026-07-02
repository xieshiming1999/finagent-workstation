export {
  cleanCode,
  flowRankPeriodForIndicator,
  normalizeAdjust,
  normalizeDate,
  normalizeEventTime,
  normalizeSnapshotTimestamp,
  normalizeTdxStockMarket,
  numberField,
  outputOnlyResult,
  quoteSnapshotFromRecord,
  result,
  safeJson,
  stringField,
  today,
} from './registry-common'

export function normalizeFundHoldingReportDate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const quarter = trimmed.match(/^(\d{4})Q([1-4])$/i)
  if (quarter) {
    const quarterEnd = { '1': '03-31', '2': '06-30', '3': '09-30', '4': '12-31' } as const
    return `${quarter[1]}-${quarterEnd[quarter[2] as keyof typeof quarterEnd]}`
  }
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  return trimmed
}
