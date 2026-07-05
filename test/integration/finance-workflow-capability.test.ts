import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Agent } from '../../src/agent/agent'
import { ToolRegistry } from '../../src/agent/tool'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import { WatchlistTool } from '../../src/agent/tools/watchlist'
import { DashboardTool } from '../../src/agent/tools/dashboard'
import { ReportDownloadTool, ReportParseTool } from '../../src/agent/tools/report'
import { CronCreateTool, CronListTool } from '../../src/agent/tools/cron'
import { CronScheduler } from '../../src/agent/cron-scheduler'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import { MockLLM } from '../mocks/mock-llm'
import type { AgentEvent } from '../../src/agent/agent-event'

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const ev of gen) events.push(ev)
  return events
}

function mockFinanceFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    if (href.endsWith('/screener/stock')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({
        total_universe: 5200,
        passed_gates: 12,
        returned: body.limit ?? 2,
        stocks: [
          { code: '600519', name: '贵州茅台', price: 1256, composite_score: 92, factors: { roe: 31.2, momentum: 18.5 } },
          { code: '000001', name: '平安银行', price: 11.13, composite_score: 78, factors: { roe: 11.2, momentum: 5.1 } },
        ],
      })
    }
    if (href.endsWith('/screener/fund')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({
        mode: body.mode ?? '4433',
        total_universe: 13000,
        passed: 21,
        returned: body.limit ?? 2,
        funds: [
          { code: '110022', name: '易方达消费行业', nav: 3.12, return_1y: 12.4, return_3y: 38.5 },
          { code: '000001', name: '华夏成长混合', nav: 1.08, return_1y: 5.2, return_3y: 18.1 },
        ],
      })
    }
    if (href === 'https://example.test/report.pdf') {
      return new Response(Buffer.from('%PDF-1.4 deterministic report'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    }
    return Response.json({ error: `unexpected mocked URL: ${href}` }, { status: 500 })
  }))
}

