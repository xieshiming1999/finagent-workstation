import { BrowserWindow } from 'electron'
import { DashboardTool } from '../agent/tools/dashboard'
import { UIControlTool, UINotifyTool, UIQueryTool } from '../agent/tools/ui-tools'
import { WebViewTool } from '../agent/tools/webview'
import { executeRendererJavaScript } from './main-runtime'

type PanelSummary = Array<{ id: string; title: string; url: string; type: string; isActive: boolean }>

export function createRendererUiBridge(getMainWindow: () => BrowserWindow | null) {
  const emitToRenderer = (event: Record<string, unknown>) => {
    getMainWindow()?.webContents.send('agent:event', event)
  }

  const queryRendererPanels = async (): Promise<PanelSummary> => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return []
    return await executeRendererJavaScript<PanelSummary>(mainWindow, `
      (function() {
        try {
          const store = window.__panelStore;
          if (!store) return [];
          return store.getState().getWebViewSummary();
        } catch { return []; }
      })()
    `)
  }

  const requestRendererUi = async (request: Record<string, unknown>): Promise<string> => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('UI_WINDOW_MISSING: main window is not available')
    return await executeRendererJavaScript<string>(mainWindow, `
      (function() {
        const request = ${JSON.stringify(request)};
        const store = window.__agentStore;
        if (!store || typeof store.getState !== 'function' || typeof store.setState !== 'function') {
          throw new Error('UI_RENDERER_STORE_MISSING: renderer agent store is not available');
        }

        function now() { return Date.now(); }
        function appendMessage(message) {
          store.setState(function(s) {
            return { messages: (s.messages || []).concat([message]) };
          });
          return store.getState().messages.length;
        }
        function widgetSummary(action, params, extra) {
          const data = params && params.data;
          const rows = Array.isArray(data) ? data.length : 0;
          const columns = Array.isArray(params && params.columns)
            ? params.columns.length
            : (rows > 0 && data[0] && typeof data[0] === 'object' ? Object.keys(data[0]).length : 'auto');
          const base = {
            ok: true,
            action,
            rendered: true,
            position: 'inline chat message #' + store.getState().messages.length,
          };
          if (action === 'showQuote') {
            return Object.assign(base, {
              fields: data && typeof data === 'object' ? Object.keys(data) : [],
              symbol: (data && (data.ts_code || data.symbol)) || 'unknown',
            }, extra || {});
          }
          if (action === 'showTable') {
            return Object.assign(base, { title: (params && params.title) || '', columns, rows }, extra || {});
          }
          if (action === 'showHtml') {
            const html = String((params && params.html) || '');
            return Object.assign(base, {
              htmlLength: html.length,
              preview: html.length > 100 ? html.slice(0, 100) + '...' : html,
            }, extra || {});
          }
          return Object.assign(base, extra || {});
        }

        if (request.type === 'ui-widget') {
          const action = String(request.action || '');
          const params = request.params || {};
          appendMessage({
            role: 'tool-result',
            content: JSON.stringify({ _widget: true, action, params }),
            timestamp: now(),
          });
          return JSON.stringify(widgetSummary(action, params, request.result || {}));
        }

        if (request.type === 'ui-notify') {
          const id = 'notify-' + now();
          const title = String(request.title || '');
          const message = String(request.message || '');
          const level = String(request.level || 'info');
          appendMessage({
            role: 'assistant',
            content: (title ? '**' + title + '** - ' : '') + message,
            timestamp: now(),
          });
          return JSON.stringify({
            ok: true,
            action: 'notify',
            id,
            title,
            message: message.slice(0, 100),
            level,
            stored: true,
            position: 'assistant message #' + store.getState().messages.length,
          });
        }

        if (request.type === 'ui-push-data') {
          const channel = String(request.channel || '');
          const targetId = request.id == null ? '' : String(request.id);
          const webviews = Array.from(document.querySelectorAll('webview'));
          const targets = targetId
            ? webviews.filter(function(wv) {
                return wv.dataset && (wv.dataset.panelId === targetId || wv.id === targetId || ('dash-' + targetId) === wv.dataset.panelId || ('dash-' + targetId) === wv.id);
              })
            : webviews;
          targets.forEach(function(wv) { if (typeof wv.send === 'function') wv.send('bridge-push', channel, request.data || {}); });
          return JSON.stringify({
            ok: true,
            action: 'pushData',
            channel,
            targetId: targetId || null,
            deliveredToPanels: targets.length,
            targetPanelIds: targets.map(function(wv) { return (wv.dataset && wv.dataset.panelId) || wv.id || ''; }).filter(Boolean),
            rawHtmlModified: false,
            note: targets.length > 0
              ? 'Bridge push was delivered to matching WebView processes. Use WebView(screenshot/get_info/get_html) to verify visible result when needed.'
              : 'No matching WebView/dashboard panel was found for this push. Use WebView(action:"list", id:"any") before retrying.',
          });
        }

        throw new Error('UI_RENDERER_UNSUPPORTED_REQUEST: ' + String(request.type));
      })()
    `)
  }

  return { emitToRenderer, queryRendererPanels, requestRendererUi }
}

export function configureWebViewTool(
  webviewTool: WebViewTool,
  getMainWindow: () => BrowserWindow | null,
  emitToRenderer: (event: Record<string, unknown>) => void,
  queryRendererPanels: () => Promise<PanelSummary>,
  requestHandler = createRendererWebViewRequestHandler(getMainWindow),
): void {
  webviewTool.setEventEmitter(emitToRenderer)
  webviewTool.setPanelQuery(queryRendererPanels)
  webviewTool.setRequestHandler(requestHandler)
}

