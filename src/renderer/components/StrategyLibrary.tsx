import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../store/useLanguageStore'
import { usePanelStore } from '../store/usePanelStore'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import StrategyWizard from './StrategyWizard'
import {
  normalizeStrategyLibrary,
  type StrategyLibraryState,
  type StrategyType,
} from './strategy-library-model'

const STRATEGY_LIBRARY_POLL_INTERVAL_MS = sidebarPanelContract('strategy-library').pollIntervalMs ?? 15000

export default function StrategyLibrary({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const addPanel = usePanelStore((s) => s.addPanel)
  const setActivePanel = usePanelStore((s) => s.setActive)
  const [state, setState] = useState<StrategyLibraryState>(() => normalizeStrategyLibrary(null))
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<StrategyType | 'all'>('all')
  const [showCreator, setShowCreator] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stats = summarizeStrategies(state.strategies)
  const visibleStrategies = typeFilter === 'all'
    ? state.strategies
    : state.strategies.filter((item) => item.strategyType === typeFilter)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await window.agent?.listStrategies()
      setState(normalizeStrategyLibrary(payload))
    } catch (error) {
      setState(normalizeStrategyLibrary({ ok: false, error: error instanceof Error ? error.message : String(error), strategies: [] }))
    } finally {
      setLoading(false)
    }
  }, [])

  const runAction = async (action: 'rerun' | 'watch' | 'monitor' | 'read', strategyId: string) => {
    setActionError(null)
    try {
      await window.agent?.runStrategyAction(action, strategyId)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    void refresh()
    timerRef.current = setInterval(() => { void refresh() }, STRATEGY_LIBRARY_POLL_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [refresh])

  const openFullView = () => {
    addPanel({ id: 'strategy-library', type: 'strategy-library', title: t('strategyLibrary'), closable: true })
    setActivePanel('strategy-library')
  }

  return (
    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className={compact ? 'space-y-4' : 'max-w-5xl mx-auto space-y-4'}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('strategyLibraryTitle')}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{t('strategyLibrarySummary')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {compact && (
              <button
                onClick={openFullView}
                className="h-8 px-3 rounded text-xs font-medium"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                {t('fullView')}
              </button>
            )}
            <button
              onClick={() => setShowCreator((value) => !value)}
              className="h-8 px-3 rounded text-xs font-medium"
              style={{
                background: showCreator ? 'var(--accent)' : 'var(--bg-secondary)',
                border: `1px solid ${showCreator ? 'var(--accent)' : 'var(--border)'}`,
                color: showCreator ? 'white' : 'var(--text-primary)',
              }}
            >
              {showCreator ? t('strategyLibraryHideCreator') : t('strategyLibraryCreate')}
            </button>
            <button
              onClick={() => void refresh()}
              className="h-8 px-3 rounded text-xs font-medium"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              {loading ? t('loading') : t('refresh')}
            </button>
          </div>
        </div>

        {showCreator && (
          <div className="rounded" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <StrategyWizard embedded />
          </div>
        )}

        {(state.error || actionError) && (
          <div className="rounded p-3 text-xs" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--red)', color: 'var(--red)' }}>
            {state.error || actionError}
          </div>
        )}

        <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {t('strategyLibraryCount')}: {state.strategies.length}
          {state.modified && <> · {t('provenanceUpdated')}: {new Date(state.modified).toLocaleString()}</>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <ContractTile
            label={t('strategyArtifactContract')}
            value={state.artifactContract}
            detail={t('strategyArtifactContractHint')}
          />
          <ContractTile
            label={t('strategyLibraryPath')}
            value={state.paths.libraryPath ? t('strategyArtifactCanonical') : t('strategyArtifactUnavailable')}
            detail={state.paths.libraryPath || state.path}
          />
          <ContractTile
            label={t('strategyItemDir')}
            value={state.paths.itemDir ? t('strategyArtifactPerItem') : t('strategyArtifactUnavailable')}
            detail={state.paths.itemDir || '-'}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          <SummaryPill label={t('strategyRerun')} value={stats.runnable} />
          <SummaryPill label={t('strategyReadEvidence')} value={stats.observedOnly} />
          <SummaryPill label={t('strategyTypeStock')} value={stats.stock} />
          <SummaryPill label={t('strategyTypeFund')} value={stats.fund} />
          <SummaryPill label={t('strategyTypePortfolio')} value={stats.portfolio} />
          <SummaryPill label={t('strategyTypeEtf')} value={stats.etf} />
          <SummaryPill label={t('strategyCreateMonitor')} value={stats.monitorReady} />
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          {(['all', 'stock_strategy', 'fund_strategy', 'portfolio_strategy', 'etf_market_strategy', 'unknown_strategy'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className="h-7 px-2 rounded"
              style={{
                background: typeFilter === type ? 'var(--accent-soft, rgba(59, 130, 246, 0.14))' : 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                color: typeFilter === type ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {strategyTypeName(type, t)}
            </button>
          ))}
        </div>

        {state.strategies.length === 0 ? (
          <div className="rounded p-5 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-medium">{t('strategyLibraryEmpty')}</div>
            <div className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{t('strategyLibraryEmptyHint')}</div>
          </div>
        ) : (
          <div className={`grid grid-cols-1 ${compact ? '' : 'lg:grid-cols-2'} gap-3`}>
            {visibleStrategies.map((item) => (
              <div key={item.strategyId} className="rounded p-3 space-y-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{item.name}</div>
                    <div className="text-[11px] font-mono mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>{item.strategyId}</div>
                  </div>
                  <span
                    className="text-[10px] px-2 py-1 rounded shrink-0"
                    style={{
                      background: item.runnable ? 'var(--green-soft, rgba(16, 185, 129, 0.12))' : 'var(--bg-tertiary)',
                      color: item.runnable ? 'var(--green)' : 'var(--text-secondary)',
                    }}
                  >
                    {item.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <Info label={t('strategyType')} value={strategyTypeName(item.strategyType, t)} />
                  <Info label={t('strategyAssetClass')} value={item.assetClass || '-'} />
                  <Info label={t('strategySymbols')} value={item.symbols.join(', ') || '-'} />
                  <Info label={t('strategyEvidenceAction')} value={item.evidenceAction || '-'} />
                  <Info label={t('strategyUpdatedAt')} value={item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'} />
                  <Info label={t('strategyEvidenceSummary')} value={item.evidenceSummary || '-'} />
                  <Info label={t('strategyDataSummary')} value={item.dataSummary || '-'} />
                  {item.riskRewardSummary && <Info label={t('strategyRiskRewardSummary')} value={item.riskRewardSummary} />}
                  {item.assumptionSummary && <Info label={t('strategyAssumptionSummary')} value={item.assumptionSummary} />}
                </div>

                <div className="flex flex-wrap gap-2">
                  <ActionButton label={item.runnable ? t('strategyRerun') : t('strategyReadEvidence')} onClick={() => void runAction(item.runnable ? 'rerun' : 'read', item.strategyId)} />
                  <ActionButton label={t('strategyAddWatch')} onClick={() => void runAction('watch', item.strategyId)} />
                  <ActionButton label={t('strategyCreateMonitor')} onClick={() => void runAction('monitor', item.strategyId)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function summarizeStrategies(strategies: StrategyLibraryState['strategies']) {
  return strategies.reduce(
    (acc, item) => {
      if (item.runnable) acc.runnable += 1
      if (!item.runnable) acc.observedOnly += 1
      if (item.strategyType === 'fund_strategy') acc.fund += 1
      if (item.strategyType === 'stock_strategy') acc.stock += 1
      if (item.strategyType === 'portfolio_strategy') acc.portfolio += 1
      if (item.strategyType === 'etf_market_strategy') acc.etf += 1
      if (item.strategyType === 'unknown_strategy') acc.unknown += 1
      if (item.status === 'observed' || item.runnable) acc.monitorReady += 1
      return acc
    },
    { runnable: 0, observedOnly: 0, stock: 0, fund: 0, portfolio: 0, etf: 0, unknown: 0, monitorReady: 0 },
  )
}

function strategyTypeName(type: StrategyType | 'all', t: ReturnType<typeof useT>): string {
  switch (type) {
    case 'all':
      return t('strategyTypeAll')
    case 'stock_strategy':
      return t('strategyTypeStock')
    case 'fund_strategy':
      return t('strategyTypeFund')
    case 'portfolio_strategy':
      return t('strategyTypePortfolio')
    case 'etf_market_strategy':
      return t('strategyTypeEtf')
    default:
      return t('strategyTypeUnknown')
  }
}

function SummaryPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-2 py-1 rounded" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>: <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function ContractTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div
      className="rounded p-2 min-w-0"
      title={detail}
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      <div style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="truncate mt-1" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="truncate" title={value} style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-7 px-2 rounded text-[11px]"
      style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
    >
      {label}
    </button>
  )
}
