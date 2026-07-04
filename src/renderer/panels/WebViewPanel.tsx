import { useRef, useEffect, useState } from 'react'
import { handleBridgePanelIpc } from './bridgePanelRuntime'

interface WebViewPanelProps {
  url: string
  id: string
}

export default function WebViewPanel({ url, id }: WebViewPanelProps) {
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [preloadPath, setPreloadPath] = useState<string | null>(null)

  useEffect(() => {
    window.agent?.getWebviewPreload().then(setPreloadPath)
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const log = (event: string, data: Record<string, unknown>) => {
      const payload = { source: 'webview-panel', event, panelId: id, ...data }
      console.log('[WebViewPanelTrace]', payload)
      window.agent?.logWebviewTrace(payload)
    }

    const handleReady = () => {
      (wv as any).setUserAgent?.((wv as any).getUserAgent?.() ?? '')
      log('dom-ready', { url, preloadPath })
    }
    const handleFinishLoad = () => {
      log('did-finish-load', { url })
    }
    const handleFailLoad = (event: any) => {
      log('did-fail-load', {
        url,
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
        validatedURL: event.validatedURL,
      })
    }
    wv.addEventListener('dom-ready', handleReady)
    wv.addEventListener('did-finish-load', handleFinishLoad)
    wv.addEventListener('did-fail-load', handleFailLoad)
    return () => {
      wv.removeEventListener('dom-ready', handleReady)
      wv.removeEventListener('did-finish-load', handleFinishLoad)
      wv.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [id, preloadPath, url])

  useEffect(() => {
    const wv = webviewRef.current as any
    if (!wv) return
    const log = (event: string, data: Record<string, unknown>) => {
      const payload = { source: 'webview-panel', event, panelId: id, ...data }
      console.log('[WebViewPanelTrace]', payload)
      window.agent?.logWebviewTrace(payload)
    }

    const handleIpc = async (event: any) => {
      await handleBridgePanelIpc({ event, webview: wv, panelId: id, source: 'webview-panel', log })
    }

    const handleConsole = (event: any) => {
      log('console-message', {
        level: event.level,
        message: String(event.message ?? '').slice(0, 500),
        line: event.line,
        sourceId: event.sourceId,
      })
    }

    wv.addEventListener('ipc-message', handleIpc)
    wv.addEventListener('console-message', handleConsole)
    return () => {
      wv.removeEventListener('ipc-message', handleIpc)
      wv.removeEventListener('console-message', handleConsole)
    }
  }, [preloadPath, id])

  if (!preloadPath) return null

  return (
    <div className="h-full">
      <webview
        ref={webviewRef as any}
        data-panel-id={id}
        src={url}
        preload={`file://${preloadPath}`}
        partition={`persist:${id}`}
        style={{ width: '100%', height: '100%' }}
        {...{ allowpopups: 'true' } as any}
      />
    </div>
  )
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface HTMLWebViewElement extends HTMLElement {}
}
