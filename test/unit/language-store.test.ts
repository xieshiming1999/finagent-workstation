import { describe, expect, it } from 'vitest'
import { normalizeMode, useLanguageStore, widgetTitle } from '../../src/renderer/store/useLanguageStore'

describe('language store', () => {
  it('normalizes unsupported config values to system', () => {
    expect(normalizeMode(undefined)).toBe('system')
    expect(normalizeMode('fr')).toBe('system')
    expect(normalizeMode('en')).toBe('en')
  })

  it('localizes widget titles from the resolved language', () => {
    useLanguageStore.setState({ mode: 'en', resolved: 'en' })
    expect(widgetTitle('pulse')).toBe('Stock Market Pulse')
    expect(widgetTitle('research')).toBe('Research Workspace')

    useLanguageStore.setState({ mode: 'zh-CN', resolved: 'zh-CN' })
    expect(widgetTitle('pulse')).toBe('股票市场脉搏')
    expect(widgetTitle('research')).toBe('研究工作台')
  })
})
