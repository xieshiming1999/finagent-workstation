import { useEffect, useMemo, useState } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { useT } from '../store/useLanguageStore'
import {
  buildResearchWorkspaceSummary,
  citationUrl,
  evidencePreview,
  primaryHypothesis,
  type ResearchWorkspaceArtifact,
} from './research-workspace-model'

const POLL_INTERVAL_MS = sidebarPanelContract('research').pollIntervalMs ?? 30000

export default function ResearchWorkspaceWidget() {
  const t = useT()
  const [rows, setRows] = useState<ResearchWorkspaceArtifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const result = await window.agent?.getResearchWorkspace()
      setRows(Array.isArray(result) ? result as ResearchWorkspaceArtifact[] : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const summary = useMemo(() => buildResearchWorkspaceSummary(rows), [rows])

  const continueResearch = (row: ResearchWorkspaceArtifact) => {
    window.agent?.send([
      'Continue this finance research artifact. Use the artifact path, verify unverified items, and produce a concise evidence-backed next step.',
      `Artifact: ${row.path}`,
      `Hypothesis: ${primaryHypothesis(row)}`,
      citationUrl(row) ? `Primary citation: ${citationUrl(row)}` : '',
    ].filter(Boolean).join('\n'))
  }

  const openCitation = (row: ResearchWorkspaceArtifact) => {
    const url = citationUrl(row)
    if (url) window.agent?.openExternal(url)
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary">
      <div className="px-3 py-2 border-b theme-border space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs theme-text font-medium">{t('researchWorkspace')}</div>
            <div className="text-[10px] theme-text-tertiary">
              {summary.artifacts} {t('researchArtifacts')} · {summary.citations} {t('researchCitations')} · {summary.unverified} {t('researchUnverified')}
            </div>
          </div>
          <button onClick={load} className="text-[10px] theme-text-tertiary hover:theme-accent px-1">{t('refresh')}</button>
        </div>
        {summary.latestAt && <div className="text-[10px] theme-text-tertiary">{new Date(summary.latestAt).toLocaleString()}</div>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 && <div className="p-4 text-xs theme-text-tertiary text-center">{t('researchLoading')}</div>}
        {error && <div className="m-3 p-2 text-xs theme-red border theme-border rounded">{t('errorPrefix')}: {error}</div>}
        {!loading && rows.length === 0 && <div className="p-4 text-xs theme-text-tertiary text-center">{t('researchEmpty')}</div>}
        {rows.map((row) => {
          const preview = evidencePreview(row)
          const url = citationUrl(row)
          const unverified = row.payload?.unverifiedItems?.length ?? Number(row.metadata?.unverifiedItems ?? 0)
          return (
            <div key={row.id} className="px-3 py-2 border-b theme-border/30 hover:theme-bg-secondary">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs theme-text leading-tight truncate" title={primaryHypothesis(row)}>{primaryHypothesis(row)}</div>
                  <div className="text-[10px] theme-text-tertiary mt-1 truncate">{row.source} · {row.verificationStatus ?? 'unverified'} · {row.freshness?.status ?? 'unknown'}</div>
                </div>
                <span className="shrink-0 text-[10px] theme-text-tertiary">{String(row.metadata?.action ?? row.payload?.action ?? 'research')}</span>
              </div>
              {preview && <div className="text-[10px] theme-text-secondary mt-1 line-clamp-2">{preview}</div>}
              <div className="flex items-center gap-2 mt-2 text-[10px] theme-text-tertiary">
                <span>{row.payload?.citations?.length ?? Number(row.metadata?.citations ?? 0)} {t('researchCitations')}</span>
                {unverified > 0 && <span className="theme-red">{unverified} {t('researchUnverified')}</span>}
                {row.payload?.draft && <span>{t('researchDraft')}</span>}
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => continueResearch(row)} className="text-[10px] theme-text-tertiary hover:theme-accent">{t('researchContinue')}</button>
                <button disabled={!url} onClick={() => openCitation(row)} className="text-[10px] theme-text-tertiary hover:theme-accent disabled:opacity-40">{t('open')}</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
