import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

type EventEmitter = (event: Record<string, unknown>) => void
type RequestHandler = (panelId: string, request: Record<string, unknown>) => Promise<string>
type PanelSummary = { id: string; title: string; url: string; type: string; isActive: boolean }

export class WebViewTool implements Tool {
  name = 'WebView'
  description = 'Control WebView panels: open URLs, navigate, execute JavaScript, query DOM, interact with elements. Also: list open WebViews, locate by URL, refresh.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['open', 'navigate', 'extract', 'execute', 'screenshot', 'cookies', 'dom', 'click', 'input', 'scroll', 'wait_for', 'back', 'forward', 'reload', 'get_info', 'get_html', 'list', 'locate', 'refresh'],
        description: 'Action to perform. list/locate/refresh manage panels; others interact with content.',
      },
      id: { type: 'string', description: 'WebView panel ID (e.g., "eastmoney", "xueqiu")' },
      url: { type: 'string', description: 'URL to open or navigate to' },
      script: { type: 'string', description: 'JavaScript to execute (for extract/execute actions)' },
      title: { type: 'string', description: 'Panel title (for open action)' },
      selector: { type: 'string', description: 'CSS selector (for click/input/dom/wait_for actions)' },
      text: { type: 'string', description: 'Text to input (for input action)' },
      x: { type: 'number', description: 'Horizontal scroll amount or position' },
      y: { type: 'number', description: 'Vertical scroll amount or position' },
      timeout: { type: 'number', description: 'Timeout in ms (for wait_for, default 5000)' },
    },
    required: ['action', 'id'],
  }

  private emitEvent: EventEmitter | null = null
  private requestHandler: RequestHandler | null = null
  private panelQuery: (() => Promise<PanelSummary[]>) | null = null

  setEventEmitter(fn: EventEmitter) { this.emitEvent = fn }
  setRequestHandler(fn: RequestHandler) { this.requestHandler = fn }
  setPanelQuery(fn: () => Promise<PanelSummary[]>) { this.panelQuery = fn }

  validateInput(input: Record<string, unknown>): string | null {
    const action = input.action as string
    if (!action) return 'action is required.'
    if (!input.id) return 'id is required. WebView panel ID.'

    switch (action) {
      case 'open':
      case 'navigate':
        if (!input.url) return `url is required for ${action} action.`
        break
      case 'execute':
        if (!input.script) return 'script is required for execute action.'
        break
      case 'click':
        if (!input.selector) return 'selector is required for click action. CSS selector to click.'
        break
      case 'input':
        if (!input.selector) return 'selector is required for input action.'
        if (input.text === undefined) return 'text is required for input action.'
        break
      case 'wait_for':
        if (!input.selector) return 'selector is required for wait_for action.'
        break
    }
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action)
    const panelId = String(input.id)
    const url = input.url ? String(input.url) : undefined
    const script = input.script ? String(input.script) : undefined
    const title = input.title ? String(input.title) : undefined
    const selector = input.selector ? String(input.selector) : undefined
    const text = input.text !== undefined ? String(input.text) : undefined
    const timeout = Number(input.timeout ?? 5000)

    // Helper to execute JS and return result
    const execJS = async (js: string): Promise<string> => {
      const targetId = await this.resolveActionPanelId(panelId, action)
      if (this.requestHandler) {
        const timeoutMs = clampTimeout(timeout)
        return await withTimeout(
          this.requestHandler(targetId, { type: 'executeJS', script: js, timeoutMs }),
          timeoutMs + 250,
          `WEBVIEW_EXECUTION_TIMEOUT: ${action} script in panel "${targetId}" did not settle within ${timeoutMs}ms. Avoid page scripts that return unresolved Promises; return a bounded value or pass a larger timeout.`,
        )
      }
      throw new Error('WEBVIEW_REQUEST_HANDLER_MISSING: synchronous WebView execution is unavailable. Restart FinAgent Workstation and retry; do not treat this as a successful page interaction.')
    }

    switch (action) {
      case 'open': {
        this.emitEvent?.({ type: 'webview-open', id: panelId, url, title: title ?? panelId })
        const observed = await this.waitForPanel((p) =>
          p.type === 'webview' && (p.id === panelId || normalizeUrl(p.url) === normalizeUrl(url ?? ''))
        )
        return JSON.stringify({
          ok: true,
          action: 'open',
          id: panelId,
          url,
          observed: Boolean(observed),
          panel: observed,
          note: observed
            ? 'WebView panel was observed in the renderer. Page resources may still be loading; use wait_for/get_info/screenshot for content readiness.'
            : 'Open event was emitted, but the renderer panel was not observed before timeout. Use WebView(action:"list", id:"any") before assuming it opened.',
        }, null, 2)
      }

      case 'navigate': {
        this.emitEvent?.({ type: 'webview-navigate', id: panelId, url })
        const observed = await this.waitForPanel((p) =>
          p.type === 'webview' && (p.id === panelId || normalizeUrl(p.url) === normalizeUrl(url ?? ''))
        )
        return JSON.stringify({
          ok: true,
          action: 'navigate',
          id: panelId,
          url,
          observed: Boolean(observed),
          panel: observed,
          note: observed
            ? 'Navigation target was observed in the renderer. Use wait_for/get_info/screenshot to verify page content.'
            : 'Navigate event was emitted, but the renderer state was not observed before timeout. Use WebView(action:"list", id:"any") before continuing.',
        }, null, 2)
      }

      case 'extract': {
        const js = script ?? 'document.body.innerText.slice(0, 10000)'
        return await execJS(js)
      }

      case 'execute': {
        return await execJS(script!)
      }

      case 'screenshot': {
        const targetId = await this.resolveActionPanelId(panelId, action)
        if (!this.requestHandler) {
          throw new Error('WEBVIEW_REQUEST_HANDLER_MISSING: synchronous WebView screenshot is unavailable. Use Screenshot(url/html) only as a fallback for static rendering.')
        }
        const waitMs = Math.max(0, Math.min(Number(input.waitMs ?? 250), 10_000))
        let result: string
        try {
          result = await this.requestHandler(targetId, { type: 'capturePage', waitMs })
        } catch (error) {
          const fallback = await this.staticDashboardInfo(panelId, ctx, error)
          if (fallback) return fallback
          throw error
        }
        const parsed = parseCaptureResult(result)
        const dataUrl = parsed.dataUrl
        if (!dataUrl.startsWith('data:image/png;base64,')) {
          throw new Error('WEBVIEW_CAPTURE_INVALID: renderer did not return a PNG data URL.')
        }
        const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
        const screenshotsDir = join(ctx.basePath, 'memory', '.screenshots')
        await mkdir(screenshotsDir, { recursive: true })
        const screenshotPath = join(screenshotsDir, `webview-${targetId}-${Date.now()}.png`)
        await writeFile(screenshotPath, png)

        return JSON.stringify({
          ok: true,
          action: 'screenshot',
          content: `Screenshot captured from the live open WebView: ${screenshotPath} (${parsed.width}x${parsed.height}, ${(png.length / 1024).toFixed(1)}KB). For visual inspection, call MultimodalAgent with this screenshot path; the configured vision model may be separate from the default text model.`,
          requestedId: panelId,
          resolvedId: targetId,
          screenshotPath,
          images: [{
            path: screenshotPath,
            mediaType: 'image/png',
            width: parsed.width,
            height: parsed.height,
            sizeBytes: png.length,
          }],
          width: parsed.width,
          height: parsed.height,
          sizeKB: Number((png.length / 1024).toFixed(1)),
          note: 'Screenshot captured from the live open WebView. Use MultimodalAgent for visual inspection when the default text model is not vision-capable.',
        }, null, 2)
      }

      case 'cookies': {
        return await execJS('document.cookie')
      }

      case 'dom': {
        const sel = selector ?? script ?? 'body'
        const js = `(function() { var el = document.querySelector('${sel.replace(/'/g, "\\'")}'); return el ? el.outerHTML.slice(0, 5000) : 'WEBVIEW_ELEMENT_MISSING: selector did not match: ${sel}'; })()`
        return await execJS(js)
      }

      case 'click': {
        const js = `(function() {
          var el = document.querySelector('${selector!.replace(/'/g, "\\'")}');
          if (!el) return 'WEBVIEW_ELEMENT_MISSING: selector did not match: ${selector}';
          el.click();
          return 'Clicked: ' + (el.tagName + (el.textContent ? ' "' + el.textContent.slice(0, 50) + '"' : ''));
        })()`
        return await execJS(js)
      }

      case 'input': {
        const js = `(function() {
          var el = document.querySelector('${selector!.replace(/'/g, "\\'")}');
          if (!el) return 'WEBVIEW_ELEMENT_MISSING: selector did not match: ${selector}';
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', {bubbles: true}));
          el.dispatchEvent(new Event('change', {bubbles: true}));
          return 'Input set on: ' + el.tagName + '[' + (el.name || el.id || '') + ']';
        })()`
        return await execJS(js)
      }

      case 'scroll': {
        const sx = Number(input.x ?? 0)
        const sy = Number(input.y ?? 0)
        const js = `(function() {
          function scrollTarget() {
            var root = document.scrollingElement || document.documentElement || document.body;
            var candidates = [root].concat(Array.from(document.querySelectorAll('*')).filter(function(el) {
              var style = window.getComputedStyle(el);
              var overflowY = style.overflowY;
              return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
            }));
            return candidates.reduce(function(best, el) {
              return (el.scrollHeight - el.clientHeight) > (best.scrollHeight - best.clientHeight) ? el : best;
            }, root);
          }
          var target = scrollTarget();
          var before = {
            x: target === document.scrollingElement ? window.scrollX : target.scrollLeft,
            y: target === document.scrollingElement ? window.scrollY : target.scrollTop
          };
          if (target === document.scrollingElement) {
            window.scrollTo({ left: ${sx}, top: ${sy}, behavior: 'auto' });
          } else {
            target.scrollTo({ left: ${sx}, top: ${sy}, behavior: 'auto' });
          }
          var after = {
            x: target === document.scrollingElement ? window.scrollX : target.scrollLeft,
            y: target === document.scrollingElement ? window.scrollY : target.scrollTop
          };
          return JSON.stringify({
            action: 'scroll',
            target: target === document.scrollingElement ? 'document' : (target.id ? '#' + target.id : target.tagName.toLowerCase()),
            requested: { x: ${sx}, y: ${sy} },
            before: before,
            after: after,
            maxY: Math.max(0, target.scrollHeight - target.clientHeight),
            moved: before.x !== after.x || before.y !== after.y
          });
        })()`
        return await execJS(js)
      }

      case 'wait_for': {
        const js = `(function() {
          return new Promise(function(resolve) {
            var attempts = 0;
            var maxAttempts = ${Math.floor(timeout / 100)};
            function check() {
              var el = document.querySelector('${selector!.replace(/'/g, "\\'")}');
              if (el) { resolve('Found: ' + el.tagName + (el.textContent ? ' "' + el.textContent.slice(0, 50) + '"' : '')); return; }
              attempts++;
              if (attempts >= maxAttempts) { resolve('WEBVIEW_ELEMENT_MISSING: selector did not match within ${timeout}ms: ${selector}'); return; }
              setTimeout(check, 100);
            }
            check();
          });
        })()`
        return await execJS(js)
      }

      case 'back': {
        return await execJS('window.history.back(); "Navigated back"')
      }

      case 'forward': {
        return await execJS('window.history.forward(); "Navigated forward"')
      }

      case 'reload': {
        return await execJS('window.location.reload(); "Page reloading"')
      }

      case 'get_info': {
        const js = `JSON.stringify((() => {
          const text = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ').trim();
          return {
            title: document.title,
            url: window.location.href,
            readyState: document.readyState,
            scrollY: window.scrollY,
            innerHeight: window.innerHeight,
            bodyHeight: document.body.scrollHeight,
            textLength: text.length,
            textSnippet: text.slice(0, 1200)
          };
        })())`
        try {
          return await execJS(js)
        } catch (error) {
          const fallback = await this.staticDashboardInfo(panelId, ctx, error)
          if (fallback) return fallback
          throw error
        }
      }

      case 'get_html': {
        const maxLen = 10000
        const js = `document.documentElement.outerHTML.slice(0, ${maxLen})`
        return await execJS(js)
      }

      case 'list': {
        if (!this.panelQuery) return toolError('panel query not available')
        let panels: PanelSummary[]
        try {
          panels = await this.panelQuery()
        } catch (error) {
          return JSON.stringify({
            action: 'list',
            count: 0,
            panels: [],
            rendererObservationError: error instanceof Error ? error.message : String(error),
            note: 'Renderer panel summary timed out; retry later or use a concrete dashboard id for static dashboard fallback.',
          }, null, 2)
        }
        if (panels.length === 0) return 'No WebView panels open.'
        return JSON.stringify({
          action: 'list',
          count: panels.length,
          panels: panels.map((p, i) => ({
            index: i + 1,
            id: p.id,
            title: p.title,
            url: p.url,
            type: p.type,
            active: p.isActive,
          })),
        }, null, 2)
      }

      case 'locate': {
        if (!this.panelQuery) return toolError('panel query not available')
        const searchUrl = url ?? (input.file_path ? String(input.file_path) : undefined)
        if (!searchUrl) return toolError('url or file_path required for locate')
        let panels: PanelSummary[]
        try {
          panels = await this.panelQuery()
        } catch (error) {
          return JSON.stringify({ found: false, url: searchUrl, rendererObservationError: error instanceof Error ? error.message : String(error), hint: 'Renderer panel summary timed out.' })
        }
        const normalized = searchUrl.replace(/\?.*$/, '').replace(/\/+$/, '')
        const match = panels.find((p) => p.url.replace(/\?.*$/, '').replace(/\/+$/, '').includes(normalized) || normalized.includes(p.url.replace(/\?.*$/, '').replace(/\/+$/, '')))
        if (!match) return JSON.stringify({ found: false, url: searchUrl, hint: `No WebView is displaying "${searchUrl}". Use open to create one.` })
        return JSON.stringify({ found: true, id: match.id, title: match.title, url: match.url, active: match.isActive })
      }

      case 'refresh': {
        const resolution = await this.resolvePanel(panelId)
        if (!resolution) {
          let panels: PanelSummary[] = []
          try {
            panels = this.panelQuery ? await this.panelQuery() : []
          } catch { /* keep empty panel summary */ }
          return toolError(`WEBVIEW_PANEL_MISSING: no open WebView/dashboard panel matches "${panelId}". Use WebView(action:"list", id:"any") to inspect open panel ids before refreshing. Open panels: ${summarizePanels(panels)}`)
        }
        const before = resolution.panel
        this.emitEvent?.({ type: 'webview-refresh', id: resolution.panel.id })
        await new Promise((r) => setTimeout(r, 150))
        let afterPanels: PanelSummary[] = []
        try {
          afterPanels = this.panelQuery ? await this.panelQuery() : []
        } catch { /* keep empty panel summary */ }
        const after = afterPanels.find((p) => p.id === resolution.panel.id)
        return JSON.stringify({
          ok: true,
          action: 'refresh',
          requestedId: panelId,
          resolvedId: resolution.panel.id,
          match: resolution.match,
          before: { title: before.title, url: before.url, active: before.isActive },
          after: after ? { title: after.title, url: after.url, active: after.isActive } : null,
          observed: Boolean(after),
          note: after
            ? 'Refresh was applied to the matching panel. For visual verification use WebView(action:"screenshot", id: resolvedId) or WebView(action:"get_info", id: resolvedId).'
            : 'Refresh event was emitted, but the panel could not be observed afterward. Use WebView(action:"list", id:"any") before assuming success.',
        }, null, 2)
      }

      default:
        return toolError(`Unknown action: ${action}. Available: open, navigate, extract, execute, screenshot, cookies, dom, click, input, scroll, wait_for, back, forward, reload, get_info, get_html, list, locate, refresh`)
    }
  }

  private async waitForPanel(predicate: (panel: PanelSummary) => boolean, timeoutMs = 1000): Promise<PanelSummary | null> {
    if (!this.panelQuery) return null
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      let panels: PanelSummary[]
      try {
        panels = await this.panelQuery()
      } catch {
        return null
      }
      const match = panels.find(predicate)
      if (match) return match
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }

  private async resolvePanel(panelId: string): Promise<{ panel: PanelSummary; match: string } | null> {
    if (!this.panelQuery) return { panel: { id: panelId, title: panelId, url: '', type: 'unknown', isActive: false }, match: 'unchecked-no-panel-query' }
    let panels: PanelSummary[]
    try {
      panels = await this.panelQuery()
    } catch {
      return null
    }
    const wanted = normalizePanelRef(panelId)
    const candidates = panels.filter((p) => p.type === 'webview' || p.type === 'dashboard')

    const exact = candidates.find((p) => normalizePanelRef(p.id) === wanted)
    if (exact) return { panel: exact, match: 'id-exact' }

    const dashExact = candidates.find((p) => normalizePanelRef(p.id).replace(/^dash-/, '') === wanted)
    if (dashExact) return { panel: dashExact, match: 'id-without-dash-prefix' }

    const titleMatch = candidates.find((p) => normalizePanelRef(p.title) === wanted || normalizePanelRef(p.title).startsWith(wanted))
    if (titleMatch) return { panel: titleMatch, match: 'title' }

    const urlMatch = candidates.find((p) => {
      const file = p.url.split('?')[0].split(/[\\/]/).filter(Boolean).pop() ?? ''
      const stem = file.replace(/\.html?$/i, '')
      const id = normalizePanelRef(p.id).replace(/^dash-/, '')
      return normalizePanelRef(stem) === wanted || id.startsWith(wanted) || wanted.startsWith(id)
    })
    return urlMatch ? { panel: urlMatch, match: 'url-or-file-stem' } : null
  }

  private async resolveActionPanelId(panelId: string, action: string): Promise<string> {
    const resolution = await this.resolvePanel(panelId)
    if (resolution) return resolution.panel.id
    let panels: PanelSummary[] = []
    try {
      panels = this.panelQuery ? await this.panelQuery() : []
    } catch { /* keep empty panel summary */ }
    throw new Error(`WEBVIEW_PANEL_MISSING: no open WebView/dashboard panel matches "${panelId}" for action "${action}". Use WebView(action:"list", id:"any") to inspect open panel ids. Open panels: ${summarizePanels(panels)}`)
  }

  private async staticDashboardInfo(panelId: string, ctx: ToolContext, cause: unknown): Promise<string | null> {
    const dashboardId = panelId.startsWith('dash-') ? panelId.slice(5) : panelId
    const filePath = join(ctx.basePath, 'dashboards', `${dashboardId}.html`)
    if (!existsSync(filePath)) return null
    const html = await readFile(filePath, 'utf-8')
    const text = reportConfigToText(extractConfigObject(html)) || htmlToText(html)
    return JSON.stringify({
      ok: true,
      action: 'get_info',
      requestedId: panelId,
      resolvedId: `dash-${dashboardId}`,
      fallback: 'static-dashboard-file',
      liveRendererError: cause instanceof Error ? cause.message : String(cause),
      title: extractTitle(html),
      url: filePath,
      readyState: 'static-file',
      bodyHeight: null,
      textLength: text.length,
      textSnippet: text.slice(0, 1200),
      note: 'Live renderer verification timed out, but the dashboard HTML artifact exists and was inspected through the WebView tool fallback. Retry live WebView get_info/screenshot later if visual DOM evidence is required.',
    }, null, 2)
  }
}

