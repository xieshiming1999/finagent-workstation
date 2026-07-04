import { useRef, useEffect, useState } from 'react'
import { handleBridgePanelIpc } from './bridgePanelRuntime'

interface DashboardPanelProps {
  id: string
  htmlPath: string
}

export default function DashboardPanel({ id, htmlPath }: DashboardPanelProps) {
  const webviewRef = useRef<HTMLElement>(null)
  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(() => Date.now())

  useEffect(() => {
    window.agent?.getWebviewPreload().then(setPreloadPath)
  }, [])

  useEffect(() => {
    setRefreshNonce(Date.now())
  }, [htmlPath])

  useEffect(() => {
    const wv = webviewRef.current as any
    if (!wv) return
    const log = (event: string, data: Record<string, unknown>) => {
      const payload = { source: 'dashboard-panel', event, panelId: id, ...data }
      console.log('[DashboardPanelTrace]', payload)
      window.agent?.logWebviewTrace(payload)
    }

    const handleReady = () => {
      log('dom-ready', { htmlPath, preloadPath })
    }
    const handleFinishLoad = () => {
      log('did-finish-load', { htmlPath })
    }
    const handleFailLoad = (event: any) => {
      log('did-fail-load', {
        htmlPath,
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
        validatedURL: event.validatedURL,
      })
    }

    const handleIpc = async (event: any) => {
      await handleBridgePanelIpc({ event, webview: wv, panelId: id, source: 'dashboard-panel', log })
    }

    const handleConsole = (event: any) => {
      log('console-message', {
        level: event.level,
        message: String(event.message ?? '').slice(0, 500),
        line: event.line,
        sourceId: event.sourceId,
      })
    }

    wv.addEventListener('dom-ready', handleReady)
    wv.addEventListener('did-finish-load', handleFinishLoad)
    wv.addEventListener('did-fail-load', handleFailLoad)
    wv.addEventListener('ipc-message', handleIpc)
    wv.addEventListener('console-message', handleConsole)
    return () => {
      wv.removeEventListener('dom-ready', handleReady)
      wv.removeEventListener('did-finish-load', handleFinishLoad)
      wv.removeEventListener('did-fail-load', handleFailLoad)
      wv.removeEventListener('ipc-message', handleIpc)
      wv.removeEventListener('console-message', handleConsole)
    }
  }, [preloadPath, id, htmlPath])

  const normalizedPath = htmlPath.split('?')[0]

  if (!preloadPath) return null

  const srcUrl = `file://${normalizedPath}?t=${refreshNonce}`

  return (
    <div className="flex flex-col h-full">
      <webview
        ref={webviewRef as any}
        data-panel-id={id}
        src={srcUrl}
        preload={`file://${preloadPath}`}
        key={`${normalizedPath}:${refreshNonce}`}
        style={{ flex: 1, width: '100%', height: '100%' }}
        {...{ nodeintegration: 'false' } as any}
      />
    </div>
  )
}
