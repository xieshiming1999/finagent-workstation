import { usePanelStore } from '../store/usePanelStore'
import { useT } from '../store/useLanguageStore'
import WebViewPanel from './WebViewPanel'
import DashboardPanel from './DashboardPanel'
import SettingsPanel from './SettingsPanel'
import DashboardManager from '../components/DashboardManager'
import StrategyLibrary from '../components/StrategyLibrary'
import DataPanel from './DataPanel'
import MacroResearchPanel from '../components/MacroResearchPanel'

export default function WorkspaceArea() {
  const t = useT()
  const { panels, activePanel, setActive, removePanel, refreshPanel } = usePanelStore()
  const active = panels.find((p) => p.id === activePanel) ?? panels[0]
  const canRefresh = (active?.type === 'dashboard' || active?.type === 'webview') && Boolean(active.url)
  const showHeader = panels.length > 1 || canRefresh

  return (
    <div className="flex flex-col h-full">
      {showHeader && (
        <div className="flex items-center shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center overflow-x-auto flex-1 min-w-0">
            {panels.map((p) => (
              <button
                key={p.id}
                onClick={() => setActive(p.id)}
                className={`flex items-center gap-1 px-3 h-8 text-xs border-b-2 shrink-0 ${
                  p.id === activePanel ? 'border-blue-500' : 'border-transparent'
                }`}
                style={{ color: p.id === activePanel ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
              >
                <span>{p.title}</span>
                {p.closable && (
                  <span
                    onClick={(e) => { e.stopPropagation(); removePanel(p.id) }}
                    className="hover:opacity-70 ml-1"
                    style={{ color: 'var(--text-dim)' }}
                  >×</span>
                )}
              </button>
            ))}
          </div>
          {canRefresh && active?.url && (
            <button
              onClick={() => refreshPanel(active.id)}
              className="h-7 w-7 mx-1 text-xs rounded hover:bg-gray-100 shrink-0"
              style={{ color: 'var(--text-tertiary)' }}
              title={active.type === 'dashboard' ? t('reloadDashboardFile') : t('refreshCurrentPage')}
              aria-label={active.type === 'dashboard' ? t('reloadDashboardFile') : t('refreshCurrentPage')}
            >
              ↻
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        {active?.type === 'webview' && active.url && (
          <WebViewPanel id={active.id} url={active.url} />
        )}
        {active?.type === 'settings' && (
          <SettingsPanel onClose={() => removePanel(active.id)} />
        )}
        {active?.type === 'dashboard' && active.url && (
          <DashboardPanel id={active.id} htmlPath={active.url} />
        )}
        {active?.type === 'dashboard' && !active.url && (
          <div className="h-full overflow-y-auto">
            <DashboardManager />
          </div>
        )}
        {active?.type === 'strategy-library' && (
          <StrategyLibrary />
        )}
        {active?.type === 'data-manager' && (
          <DataPanel />
        )}
        {active?.type === 'macro-research' && (
          <MacroResearchPanel />
        )}
      </div>
    </div>
  )
}
