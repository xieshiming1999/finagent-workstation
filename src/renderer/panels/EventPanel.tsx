import { useEffect, useRef } from 'react'
import { useEventStore } from '../store/useEventStore'
import { useT } from '../store/useLanguageStore'
import { MessageRow } from './ChatPanel'

export default function EventPanel() {
  const t = useT()
  const { messages, isProcessing, status, contextInfo, queueLength, droppedCount, isQueuePaused, cancel, background, clearQueue, toggleQueuePause } = useEventStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      <div className="h-8 border-b border-gray-100 px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">{t('events')}</span>
          {isProcessing && (
            <span className="flex items-center gap-1 text-[10px] text-blue-500">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              {status ?? t('processing')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={cancel}
            disabled={!isProcessing}
            className="w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-red-50"
            title={t('stopEventAgent')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/></svg>
          </button>
          <button
            onClick={background}
            disabled={!isProcessing}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100"
            title={t('backgroundEventAgent')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="13" height="13" rx="2"/><path d="M9 2h11a2 2 0 0 1 2 2v11"/></svg>
          </button>
          <button
            onClick={toggleQueuePause}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            title={isQueuePaused ? t('resumeQueue') : t('pauseQueue')}
          >
            {isQueuePaused
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>}
          </button>
          <button
            onClick={clearQueue}
            disabled={queueLength <= 0}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100"
            title={t('clearQueue')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 6l1 15h12l1-15"/></svg>
          </button>
          {queueLength > 0 && (
            <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">
              {t('queueLabel')}: {queueLength}
            </span>
          )}
          {droppedCount > 0 && (
            <span className="text-[10px] text-red-400 bg-red-50 rounded px-1.5 py-0.5">
              {t('droppedLabel')}: {droppedCount}
            </span>
          )}
          {isQueuePaused && (
            <span className="text-[10px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">
              {t('paused')}
            </span>
          )}
          {contextInfo && (
            <span className="font-mono text-[10px] text-gray-400">
              {contextInfo}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-300 text-xs">
            <div className="text-center space-y-1">
              <div>{t('noEventsYet')}</div>
              <div className="text-[10px] text-gray-300">{t('eventPanelHelp')}</div>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageRow key={i} message={msg} showToolResults />
        ))}
      </div>
    </div>
  )
}
