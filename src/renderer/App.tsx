import { useEffect, useState, useCallback } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import ChatPanel from './panels/ChatPanel'
import EventConsole from './panels/EventConsole'
import WorkspaceArea from './panels/WorkspaceArea'
import SidebarArea from './panels/SidebarArea'
import MarketBar from './components/MarketBar'
import MarketWeatherBackground from './components/MarketWeatherBackground'
import CommandPalette from './components/CommandPalette'
import { useAgentStore } from './store/useAgentStore'
import { useEventStore } from './store/useEventStore'
import { usePanelStore } from './store/usePanelStore'
import { useSidebarStore } from './store/useSidebarStore'
import { useLayoutStore, LAYOUT_CONFIGS } from './store/useLayoutStore'
import { panelTitle, useLanguageStore, useT } from './store/useLanguageStore'
import { useBottomPanelStore } from './store/useBottomPanelStore'

export default function App() {
  const t = useT()
  const handleEvent = useAgentStore((s) => s.handleEvent)
  const restoreSession = useAgentStore((s) => s.restoreSession)
  const handleEventAgentEvent = useEventStore((s) => s.handleEvent)
  const restoreEventSession = useEventStore((s) => s.restoreSession)
  const addPanel = usePanelStore((s) => s.addPanel)
  const sidebarVisible = useSidebarStore((s) => s.visible)
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar)
  const localizeWidgets = useSidebarStore((s) => s.localizeBuiltinTitles)
  const localizePanels = usePanelStore((s) => s.localizeBuiltinTitles)
  const localizeBottomPanels = useBottomPanelStore((s) => s.localizeBuiltinTitles)
  const [consoleVisible, setConsoleVisible] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const eventMessages = useEventStore((s) => s.messages)
  const eventProcessing = useEventStore((s) => s.isProcessing)
  const layoutMode = useLayoutStore((s) => s.mode)
  const layoutConfig = LAYOUT_CONFIGS[layoutMode]
  const resolvedLanguage = useLanguageStore((s) => s.resolved)

  // Auto-expand console when first event arrives
  useEffect(() => {
    if (eventMessages.length > 0 && !consoleVisible) {
      // Don't auto-expand — just let the status bar badge notify
    }
  }, [eventMessages.length])

  useEffect(() => {
    if (!window.agent) return
    restoreSession()
    restoreEventSession()
    const off1 = window.agent.onEvent(handleEvent)
    const off2 = window.agent.onEventAgentEvent(handleEventAgentEvent)
    return () => { off1(); off2() }
  }, [handleEvent, handleEventAgentEvent, restoreSession, restoreEventSession])

  useEffect(() => {
    localizeWidgets()
    localizePanels()
    localizeBottomPanels()
  }, [resolvedLanguage, localizeWidgets, localizePanels, localizeBottomPanels])

  const toggleConsole = useCallback(() => setConsoleVisible((v) => !v), [])

  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase()
    if ((e.metaKey || e.ctrlKey) && key === 'k') { e.preventDefault(); setShowPalette((v) => !v) }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); addPanel({ id: 'settings', type: 'settings', title: panelTitle('settings'), closable: true }) }
    if ((e.metaKey || e.ctrlKey) && key === 'b') { e.preventDefault(); toggleSidebar() }
    if ((e.metaKey || e.ctrlKey) && key === 'j') { e.preventDefault(); toggleConsole() }
    if (e.key === 'Escape' && showPalette) { setShowPalette(false) }
  }, [showPalette, addPanel, toggleSidebar, toggleConsole])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [handleGlobalKey])

  return (
    <div className="flex flex-col w-screen h-screen min-w-0 relative" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <MarketWeatherBackground />

      {/* Title bar */}
      <div className="h-9 w-full min-w-0 flex items-center shrink-0 select-none" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="w-20 shrink-0" />
        <span className="flex-1 text-center text-xs text-gray-400 font-medium">{t('appName')}</span>
        <div className="flex items-center gap-1 mr-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => setShowPalette(true)} className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100" title={`⌘K ${t('commandPaletteShortcut')}`}>⌘K</button>
          <button onClick={toggleSidebar} className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100" title={`⌘B ${t('commandToggleSidebar')}`}>{sidebarVisible ? '◫' : '◧'}</button>
          <button
            onClick={toggleConsole}
            className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 relative"
            title={`⌘J ${t('consoleShortcut')}`}
          >
            {consoleVisible ? '⬒' : '⬓'}
            {!consoleVisible && eventProcessing && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />}
            {!consoleVisible && eventMessages.length > 0 && !eventProcessing && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full" />}
          </button>
          <button onClick={() => addPanel({ id: 'settings', type: 'settings', title: panelTitle('settings'), closable: true })} className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100">{t('settings')}</button>
        </div>
      </div>

      {/* Main content: 3 columns */}
      <div className="w-full min-w-0 flex-1 overflow-hidden">
        <Allotment>
          {/* Left: Sidebar widgets */}
          {sidebarVisible && (
            <Allotment.Pane minSize={180} preferredSize="20%" maxSize={360}>
              <div className="h-full w-full min-w-0" style={{ borderRight: '1px solid var(--border)' }}>
                <SidebarArea />
              </div>
            </Allotment.Pane>
          )}

          {/* Center: WebView tabs + Event Console */}
          <Allotment.Pane minSize={320}>
            <Allotment vertical>
              {/* WebView / Dashboard / Settings tabs */}
              <Allotment.Pane minSize={200}>
                <WorkspaceArea />
              </Allotment.Pane>

              {/* Event Console (collapsed by default) */}
              {consoleVisible && (
                <Allotment.Pane minSize={80} preferredSize={180} maxSize={400}>
                  <EventConsole />
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>

          {/* Right: Chat Agent (pure, no tab switching) */}
          {layoutConfig.chatWidth !== '0%' && (
            <Allotment.Pane minSize={280} preferredSize={layoutConfig.chatWidth}>
              <div className="h-full w-full min-w-0" style={{ borderLeft: '1px solid var(--border)' }}>
                <ChatPanel />
              </div>
            </Allotment.Pane>
          )}
        </Allotment>
      </div>

      <MarketBar />
      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} />}
    </div>
  )
}
