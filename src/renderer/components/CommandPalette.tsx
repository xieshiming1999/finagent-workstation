import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { usePanelStore } from '../store/usePanelStore'
import { useAgentStore } from '../store/useAgentStore'
import { useSidebarStore } from '../store/useSidebarStore'
import { useLayoutStore, LAYOUT_CONFIGS, type LayoutMode } from '../store/useLayoutStore'
import { useThemeStore, type ThemeMode } from '../store/useThemeStore'
import { panelTitle, useT, widgetTitle } from '../store/useLanguageStore'

interface Command {
  id: string
  label: string
  category: string
  shortcut?: string
  action: () => void
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const addPanel = usePanelStore((s) => s.addPanel)
  const clearMessages = useAgentStore((s) => s.clearMessages)
  const setLayout = useLayoutStore((s) => s.setMode)
  const addWidget = useSidebarStore((s) => s.addWidget)
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar)
  const setTheme = useThemeStore((s) => s.setMode)

  const commands: Command[] = [
    { id: 'settings', label: t('openSettings'), category: t('commandAppCategory'), shortcut: '⌘,', action: () => addPanel({ id: 'settings', type: 'settings', title: panelTitle('settings'), closable: true }) },
    { id: 'strategy-library', label: t('strategyLibrary'), category: t('commandFinanceCategory'), action: () => addPanel({ id: 'strategy-library', type: 'strategy-library' as any, title: t('strategyLibrary'), closable: true }) },
    { id: 'data-manager', label: t('dataManager'), category: t('commandFinanceCategory'), action: () => addPanel({ id: 'data-manager', type: 'data-manager' as any, title: t('dataManager'), closable: true }) },
    { id: 'macro-research', label: t('factorRadar'), category: t('commandFinanceCategory'), action: () => addPanel({ id: 'macro-research', type: 'macro-research', title: t('factorRadar'), closable: true }) },
    { id: 'portfolio-widget', label: `${widgetTitle('portfolio')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'portfolio', type: 'portfolio', title: widgetTitle('portfolio') }) },
    { id: 'session-widget', label: `${widgetTitle('session')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'session', type: 'session', title: widgetTitle('session') }) },
    { id: 'sessions-widget', label: `${widgetTitle('sessions')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'sessions', type: 'sessions', title: widgetTitle('sessions') }) },
    { id: 'watchlist', label: `${widgetTitle('watchlist')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'watchlist', type: 'watchlist', title: widgetTitle('watchlist') }) },
    { id: 'fund-pulse', label: `${widgetTitle('fund-pulse')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'fund-pulse', type: 'fund-pulse', title: widgetTitle('fund-pulse') }) },
    { id: 'fund-watchlist', label: `${widgetTitle('fund-watchlist')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'fund-watchlist', type: 'fund-watchlist', title: widgetTitle('fund-watchlist') }) },
    { id: 'apihealth', label: `${widgetTitle('api-health')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'api-health', type: 'api-health', title: widgetTitle('api-health') }) },
    { id: 'eastmoney', label: t('commandOpenEastMoney'), category: t('commandWebViewCategory'), action: () => usePanelStore.getState().openWebView('eastmoney', 'https://www.eastmoney.com', 'EastMoney') },
    { id: 'xueqiu', label: t('commandOpenXueqiu'), category: t('commandWebViewCategory'), action: () => usePanelStore.getState().openWebView('xueqiu', 'https://xueqiu.com', 'Xueqiu') },
    { id: 'clear', label: t('commandClearChat'), category: t('commandChatCategory'), action: () => { clearMessages(); window.agent?.clear() } },
    { id: 'devtools', label: t('commandToggleDevtools'), category: t('commandDevCategory'), shortcut: '⌘⇧I', action: () => { /* handled by Electron */ } },
    { id: 'newchat', label: t('commandNewChatSession'), category: t('commandChatCategory'), shortcut: '⌘N', action: () => { clearMessages(); window.agent?.clear() } },
    { id: 'news', label: `${widgetTitle('news')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'news', type: 'news', title: widgetTitle('news') }) },
    { id: 'calendar', label: `${widgetTitle('calendar')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'calendar', type: 'calendar', title: widgetTitle('calendar') }) },
    { id: 'pulse', label: `${widgetTitle('pulse')} ${t('widgetSidebarSuffix')}`, category: t('commandWidgetCategory'), action: () => addWidget({ id: 'pulse', type: 'pulse', title: widgetTitle('pulse') }) },
    { id: 'sidebar-toggle', label: t('commandToggleSidebar'), category: t('commandLayoutCategory'), shortcut: '⌘B', action: toggleSidebar },
    { id: 'theme-light', label: t('themeLight'), category: t('commandThemeCategory'), action: () => setTheme('light') },
    { id: 'theme-dark', label: t('themeDark'), category: t('commandThemeCategory'), action: () => setTheme('dark') },
    { id: 'theme-warm', label: t('themeWarm'), category: t('commandThemeCategory'), action: () => setTheme('warm') },
    { id: 'theme-system', label: t('themeSystem'), category: t('commandThemeCategory'), action: () => setTheme('system') },
    ...Object.entries(LAYOUT_CONFIGS).map(([key, cfg]) => ({
      id: `layout-${key}`, label: `${t('layoutPrefix')}: ${cfg.label}`, category: t('commandLayoutCategory'),
      action: () => setLayout(key as LayoutMode),
    })),
  ]

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()) || c.category.toLowerCase().includes(query.toLowerCase()))
    : commands

  useEffect(() => {
    inputRef.current?.focus()
    setSelectedIdx(0)
  }, [query])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return }
    if (e.key === 'Enter' && filtered[selectedIdx]) {
      filtered[selectedIdx].action()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20%]" onClick={onClose}>
      <div className="w-[480px] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('typeCommand')}
            className="w-full text-sm focus:outline-none"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => { cmd.action(); onClose() }}
              className={`w-full flex items-center justify-between px-4 py-2 text-sm ${
                i === selectedIdx ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-16">{cmd.category}</span>
                <span>{cmd.label}</span>
              </div>
              {cmd.shortcut && <span className="text-xs text-gray-400 font-mono">{cmd.shortcut}</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">{t('noCommandsFound')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
