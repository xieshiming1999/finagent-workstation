import { existsSync, readFileSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

type EventEmitter = (event: Record<string, unknown>) => void
type PanelSummary = { id: string; title: string; url: string; type: string; isActive: boolean }
type UIRequestHandler = (request: Record<string, unknown>) => Promise<string>

/**
 * UIControlTool — mirrors finagent's UIControlTool.
 *
 * Free-form action + params pattern. The handler (set by the UI layer) processes
 * the action and returns a JSON result to the agent. This keeps the agent layer
 * free of UI framework dependency.
 *
 * Available actions:
 *   showQuote — inline stock quote card in chat
 *   showTable — inline data table in chat
 *   showChart — inline chart from data file
 *   showHtml  — inline HTML content in chat
 *   openPage / navigate / addDashboard / selectDashboard — open a dashboard page
 *   addPage   — create and open a new page
 *   closePage — close a dashboard tab
 *   removePage / removeDashboard — remove a page permanently
 *   openPanel — open a panel (webview/dashboard/settings)
 *   closePanel — close a panel
 *   pushData  — push data to a dashboard channel
 */
export class UIControlTool implements Tool {
  name = 'UIControl'
  description = 'Control the UI: show inline widgets (quote cards, tables, charts, HTML), open/close pages and panels, push data to dashboards. Returns structured JSON feedback.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'UI action to perform (e.g., showQuote, showTable, showChart, showHtml, openPage, closePage, openPanel, closePanel, pushData)',
      },
      params: {
        type: 'object',
        description: 'Parameters for the action',
      },
    },
    required: ['action'],
  }

  private emitEvent: EventEmitter | null = null
  private panelQuery: (() => Promise<PanelSummary[]>) | null = null
  private requestHandler: UIRequestHandler | null = null
  setEventEmitter(fn: EventEmitter) { this.emitEvent = fn }
  setPanelQuery(fn: () => Promise<PanelSummary[]>) { this.panelQuery = fn }
  setRequestHandler(fn: UIRequestHandler) { this.requestHandler = fn }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>): string | null {
    const action = input.action as string | undefined
    if (!action?.trim()) return 'action is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action)
    const params = (input.params ?? input.payload ?? {}) as Record<string, unknown>

    if (!this.emitEvent) {
      return toolError('UIControl not available: no UI handler registered.')
    }

    // Map actions to events for the renderer
    switch (action) {
      case 'showQuote': {
        const data = (params.data ?? params) as Record<string, unknown>
        return await this.performRendererRequest({ type: 'ui-widget', action: 'showQuote', params: { data } })
      }

      case 'showTable': {
        const data = params.data
        const title = String(params.title ?? '')
        const columns = params.columns as unknown[] | undefined
        return await this.performRendererRequest({ type: 'ui-widget', action: 'showTable', params: { title, data, columns } })
      }

      case 'showChart': {
        const dataFile = params.dataFile as string | undefined
        if (!dataFile) {
          return toolError('showChart requires "dataFile" param (path to JSON data file). Use Write to create a JSON file with {columns:[...], data:[[...],...]} format, then pass its path here.')
        }
        const filePath = resolve(dataFile)
        if (!existsSync(filePath)) {
          return toolError(`data file not found: ${filePath}. Use Write to create a JSON file with {columns:[...], data:[[...],...]} format.`)
        }
        try {
          const content = readFileSync(filePath, 'utf-8')
          const fileData = JSON.parse(content)
          const columns = fileData.columns as unknown[] | undefined
          const data = fileData.data as unknown[] | undefined

          if (!data || !Array.isArray(data) || data.length === 0) {
            return toolError(`data file has no "data" field or it is empty. File must contain a "data" field with array of records. Actual keys: ${Object.keys(fileData).join(', ')}`)
          }

          let normalizedData: Record<string, unknown>
          if (columns && Array.isArray(columns) && columns.length > 0) {
            normalizedData = fileData
          } else if (typeof data[0] === 'object' && !Array.isArray(data[0])) {
            const firstRow = data[0] as Record<string, unknown>
            const derivedColumns = Object.keys(firstRow)
            const derivedRows = data.map((row: any) =>
              derivedColumns.map((col) => row[col])
            )
            normalizedData = { ...fileData, columns: derivedColumns, data: derivedRows }
          } else {
            return toolError(`data format not recognized. Expected {columns:[...], data:[[...],...]} (Tushare) or {data:[{date:...,open:...},...]} (object array). Actual keys: ${Object.keys(fileData).join(', ')}`)
          }

          return await this.performRendererRequest({
            type: 'ui-widget',
            action: 'showChart',
            params: { ...params, _fileData: normalizedData },
            result: {
              dataFile: filePath,
              fileSize: `${(content.length / 1024).toFixed(1)} KB`,
              columns: (normalizedData.columns as unknown[])?.length ?? 0,
              rows: (normalizedData.data as unknown[])?.length ?? 0,
              columnNames: (normalizedData.columns as unknown[])?.slice(0, 8),
            },
          })
        } catch (e) {
          return toolError(`failed to parse data file: ${e}. File must be JSON with {columns:[...], data:[[...],...]} format.`)
        }
      }

      case 'showHtml': {
        const html = String(params.html ?? '')
        return await this.performRendererRequest({ type: 'ui-widget', action: 'showHtml', params: { html } })
      }

      case 'openPage':
      case 'navigate':
      case 'addDashboard':
      case 'selectDashboard': {
        const path = String(params.path ?? params.file ?? params.url ?? '')
        const title = String(params.title ?? params.name ?? '')
        if (!path) {
          return toolError('path or url required for openPage. Provide the path to an HTML file.')
        }
        const fullPath = resolveRuntimePath(path, ctx)
        if (!existsSync(fullPath)) {
          return toolError(`file not found: ${fullPath}. Use Write to create the file first, then call openPage.`)
        }
        const displayTitle = title || titleFromPath(fullPath)
        const id = slugFromTitle(displayTitle, fullPath)
        this.emitEvent({ type: 'dashboard-open', id, title: displayTitle, path: fullPath })
        const observed = await this.waitForPanel((p) =>
          p.type === 'dashboard' && (p.id === `dash-${id}` || normalizeUrl(p.url) === normalizeUrl(fullPath))
        )
        return JSON.stringify({
          ok: true,
          action: 'openPage',
          path: fullPath,
          title: displayTitle,
          id,
          observed: Boolean(observed),
          panel: observed,
          note: observed
            ? 'Dashboard page was observed in the renderer.'
            : 'Open event was emitted, but the renderer panel was not observed before timeout. Use UIQuery(key:"webviews") or WebView(action:"list", id:"any") before assuming it opened.',
        })
      }

      case 'addPage': {
        const path = String(params.path ?? '')
        const title = String(params.title ?? params.name ?? '')
        if (!path) return toolError('path required for addPage')
        const fullPath = resolveRuntimePath(path, ctx)
        const displayTitle = title || titleFromPath(fullPath)
        const id = slugFromTitle(displayTitle, fullPath)
        this.emitEvent({ type: 'dashboard-open', id, title: displayTitle, path: fullPath })
        const observed = await this.waitForPanel((p) =>
          p.type === 'dashboard' && (p.id === `dash-${id}` || normalizeUrl(p.url) === normalizeUrl(fullPath))
        )
        return JSON.stringify({
          ok: true,
          action: 'addPage',
          path: fullPath,
          title: displayTitle,
          id,
          observed: Boolean(observed),
          panel: observed,
        })
      }

      case 'closePage': {
        const id = String(params.id ?? params.name ?? '')
        if (!id) return toolError('id or name required for closePage')
        this.emitEvent({ type: 'ui-close-panel', id: `dash-${id}` })
        const gone = await this.waitForPanelAbsence(`dash-${id}`)
        return JSON.stringify({ ok: true, action: 'closePage', id, observedClosed: gone })
      }

      case 'removePage':
      case 'removeDashboard': {
        const id = String(params.id ?? params.name ?? '')
        if (!id) return toolError('id or name required for removePage')
        this.emitEvent({ type: 'ui-close-panel', id: `dash-${id}` })
        const gone = await this.waitForPanelAbsence(`dash-${id}`)
        return JSON.stringify({ ok: true, action: 'removePage', id, observedClosed: gone })
      }

      case 'openPanel': {
        const panelId = String(params.id ?? params.panelId ?? '')
        const panelType = String(params.type ?? params.panelType ?? 'dashboard')
        const url = params.url ? String(params.url) : undefined
        const title = String(params.title ?? panelId)
        this.emitEvent({ type: 'ui-open-panel', id: panelId, panelType, url, title })
        const observed = await this.waitForPanel((p) =>
          p.id === panelId || (url ? normalizeUrl(p.url) === normalizeUrl(url) : false)
        )
        return JSON.stringify({
          ok: true,
          action: 'openPanel',
          id: panelId,
          type: panelType,
          observed: Boolean(observed),
          panel: observed,
        })
      }

      case 'closePanel': {
        const panelId = String(params.id ?? params.panelId ?? '')
        this.emitEvent({ type: 'ui-close-panel', id: panelId })
        const gone = await this.waitForPanelAbsence(panelId)
        return JSON.stringify({ ok: true, action: 'closePanel', id: panelId, observedClosed: gone })
      }

      case 'pushData': {
        const id = params.id ? String(params.id) : undefined
        const channel = String(params.channel ?? '')
        const data = params.data
        if (!channel) return toolError('channel required for pushData')
        return await this.performRendererRequest({ type: 'ui-push-data', id, channel, data })
      }

      default:
        return toolError(`Unknown action: ${action}. Available: showQuote, showTable, showChart, showHtml, openPage, addPage, closePage, removePage, openPanel, closePanel, pushData`)
    }
  }

  private async waitForPanel(predicate: (panel: PanelSummary) => boolean, timeoutMs = 1000): Promise<PanelSummary | null> {
    if (!this.panelQuery) return null
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      const panels = await this.panelQuery()
      const match = panels.find(predicate)
      if (match) return match
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }

  private async waitForPanelAbsence(id: string, timeoutMs = 1000): Promise<boolean> {
    if (!this.panelQuery) return false
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      const panels = await this.panelQuery()
      if (!panels.some((p) => p.id === id)) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return false
  }

  private async performRendererRequest(request: Record<string, unknown>): Promise<string> {
    if (!this.requestHandler) {
      return toolError('UI renderer request handler not available. Restart FinAgent Workstation and retry; do not treat this as a successful UI render.')
    }
    return await this.requestHandler(request)
  }
}