describe('finance workflow capability integration', () => {
  let basePath: string

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-workflow-capability-'))
    mockFinanceFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs stock-picking through screener, watchlist, and dashboard artifact tools', async () => {
    const dashboard = new DashboardTool()
    dashboard.setPanelQuery(async () => [{ id: 'dash-stock-picks', title: 'Stock Picks', url: '', type: 'dashboard', isActive: true }])
    const registry = new ToolRegistry()
    registry.register(new DataStoreTool())
    registry.register(new WatchlistTool())
    registry.register(dashboard)

    const llm = new MockLLM([
      { toolCalls: [{ id: 'screen-stock', name: 'DataStore', arguments: { action: 'screen_stock', limit: 2, sort_by: 'composite_score' } }] },
      { toolCalls: [{ id: 'watch-stock', name: 'Watchlist', arguments: { action: 'add', symbol: '600519', name: '贵州茅台', type: 'stock', tags: ['candidate'], source: 'stock-picking', score: 92, rating: 'A' } }] },
      { toolCalls: [{ id: 'dash-stock', name: 'Dashboard', arguments: { id: 'stock-picks', title: 'Stock Picks', html: '<html><body><h1>Stock Picks</h1><p>600519</p></body></html>' } }] },
      { text: 'Stock-picking workflow completed with watchlist and dashboard evidence.' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('screen stocks and create a stock-picking dashboard'))

    expect(events.some((e) => e.type === 'tool-result' && e.name === 'DataStore' && e.result.includes('600519'))).toBe(true)
    expect(events.some((e) => e.type === 'tool-result' && e.name === 'Watchlist' && e.result.includes('贵州茅台'))).toBe(true)
    expect(existsSync(join(basePath, 'dashboards', 'stock-picks.html'))).toBe(true)
    const watchlist = JSON.parse(readFileSync(join(basePath, 'watchlists.json'), 'utf-8'))
    expect(watchlist.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: '600519', type: 'stock', source: 'stock-picking', score: 92 }),
    ]))
    expect(new ArtifactRegistry(basePath).list('dashboard')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dashboard:stock-picks', source: 'Dashboard' }),
    ]))
  })

  it('runs fund-screening through screener and the unified watchlist model', async () => {
    const registry = new ToolRegistry()
    registry.register(new DataStoreTool())
    registry.register(new WatchlistTool())
    const llm = new MockLLM([
      { toolCalls: [{ id: 'screen-fund', name: 'DataStore', arguments: { action: 'screen_fund', mode: '4433', limit: 2 } }] },
      { toolCalls: [{ id: 'watch-fund', name: 'Watchlist', arguments: { action: 'add', symbol: '110022', name: '易方达消费行业', type: 'fund', tags: ['4433'], source: 'fund-screening', rating: 'shortlist' } }] },
      { text: 'Fund-screening workflow completed with unified watchlist evidence.' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('screen funds and add the best candidate to fund watchlist'))

    expect(events.some((e) => e.type === 'tool-result' && e.name === 'DataStore' && e.result.includes('110022'))).toBe(true)
    const watchlist = JSON.parse(readFileSync(join(basePath, 'watchlists.json'), 'utf-8'))
    expect(watchlist.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: '110022', type: 'fund', source: 'fund-screening', rating: 'shortlist' }),
    ]))
  })

  it('creates a scheduled-analysis cron job and delivers its prompt through the event-agent queue', async () => {
    const scheduler = new CronScheduler(basePath)
    const registry = new ToolRegistry()
    registry.register(new CronCreateTool(scheduler))
    registry.register(new CronListTool(scheduler))
    const setupLlm = new MockLLM([
      { toolCalls: [{ id: 'cron-create', name: 'CronCreate', arguments: { cron: 'every 30 minutes', prompt: 'Run scheduled analysis for watchlist risk and refresh dashboard.', durable: true } }] },
      { toolCalls: [{ id: 'cron-list', name: 'CronList', arguments: {} }] },
      { text: 'Scheduled-analysis cron workflow configured.' },
    ])
    const setupAgent = new Agent({ llm: setupLlm, tools: registry, basePath, skipPermissions: true })

    const setupEvents = await collectEvents(setupAgent.run('schedule recurring watchlist analysis'))
    expect(setupEvents.some((e) => e.type === 'tool-result' && e.name === 'CronCreate' && e.result.includes('created'))).toBe(true)
    const job = scheduler.list()[0]
    expect(job.prompt).toContain('scheduled analysis')
    expect(readFileSync(join(basePath, 'scheduled_tasks.json'), 'utf-8')).toContain('Run scheduled analysis')

    const eventAgent = new Agent({
      llm: new MockLLM([{ text: 'scheduled analysis executed' }]),
      tools: new ToolRegistry(),
      basePath,
      sessionBasePath: join(basePath, 'event-agent'),
      skipPermissions: true,
      agentRole: 'event',
      drainNotificationsInLoop: false,
    })
    const events: AgentEvent[] = []
    eventAgent.startAutoProcessing((event) => events.push(event))
    eventAgent.notifications.enqueue('cron', job.prompt, 'now')
    for (let i = 0; i < 30 && !events.some((e) => e.type === 'done'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    eventAgent.stopAutoProcessing()

    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('scheduled analysis executed'))).toBe(true)
    expect(readFileSync(join(basePath, 'event-agent', 'sessions', 'current.jsonl'), 'utf-8')).toContain('<scheduled-task>')
  })

  it('runs report download, parse guidance, and dashboard artifact generation as one workflow', async () => {
    const reportPath = join(basePath, 'reports', 'mock.pdf')
    const dashboard = new DashboardTool()
    dashboard.setPanelQuery(async () => [{ id: 'dash-report-summary', title: 'Report Summary', url: '', type: 'dashboard', isActive: true }])
    const registry = new ToolRegistry()
    registry.register(new ReportDownloadTool())
    registry.register(new ReportParseTool())
    registry.register(dashboard)
    const llm = new MockLLM([
      { toolCalls: [{ id: 'report-download', name: 'ReportDownload', arguments: { url: 'https://example.test/report.pdf', outputPath: reportPath, code: '600519', year: '2024', type: 'annual' } }] },
      { toolCalls: [{ id: 'report-parse', name: 'ReportParse', arguments: { path: reportPath } }] },
      { toolCalls: [{ id: 'report-dashboard', name: 'Dashboard', arguments: { id: 'report-summary', title: 'Report Summary', html: '<html><body><h1>Report Summary</h1></body></html>' } }] },
      { text: 'Report workflow completed with downloaded PDF, parse guidance, and dashboard artifact.' },
    ])
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('download report, parse it, and create report dashboard'))

    expect(events.some((e) => e.type === 'tool-result' && e.name === 'ReportDownload' && e.result.includes('Downloaded'))).toBe(true)
    expect(events.some((e) => e.type === 'tool-result' && e.name === 'ReportParse' && e.result.includes('PDF parsing requires'))).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(existsSync(join(basePath, 'dashboards', 'report-summary.html'))).toBe(true)
    expect(new ArtifactRegistry(basePath).list('report')).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'ReportDownload', metadata: expect.objectContaining({ code: '600519' }) }),
    ]))
    expect(new ArtifactRegistry(basePath).list('dashboard')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dashboard:report-summary', source: 'Dashboard' }),
    ]))
  })
})
