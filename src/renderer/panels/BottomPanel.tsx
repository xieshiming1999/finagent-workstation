import { useEffect, useRef, useState } from 'react'
import { useBottomPanelStore } from '../store/useBottomPanelStore'
import ApiHealthPanel from '../components/ApiHealthPanel'
import { useT } from '../store/useLanguageStore'
import { uiSurfaceContract } from './ui-surface-contract'

const BOTTOM_PANEL_LOG_POLL_INTERVAL_MS =
  uiSurfaceContract('bottom-panel').pollIntervalMs ?? 2000

export default function BottomPanel() {
  const t = useT()
  const { tabs, activeTab, setActive, removeTab, toggle } = useBottomPanelStore()
  const active = tabs.find((t) => t.id === activeTab)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-gray-200 shrink-0 bg-gray-50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`flex items-center gap-1 px-3 h-7 text-[10px] uppercase tracking-wider font-medium border-b-2 ${
              tab.id === activeTab ? 'border-blue-500 text-gray-700' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.title}
            <span
              onClick={(e) => { e.stopPropagation(); removeTab(tab.id) }}
              className="text-gray-300 hover:text-gray-500 ml-0.5"
            >×</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={toggle} className="text-xs text-gray-400 hover:text-gray-600 px-2" title={t('closePanel')}>
          ▼
        </button>
      </div>

      <div className="flex-1 overflow-hidden bg-white">
        {active?.type === 'logs' && <LogsView />}
        {active?.type === 'terminal' && <TerminalView />}
        {active?.type === 'api-health' && <ApiHealthPanel />}
        {active?.type === 'tasks' && <TasksView />}
      </div>
    </div>
  )
}

function LogsView() {
  const t = useT()
  const [log, setLog] = useState<{ path: string; content: string; files?: Array<{ name: string }>; truncated?: boolean }>({ path: '', content: '' })
  const scrollRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next = await window.agent?.getLogs?.()
      if (!cancelled && next) setLog(next)
    }
    load()
    const timer = window.setInterval(load, BOTTOM_PANEL_LOG_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [log.content])

  return (
    <div className="h-full flex flex-col bg-gray-50 font-mono text-[11px]">
      <div className="shrink-0 px-2 py-1 border-b border-gray-200 text-gray-400 truncate">
        {log.path ? `${log.path} (${log.files?.length ?? 0} ${t('logFiles')}${log.truncated ? `, ${t('truncated')}` : ''})` : t('logDirectoryNotInitialized')}
      </div>
      <pre ref={scrollRef} className="flex-1 overflow-y-auto p-2 text-gray-600 whitespace-pre-wrap">
        {log.content || t('noLogsYet')}
      </pre>
    </div>
  )
}

function TerminalView() {
  const t = useT()
  return (
    <div className="h-full overflow-y-auto p-2 font-mono text-[11px] text-green-400 bg-[#1e1e1e]">
      <div>$ {t('finAgentTerminal')}</div>
      <div className="text-gray-500">{t('bashOutputsHere')}</div>
    </div>
  )
}

function TasksView() {
  const t = useT()
  return (
    <div className="h-full overflow-y-auto p-2 text-xs text-gray-500">
      <div>{t('noActiveTasks')}</div>
    </div>
  )
}