function titleFromPath(path: string): string {
  const clean = path.split('?')[0]
  const file = clean.split(/[\\/]/).filter(Boolean).pop() ?? 'Page'
  return file.replace(/\.html?$/i, '') || 'Page'
}

function resolveRuntimePath(path: string, ctx: ToolContext): string {
  if (path.startsWith('file://')) {
    return new URL(path).pathname
  }
  if (isAbsolute(path)) return path
  if (path === 'memory' || path.startsWith('memory/')) {
    return resolve(ctx.basePath, path)
  }
  if (path === 'bundle' || path.startsWith('bundle/')) {
    return resolve(ctx.basePath, path)
  }
  return resolve(ctx.workDir, path)
}

function slugFromTitle(title: string, path: string): string {
  const base = title || titleFromPath(path)
  const slug = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const suffix = Math.abs(hashString(path)).toString(36)
  return `${slug || 'page'}-${suffix}`
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function normalizeUrl(url: string): string {
  return url.split('?')[0].replace(/^file:\/\//, '').replace(/\/+$/, '')
}

export class UIQueryTool implements Tool {
  name = 'UIQuery'
  description = 'Query the current UI state: active panels, window dimensions, current page, theme.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'What to query (e.g., activePanels, windowSize, currentPage, theme)' },
    },
    required: ['key'],
  }

  private handler: ((key: string) => Promise<string>) | null = null
  setHandler(fn: (key: string) => Promise<string>) { this.handler = fn }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const key = String(input.key ?? input.query ?? 'activePanels')
    if (this.handler) {
      return await this.handler(key)
    }
    return toolError(`UIQuery not available: no handler registered. Queried: ${key}`)
  }
}

export class UINotifyTool implements Tool {
  name = 'UINotify'
  description = 'Send a notification to the user with title and message. Used for price alerts, task completion, anomaly detection.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Notification title' },
      message: { type: 'string', description: 'Notification message body' },
      level: { type: 'string', enum: ['info', 'warning', 'error', 'success'], description: 'Notification severity level (default: info)' },
    },
    required: ['message'],
  }

  private emitEvent: EventEmitter | null = null
  private requestHandler: UIRequestHandler | null = null
  setEventEmitter(fn: EventEmitter) { this.emitEvent = fn }
  setRequestHandler(fn: UIRequestHandler) { this.requestHandler = fn }

  needsPermissions(): boolean { return true }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.message || !String(input.message).trim()) return 'message is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const title = String(input.title ?? '')
    const message = String(input.message)
    const level = String(input.level ?? 'info')

    if (this.requestHandler) {
      return await this.requestHandler({ type: 'ui-notify', title, message, level })
    }

    this.emitEvent?.({ type: 'ui-notify', title, message, level })

    return JSON.stringify({
      ok: true,
      action: 'notify',
      title,
      message: message.slice(0, 100),
      level,
      delivery: 'event-emitted-no-ack',
    })
  }
}
