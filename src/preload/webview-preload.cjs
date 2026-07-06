const { contextBridge, ipcRenderer } = require('electron')

function ensureBridge() {
  let id = 0
  const DEFAULT_BRIDGE_TIMEOUT_MS = 30000
  const MAX_BRIDGE_TIMEOUT_MS = 120000
  const callbacks = {}
  const pushHandlers = {}
  function emitBridgeDiagnostic(event, data) {
    try {
      ipcRenderer.sendToHost('webview-diagnostic', {
        event,
        href: location.href,
        title: document.title,
        ...data,
      })
    } catch (_) {}
  }
  function bridgeTimeoutMs(msg) {
    const params = msg && typeof msg.params === 'object' && msg.params ? msg.params : {}
    const raw = msg.timeoutMs ?? msg.timeout ?? params._timeoutMs ?? params.timeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_BRIDGE_TIMEOUT_MS
    return Math.max(100, Math.min(Math.floor(n), MAX_BRIDGE_TIMEOUT_MS))
  }
  function handleBridgeCallback(callbackId, data) {
    const entry = callbacks[callbackId]
    if (entry) {
      entry.resolve(data)
      delete callbacks[callbackId]
    }
  }
  function send(msg) {
    return new Promise((resolve) => {
      const callbackId = String(++id)
      msg.id = msg.id || callbackId
      const timeoutMs = bridgeTimeoutMs(msg)
      let settled = false
      let timer = null
      const finish = (data) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        delete callbacks[msg.id]
        resolve(data)
      }
      timer = setTimeout(() => {
        const error = `BRIDGE_TIMEOUT: ${String(msg.type || 'request')} ${String(msg.path || '')} did not receive a callback within ${timeoutMs}ms`
        emitBridgeDiagnostic('bridge-timeout', {
          id: msg.id,
          type: msg.type,
          path: msg.path,
          timeoutMs,
        })
        finish({ error, timeout: true, id: msg.id, type: msg.type, path: msg.path })
      }, timeoutMs)
      callbacks[msg.id] = { resolve: finish }
      ipcRenderer.sendToHost('bridge-message', msg)
    })
  }
  const B = {
    fetch: (path, params, method) => send({ type: 'http', method: method || 'GET', path, params: params || {} }),
    callService: (path, params, method) => send({ type: 'http', method: method || 'GET', path, params: params || {} }),
    get: (path, options) => send({ type: 'http', method: 'GET', path, params: (options || {}).params || {} }),
    post: (path, body) => send({ type: 'http', method: 'POST', path, params: body || {} }),
    put: (path, body) => send({ type: 'http', method: 'PUT', path, params: body || {} }),
    delete: (path, options) => send({ type: 'http', method: 'DELETE', path, params: (options || {}).params || {} }),
    readFile: (path) => send({ type: 'readFile', path }).then((r) => r && r.content),
    writeFile: (path, content) => send({ type: 'writeFile', path, content }),
    listDir: (path) => send({ type: 'listDir', path: path || '.' }).then((r) => (r && r.entries) || []),
    fileExists: (path) => send({ type: 'fileExists', path }).then((r) => !!(r && r.exists)),
    fileStat: (path) => send({ type: 'fileStat', path }),
    getState: (key) => send({ type: 'getState', key, source: document.title || location.pathname }).then((r) => r && r.value),
    setState: (key, value) => send({ type: 'setState', key, value, source: document.title || location.pathname }),
    sendToAgent: (message, data) => send({ type: 'agent_message', message, source: document.title || 'dashboard', data: data || {} }),
    sendToMonitor: (monitorId, channel, data) => send({ type: 'sendToMonitor', monitorId, channel, data: data || {} }),
    notify: (message, severity) => send({ type: 'notify', message, severity }),
    alert: (message) => send({ type: 'notify', message: '⚠ ' + message, severity: 'alert' }),
    getConfig: (key) => send({ type: 'getConfig', key }).then((r) => r && r.value),
    onPush: (channel, handler) => {
      pushHandlers[channel] = handler
    },
  }
  B.parseCSV = function(text, sep) {
    sep = sep || ','
    return String(text).split('\n').filter((line) => line.trim()).map((line) => line.split(sep).map((v) => v.trim()))
  }
  B.toCSV = function(rows, sep) {
    sep = sep || ','
    return rows.map((row) => Array.isArray(row) ? row.map((cell) => {
      const value = String(cell)
      return value.includes(sep) || value.includes('"') || value.includes('\n') ? '"' + value.replace(/"/g, '""') + '"' : value
    }).join(sep) : String(row)).join('\n')
  }
  B.sum = (arr) => arr.reduce((a, b) => a + b, 0)
  B.avg = (arr) => arr.length ? B.sum(arr) / arr.length : 0
  B.median = (arr) => {
    if (!arr.length) return 0
    const sorted = arr.slice().sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  B.groupBy = (arr, key) => arr.reduce((out, item) => {
    const value = typeof key === 'function' ? key(item) : item[key]
    ;(out[value] ||= []).push(item)
    return out
  }, {})
  B.unique = (arr) => Array.from(new Set(arr.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)))).map((v) => {
    try { return JSON.parse(v) } catch { return v }
  })
  B.sortBy = (arr, key, desc) => arr.slice().sort((a, b) => {
    const av = typeof key === 'function' ? key(a) : a[key]
    const bv = typeof key === 'function' ? key(b) : b[key]
    if (av < bv) return desc ? 1 : -1
    if (av > bv) return desc ? -1 : 1
    return 0
  })
  B.flatten = (arr) => arr.reduce((out, item) => out.concat(Array.isArray(item) ? B.flatten(item) : item), [])
  B.parseXML = function(text) {
    text = String(text || '').trim()
    const m = text.match(/^<([\w:-]+)([^>]*)>([\s\S]*)<\/\1>$/)
    if (!m) return { text }
    const attrs = {}
    String(m[2] || '').replace(/([\w:-]+)=["']([^"']*)["']/g, (_, k, v) => { attrs[k] = v; return '' })
    return { tag: m[1], attrs, text: String(m[3] || '').replace(/<[^>]+>/g, '').trim() }
  }
  B.base64Encode = (text) => Buffer.from(String(text), 'utf8').toString('base64')
  B.base64Decode = (text) => Buffer.from(String(text), 'base64').toString('utf8')
  B.hexEncode = (text) => Buffer.from(String(text), 'utf8').toString('hex')
  B.hexDecode = (hex) => Buffer.from(String(hex), 'hex').toString('utf8')
  B.hash = async (text, algo) => {
    const crypto = require('crypto')
    return crypto.createHash(algo || 'sha256').update(String(text)).digest('hex')
  }

  const agentBridge = {
    postMessage: function(jsonStr) {
      try {
        const msg = JSON.parse(jsonStr)
        ipcRenderer.sendToHost('bridge-message', msg)
      } catch (e) {
        console.error('AgentBridge parse error:', e)
      }
    },
  }

  try {
    contextBridge.exposeInMainWorld('Bridge', B)
    contextBridge.exposeInMainWorld('AgentBridge', agentBridge)
  } catch (e) {
    window.Bridge = B
    window.AgentBridge = agentBridge
    console.error('[WebViewPreload] contextBridge expose failed, used direct window fallback:', e)
  }

  return { handleBridgeCallback, pushHandlers, bridge: B }
}

const exposed = ensureBridge()

function emitDiagnostic(event, data) {
  ipcRenderer.sendToHost('webview-diagnostic', {
    event,
    href: location.href,
    title: document.title,
    ...data,
  })
}

console.log('[WebViewPreload] Bridge injected', {
  exposedViaContextBridge: true,
  hasBridgeInPreloadWorld: typeof exposed.bridge !== 'undefined',
  href: location.href,
})
emitDiagnostic('preload-ready', {
  exposedViaContextBridge: true,
  hasBridgeInPreloadWorld: typeof exposed.bridge !== 'undefined',
})

ipcRenderer.on('bridge-callback', (_, id, data) => {
  emitDiagnostic('bridge-callback', {
    id,
    hasError: Boolean(data && data.error),
    error: data && data.error ? String(data.error).slice(0, 200) : undefined,
  })
  if (exposed.handleBridgeCallback) {
    exposed.handleBridgeCallback(id, data)
  }
})

ipcRenderer.on('bridge-push', (_, channel, data) => {
  emitDiagnostic('bridge-push', {
    channel,
    dataKeys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [],
  })
  if (exposed.pushHandlers && exposed.pushHandlers[channel]) {
    exposed.pushHandlers[channel](data)
  }
})