export function createRendererWebViewRequestHandler(
  getMainWindow: () => BrowserWindow | null,
) {
  return async (panelId: string, request: Record<string, unknown>) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('WEBVIEW_WINDOW_MISSING: main window is not available')
    const rendererTimeoutMs = request.type === 'executeJS'
      ? Math.max(350, Math.min(Number(request.timeoutMs || 5000), 60_000) + 500)
      : request.type === 'capturePage'
        ? Math.max(5000, Math.min(Number(request.waitMs || 0), 10_000) + 5000)
        : 5000

    return await executeRendererJavaScript<string>(mainWindow, `
      (async function() {
        const panelId = ${JSON.stringify(panelId)};
        const request = ${JSON.stringify(request)};
        const webviews = Array.from(document.querySelectorAll('webview'));
        const target = webviews.find((el) => el.dataset.panelId === panelId || el.id === panelId);
        if (!target) {
          throw new Error('WEBVIEW_PANEL_MISSING: no open WebView panel with id "' + panelId + '"');
        }

        if (request.type === 'executeJS') {
          const script = String(request.script || '');
          const timeoutMs = Math.max(100, Math.min(Number(request.timeoutMs || 5000), 60000));
          if (!script) throw new Error('WEBVIEW_SCRIPT_MISSING: script is required');
          if (typeof target.executeJavaScript !== 'function') {
            throw new Error('WEBVIEW_EXECUTION_UNAVAILABLE: target panel cannot execute JavaScript');
          }
          const execution = target.executeJavaScript(script);
          if (execution && typeof execution.catch === 'function') execution.catch(function() {});
          const value = await Promise.race([
            execution,
            new Promise(function(_, reject) {
              setTimeout(function() {
                reject(new Error('WEBVIEW_EXECUTION_TIMEOUT: script did not settle within ' + timeoutMs + 'ms'));
              }, timeoutMs);
            })
          ]);
          if (typeof value === 'string') return value;
          if (value === undefined) return 'undefined';
          return JSON.stringify(value);
        }

        if (request.type === 'capturePage') {
          if (typeof target.capturePage !== 'function') {
            throw new Error('WEBVIEW_CAPTURE_UNAVAILABLE: target panel cannot capture screenshots');
          }
          const waitMs = Number(request.waitMs || 0);
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
          const image = await target.capturePage();
          const size = typeof image.getSize === 'function' ? image.getSize() : { width: null, height: null };
          return JSON.stringify({
            dataUrl: image.toDataURL(),
            width: size.width,
            height: size.height
          });
        }

        throw new Error('WEBVIEW_UNSUPPORTED_REQUEST: ' + String(request.type));
      })()
    `, rendererTimeoutMs)
  }
}

export function configureDashboardTool(
  dashboardTool: DashboardTool,
  assetsPath: string,
  emitToRenderer: (event: Record<string, unknown>) => void,
  queryRendererPanels: () => Promise<PanelSummary>,
): void {
  dashboardTool.setEventEmitter(emitToRenderer)
  dashboardTool.setPanelQuery(queryRendererPanels)
  dashboardTool.setAssetsPath(assetsPath)
}

export function configureUiTools(
  uiControlTool: UIControlTool,
  uiNotifyTool: UINotifyTool,
  uiQueryTool: UIQueryTool,
  getMainWindow: () => BrowserWindow | null,
  emitToRenderer: (event: Record<string, unknown>) => void,
  queryRendererPanels: () => Promise<PanelSummary>,
  requestRendererUi: (request: Record<string, unknown>) => Promise<string>,
  queryUi = createRendererUiQuery(getMainWindow, queryRendererPanels),
): void {
  uiControlTool.setEventEmitter(emitToRenderer)
  uiControlTool.setPanelQuery(queryRendererPanels)
  uiControlTool.setRequestHandler(requestRendererUi)
  uiNotifyTool.setEventEmitter(emitToRenderer)
  uiNotifyTool.setRequestHandler(requestRendererUi)
  uiQueryTool.setHandler(queryUi)
}

export function createRendererUiQuery(
  getMainWindow: () => BrowserWindow | null,
  queryRendererPanels: () => Promise<PanelSummary>,
) {
  return async (key: string) => {
    switch (key) {
      case 'activePanels':
      case 'panels': {
        const wins = BrowserWindow.getAllWindows()
        return JSON.stringify({ windows: wins.length, focused: BrowserWindow.getFocusedWindow()?.id ?? null })
      }
      case 'windowSize': {
        const win = getMainWindow()
        if (!win) return JSON.stringify({ error: 'no window' })
        const [w, h] = win.getSize()
        return JSON.stringify({ width: w, height: h })
      }
      case 'theme':
        return JSON.stringify({ theme: 'system' })
      case 'webviews': {
        const mainWindow = getMainWindow()
        if (!mainWindow) return JSON.stringify({ webviews: [] })
        try {
          const panels = await queryRendererPanels()
          return JSON.stringify({ webviews: panels })
        } catch { return JSON.stringify({ webviews: [] }) }
      }
      default:
        return JSON.stringify({ error: `Unknown key: ${key}`, available: ['activePanels', 'windowSize', 'theme'] })
    }
  }
}
