import { describe, expect, it } from 'vitest'
import {
  pulseCategoryLabel,
  pulseHotValueLabel,
  pulseRankChangeLabel,
  pulseRegimeLabel,
  pulseSecondaryText,
} from '../../src/renderer/components/market-pulse-format'
import type { SnapshotLeaderItem } from '../../src/agent/data/market-snapshot'
import { useLanguageStore } from '../../src/renderer/store/useLanguageStore'

describe('market pulse formatting helpers', () => {
  useLanguageStore.setState({ mode: 'zh-CN', resolved: 'zh-CN' })

  it('labels derivative items clearly', () => {
    expect(pulseCategoryLabel('derivative')).toBe('衍生品')
  })

  it('uses explanation as secondary text when present', () => {
    const item: SnapshotLeaderItem = {
      code: 'OPT1',
      name: '科创板50沽6月1250',
      displayName: '科创50 沽权 1250',
      changePct: 233.33,
      category: 'derivative',
      instrumentType: 'option',
      explanation: '期权沽 | 6月到期 | 行权价 1250',
      isFiltered: true,
    }

    expect(pulseSecondaryText(item)).toContain('行权价 1250')
  })

  it('returns null when no extra explanation is needed', () => {
    const item: SnapshotLeaderItem = {
      code: 'BK0475',
      name: '白酒',
      displayName: '白酒',
      changePct: 4.23,
      category: 'industry',
      instrumentType: 'sector',
      isFiltered: false,
    }

    expect(pulseSecondaryText(item)).toBeNull()
  })

  it('hides IPO classifier explanation from visible pulse rows', () => {
    const item: SnapshotLeaderItem = {
      code: 'N001',
      name: 'N新股',
      displayName: 'N新股',
      changePct: 120,
      category: 'ipo',
      instrumentType: 'ipo',
      explanation: 'IPO / recent-listing style instrument',
      isFiltered: true,
    }

    expect(pulseSecondaryText(item)).toBeNull()
  })

  it('formats regime and hot-stock labels in chinese', () => {
    expect(pulseRegimeLabel('bullish')).toBe('强势')
    expect(pulseHotValueLabel(125000)).toContain('12.5万')
    expect(pulseRankChangeLabel(-3)).toBe('排名下降 3')
  })
})
