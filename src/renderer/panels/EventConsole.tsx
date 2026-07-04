import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useEventStore } from '../store/useEventStore'
import { useT } from '../store/useLanguageStore'
import { MessageRow } from './ChatPanel'
import { uiSurfaceContract } from './ui-surface-contract'

type ConsoleTab = 'events' | 'logs' | 'tasks'

const EVENT_CONSOLE_LOG_POLL_INTERVAL_MS =
  uiSurfaceContract('event-console').pollIntervalMs ?? 2000

export default function EventConsole() {
  const t = useT()
  const { messages, isProcessing, status, contextInfo, queueLength, droppedCount, isQueuePaused, send, cancel, background, clearQueue, toggleQueuePause } = useEventStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const [activeTab, setActiveTab] = useState<ConsoleTab>('events')
  const [input, setInput] = useState('')
  const [log, setLog] = useState<{ path: string; content: string; files?: Array<{ name: string }>; truncated?: boolean }>({ path: '', content: '' })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (activeTab !== 'logs') return
    let cancelled = false
    const load = async () => {
      const next = await window.agent?.getLogs?.()
      if (!cancelled && next) setLog(next)
    }
    load()
    const timer = window.setInterval(load, EVENT_CONSOLE_LOG_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'logs') logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [activeTab, log.content])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    send(text)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend() }
  }

  const tabs: Array<{ id: ConsoleTab; label: string; count?: number }> = [
    { id: 'events', label: t('events'), count: messages.length > 0 ? messages.length : undefined },
    { id: 'logs', label: t('bottomLogs') },
    { id: 'tasks', label: t('bottomTasks') },
  ]

  return (
    <div className="flex flex-col h-full" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
      {/* Header with tabs */}
      <div className="h-7 flex items-center justify-between px-2 shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex items-center gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                activeTab === tab.id ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
              {tab.count != null && <span className="ml-1 text-gray-300">{tab.count}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <span className="flex items-center gap-1 text-[10px] text-blue-500">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              {status ?? t('processing')}
            </span>
          )}
          {queueLength > 0 && (
            <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1 py-0.5">{t('queueLabel')}:{queueLength}</span>
          )}
          {droppedCount > 0 && (
            <span className="text-[10px] text-red-400 bg-red-50 rounded px-1 py-0.5">{t('droppedLabel')}:{droppedCount}</span>
          )}
          {isQueuePaused && (
            <span className="text-[10px] text-amber-600 bg-amber-50 rounded px-1 py-0.5">{t('paused')}</span>
          )}
          {contextInfo && (
            <span className="font-mono text-[10px] text-gray-400">{contextInfo}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {activeTab === 'events' && (
          <>
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-300 text-[10px]">
                {t('eventPanelHelp')}
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageRow key={i} message={msg} showToolResults />
            ))}
          </>
        )}
        {activeTab === 'logs' && (
          <div className="h-full flex flex-col">
            <div className="shrink-0 text-gray-400 text-[10px] py-1 truncate">
              {log.path ? `${log.path} (${log.files?.length ?? 0} ${t('logFiles')}${log.truncated ? `, ${t('truncated')}` : ''})` : t('logDirectoryNotInitialized')}
            </div>
            <pre ref={logRef} className="flex-1 overflow-y-auto whitespace-pre-wrap text-gray-500 text-[10px] pb-2">
              {log.content || t('noLogsYet')}
            </pre>
          </div>
        )}
        {activeTab === 'tasks' && (
          <div className="text-gray-400 text-[10px] py-2">{t('backgroundTasksAppearHere')}</div>
        )}
      </div>

      {/* Input for event agent */}
      {activeTab === 'events' && (
        <div className="flex items-center gap-1 px-2 py-1 shrink-0" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button
            onClick={cancel}
            disabled={!isProcessing}
            className="w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-red-50 shrink-0"
            title={t('stopEventAgent')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/></svg>
          </button>
          <button
            onClick={background}
            disabled={!isProcessing}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100 shrink-0"
            title={t('backgroundEventAgent')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="13" height="13" rx="2"/><path d="M9 2h11a2 2 0 0 1 2 2v11"/></svg>
          </button>
          <button
            onClick={toggleQueuePause}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 shrink-0"
            title={isQueuePaused ? t('resumeQueue') : t('pauseQueue')}
          >
            {isQueuePaused
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>}
          </button>
          <button
            onClick={clearQueue}
            disabled={queueLength <= 0}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100 shrink-0"
            title={t('clearQueue')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 6l1 15h12l1-15"/></svg>
          </button>
          <span className="text-[10px] text-gray-400">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('sendToEventAgent')}
            className="flex-1 text-[11px] bg-transparent border-none outline-none text-gray-600 font-mono placeholder:text-gray-300"
          />
        </div>
      )}
    </div>
  )
}
