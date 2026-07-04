import { useEffect, useMemo, useState } from 'react'
import { useT } from '../store/useLanguageStore'
import { createSessionPreviewController, type SessionPreview as PreviewState } from './session-preview-controller'

interface SessionEntry {
  id?: string
  name: string
  path: string
  title?: string
  firstPrompt?: string
  createdAt?: string
}

interface PreviewMessage {
  role: string
  content: string
  toolName?: string
  isError?: boolean
  timestamp?: string
}

export default function SessionHistoryPanel() {
  const t = useT()
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [selected, setSelected] = useState<SessionEntry | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [query, setQuery] = useState('')
  const [previewCollapsed, setPreviewCollapsed] = useState(false)

  const previewController = useMemo(() => createSessionPreviewController<SessionEntry>(
    async (session) => {
      const result = await (window as any).electron?.ipcRenderer?.invoke('agent:sessionPreview', session.path) as PreviewState | undefined
      return result
    },
    (patch) => {
      if ('selected' in patch) setSelected(patch.selected ?? null)
      if ('preview' in patch) setPreview(patch.preview ?? null)
      if ('loadingPreview' in patch) setLoadingPreview(Boolean(patch.loadingPreview))
    },
  ), [])

  useEffect(() => {
    window.agent?.history().then((list: SessionEntry[]) => {
      const rows = list ?? []
      setSessions(rows)
      if (rows[0]) void previewController.select(rows[0])
    })
  }, [previewController])

  const selectSession = (session: SessionEntry) => {
    void previewController.select(session)
  }

  if (sessions.length === 0) {
    return <div className="p-3 text-xs text-center theme-text-tertiary">{t('noPastSessions')}</div>
  }

  const messages = preview?.messages ?? []
  const filteredSessions = sessions.filter((session) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [session.title, session.firstPrompt, session.name].some((value) => String(value ?? '').toLowerCase().includes(q))
  })
  const summary = summarizeMessages(messages)

  return (
    <div className="h-full flex flex-col theme-bg theme-text-secondary">
      <div className="shrink-0 border-b theme-border p-2 space-y-2">
        <div>
          <div className="text-xs theme-text font-medium">{t('sessions')}</div>
          <div className="text-[10px] theme-text-tertiary">{t('readOnlyPreview')}</div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchHistory')}
          className="w-full theme-bg-secondary border theme-border rounded px-2 py-1 text-xs theme-text-secondary focus:outline-none focus:border-[#2962ff]"
        />
        <div className="max-h-40 overflow-y-auto space-y-1">
        {filteredSessions.map((session) => {
          const active = selected?.path === session.path
          return (
            <button
              key={session.path}
              onClick={() => selectSession(session)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs ${active ? 'theme-bg-tertiary' : 'hover:theme-bg-secondary'}`}
            >
              <div className="theme-text truncate">{displayTitle(session)}</div>
              <div className="theme-text-tertiary text-[10px] truncate">{session.firstPrompt || session.name}</div>
              <div className="theme-text-tertiary text-[9px] font-mono">{formatDate(session.createdAt, session.name)}</div>
            </button>
          )
        })}
        {filteredSessions.length === 0 && <div className="text-xs theme-text-tertiary text-center py-2">{t('noResults')}</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs theme-text font-medium truncate">{preview?.title || (selected ? displayTitle(selected) : t('sessions'))}</div>
            <div className="text-[10px] theme-text-tertiary truncate">{selected ? formatDate(preview?.createdAt || selected.createdAt, selected.name) : ''}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {messages.length > 0 && (
              <button
                onClick={() => setPreviewCollapsed((value) => !value)}
                className="text-[10px] px-1.5 py-0.5 rounded border theme-border hover:theme-bg-secondary"
              >
                {previewCollapsed ? t('expand') : t('collapse')}
              </button>
            )}
            {loadingPreview && <span className="text-[10px] theme-text-tertiary">{t('loading')}</span>}
          </div>
        </div>
        {messages.length > 0 && (
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <SummaryMetric label={t('userMessages')} value={String(summary.user)} />
            <SummaryMetric label={t('assistantMessages')} value={String(summary.assistant)} />
            <SummaryMetric label={t('toolMessages')} value={String(summary.tools)} />
          </div>
        )}

        {preview?.error && <div className="text-xs theme-red">{preview.error}</div>}
        {!loadingPreview && messages.length === 0 && !preview?.error && (
          <div className="text-xs theme-text-tertiary">{t('noSessionPreview')}</div>
        )}
        {!previewCollapsed && messages.map((message, index) => (
          <PreviewBubble key={`${message.role}-${index}`} message={message} />
        ))}
      </div>
    </div>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border theme-border px-1.5 py-1">
      <div className="font-mono theme-text-secondary">{value}</div>
      <div className="theme-text-tertiary truncate">{label}</div>
    </div>
  )
}

function summarizeMessages(messages: PreviewMessage[]): { user: number; assistant: number; tools: number } {
  return messages.reduce((summary, message) => {
    if (message.role === 'user') summary.user += 1
    else if (message.role === 'assistant') summary.assistant += 1
    else summary.tools += 1
    return summary
  }, { user: 0, assistant: 0, tools: 0 })
}

function PreviewBubble({ message }: { message: PreviewMessage }) {
  const label = message.toolName ?? message.role
  const color = message.role === 'user'
    ? 'border-blue-500'
    : message.isError
      ? 'border-red-500'
      : message.role === 'assistant'
        ? 'border-green-500'
        : 'theme-border'
  return (
    <div className={`border-l-2 ${color} pl-2 py-1 text-[11px]`}>
      <div className="text-[9px] uppercase tracking-wide theme-text-tertiary mb-0.5">{label}</div>
      <div className="theme-text-secondary whitespace-pre-wrap break-words">{message.content}</div>
    </div>
  )
}

function displayTitle(session: SessionEntry): string {
  return session.title || session.firstPrompt || session.name
}

function formatDate(value: string | null | undefined, fallbackName?: string): string {
  if (value) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toLocaleString()
  }
  return fallbackName?.replace(/_/g, ' ') ?? ''
}
