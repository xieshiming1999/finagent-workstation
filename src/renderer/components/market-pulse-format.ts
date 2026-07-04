import type { SnapshotLeaderCategory, SnapshotLeaderItem } from '../../agent/data/market-snapshot'
import { t } from '../store/useLanguageStore'

export function pulseCategoryLabel(category: SnapshotLeaderCategory): string {
  switch (category) {
    case 'industry':
      return t('pulseIndustry')
    case 'concept':
      return t('pulseConcept')
    case 'area':
      return t('pulseArea')
    case 'derivative':
      return t('pulseDerivative')
    case 'ipo':
      return t('pulseIpo')
    default:
      return t('pulseOther')
  }
}

export function pulseSectionTitle(item: SnapshotLeaderItem): string {
  return item.isFiltered ? t('nonSectorMovers') : t('topSectors')
}

export function pulseSecondaryText(item: SnapshotLeaderItem): string | null {
  if (item.category === 'ipo') return null
  if (item.explanation) return item.explanation
  if (item.displayName !== item.name) return item.name
  return null
}

export function pulseRegimeLabel(regime: string): string {
  switch (regime) {
    case 'bullish':
      return t('bullish')
    case 'bearish':
      return t('bearish')
    default:
      return t('neutral')
  }
}

export function pulseHotValueLabel(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0) return `${t('pulseHeatLabel')} -`
  if (value >= 1e8) return `${t('pulseHeatLabel')} ${(value / 1e8).toFixed(1)}${t('hundredMillionUnit')}`
  if (value >= 1e4) return `${t('pulseHeatLabel')} ${(value / 1e4).toFixed(1)}${t('tenThousandUnit')}`
  return `${t('pulseHeatLabel')} ${Math.round(value)}`
}

export function pulseRankChangeLabel(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value === 0) return t('pulseRankFlat')
  return value > 0
    ? `${t('pulseRankUp')} ${value}`
    : `${t('pulseRankDown')} ${Math.abs(value)}`
}
