import { t } from '../store/useLanguageStore'

type LogFn = (event: string, data: Record<string, unknown>) => void

const DEFAULT_BRIDGE_TIMEOUT_MS = 30_000
const MAX_BRIDGE_TIMEOUT_MS = 120_000

export function bridgeMessageTimeoutMs(msg: unknown): number {
  const m = msg && typeof msg === 'object' ? msg as Record<string, unknown> : {}
  const params = m.params && typeof m.params === 'object' && !Array.isArray(m.params)
    ? m.params as Record<string, unknown>
    : {}
  const raw = m.timeoutMs ?? m.timeout ?? params._timeoutMs ?? params.timeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_BRIDGE_TIMEOUT_MS
  return Math.max(100, Math.min(Math.floor(value), MAX_BRIDGE_TIMEOUT_MS))
}

export async function callBridgeMessageWithTimeout(
  msg: unknown,
  bridgeMessage: ((msg: unknown) => Promise<unknown>) | undefined,
): Promise<unknown> {
  if (!bridgeMessage) return { error: t('bridgeRendererUnavailable') }
  const timeoutMs = bridgeMessageTimeoutMs(msg)
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      bridgeMessage(msg),
      new Promise<unknown>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`BRIDGE_RENDERER_TIMEOUT: bridge message did not complete within ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      timeout: err instanceof Error && err.message.startsWith('BRIDGE_RENDERER_TIMEOUT'),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function handleBridgePanelIpc(args: {
  event: any
  webview: any
  panelId: string
  source: 'webview-panel' | 'dashboard-panel'
  log: LogFn
}): Promise<void> {
  const { event, webview, log } = args
  if (event.channel === 'webview-diagnostic') {
    const diagnostic = event.args?.[0]
    log('webview-diagnostic', summarizeDiagnostic(diagnostic))
    return
  }

  const msg = event.args?.[0]
  if (!msg?.id) return
  log('bridge-request', summarizeBridgeMessage(msg))

  if (msg.type === 'sendToMonitor') {
    const result = deliverMonitorPush(msg)
    log('bridge-response', { id: msg.id, type: msg.type, result: summarizeBridgeResult(result) })
    webview.send?.('bridge-callback', msg.id, result)
    return
  }

  const result = await callBridgeMessageWithTimeout(msg, window.agent?.bridgeMessage)
  log('bridge-response', { id: msg.id, type: msg.type, result: summarizeBridgeResult(result) })
  webview.send?.('bridge-callback', msg.id, result)
}

function deliverMonitorPush(msg: any): Record<string, unknown> {
  const targetId = String(msg.monitorId ?? '')
  const channel = String(msg.channel ?? '')
  const target = Array.from(document.querySelectorAll('webview')).find((el: any) =>
    el.dataset?.panelId === targetId || el.id === targetId
  ) as any
  if (target && channel) {
    target.send?.('bridge-push', channel, msg.data ?? {})
    return { ok: true, delivered: true, monitorId: targetId, channel }
  }
  return { error: `Bridge target not found for sendToMonitor: ${targetId}` }
}

export function summarizeBridgeMessage(msg: any): Record<string, unknown> {
  const data = msg?.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? msg.data : {}
  return {
    id: msg?.id,
    type: msg?.type,
    path: msg?.path,
    method: msg?.method,
    source: msg?.source,
    message: typeof msg?.message === 'string' ? msg.message.slice(0, 120) : undefined,
    dataKeys: Object.keys(data),
  }
}

export function summarizeBridgeResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { value: result }
  const r = result as Record<string, unknown>
  const data = Array.isArray(r.data) ? r.data : null
  return {
    ok: r.ok,
    error: r.error,
    queued: r.queued,
    notificationId: r.notificationId,
    source: r.source,
    warning: r.warning,
    timeout: r.timeout,
    dataCount: data?.length,
    firstCode: data && data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>).code : undefined,
  }
}

export function summarizeDiagnostic(diagnostic: unknown): Record<string, unknown> {
  if (!diagnostic || typeof diagnostic !== 'object') return { value: diagnostic }
  const d = diagnostic as Record<string, unknown>
  return {
    event: typeof d.event === 'string' ? d.event : undefined,
    href: typeof d.href === 'string' ? d.href.slice(0, 300) : undefined,
    title: typeof d.title === 'string' ? d.title.slice(0, 120) : undefined,
    exposedViaContextBridge: d.exposedViaContextBridge,
    hasBridgeInPreloadWorld: d.hasBridgeInPreloadWorld,
    hasError: d.hasError,
    error: typeof d.error === 'string' ? d.error.slice(0, 200) : undefined,
    id: d.id,
    channel: d.channel,
    dataKeys: Array.isArray(d.dataKeys) ? d.dataKeys : undefined,
  }
}