function parseCaptureResult(raw: string): { dataUrl: string; width: number | null; height: number | null } {
  try {
    const parsed = JSON.parse(raw) as { dataUrl?: unknown; width?: unknown; height?: unknown }
    return {
      dataUrl: String(parsed.dataUrl ?? ''),
      width: typeof parsed.width === 'number' ? parsed.width : null,
      height: typeof parsed.height === 'number' ? parsed.height : null,
    }
  } catch {
    return { dataUrl: raw, width: null, height: null }
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i)
  return decodeHtml(match?.[1] ?? '')
}

function htmlToText(html: string): string {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
}

function extractConfigObject(html: string): Record<string, unknown> | null {
  const marker = 'var CONFIG'
  const start = html.indexOf(marker)
  if (start === -1) return null
  const eqIdx = html.indexOf('=', start + marker.length)
  if (eqIdx === -1) return null
  let braceStart = -1
  for (let i = eqIdx + 1; i < html.length; i++) {
    if (html[i] === '{') { braceStart = i; break }
    if (html[i] === ';') return null
  }
  if (braceStart === -1) return null

  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        inString = false
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(braceStart, i + 1))
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function reportConfigToText(config: Record<string, unknown> | null): string {
  if (!config) return ''
  const parts: string[] = []
  const add = (value: unknown) => {
    if (value !== undefined && value !== null && String(value).trim()) parts.push(String(value).trim())
  }
  add(config.title)
  add(config.subtitle)
  const funds = Array.isArray(config.funds) ? config.funds : []
  if (funds.length) {
    parts.push('基金基础信息')
    for (const fund of funds) {
      if (!fund || typeof fund !== 'object') continue
      const item = fund as Record<string, unknown>
      add([
        item.name,
        item.code,
        item.type,
        item.valueLabel,
        item.value,
        item.source,
        item.dataTime,
        item.fetchTime,
        item.asOf,
        item.fetchedAt,
      ].filter((value) => value !== undefined && value !== null && String(value).trim()).join(' '))
    }
  }
  add(config.categoryDifference)
  add(config['类别差异'])
  add(config.riskWarning)
  add(config['风险提示'])
  add(config.dataNote)
  add(config['数据说明'])
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function summarizePanels(panels: Array<{ id: string; title: string; url: string; type: string; isActive: boolean }>): string {
  const visible = panels
    .filter((p) => p.type === 'webview' || p.type === 'dashboard')
    .slice(0, 8)
    .map((p) => `${p.id}${p.isActive ? ' (active)' : ''}`)
  return visible.length > 0 ? visible.join(', ') : '(none)'
}

function normalizeUrl(url: string): string {
  return url.split('?')[0].replace(/^file:\/\//, '').replace(/\/+$/, '')
}

function normalizePanelRef(value: string): string {
  return value
    .split('?')[0]
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()!
    .replace(/\.html?$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return 5000
  return Math.max(100, Math.min(Math.floor(value), 60_000))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
