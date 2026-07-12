import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import vm from 'vm'
import { TaskRegistry } from '../../src/agent/background-task'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import { TeamRegistry } from '../../src/agent/team-context'
import type { ToolContext } from '../../src/agent/tool'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import { DataTaskTool } from '../../src/agent/tools/data-task'
import { DashboardTool } from '../../src/agent/tools/dashboard'
import { ReportDownloadTool } from '../../src/agent/tools/report'
import { ResearchTool } from '../../src/agent/tools/research'
import { TaskOutputTool } from '../../src/agent/tools/tasks'
import { UIControlTool } from '../../src/agent/tools/ui-tools'
import { WebFetchTool } from '../../src/agent/tools/web-fetch'
import { WebViewTool } from '../../src/agent/tools/webview'

function makeCtx(basePath: string): ToolContext {
  return {
    basePath,
    workDir: basePath,
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: new TaskRegistry(),
    teamRegistry: new TeamRegistry(),
  }
}

describe('sync tool contracts', () => {
  it('report dashboard template renders object-shaped table rows', () => {
    const template = readFileSync(join(process.cwd(), 'assets', 'dashboards', 'report.html'), 'utf8')
    const config = {
      title: '东方财富（300059）股票研究看板',
      sections: [{
        title: '核心数据',
        type: 'table',
        headers: ['字段', '值'],
        rows: [
          { 字段: '行情', 值: '20.92 +12.47%' },
          { 字段: '来源', 值: 'DataStore query_quote' },
        ],
      }],
    }
    const html = template.replace(/var CONFIG = \{[\s\S]*?\};/, `var CONFIG = ${JSON.stringify(config)};`)
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? ''
    const element = {
      innerHTML: '<div>Loading report...</div>',
    }
    const context = vm.createContext({
      document: {
        title: 'Report',
        getElementById: (id: string) => id === 'content' ? element : null,
      },
      console,
    })

    vm.runInContext(script, context)

    expect(element.innerHTML).toContain('东方财富')
    expect(element.innerHTML).toContain('20.92 +12.47%')
    expect(element.innerHTML).not.toContain('Loading report')
  })

  it('UIControl help is available before a renderer handler is registered', async () => {
    const result = JSON.parse(await new UIControlTool().call('ui-help', {
      action: 'help',
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-ui-help-')))))

    expect(result.contract).toBe('ui-control-help-v1')
    expect(result.actions.pages).toContain('openPage')
    expect(result.actions.liveUpdate).toContain('pushData')
    expect(result.observation.join(' ')).toContain('observed=false')
  })

  it('WebView help is available without an existing panel id', async () => {
    const tool = new WebViewTool()

    const result = JSON.parse(await tool.call('wv-help', {
      action: 'help',
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-webview-help-')))))

    expect(result.contract).toBe('webview-help-v1')
    expect(result.actions.discovery).toContain('list')
    expect(result.requiredFields.open).toContain('url')
  })

  it('WebView open observes renderer panel state before reporting success', async () => {
    const tool = new WebViewTool()
    const events: Record<string, unknown>[] = []
    let queryCount = 0
    tool.setEventEmitter((event) => events.push(event))
    tool.setPanelQuery(async () => {
      queryCount++
      if (queryCount < 2) return []
      return [{ id: 'tv', title: 'TradingView', url: 'https://example.test/chart', type: 'webview', isActive: true }]
    })

    const result = JSON.parse(await tool.call('wv1', {
      action: 'open',
      id: 'tv',
      url: 'https://example.test/chart',
      title: 'TradingView',
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-webview-sync-')))))

    expect(events[0]).toMatchObject({ type: 'webview-open', id: 'tv' })
    expect(result.observed).toBe(true)
    expect(result.panel.id).toBe('tv')
  })

  it('WebView execute times out page scripts that never settle', async () => {
    const tool = new WebViewTool()
    tool.setPanelQuery(async () => [{ id: 'dash-report', title: 'Report', url: '/tmp/report.html', type: 'dashboard', isActive: true }])
    tool.setRequestHandler(async () => new Promise<string>(() => {}))

    await expect(tool.call('wv-timeout', {
      action: 'execute',
      id: 'dash-report',
      script: 'new Promise(() => {})',
      timeout: 100,
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-webview-timeout-'))))).rejects.toThrow('WEBVIEW_EXECUTION_TIMEOUT')
  })

  it('UIControl openPage observes the dashboard panel', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-ui-sync-'))
    const htmlPath = join(basePath, 'page.html')
    writeFileSync(htmlPath, '<html><body>ok</body></html>')
    const tool = new UIControlTool()
    const events: Record<string, unknown>[] = []
    tool.setEventEmitter((event) => events.push(event))
    tool.setPanelQuery(async () => [{ id: 'dash-page', title: 'Page', url: htmlPath, type: 'dashboard', isActive: true }])

    const result = JSON.parse(await tool.call('ui1', {
      action: 'openPage',
      params: { path: htmlPath, title: 'Page' },
    }, makeCtx(basePath)))

    expect(events[0]).toMatchObject({ type: 'dashboard-open', title: 'Page', path: htmlPath })
    expect(result.observed).toBe(true)
    expect(result.panel.type).toBe('dashboard')
    expect(result.artifact.kind).toBe('dashboard')
    expect(result.artifact.path).toBe('page.html')
    expect(result.artifact.provenance.source).toBe('UIControl:openPage')
  })

  it('UIControl openPage resolves memory-relative page paths from the runtime root', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-ui-memory-path-'))
    const htmlPath = join(basePath, 'memory', 'pages', 'market.html')
    mkdirSync(join(basePath, 'memory', 'pages'), { recursive: true })
    writeFileSync(htmlPath, '<html><body>market</body></html>')
    const tool = new UIControlTool()
    const events: Record<string, unknown>[] = []
    tool.setEventEmitter((event) => events.push(event))
    tool.setPanelQuery(async () => [{ id: 'dash-market', title: 'Market', url: htmlPath, type: 'dashboard', isActive: true }])

    const result = JSON.parse(await tool.call('ui-memory', {
      action: 'openPage',
      params: { path: 'memory/pages/market.html', title: 'Market' },
    }, makeCtx(basePath)))

    expect(events[0]).toMatchObject({ type: 'dashboard-open', title: 'Market', path: htmlPath })
    expect(result.path).toBe(htmlPath)
    expect(result.artifact.kind).toBe('dashboard')
    expect(result.artifact.path).toBe('memory/pages/market.html')
    expect(new ArtifactRegistry(basePath).list('dashboard')[0]).toMatchObject({
      path: 'memory/pages/market.html',
      source: 'UIControl:openPage',
    })
    expect(result.observed).toBe(true)
  })

  it('UIControl openPage accepts file URLs for generated pages', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-ui-file-url-'))
    const htmlPath = join(basePath, 'memory', 'pages', 'market.html')
    mkdirSync(join(basePath, 'memory', 'pages'), { recursive: true })
    writeFileSync(htmlPath, '<html><body>market</body></html>')
    const tool = new UIControlTool()
    const events: Record<string, unknown>[] = []
    tool.setEventEmitter((event) => events.push(event))
    tool.setPanelQuery(async () => [{ id: 'dash-market', title: 'Market', url: htmlPath, type: 'dashboard', isActive: true }])

    const result = JSON.parse(await tool.call('ui-file-url', {
      action: 'openPage',
      params: { url: `file://${htmlPath}`, title: 'Market' },
    }, makeCtx(basePath)))

    expect(events[0]).toMatchObject({ type: 'dashboard-open', title: 'Market', path: htmlPath })
    expect(result.path).toBe(htmlPath)
    expect(result.observed).toBe(true)
  })

  it('UIControl openPage accepts file path alias for generated pages', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-ui-file-alias-'))
    const htmlPath = join(basePath, 'memory', 'pages', 'market.html')
    mkdirSync(join(basePath, 'memory', 'pages'), { recursive: true })
    writeFileSync(htmlPath, '<html><body>market</body></html>')
    const tool = new UIControlTool()
    const events: Record<string, unknown>[] = []
    tool.setEventEmitter((event) => events.push(event))
    tool.setPanelQuery(async () => [{ id: 'dash-market', title: 'Market', url: htmlPath, type: 'dashboard', isActive: true }])

    const result = JSON.parse(await tool.call('ui-file-alias', {
      action: 'openPage',
      params: { file: htmlPath, title: 'Market' },
    }, makeCtx(basePath)))

    expect(events[0]).toMatchObject({ type: 'dashboard-open', title: 'Market', path: htmlPath })
    expect(result.path).toBe(htmlPath)
    expect(result.observed).toBe(true)
  })

  it('Dashboard registers generated dashboard artifacts with renderer evidence', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-dashboard-artifact-'))
    const tool = new DashboardTool()
    tool.setEventEmitter(() => {})
    tool.setPanelQuery(async () => [{ id: 'dash-pulse', title: 'Pulse', url: join(basePath, 'dashboards', 'pulse.html'), type: 'dashboard', isActive: true }])

    const result = JSON.parse(await tool.call('dash1', {
      id: 'pulse',
      title: 'Pulse',
      html: '<html><body>pulse</body></html>',
    }, makeCtx(basePath)))

    expect(result.observed).toBe(true)
    const artifact = new ArtifactRegistry(basePath).list('dashboard')[0]
    expect(artifact).toMatchObject({
      id: 'dashboard:pulse',
      path: join(basePath, 'dashboards', 'pulse.html'),
      source: 'Dashboard',
      ownerTask: 'dashboard',
      verificationStatus: 'verified',
      freshness: expect.objectContaining({ status: 'unknown' }),
      provenance: expect.objectContaining({ source: 'Dashboard', rendererObserved: true }),
      metadata: expect.objectContaining({
        dashboardId: 'pulse',
        mode: 'custom HTML',
        observed: true,
        panelId: 'dash-pulse',
      }),
    })
  })

  it('Dashboard normalizes template config and reports renderer observation timeouts without failing the write', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-dashboard-timeout-'))
    const assetsPath = join(basePath, 'assets')
    mkdirSync(join(assetsPath, 'dashboards'), { recursive: true })
    writeFileSync(join(assetsPath, 'dashboards', 'report.html'), '<html><head><title>{{TITLE}}</title></head><body><script>var CONFIG = {};</script></body></html>', { flag: 'w' })
    const tool = new DashboardTool()
    tool.setAssetsPath(assetsPath)
    tool.setEventEmitter(() => {})
    tool.setPanelQuery(async () => { throw new Error('UI_RENDERER_TIMEOUT: renderer JavaScript did not settle within 5000ms') })

    const result = JSON.parse(await tool.call('dash-timeout', {
      id: 'fund-report',
      title: 'Fund Report',
      template: 'report',
      config: JSON.stringify({ title: 'Fund Report', sections: [{ heading: 'A', content: 'B' }] }, null, 2),
    }, makeCtx(basePath)))

    expect(result.ok).toBe(true)
    expect(result.observed).toBe(false)
    expect(result.rendererObservationError).toContain('UI_RENDERER_TIMEOUT')
  })

  it('Dashboard rejects invalid template config before writing malformed HTML', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-dashboard-invalid-config-'))
    const assetsPath = join(basePath, 'assets')
    mkdirSync(join(assetsPath, 'dashboards'), { recursive: true })
    writeFileSync(join(assetsPath, 'dashboards', 'report.html'), '<html><body><script>var CONFIG = {};</script></body></html>', { flag: 'w' })
    const tool = new DashboardTool()
    tool.setAssetsPath(assetsPath)

    await expect(tool.call('dash-invalid', {
      id: 'bad-report',
      title: 'Bad Report',
      template: 'report',
      config: '{"title": "Bad"',
    }, makeCtx(basePath))).rejects.toThrow('DASHBOARD_CONFIG_INVALID_JSON')
  })

  it('Dashboard rejects mixed template and custom HTML modes', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-dashboard-mixed-mode-'))
    const assetsPath = join(basePath, 'assets')
    mkdirSync(join(assetsPath, 'dashboards'), { recursive: true })
    writeFileSync(join(assetsPath, 'dashboards', 'report.html'), '<html><body><script>var CONFIG = {};</script></body></html>', { flag: 'w' })
    const tool = new DashboardTool()
    tool.setAssetsPath(assetsPath)

    await expect(tool.call('dash-mixed', {
      id: 'bad-report',
      title: 'Bad Report',
      template: 'report',
      html: '<html><body>custom report</body></html>',
    }, makeCtx(basePath))).rejects.toThrow('Use either template+config or custom html, not both')
  })

  it('WebView get_info falls back to a generated dashboard artifact when live renderer verification times out', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-webview-static-fallback-'))
    const dashboardDir = join(basePath, 'dashboards')
    mkdirSync(dashboardDir, { recursive: true })
    writeFileSync(join(dashboardDir, 'fund-report.html'), '<html><head><title>Fund Report</title></head><body><h1>基金对比看板</h1><p>易方达天天理财货币A 000009</p></body></html>', { flag: 'w' })
    const tool = new WebViewTool()
    tool.setPanelQuery(async () => [{ id: 'dash-fund-report', title: 'Fund Report', url: join(dashboardDir, 'fund-report.html'), type: 'dashboard', isActive: true }])
    tool.setRequestHandler(async () => { throw new Error('UI_RENDERER_TIMEOUT: renderer JavaScript did not settle within 5000ms') })

    const result = JSON.parse(await tool.call('wv-static', {
      action: 'get_info',
      id: 'fund-report',
    }, makeCtx(basePath)))

    expect(result.ok).toBe(true)
    expect(result.fallback).toBe('static-dashboard-file')
    expect(result.title).toBe('Fund Report')
    expect(result.textSnippet).toContain('基金对比看板')
  })

  it('WebView static dashboard fallback extracts report template config', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-webview-report-config-fallback-'))
    const dashboardDir = join(basePath, 'dashboards')
    mkdirSync(dashboardDir, { recursive: true })
    writeFileSync(join(dashboardDir, 'fund-report.html'), `<html><head><title>Fund Report</title></head><body><div>Loading report...</div><script>var CONFIG = ${JSON.stringify({
      title: '基金对比看板',
      subtitle: '华夏成长混合 vs 易方达天天理财货币A',
      funds: [
        { name: '华夏成长混合', code: '000001', type: '混合型基金', value: '1.538', source: 'EastMoney', dataTime: '2026-06-24', fetchTime: '2026-06-27T08:47:33Z' },
        { name: '易方达天天理财货币A', code: '000009', type: '货币型基金', value: '0.2361 / 0.844%', source: 'EastMoney', dataTime: '2026-06-22', fetchTime: '2026-06-24T10:42:12Z' },
      ],
      categoryDifference: '货币型基金使用万份收益，混合型基金使用单位净值。',
      riskWarning: '风险不同。',
    })};</script></body></html>`, { flag: 'w' })
    const tool = new WebViewTool()
    tool.setPanelQuery(async () => [{ id: 'dash-fund-report', title: 'Fund Report', url: join(dashboardDir, 'fund-report.html'), type: 'dashboard', isActive: true }])
    tool.setRequestHandler(async () => { throw new Error('UI_RENDERER_TIMEOUT: renderer JavaScript did not settle within 5000ms') })

    const result = JSON.parse(await tool.call('wv-report-config-static', {
      action: 'get_info',
      id: 'fund-report',
    }, makeCtx(basePath)))

    expect(result.ok).toBe(true)
    expect(result.fallback).toBe('static-dashboard-file')
    expect(result.textSnippet).toContain('华夏成长混合')
    expect(result.textSnippet).toContain('易方达天天理财货币A')
    expect(result.textSnippet).not.toBe('Loading report...')
  })

  it('ReportDownload registers downloaded report artifacts with source metadata', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-report-artifact-'))
    const outputPath = join(basePath, 'reports', 'sample.pdf')
    const fetchMock = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer,
    })
    const previousFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const result = await new ReportDownloadTool().call('report1', {
        url: 'https://example.test/sample.pdf',
        outputPath,
        code: '600519',
        year: '2025',
        type: 'annual',
      }, makeCtx(basePath))

      expect(result).toContain(outputPath)
      const artifact = new ArtifactRegistry(basePath).list('report')[0]
      expect(artifact).toMatchObject({
        id: `report:${outputPath}`,
        path: outputPath,
        source: 'ReportDownload',
        ownerTask: '600519',
        verificationStatus: 'verified',
        freshness: expect.objectContaining({ status: 'fresh' }),
        provenance: expect.objectContaining({ source: 'ReportDownload', url: 'https://example.test/sample.pdf', httpStatus: 200 }),
        metadata: expect.objectContaining({
          url: 'https://example.test/sample.pdf',
          code: '600519',
          year: '2025',
          reportType: 'annual',
          outputPath,
          sizeBytes: 5,
        }),
      })
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  it('Research fetch stores a research workspace artifact with evidence and citations', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-research-artifact-'))
    const previousFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html><body><h1>Company update</h1><p>Revenue rose 20%</p></body></html>',
    })) as typeof fetch
    try {
      const result = await new ResearchTool().call('research-fetch', {
        action: 'fetch',
        url: 'https://example.test/company-update',
      }, makeCtx(basePath))

      expect(result).toContain('Company update')
      const artifact = new ArtifactRegistry(basePath).list('research')[0]
      expect(artifact).toMatchObject({
        kind: 'research',
        ownerTask: 'research-workspace',
        verificationStatus: 'verified',
        freshness: expect.objectContaining({ status: 'fresh' }),
        provenance: expect.objectContaining({ action: 'fetch', query: 'https://example.test/company-update' }),
        metadata: expect.objectContaining({ action: 'fetch', citations: 1, evidence: 1, draft: true }),
      })
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  it('Research news routes Sina finance news through governed interface provenance', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-research-news-sina-'))
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('gushitong.baidu.com')) {
        return {
          ok: true,
          json: async () => ({ Result: [] }),
        } as Response
      }
      if (url.includes('search-api-web.eastmoney.com')) {
        return {
          ok: true,
          text: async () => 'jQuery({"result":{"cmsArticleWebOld":[]}})',
        } as Response
      }
      if (url.includes('feed.mix.sina.com.cn/api/roll/get')) {
        return {
          ok: true,
          json: async () => ({
            result: {
              data: [{
                title: '贵州茅台接口化新闻',
                url: 'https://finance.sina.com.cn/test-news',
                source: '新浪财经',
                ctime: '2026-06-23 10:00:00',
              }],
            },
          }),
        } as Response
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await new ResearchTool().call('research-news', {
        action: 'news',
        query: '贵州茅台',
      }, makeCtx(basePath))
      const parsed = JSON.parse(result)

      expect(parsed.results).toEqual([
        expect.objectContaining({
          title: '贵州茅台接口化新闻',
          interfaceId: 'news.finance_feed',
          provider: 'sina',
          capabilityId: 'sina.news.finance_feed',
        }),
      ])
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('feed.mix.sina.com.cn/api/roll/get'),
        expect.objectContaining({
          headers: expect.objectContaining({ Referer: 'https://finance.sina.com.cn' }),
        }),
      )
      const artifact = new ArtifactRegistry(basePath).list('research')[0]
      expect(artifact).toMatchObject({
        kind: 'research',
        provenance: expect.objectContaining({ action: 'news', query: '贵州茅台' }),
        metadata: expect.objectContaining({ action: 'news', evidence: 1 }),
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Research exposes search providers and search-provider schema', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-research-providers-'))
    writeFileSync(join(basePath, 'config.json'), JSON.stringify({
      apiKeys: {
        BRAVE_SEARCH_KEY: 'brave-test',
      },
    }))

    const tool = new ResearchTool()
    const providers = JSON.parse(await tool.call('research-providers', {
      action: 'providers',
    }, makeCtx(basePath)))

    expect((tool.inputSchema as any).properties.action.enum).toContain('providers')
    expect((tool.inputSchema as any).properties.provider.enum).toEqual(['auto', 'brave', 'tavily'])
    expect(providers.searchEngines).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'brave', configured: true, available: true }),
      expect.objectContaining({ provider: 'tavily', configured: false, available: false }),
    ]))
  })

  it('WebFetch rejects binary output paths outside the runtime root', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-webfetch-path-'))
    const tool = new WebFetchTool()

    expect(tool.validateInput?.({
      url: 'https://example.test/file.pdf',
      outputPath: '../escape.pdf',
    }, makeCtx(basePath))).toContain('outside the allowed directory')
  })

  it('UIControl showQuote waits for renderer acknowledgement', async () => {
    const tool = new UIControlTool()
    const requests: Record<string, unknown>[] = []
    tool.setEventEmitter(() => {})
    tool.setRequestHandler(async (request) => {
      requests.push(request)
      return JSON.stringify({
        ok: true,
        action: request.action,
        rendered: true,
        position: 'inline chat message #1',
      })
    })

    const result = JSON.parse(await tool.call('ui-widget-1', {
      action: 'showQuote',
      params: { data: { symbol: '600519', price: 123 } },
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-ui-widget-sync-')))))

    expect(requests[0]).toMatchObject({ type: 'ui-widget', action: 'showQuote' })
    expect(result.rendered).toBe(true)
    expect(result.position).toBe('inline chat message #1')
  })

  it('UIControl pushData waits for renderer delivery result', async () => {
    const tool = new UIControlTool()
    tool.setEventEmitter(() => {})
    tool.setRequestHandler(async (request) => JSON.stringify({
      ok: true,
      action: 'pushData',
      channel: request.channel,
      targetId: request.id,
      deliveredToPanels: 1,
      rawHtmlModified: false,
    }))

    const result = JSON.parse(await tool.call('ui-push-1', {
      action: 'pushData',
      params: { id: 'dash-report', channel: 'table', data: { rows: 3 } },
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-ui-push-sync-')))))

    expect(result.deliveredToPanels).toBe(1)
    expect(result.rawHtmlModified).toBe(false)
  })

  it('DataTask submit blocks by default until completion', async () => {
    const task = {
      id: 'dt-test',
      type: 'batch_quote',
      params: {},
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      result: undefined as string | undefined,
    }
    const engine = {
      create: () => {
        setTimeout(() => {
          task.status = 'completed'
          task.progress = 1
          task.result = '{"ok":true}'
        }, 20)
        return task
      },
      get: () => task,
      getResult: () => task.result ?? null,
    }
    const tool = new DataTaskTool(engine as any)

    const result = JSON.parse(await tool.call('dt1', {
      action: 'submit',
      type: 'batch_quote',
      codes: ['600519'],
      timeout: 2000,
    }))

    expect(result.retrieval_status).toBe('success')
    expect(result.taskId).toBe('dt-test')
    expect(result.result).toBe('{"ok":true}')
  })

  it('DataTask schema advertises the executable screen_advanced task type', () => {
    const tool = new DataTaskTool(null)
    const properties = tool.inputSchema.properties as Record<string, { description?: string }>

    expect(properties.taskType.description).toContain('screen_advanced')
    expect(properties.taskType.description).not.toContain('Task type: screen,')
    expect(properties.conditions.description).toContain('screen_advanced')
  })

  it('DataTask help is available before engine configuration', async () => {
    const tool = new DataTaskTool(null)

    const result = JSON.parse(await tool.call('dt-help', { action: 'help' }))

    expect(result.contract).toBe('data-task-help-v1')
    expect(result.actions).toContain('submit')
    expect(result.taskTypes).toContain('screen_advanced')
  })

  it('DataStore fetch blocks by default until fetch task is done', async () => {
    const taskRow = {
      id: 1,
      task_type: 'stock_list',
      code: null,
      params: '{}',
      status: 'pending',
      priority: 3,
      progress: JSON.stringify({ fetched: 1, total: 1 }),
      created_at: new Date().toISOString(),
      error: null,
    }
    let queryCount = 0
    const store = {
      query: () => {
        queryCount++
        if (queryCount >= 2) taskRow.status = 'done'
        return [taskRow]
      },
    }
    const queue = {
      enqueue: () => 1,
      start: async () => {},
    }
    const tool = new DataStoreTool(queue as any)
    tool.setDataStore(store as any)

    const result = JSON.parse(await tool.call('ds1', {
      action: 'fetch',
      type: 'stock_list',
      timeout: 2000,
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-ds-sync-')))))

    expect(result.retrieval_status).toBe('success')
    expect(result.provenance).toMatchObject({
      interfaceId: 'provider.fetch_task_queue',
      provider: 'local',
      capabilityId: 'local.provider.fetch_task_queue',
      canonicalSchema: 'fetch_task_queue',
      canonicalTable: 'fetch_tasks',
      readbackAction: 'fetch_status',
    })
    expect(result.tasks[0]).toMatchObject({ id: 1, type: 'stock_list', status: 'done' })
  })

  it('DataStore fetch failure returns fetch queue provenance through the tool error channel', async () => {
    const taskRow = {
      id: 1,
      task_type: 'fund_nav',
      code: '110022',
      params: '{}',
      status: 'failed',
      priority: 3,
      progress: null,
      created_at: new Date().toISOString(),
      error: 'provider timeout',
    }
    const store = {
      query: () => [taskRow],
      queryFundList: () => [],
    }
    const queue = {
      enqueue: () => 1,
      start: async () => {},
    }
    const tool = new DataStoreTool(queue as any)
    tool.setDataStore(store as any)

    await expect(tool.call('ds1', {
      action: 'fetch',
      type: 'fund_nav',
      code: '110022',
      timeout: 2000,
    }, makeCtx(mkdtempSync(join(tmpdir(), 'fin-ds-sync-failed-'))))).rejects.toThrow(/provider\.fetch_task_queue/)
  })

  it('TaskOutput exposes parent-owned background ownership metadata', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-task-output-owner-'))
    const ctx = makeCtx(basePath)
    ctx.taskRegistry.configure(join(basePath, 'memory'))
    const task = ctx.taskRegistry.register({
      description: 'research',
      prompt: 'inspect',
      toolUseId: 'tc-agent',
      parentSessionId: 'session-parent',
      sidechainPath: join(basePath, 'sessions', 'session-parent', 'subagents', 'agent-1'),
      isBackgrounded: true,
    })
    ctx.taskRegistry.updateStatus(task.id, 'completed', { result: 'done' })

    const result = JSON.parse(await new TaskOutputTool().call('to1', {
      task_id: task.id,
      block: false,
    }, ctx))

    expect(result.retrieval_status).toBe('success')
    expect(result.ownership).toMatchObject({
      mode: 'parent-owned-background',
      isBackgrounded: true,
      parentSessionId: 'session-parent',
      toolUseId: 'tc-agent',
      sidechainPath: join(basePath, 'sessions', 'session-parent', 'subagents', 'agent-1'),
    })
  })

  it('TaskOutput validates expected output contract and evidence', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-task-output-validation-'))
    const ctx = makeCtx(basePath)
    ctx.taskRegistry.configure(join(basePath, 'memory'))
    const task = ctx.taskRegistry.register({
      description: 'research',
      prompt: 'inspect',
      isBackgrounded: true,
    })
    ctx.taskRegistry.updateStatus(task.id, 'completed', {
      result: JSON.stringify({
        contract: 'task-analysis-v1',
        evidenceRefs: ['quote', 'macro'],
        summary: 'done',
      }),
    })

    const result = JSON.parse(await new TaskOutputTool().call('to1', {
      task_id: task.id,
      block: false,
      expectedContract: 'task-analysis-v1',
      requiredEvidence: ['quote', 'macro'],
    }, ctx))

    expect(result.retrieval_status).toBe('success')
  })

  it('TaskOutput fails validation for missing required evidence', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-task-output-validation-missing-'))
    const ctx = makeCtx(basePath)
    ctx.taskRegistry.configure(join(basePath, 'memory'))
    const task = ctx.taskRegistry.register({
      description: 'research',
      prompt: 'inspect',
      isBackgrounded: true,
    })
    ctx.taskRegistry.updateStatus(task.id, 'completed', {
      result: JSON.stringify({
        contract: 'task-analysis-v1',
        evidenceRefs: ['quote'],
      }),
    })

    await expect(new TaskOutputTool().call('to1', {
      task_id: task.id,
      block: false,
      expectedContract: 'task-analysis-v1',
      requiredEvidence: ['quote', 'macro'],
    }, ctx)).rejects.toThrow('validation_failed')
  })

  it('TaskOutput throws tool errors for failed background tasks', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-task-output-failed-'))
    const ctx = makeCtx(basePath)
    ctx.taskRegistry.configure(join(basePath, 'memory'))
    const task = ctx.taskRegistry.register({
      description: 'research',
      prompt: 'inspect',
      isBackgrounded: true,
    })
    ctx.taskRegistry.updateStatus(task.id, 'failed', { error: 'sub-agent crashed' })

    await expect(new TaskOutputTool().call('to1', {
      task_id: task.id,
      block: false,
    }, ctx)).rejects.toThrow('Task agent-1 failed: sub-agent crashed')
  })
})
