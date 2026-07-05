import { describe, expect, it } from 'vitest'
import {
  displaySourcePriority,
  normalizeSourcePriority,
  parseSourcePriorityInput,
  serializeSourcePriorityInput,
} from '../../src/renderer/panels/data-feed-priority-model'

describe('data feed source priority model', () => {
  it('parses JSON, comma, arrow, and whitespace separated provider lists', () => {
    expect(parseSourcePriorityInput('["tdx","eastmoney","tdx"]')).toEqual(['tdx', 'eastmoney'])
    expect(parseSourcePriorityInput('tdx, eastmoney akshare')).toEqual(['tdx', 'eastmoney', 'akshare'])
    expect(parseSourcePriorityInput('tdx -> eastmoney -> akshare')).toEqual(['tdx', 'eastmoney', 'akshare'])
  })

  it('serializes editable input to the feed config JSON format', () => {
    expect(serializeSourcePriorityInput('tdx, eastmoney')).toBe('["tdx","eastmoney"]')
  })

  it('formats stored priority for display and preserves invalid text for repair', () => {
    expect(displaySourcePriority('["akshare","tushare"]')).toBe('akshare -> tushare')
    expect(displaySourcePriority('{bad')).toBe('{bad')
  })

  it('normalizes blank and duplicate provider ids', () => {
    expect(normalizeSourcePriority(['', 'tdx', 'tdx', ' eastmoney '])).toEqual(['tdx', 'eastmoney'])
  })
})
