import { useEffect, useState } from 'react'
import { usePanelStore } from '../store/usePanelStore'
import { pulseRegimeLabel } from './market-pulse-format'
import { dashboardTitle, useT } from '../store/useLanguageStore'

interface ModuleCard {
  id: string
  title: string
  icon: string
  value: string
  sub: string
  color: string
  action: () => void
}

export default function DashboardGrid() {
  const t = useT()
  const addPanel = usePanelStore((s) => s.addPanel)
  const [marketData, setMarketData] = useState<{ upCount: number; downCount: number; regime: string }>({ upCount: 0, downCount: 0, regime: '...' })

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.agent?.bridgeMessage({ id: 'grid', type: 'readFile', path: 'snapshots/latest.json' }) as any
        if (result?.content) {
          const snap = JSON.parse(result.content)
          setMarketData({ upCount: snap.limitUpCount ?? 0, downCount: snap.limitDownCount ?? 0, regime: snap.regime ?? 'neutral' })
        }
      } catch { /* ignore */ }
    }
    load()
  }, [])

  const openDash = async (name: string, title: string) => {
    const path = await window.agent?.getAssetPath(`dashboards/${name}.html`)
    if (path) addPanel({ id: `tmpl-${name}`, type: 'dashboard', title, url: path, closable: true })
  }

  const cards: ModuleCard[] = [
    { id: 'market', title: t('market'), icon: '📊', value: pulseRegimeLabel(marketData.regime), sub: `${t('limitUp')} ${marketData.upCount} / ${t('limitDown')} ${marketData.downCount}`, color: 'var(--accent)', action: () => openDash('kpi', dashboardTitle('kpi')) },
    { id: 'chart', title: t('dashboardCardsCharts'), icon: '📈', value: t('dashboardCardsChartsValue'), sub: t('dashboardCardsChartsSub'), color: 'var(--green)', action: () => openDash('chart', dashboardTitle('chart')) },
    { id: 'monitor', title: t('dashboardCardsMonitors'), icon: '🔔', value: t('dashboardCardsMonitorsValue'), sub: t('dashboardCardsMonitorsSub'), color: 'var(--yellow)', action: () => openDash('monitor', dashboardTitle('monitor')) },
    { id: 'backtest', title: dashboardTitle('backtest'), icon: '🧪', value: t('dashboardCardsBacktestValue'), sub: t('dashboardCardsBacktestSub'), color: 'var(--red)', action: () => openDash('backtest', dashboardTitle('backtest')) },
    { id: 'report', title: t('dashboardCardsReports'), icon: '📋', value: t('dashboardCardsReportsValue'), sub: t('dashboardCardsReportsSub'), color: 'var(--accent)', action: () => openDash('report', dashboardTitle('report')) },
    { id: 'valuation', title: dashboardTitle('valuation'), icon: '💰', value: t('dashboardCardsValuationValue'), sub: t('dashboardCardsValuationSub'), color: 'var(--green)', action: () => openDash('valuation', dashboardTitle('valuation')) },
  ]

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{t('quickLaunch')}</h2>
      <div className="grid grid-cols-3 gap-3">
        {cards.map((card) => (
          <button
            key={card.id}
            onClick={card.action}
            className="rounded-lg p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{card.icon}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{card.title}</span>
            </div>
            <div className="text-sm font-bold font-mono" style={{ color: card.color }}>{card.value}</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{card.sub}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
