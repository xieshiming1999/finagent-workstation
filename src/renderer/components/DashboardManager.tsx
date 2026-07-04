import { useEffect, useState } from 'react'
import { usePanelStore } from '../store/usePanelStore'
import { useT } from '../store/useLanguageStore'

interface DashboardEntry {
  name: string
  path: string
  size: number
  modified: string
}

export default function DashboardManager() {
  const t = useT()
  const [dashboards, setDashboards] = useState<DashboardEntry[]>([])
  const addPanel = usePanelStore((s) => s.addPanel)

  useEffect(() => {
    window.agent?.listDashboards().then(setDashboards)
  }, [])

  const openDashboard = (entry: DashboardEntry) => {
    addPanel({ id: `dash-${entry.name}`, type: 'dashboard', title: entry.name, url: entry.path, closable: true })
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h2 className="text-sm theme-text font-semibold mb-3">{t('dashboardManagerTitle')}</h2>
          {dashboards.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {dashboards.map((d) => (
                <button key={d.name} onClick={() => openDashboard(d)}
                  className="theme-bg-secondary border theme-border rounded-lg p-3 text-left hover:border-[#2962ff] transition-colors">
                  <div className="text-xs theme-text font-medium truncate">{d.name}</div>
                  <div className="text-[10px] theme-text-tertiary mt-1">
                    {(d.size / 1024).toFixed(1)}KB · {new Date(d.modified).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="theme-bg-secondary border theme-border rounded-lg p-4 text-center">
              <div className="text-xs theme-text-tertiary">{t('noDashboardsYet')}</div>
              <div className="text-[10px] theme-text-tertiary mt-1">{t('dashboardCreateHint')}</div>
            </div>
          )}
        </div>

        <div className="text-[10px] theme-text-tertiary text-center pt-4 border-t theme-border">
          <span className="font-mono">⌘K</span> {t('dashboardFooterCommandPalette')} · <span className="font-mono">/help</span> {t('dashboardFooterAllCommands')}
        </div>
      </div>
    </div>
  )
}
