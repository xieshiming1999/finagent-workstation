import { describe, expect, it } from 'vitest'
import { assistantMessage, toolMessage, userMessage } from '../../src/agent/message'
import {
  buildFinanceRecovery,
  maybeBuildFinanceBoundedAnswer,
  maybeInterceptFinanceToolCalls,
} from '../../src/domain/finance/workflows/finance-workflow-hooks'

function macroStockUser(subject: string) {
  return userMessage(
    'macro stock analysis\n' +
    `data: ${JSON.stringify({ workflowState: {
      contract: 'finance-workflow-state-v1',
      workflowKind: 'macro_factor_lookup',
      assetClass: 'stock',
      intentMode: 'analysis',
      executionMode: 'preview_only',
      safetyBoundary: 'read-only macro attribution',
      evidenceRefs: [],
      confirmationState: 'none',
      subject,
      source: 'agent-structured-intent',
    } })}`,
  )
}

describe('macro evidence workflow summary', () => {
  it('adds governed attribution readback when macro evidence calls omit it', () => {
    const interception = maybeInterceptFinanceToolCalls([
      userMessage(
        'macro analysis\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"macro_attribution","assetClass":"stock","intentMode":"analysis","executionMode":"readback","safetyBoundary":"read-only macro attribution","confirmationState":"none","source":"agent-structured-intent"}}',
      ),
    ], [
      {
        id: 'factor',
        name: 'DataStore',
        input: { action: 'query_macro_factors', target: 'A-shares', family: 'rates_liquidity' },
      },
      {
        id: 'sources',
        name: 'DataStore',
        input: { action: 'macro_research_sources', category: 'rates_liquidity' },
      },
    ])

    expect(interception?.answer).toBeNull()
    expect(interception?.autoToolCalls).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ action: 'query_macro_factors' }) }),
      expect.objectContaining({ input: expect.objectContaining({ action: 'macro_research_sources' }) }),
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_macro_attribution', target: 'A-shares', limit: 10 },
      }),
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_macro_research_evidence', target: 'A-shares', limit: 10 },
      }),
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_finance_news', query: 'A-shares', limit: 10 },
      }),
    ])
  })

  it('answers from governed macro evidence before generic search or web fetch fallback', () => {
    const messages = [
      userMessage(
        'macro analysis\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"macro_attribution","assetClass":"stock","intentMode":"analysis","executionMode":"readback","safetyBoundary":"read-only macro attribution","confirmationState":"none","source":"agent-structured-intent"}}',
      ),
      assistantMessage('', [
        { id: 'factors', name: 'DataStore', input: { action: 'query_macro_factors', target: 'A-shares' } },
        { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: 'A-shares' } },
        { id: 'news', name: 'DataStore', input: { action: 'query_finance_news', query: 'A-shares' } },
        { id: 'content', name: 'DataStore', input: { action: 'query_macro_research_content', provider: 'pboc' } },
      ]),
      toolMessage('factors', JSON.stringify({
        action: 'query_macro_factors',
        status: 'ok',
        rows: [{
          title: '政策利率和流动性预期',
          family: 'rates_liquidity',
          source: 'pboc',
          sourceDataTime: '2026-07-01',
          affectedAssets: ['equity', 'fund', 'consumption funds', 'consumer equities', 'technology equities'],
          regions: ['China'],
          sectors: ['policy-sensitive sectors'],
          transmissionChannels: ['liquidity', 'risk_appetite'],
          expectedDirection: 'mixed',
        }],
      })),
      toolMessage('attr', JSON.stringify({
        action: 'query_macro_attribution',
        status: 'ok',
        rows: [{
          provider: 'macro_attribution',
          family: 'risk_appetite',
          status: 'hypothesis',
          limitation: '不能作为单独买卖条件',
        }],
      })),
      toolMessage('news', JSON.stringify({
        action: 'query_finance_news',
        status: 'ok',
        sourceDataTime: '2026-07-01T09:00:00.000Z',
        fetchedAt: '2026-07-09T06:00:00.000Z',
        count: 1,
        data: [{
          title: 'A-share policy news clue',
          source: 'akshare',
          published_at: '2026-07-01T09:00:00.000Z',
          url: 'https://example.com/news',
        }],
      })),
      toolMessage('content', JSON.stringify({
        action: 'query_macro_research_content',
        status: 'ok',
        contentEvidence: [{
          title: 'Monetary Policy Report',
          sourceName: 'PBOC',
          sourceDataTime: '2026-06-30',
          contentHash: 'abcdef1234567890',
          keyClaims: ['liquidity remains an important policy transmission channel'],
          bodyPreview: 'The official report discusses liquidity, credit and policy transmission.',
          evidenceTier: 'official_event_document',
          accessStatus: 'public',
          confidenceEffect: 'raises confidence',
          nextEvidenceAction: 'use cache/readback',
        }],
      })),
    ]

    const interception = maybeInterceptFinanceToolCalls(messages, [
      { id: 'search', name: 'Research', input: { action: 'news', query: 'A股 宏观 风险偏好' } },
    ])

    expect(interception?.autoToolCalls).toBeUndefined()
    expect(interception?.answer).toContain('受治理的宏观证据')
    expect(interception?.answer).toContain('政策利率和流动性预期')
    expect(interception?.answer).toContain('Monetary Policy Report')
    expect(interception?.answer).toContain('可靠性')
    expect(interception?.answer).toContain('新鲜度')
    expect(interception?.answer).toContain('资产影响')
    expect(interception?.answer).toContain('消费基金')
    expect(interception?.answer).toContain('科技基金')
    expect(interception?.answer).toContain('基金分类口径')
    expect(interception?.answer).toContain('置信度/下一步')
    expect(interception?.answer).toContain('tier=official_event_document')
    expect(interception?.answer).toContain('impact=mixed')
    expect(interception?.answer).toContain('Research/WebFetch')
  })

  it('adds attribution readback from prior macro evidence before generic fallback', () => {
    const messages = [
      userMessage('macro analysis'),
      assistantMessage('', [
        { id: 'factors', name: 'DataStore', input: { action: 'query_macro_factors', assets: 'bond funds' } },
      ]),
      toolMessage('factors', JSON.stringify({
        action: 'query_macro_factors',
        status: 'ok',
        rows: [{ title: 'FRED official series', family: 'macro_official_series' }],
      })),
    ]

    const interception = maybeInterceptFinanceToolCalls(messages, [
      { id: 'search', name: 'Research', input: { action: 'search', query: 'bond fund macro' } },
    ])

    expect(interception?.answer).toBeNull()
    expect(interception?.autoToolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_macro_attribution', target: 'A-shares', limit: 10 },
      }),
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_finance_news', query: 'A-shares', limit: 10 },
      }),
    ])
  })

  it('adds governed finance news refresh before readback in macro source workflows', () => {
    const interception = maybeInterceptFinanceToolCalls([
      userMessage(
        'macro refresh\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"macro_attribution","assetClass":"mixed","intentMode":"analysis","executionMode":"readback","safetyBoundary":"read-only macro attribution","confirmationState":"none","source":"agent-structured-intent"}}',
      ),
    ], [
      { id: 'sources', name: 'DataStore', input: { action: 'macro_research_sources', category: 'macro_news' } },
      { id: 'factors', name: 'DataStore', input: { action: 'query_macro_factors', target: 'A-shares', limit: 10 } },
      { id: 'news-readback', name: 'DataStore', input: { action: 'query_finance_news', query: 'A-shares', limit: 10 } },
    ])

    const actions = interception?.autoToolCalls?.map((call) => call.input.action)
    expect(actions).toEqual([
      'macro_research_sources',
      'query_macro_factors',
      'query_macro_attribution',
      'query_macro_research_evidence',
      'finance_news',
      'query_finance_news',
    ])
    expect(interception?.autoToolCalls?.find((call) => call.input.action === 'finance_news')?.input).toEqual({
      action: 'finance_news',
      query: 'A-shares',
      limit: 20,
    })
  })

  it('adds fresh macro and news readbacks after a governed finance news refresh', () => {
    const messages = [
      userMessage(
        'macro refresh\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"macro_attribution","assetClass":"mixed","intentMode":"analysis","executionMode":"readback","safetyBoundary":"read-only macro attribution","confirmationState":"none","source":"agent-structured-intent"}}',
      ),
      assistantMessage('', [
        { id: 'old-factors', name: 'DataStore', input: { action: 'query_macro_factors', target: 'A-shares' } },
        { id: 'old-news', name: 'DataStore', input: { action: 'query_finance_news', query: 'A-shares' } },
      ]),
      toolMessage('old-factors', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('old-news', JSON.stringify({ action: 'query_finance_news', data: [] })),
    ]

    const interception = maybeInterceptFinanceToolCalls(messages, [
      { id: 'refresh', name: 'DataStore', input: { action: 'finance_news', query: 'A-shares', limit: 20 } },
      { id: 'provenance', name: 'DataStore', input: { action: 'macro_research_provenance', target: 'A-shares' } },
    ])

    expect(interception?.autoToolCalls?.map((call) => call.input.action)).toEqual([
      'finance_news',
      'macro_research_provenance',
      'query_macro_factors',
      'query_macro_attribution',
      'query_finance_news',
    ])
  })

  it('does not retry a typed failed finance news request regardless of error prose', () => {
    const messages = [
      userMessage('macro refresh'),
      assistantMessage('', [
        { id: 'factors', name: 'DataStore', input: { action: 'query_macro_factors', target: 'A-shares' } },
        { id: 'failed-news', name: 'DataStore', input: { action: 'finance_news', query: 'A-shares' } },
      ]),
      toolMessage('factors', JSON.stringify({
        action: 'query_macro_factors',
        rows: [{ title: 'Policy liquidity context', family: 'rates_liquidity' }],
      })),
      toolMessage('failed-news', 'arbitrary provider display text', true),
    ]

    const interception = maybeInterceptFinanceToolCalls(messages, [
      { id: 'retry-news', name: 'DataStore', input: { action: 'finance_news', query: 'A-shares' } },
    ])

    const actions = interception?.autoToolCalls?.map((call) => call.input.action)
    expect(actions).not.toContain('finance_news')
    expect(actions).toContain('query_finance_news')
  })

  it('keeps proposed macro attribution when budget trimming broad evidence batches', () => {
    const messages = [
      macroStockUser('贵州茅台'),
      assistantMessage('', Array.from({ length: 7 }, (_, index) => ({
        id: `prior-${index}`,
        name: 'DataStore',
        input: { action: 'query_quote', code: `00000${index}` },
      }))),
    ]

    const interception = maybeInterceptFinanceToolCalls(messages, [
      { id: 'company', name: 'DataStore', input: { action: 'query_stock_company_info', code: '600519' } },
      { id: 'quote', name: 'DataStore', input: { action: 'query_quote', code: '600519' } },
      { id: 'valuation', name: 'DataStore', input: { action: 'query_stock_daily_valuation', code: '600519' } },
      { id: 'macro-1', name: 'DataStore', input: { action: 'query_macro_factors', target: '贵州茅台', family: 'rates_liquidity' } },
      { id: 'macro-2', name: 'DataStore', input: { action: 'query_macro_factors', target: '贵州茅台', family: 'policy_regulation' } },
      { id: 'macro-3', name: 'DataStore', input: { action: 'query_macro_factors', target: '贵州茅台', family: 'narrative_attention' } },
      { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: '贵州茅台' } },
    ])

    expect(interception?.answer).toBeNull()
    expect(interception?.autoToolCalls?.map((call) => call.input.action)).toContain('query_macro_attribution')
  })

  it('recovers stock quote evidence before bounded stock macro answers', () => {
    const messages = [
      macroStockUser('贵州茅台'),
      assistantMessage('', [
        { id: 'factor', name: 'DataStore', input: { action: 'query_macro_factors', target: '白酒；政策/监管；贵州茅台' } },
        { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: '白酒；政策/监管；贵州茅台' } },
        { id: 'news', name: 'DataStore', input: { action: 'query_finance_news', query: '白酒；政策/监管；贵州茅台' } },
        { id: 'search', name: 'DataStore', input: { action: 'query_stock_list', keyword: '贵州茅台' } },
      ]),
      toolMessage('factor', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('attr', JSON.stringify({ action: 'query_macro_attribution', rows: [] })),
      toolMessage('news', JSON.stringify({ action: 'query_finance_news', data: [] })),
      toolMessage('search', JSON.stringify({ action: 'query_stock_list', keyword: '贵州茅台', data: [{ code: '600519', name: '贵州茅台', market: 'SH' }] })),
    ]

    expect(maybeBuildFinanceBoundedAnswer(messages)).toBeNull()
    const recovery = buildFinanceRecovery(messages)

    expect(recovery?.toolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_quote', code: '600519', limit: 1 },
      }),
    ])
  })

  it('redirects generic fallback to stock quote evidence when named-stock macro evidence is incomplete', () => {
    const messages = [
      macroStockUser('贵州茅台'),
      assistantMessage('', [
        { id: 'factor', name: 'DataStore', input: { action: 'query_macro_factors', target: '白酒；政策/监管；贵州茅台' } },
        { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: '白酒；政策/监管；贵州茅台' } },
        { id: 'news', name: 'DataStore', input: { action: 'query_finance_news', query: '白酒；政策/监管；贵州茅台' } },
        { id: 'search', name: 'DataStore', input: { action: 'query_stock_list', keyword: '贵州茅台' } },
      ]),
      toolMessage('factor', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('attr', JSON.stringify({ action: 'query_macro_attribution', rows: [] })),
      toolMessage('news', JSON.stringify({ action: 'query_finance_news', data: [] })),
      toolMessage('search', JSON.stringify({ action: 'query_stock_list', keyword: '贵州茅台', data: [{ code: '600519', name: '贵州茅台', market: 'SH' }] })),
    ]

    const interception = maybeInterceptFinanceToolCalls(messages, [
      { id: 'research', name: 'Research', input: { action: 'search', query: '贵州茅台 政策 新闻' } },
    ])

    expect(interception?.answer).toBeNull()
    expect(interception?.autoToolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_quote', code: '600519', limit: 1 },
      }),
    ])
  })

  it('uses the typed workflow subject instead of inferring identity from news prose', () => {
    const messages = [
      macroStockUser('贵州茅台'),
      assistantMessage('', [
        { id: 'factor', name: 'DataStore', input: { action: 'query_macro_factors', target: '白酒 sector' } },
        { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: '白酒 sector' } },
        { id: 'news', name: 'DataStore', input: { action: 'query_finance_news', query: '白酒 sector' } },
      ]),
      toolMessage('factor', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('attr', JSON.stringify({ action: 'query_macro_attribution', rows: [] })),
      toolMessage('news', JSON.stringify({ action: 'query_finance_news', data: [] })),
      assistantMessage('', [
        { id: 'research', name: 'Research', input: { action: 'news', query: '白酒 贵州茅台 政策 新闻 2026' } },
      ]),
      toolMessage('research', JSON.stringify({ action: 'news', count: 1, results: [] })),
    ]

    expect(buildFinanceRecovery(messages)?.toolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_stock_list', keyword: '贵州茅台', limit: 5 },
      }),
    ])
  })

  it('recovers a translated stock identity from the typed workflow subject', () => {
    const messages = [
      macroStockUser('Guizhou Moutai'),
      assistantMessage('', [
        { id: 'factor', name: 'DataStore', input: { action: 'query_macro_factors', target: 'Guizhou Moutai; policy/regulation; Baijiu' } },
        { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: 'Guizhou Moutai; policy/regulation; Baijiu' } },
        { id: 'news', name: 'DataStore', input: { action: 'query_finance_news', query: 'Guizhou Moutai; policy/regulation; Baijiu' } },
      ]),
      toolMessage('factor', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('attr', JSON.stringify({ action: 'query_macro_attribution', rows: [] })),
      toolMessage('news', JSON.stringify({ action: 'query_finance_news', data: [] })),
    ]

    expect(buildFinanceRecovery(messages)?.toolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_stock_list', keyword: 'Guizhou Moutai', limit: 5 },
      }),
    ])

    const recoveredMessages = [
      ...messages,
      assistantMessage('', [
        { id: 'search', name: 'DataStore', input: { action: 'query_stock_list', keyword: 'Guizhou Moutai' } },
      ]),
      toolMessage('search', JSON.stringify({ action: 'query_stock_list', keyword: 'Guizhou Moutai', data: [{ code: '600519', name: '贵州茅台', market: 'SH' }] })),
    ]

    expect(buildFinanceRecovery(recoveredMessages)?.toolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_quote', code: '600519', limit: 1 },
      }),
    ])
  })

  it('uses the typed stock subject over broad macro targets and does not repeat failed identity search', () => {
    const messages = [
      macroStockUser('贵州茅台'),
      assistantMessage('', [
        { id: 'industry', name: 'DataStore', input: { action: 'query_macro_factors', target: '白酒' } },
        { id: 'stock', name: 'DataStore', input: { action: 'query_macro_factors', target: '贵州茅台' } },
        { id: 'attr', name: 'DataStore', input: { action: 'query_macro_attribution', target: '白酒' } },
      ]),
      toolMessage('industry', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('stock', JSON.stringify({ action: 'query_macro_factors', rows: [] })),
      toolMessage('attr', JSON.stringify({ action: 'query_macro_attribution', rows: [] })),
    ]

    expect(buildFinanceRecovery(messages)?.toolCalls).toEqual([
      expect.objectContaining({
        name: 'DataStore',
        input: { action: 'query_stock_list', keyword: '贵州茅台', limit: 5 },
      }),
    ])

    const searchedMessages = [
      ...messages,
      assistantMessage('', [
        { id: 'search', name: 'DataStore', input: { action: 'query_stock_list', keyword: '贵州茅台', limit: 5 } },
      ]),
      toolMessage('search', JSON.stringify({ action: 'query_stock_list', keyword: '贵州茅台', count: 0, data: [] })),
    ]

    expect(buildFinanceRecovery(searchedMessages)).toBeNull()
  })

  it('builds a bounded macro answer from structured content readback', () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage(
        'macro analysis\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"macro_attribution","assetClass":"mixed","intentMode":"analysis","executionMode":"readback","safetyBoundary":"read-only macro attribution","confirmationState":"none","source":"agent-structured-intent"}}',
      ),
      assistantMessage('', [
        { id: 'source', name: 'DataStore', input: { action: 'macro_research_sources', category: 'policy_regulation' } },
        { id: 'content', name: 'DataStore', input: { action: 'query_macro_research_content', provider: 'msci' } },
      ]),
      toolMessage('source', JSON.stringify({
        action: 'macro_research_sources',
        rows: [{ providerName: 'MSCI', categories: ['index_event'], accessClass: 'public' }],
      })),
      toolMessage('content', JSON.stringify({
        action: 'query_macro_research_content',
        contentEvidence: [{
          title: 'Index rebalancing research',
          sourceName: 'MSCI',
          sourceDataTime: '2026-06-20',
          contentHash: '123456abcdef',
          keyClaims: ['index changes can affect passive flows'],
        }],
      })),
    ])

    expect(answer).toContain('宏观证据与来源状态')
    expect(answer).toContain('MSCI')
    expect(answer).toContain('Index rebalancing research')
    expect(answer).toContain('宏观假设和失效条件')
  })

  it('preserves structured non-macro context in bounded macro answers', () => {
    const answer = maybeBuildFinanceBoundedAnswer([
      userMessage('macro analysis'),
      assistantMessage('', [
        { id: 'quote', name: 'DataStore', input: { action: 'query_quote', code: '600519' } },
        { id: 'watch', name: 'Watchlist', input: { action: 'list' } },
        { id: 'factor', name: 'DataStore', input: { action: 'query_macro_factors', assets: 'bond funds', target: '600519' } },
      ]),
      toolMessage('factor', JSON.stringify({
        action: 'query_macro_factors',
        rows: [{ title: 'FRED official series', family: 'macro_official_series' }],
      })),
      toolMessage('quote', JSON.stringify({
        action: 'query_quote',
        rows: [{ code: '600519', name: '贵州茅台', price: 1500 }],
      })),
    ])

    expect(answer).toContain('贵州茅台')
    expect(answer).toContain('债券基金')
    expect(answer).toContain('自选股')
    expect(answer).toContain('信用')
  })
})
