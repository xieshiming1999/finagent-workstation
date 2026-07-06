import { describe, expect, it } from 'vitest'
import {
  buildNewsFeedSummary,
  buildNewsProvenanceTooltip,
  filterNewsRows,
  isHeadlineOnlyNews,
  newsFetchedAt,
  newsSourceTime,
  newsBodyText,
  newsUrl,
  normalizeNewsUrl,
} from '../../src/renderer/components/news-feed-model'

describe('news feed URL handling', () => {
  it('keeps valid http and https URLs', () => {
    expect(normalizeNewsUrl(' https://example.com/article?id=1 ')).toBe('https://example.com/article?id=1')
    expect(normalizeNewsUrl('http://example.com/news')).toBe('http://example.com/news')
  })

  it('normalizes protocol-relative provider URLs to https', () => {
    expect(normalizeNewsUrl('//finance.example.com/a')).toBe('https://finance.example.com/a')
  })

  it('falls back from an invalid url field to a valid link field', () => {
    expect(newsUrl({ title: 'headline', url: 'about:blank', link: 'https://example.com/fallback' })).toBe('https://example.com/fallback')
  })

  it('rejects empty, relative, and unsafe URLs', () => {
    expect(normalizeNewsUrl('')).toBe('')
    expect(normalizeNewsUrl('/relative/path')).toBe('')
    expect(normalizeNewsUrl('javascript:alert(1)')).toBe('')
    expect(normalizeNewsUrl('file:///tmp/news.html')).toBe('')
    expect(newsUrl({ title: 'headline', url: 'about:blank', link: '/fallback' })).toBe('')
  })

  it('classifies headline-only rows and exposes useful body text when enrichment exists', () => {
    expect(isHeadlineOnlyNews({ title: '标普500指数转涨' })).toBe(true)
    expect(newsBodyText({ title: 'headline', summary: 'short summary', content: 'long content' })).toBe('short summary')
    expect(isHeadlineOnlyNews({ title: 'headline', content: 'full article text' })).toBe(false)
  })

  it('filters and summarizes feed rows across content, source, and symbols', () => {
    const rows = [
      { title: 'A-share rally', source: 'eastmoney', relatedSymbols: ['600519'] },
      { title: 'ETF flows', source: 'fund', summary: '沪深300 ETF inflow' },
      { title: 'Macro', source: 'wind', content: 'credit impulse update' },
    ]

    expect(filterNewsRows(rows, '沪深300').map((item) => item.title)).toEqual(['ETF flows'])
    expect(filterNewsRows(rows, '600519').map((item) => item.title)).toEqual(['A-share rally'])
    expect(buildNewsFeedSummary(rows)).toMatchObject({ state: 'mixed', sources: 3, headlineOnly: 1, enriched: 2 })
    expect(buildNewsFeedSummary([])).toMatchObject({ state: 'empty' })
    expect(buildNewsFeedSummary([{ title: 'Only a headline' }])).toMatchObject({ state: 'headline-only' })
    expect(buildNewsFeedSummary([{ title: 'Full', summary: 'body' }])).toMatchObject({ state: 'enriched' })
  })

  it('builds route-level provenance for news rows', () => {
    const item = {
      title: '市场新闻',
      source: 'sina',
      published_at: '2026-06-24T09:30:00.000Z',
      fetched_at: '2026-06-24T09:31:00.000Z',
    }
    const tooltip = buildNewsProvenanceTooltip(item, {
      interfaceId: 'news.finance_feed',
      capabilityId: 'sina.news.finance_feed',
      provider: 'sina',
      canonicalSchema: 'finance_news',
      canonicalTable: 'finance_news',
      cacheStatus: 'cache-hit',
    }, {
      interface: 'interface',
      provider: 'provider',
      capability: 'capability',
      schema: 'schema',
      table: 'table',
      cache: 'cache',
      dataTime: 'data time',
      fetched: 'retrieved at',
    })

    expect(newsSourceTime(item)).toBe('2026-06-24T09:30:00.000Z')
    expect(newsFetchedAt(item)).toBe('2026-06-24T09:31:00.000Z')
    expect(tooltip).toContain('interface: news.finance_feed')
    expect(tooltip).toContain('provider: sina')
    expect(tooltip).toContain('capability: sina.news.finance_feed')
    expect(tooltip).toContain('schema: finance_news')
    expect(tooltip).toContain('table: finance_news')
    expect(tooltip).toContain('cache: cache-hit')
    expect(tooltip).toContain('data time: 2026-06-24T09:30:00.000Z')
    expect(tooltip).toContain('retrieved at: 2026-06-24T09:31:00.000Z')
  })
})
