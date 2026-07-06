import { describe, expect, it } from 'vitest'
import {
  fundPickerPrimarySelection,
  fundPickerRows,
  matchesFund,
  stockPickerPrimarySelection,
  stockPickerRows,
} from '../../src/renderer/components/watchlist-picker-model'

describe('watchlist picker model', () => {
  it('matches cached hot stocks by base name even when the exchange display name has an IPO prefix', () => {
    const result = stockPickerRows(
      '永大',
      [],
      [
        { code: '001239', name: 'N永大', market: 'SZ', price: 42.5, changePct: 154.94 },
        { code: '600519', name: '贵州茅台', market: 'SH' },
      ],
      new Set(),
    )

    expect(result.showSearch).toBe(true)
    expect(result.searchRows).toEqual([
      { code: '001239', name: 'N永大', market: 'SZ', price: 42.5, changePct: 154.94 },
    ])
    expect(result.visibleHot.map((item) => item.code)).toEqual(['600519'])
  })

  it('deduplicates typed stock search results against hot suggestions and hides existing watchlist codes', () => {
    const result = stockPickerRows(
      '600',
      [
        { code: '600519', name: '贵州茅台', market: 'SH' },
        { code: '600036', name: '招商银行', market: 'SH' },
      ],
      [
        { code: '600519', name: '贵州茅台', market: 'SH', price: 1260, changePct: 1 },
        { code: '600000', name: '浦发银行', market: 'SH' },
      ],
      new Set(['600036']),
    )

    expect(result.searchRows.map((item) => item.code)).toEqual(['600519', '600000'])
    expect(result.visibleHot).toEqual([])
  })

  it('selects cached hot stock matches for enter when IPC search has not returned them', () => {
    const selected = stockPickerPrimarySelection(
      '永大',
      [],
      [
        { code: '001239', name: 'N永大', market: 'SZ', price: 42.5, changePct: 154.94 },
      ],
      new Set(),
    )

    expect(selected?.code).toBe('001239')
  })

  it('uses cached fund suggestions when idle and searchable cached rows when typing', () => {
    const cached = [
      { code: '110022', name: '易方达消费行业', company: '易方达基金', return_1y: 12 },
      { code: '000001', name: '华夏成长混合', company: '华夏基金', return_1y: 3 },
    ]

    expect(fundPickerRows('', [], cached, new Set(['000001'])).rows.map((fund) => fund.code)).toEqual(['110022'])
    expect(fundPickerRows('消费', [], cached, new Set()).rows.map((fund) => fund.code)).toEqual(['110022'])
  })

  it('selects cached fund matches for enter when IPC search has not returned them', () => {
    const selected = fundPickerPrimarySelection(
      '消费',
      [],
      [
        { code: '110022', name: '易方达消费行业', company: '易方达基金', return_1y: 12 },
      ],
      new Set(),
    )

    expect(selected?.code).toBe('110022')
  })

  it('matches fund search across code, name, company, manager, and type', () => {
    const fund = { code: '110022', name: '易方达消费行业', company: '易方达基金', manager: '张三', fund_type: '股票型' }

    expect(matchesFund(fund, '1100')).toBe(true)
    expect(matchesFund(fund, '消费')).toBe(true)
    expect(matchesFund(fund, '易方达')).toBe(true)
    expect(matchesFund(fund, '张三')).toBe(true)
    expect(matchesFund(fund, '股票')).toBe(true)
  })
})
