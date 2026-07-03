import { writeFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { ArtifactRegistry } from '../artifact-registry'

type PanelSummary = { id: string; title: string; url: string; type: string; isActive: boolean }

export class DashboardTool implements Tool {
  name = 'Dashboard'
  description = 'Create or update a dashboard panel with HTML content. Can use templates (kpi, chart, monitor, table, report, valuation, backtest) with CONFIG injection.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Dashboard ID (unique slug)' },
      title: { type: 'string', description: 'Dashboard title shown in the tab' },
      html: { type: 'string', description: 'Full HTML content (if not using template)' },
      template: { type: 'string', description: 'Template name: kpi, chart, monitor, table, report, valuation, backtest' },
      config: { type: 'string', description: 'JSON string to inject as CONFIG (for template mode)' },
      templateTitle: { type: 'string', description: 'Title to replace {{TITLE}} in template' },
    },
    required: ['id', 'title'],
  }

  private emitEvent: ((event: Record<string, unknown>) => void) | null = null
  private panelQuery: (() => Promise<PanelSummary[]>) | null = null
  private assetsPath = ''

  setEventEmitter(fn: (event: Record<string, unknown>) => void) { this.emitEvent = fn }
  setPanelQuery(fn: () => Promise<PanelSummary[]>) { this.panelQuery = fn }
  setAssetsPath(path: string) { this.assetsPath = path }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.id) return 'id is required (unique slug, e.g., "stock-analysis-000001").'
    if (!input.title) return 'title is required. The tab title for the dashboard.'
    if (!input.html && !input.template) return 'Either html or template is required. Use template for pre-built layouts (kpi, chart, monitor, table, report, valuation, backtest).'
    if (input.html && input.template) return 'Use either template+config or custom html, not both. For Dashboard(template:"report"), put report data in config.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const validationError = this.validateInput(input)
    if (validationError) throw new Error(validationError)

    const id = String(input.id)
    const title = String(input.title)

    let html: string
    if (input.template) {
      const templateName = String(input.template)
      const baseDir = this.assetsPath || ctx.bundleDir.replace('/bundle', '')
      // Try flat structure first (chart.html), then subdirectory (chart/template.html)
      let templatePath = join(baseDir, 'dashboards', `${templateName}.html`)
      if (!existsSync(templatePath)) {
        templatePath = join(baseDir, 'dashboards', templateName, 'template.html')
      }
      if (!existsSync(templatePath)) {
        return toolError(`template "${templateName}" not found. Available: kpi, chart, monitor, table, report, report-weekly, valuation, backtest`)
      }
      html = await readFile(templatePath, 'utf-8')
      html = html.replace(/\{\{TITLE\}\}/g, String(input.templateTitle ?? title))

      if (input.config) {
        const configStr = normalizeConfigString(String(input.config))
        if (html.includes('{{CONFIG}}')) {
          html = html.replace('{{CONFIG}}', configStr)
        } else {
          html = replaceConfig(html, configStr)
        }
      }
    } else {
      html = String(input.html)
    }

    const dashboardsDir = join(ctx.basePath, 'dashboards')
    await mkdir(dashboardsDir, { recursive: true })
    const filePath = join(dashboardsDir, `${id}.html`)
    await writeFile(filePath, html, 'utf-8')
    this.emitEvent?.({ type: 'dashboard-open', id, title, path: filePath })
    const observation = await this.waitForPanel((p) =>
      p.type === 'dashboard' && (p.id === `dash-${id}` || p.id === id || normalizeUrl(p.url) === normalizeUrl(filePath))
    )
    const observed = observation.panel
    const mode = input.template ? `template "${input.template}"` : 'custom HTML'
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'dashboard',
      path: filePath,
      title,
      source: 'Dashboard',
      id: `dashboard:${id}`,
      ownerTask: String(input.template ?? 'dashboard'),
      verificationStatus: observed ? 'verified' : 'unverified',
      freshness: {
        fetchedAt: new Date().toISOString(),
        status: 'unknown',
      },
      provenance: {
        source: 'Dashboard',
        mode,
        template: input.template ? String(input.template) : null,
        rendererObserved: Boolean(observed),
      },
      metadata: {
        dashboardId: id,
        mode,
        template: input.template ? String(input.template) : null,
        bytes: html.length,
        observed: Boolean(observed),
        rendererObservationError: observation.error,
        panelId: observed?.id ?? null,
      },
    })
    return JSON.stringify({
      ok: true,
      action: 'dashboard-open',
      id,
      title,
      mode,
      bytes: html.length,
      path: filePath,
      observed: Boolean(observed),
      panel: observed,
      rendererObservationError: observation.error,
      note: observed
        ? 'Dashboard panel was observed in the renderer. Use WebView(action:"screenshot", id: panel.id) or WebView(action:"get_info", id: panel.id) for content verification.'
        : observation.error
          ? 'Dashboard file was written and open event emitted, but renderer observation failed. Use WebView(action:"get_info", id) for bounded static fallback or retry live verification.'
          : 'Dashboard file was written and open event emitted, but the renderer panel was not observed before timeout. Use WebView(action:"list", id:"any") before assuming it opened.',
    }, null, 2)
  }

  private async waitForPanel(predicate: (panel: PanelSummary) => boolean, timeoutMs = 1000): Promise<{ panel: PanelSummary | null; error: string | null }> {
    if (!this.panelQuery) return { panel: null, error: null }
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      let panels: PanelSummary[]
      try {
        panels = await this.panelQuery()
      } catch (error) {
        return { panel: null, error: error instanceof Error ? error.message : String(error) }
      }
      const match = panels.find(predicate)
      if (match) return { panel: match, error: null }
      await new Promise((r) => setTimeout(r, 50))
    }
    return { panel: null, error: null }
  }
}

function normalizeConfigString(configStr: string): string {
  try {
    return JSON.stringify(JSON.parse(configStr))
  } catch (error) {
    throw new Error(`DASHBOARD_CONFIG_INVALID_JSON: config must be valid JSON for template mode. ${error instanceof Error ? error.message : String(error)}`)
  }
}

function normalizeUrl(url: string): string {
  return url.split('?')[0].replace(/^file:\/\//, '').replace(/\/+$/, '')
}

function replaceConfig(html: string, configStr: string): string {
  const marker = 'var CONFIG'
  const start = html.indexOf(marker)
  if (start === -1) return html

  const eqIdx = html.indexOf('=', start + marker.length)
  if (eqIdx === -1) return html

  let braceStart = -1
  for (let i = eqIdx + 1; i < html.length; i++) {
    if (html[i] === '{') { braceStart = i; break }
    if (html[i] === ';') return html
  }
  if (braceStart === -1) return html

  let depth = 0
  let braceEnd = -1
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') {
      depth--
      if (depth === 0) { braceEnd = i; break }
    }
  }
  if (braceEnd === -1) return html

  const semiEnd = html.indexOf(';', braceEnd)
  const end = semiEnd !== -1 && semiEnd <= braceEnd + 2 ? semiEnd + 1 : braceEnd + 1
  return html.slice(0, start) + `var CONFIG = ${configStr};` + html.slice(end)
}
