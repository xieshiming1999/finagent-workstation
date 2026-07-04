import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import { useAgentStore, type ChatMessage } from '../store/useAgentStore'
import { usePanelStore } from '../store/usePanelStore'
import { useSidebarStore } from '../store/useSidebarStore'
import { useLayoutStore, type LayoutMode } from '../store/useLayoutStore'
import { detectContentType, parseStrategyReview, parseTradePrep, stripFinanceContractLines } from '../components/rich-content/parsers'
import { StockQuoteCard, SignalCard, BacktestCard, AnalysisEvidenceCard, StrategyReviewCard, TradePrepCard } from '../components/rich-content/cards'
import { panelTitle, t, useT, widgetTitle } from '../store/useLanguageStore'

type MarkdownSegment =
  | { kind: 'markdown'; content: string }
  | { kind: 'html'; content: string }

function summarizeToolInput(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    const s = String(v)
    if (s.length > 200) {
      parts.push(`${k}: ${s.slice(0, 100)}... (${s.length} ${t('chars')})`)
    } else {
      parts.push(`${k}: ${s}`)
    }
  }
  return parts.join('\n')
}

export default function ChatPanel() {
  const tt = useT()
  const { messages, isLoading, status, contextInfo, pendingConfirm, send, cancel, resolvePermission, clearMessages } = useAgentStore()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [isLoading])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')

    if (text.startsWith('/')) {
      handleSlashCommand(text)
      return
    }
    send(text)
  }

  const handleSlashCommand = (cmd: string) => {
    const [name, ...args] = cmd.slice(1).split(' ')
    const addPanel = usePanelStore.getState().addPanel
    const openWebView = usePanelStore.getState().openWebView

    switch (name) {
      case 'clear':
        clearMessages()
        window.agent?.clear()
        // Brief feedback before messages are wiped
        setTimeout(() => {
          const { messages } = useAgentStore.getState()
          if (messages.length === 0) {
            useAgentStore.setState({
              messages: [{ role: 'assistant', content: tt('sessionClearedArchived'), timestamp: Date.now() }],
            })
          }
        }, 100)
        return
      case 'compact':
        send('/compact')
        return
      case 'resume':
        window.agent?.sessions().then((sessions: Array<{ name: string; path: string }>) => {
          if (sessions.length === 0) return
          window.agent?.resume(sessions[0].path).then(() => useAgentStore.getState().restoreSession())
        })
        return
      case 'history':
        useSidebarStore.getState().addWidget({ id: 'sessions', type: 'sessions', title: widgetTitle('sessions') })
        return
      case 'settings':
        addPanel({ id: 'settings', type: 'settings', title: panelTitle('settings'), closable: true })
        return
      case 'watchlist':
        useSidebarStore.getState().addWidget({ id: 'watchlist', type: 'watchlist', title: widgetTitle('watchlist') })
        return
      case 'eastmoney':
        openWebView('eastmoney', 'https://www.eastmoney.com', 'EastMoney')
        return
      case 'xueqiu':
        openWebView('xueqiu', 'https://xueqiu.com', 'Xueqiu')
        return
      case 'open':
        if (args[0]) openWebView(args[0], args[0].startsWith('http') ? args[0] : `https://${args[0]}`, args[0])
        return
      case 'apihealth':
      case 'health':
        useSidebarStore.getState().addWidget({ id: 'api-health', type: 'api-health', title: widgetTitle('api-health') })
        return
      case 'news':
        useSidebarStore.getState().addWidget({ id: 'news', type: 'news', title: widgetTitle('news') })
        return
      case 'calendar':
        useSidebarStore.getState().addWidget({ id: 'calendar', type: 'calendar', title: widgetTitle('calendar') })
        return
      case 'layout': {
        const mode = (args[0] ?? 'default') as LayoutMode
        useLayoutStore.getState().setMode(mode)
        return
      }
      case 'help':
        // Show UI commands locally, then send /help to agent for agent commands
        send('/help')
        return
      case 'status': {
        // Query all services and display status
        Promise.all([
          window.agent?.getSidecarStatus?.(),
          window.agent?.getMcpStatus?.(),
          window.agent?.getPlugins?.(),
          window.agent?.getHooks?.(),
        ]).then(([sidecar, mcp, plugins, hooks]) => {
          const lines = [`**${tt('systemStatus')}**`, '']
          if (sidecar) {
            const s = sidecar as any
            lines.push(`${tt('sidecarLabel')}: ${s.sidecar} | TDX: ${s.tdxHealth?.status ?? 'unknown'} (ExQuote: ${s.tdxHealth?.exStatus ?? 'unknown'})`)
          }
          if (Array.isArray(mcp) && mcp.length > 0) {
            lines.push(`${tt('mcpServers')}: ${mcp.map((m: any) => `${m.name}(${m.status}, ${m.tools} ${tt('toolCalls')})`).join(', ')}`)
          } else {
            lines.push(tt('mcpNoServers'))
          }
          if (Array.isArray(plugins) && plugins.length > 0) {
            lines.push(`${tt('pluginsLabel')}: ${plugins.map((p: any) => `${p.name} v${p.version} (${p.tools} ${tt('toolCalls')})`).join(', ')}`)
          } else {
            lines.push(tt('pluginsNone'))
          }
          if (Array.isArray(hooks) && hooks.length > 0) {
            lines.push(`${tt('hooksLabel')}: ${hooks.map((h: any) => `${h.name}@${h.event}`).join(', ')}`)
          } else {
            lines.push(tt('hooksNone'))
          }
          useAgentStore.setState((s) => ({
            messages: [...s.messages, { role: 'assistant' as const, content: lines.join('\n'), timestamp: Date.now() }],
          }))
        })
        return
      }
      default:
        send(cmd)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-300">
            <div className="text-center">
              <div className="text-4xl mb-2">$</div>
              <div className="text-sm">{t('appName')}</div>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageRow key={i} message={msg} />
        ))}
      </div>

      {(isLoading || contextInfo) && (
        <div className="flex items-center gap-2 text-xs text-gray-400 px-4 py-1 border-t border-gray-50">
          {isLoading && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
          {isLoading && status && <span>{status}</span>}
          <span className="flex-1" />
          {contextInfo && <span className="font-mono text-[10px]">{contextInfo}</span>}
        </div>
      )}

      {pendingConfirm && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2">
          <div className="text-xs text-amber-800 font-medium mb-1">{tt('permissionRequired')}: {pendingConfirm.name}</div>
          <pre className="text-[10px] text-amber-600 font-mono mb-2 max-h-20 overflow-y-auto whitespace-pre-wrap">
            {summarizeToolInput(pendingConfirm.input)}
          </pre>
          <div className="flex items-center gap-2">
            <button onClick={() => resolvePermission(true)} className="text-xs bg-green-500 text-white px-2 py-0.5 rounded hover:bg-green-600">{tt('allow')}</button>
            <button onClick={() => resolvePermission(true, true)} className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded hover:bg-blue-600">{tt('alwaysAllow')}</button>
            <button onClick={() => resolvePermission(false)} className="text-xs bg-red-400 text-white px-2 py-0.5 rounded hover:bg-red-500">{tt('deny')}</button>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 px-4 py-2 flex items-end gap-2">
        <button
          onClick={cancel}
          disabled={!isLoading}
          className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-red-50 shrink-0"
          title={tt('stopCancel')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/></svg>
        </button>
        <button
          onClick={() => window.agent?.background()}
          disabled={!isLoading}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100 shrink-0"
          title={tt('backgroundShort')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="13" height="13" rx="2"/><path d="M9 2h11a2 2 0 0 1 2 2v11"/></svg>
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tt('askFinAgent')}
          rows={1}
          className="flex-1 resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:border-blue-400 font-mono"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="text-blue-500 hover:text-blue-700 disabled:text-gray-300 px-2 py-1 text-sm shrink-0"
        >
          {tt('send')}
        </button>
      </div>
    </div>
  )
}

export function MessageRow({ message, showToolResults = false }: { message: ChatMessage; showToolResults?: boolean }) {
  const tt = useT()
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const [toolResultExpanded, setToolResultExpanded] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="py-1 flex justify-end">
        <div className="bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg max-w-[80%]">
          {message.content}
        </div>
      </div>
    )
  }

  if (message.role === 'thinking') {
    return (
      <div className="py-0.5">
        <button onClick={() => setThinkingExpanded(!thinkingExpanded)} className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-600">
          <span>{thinkingExpanded ? '▾' : '▸'}</span>
          <span>{tt('thinkingLabel')} ({message.content.length} {tt('chars')})</span>
        </button>
        {thinkingExpanded && (
          <pre className="text-xs text-purple-300 font-mono whitespace-pre-wrap ml-3 mt-1 max-h-60 overflow-y-auto">
            {message.content}
          </pre>
        )}
      </div>
    )
  }

  if (message.role === 'turn-complete') {
    return (
      <div className="py-0.5 flex items-center gap-2 text-xs text-green-500">
        <span>✓</span>
        <span>{message.durationMs ? `${(message.durationMs / 1000).toFixed(1)}s` : ''}</span>
        {message.toolCallCount != null && message.toolCallCount > 0 && <span>{message.toolCallCount} {tt('toolCalls')}</span>}
      </div>
    )
  }

  if (message.role === 'tool-use') {
    const icon = message.toolStatus === 'ok' ? '✓' : message.toolStatus === 'error' ? '✗' : '…'
    const iconColor = message.toolStatus === 'ok' ? 'text-green-500' : message.toolStatus === 'error' ? 'text-red-500' : 'text-gray-400'
    return (
      <div className="py-0.5">
        <div className="flex items-center gap-1">
          <span className={`text-xs ${iconColor}`}>{icon}</span>
          <span className="text-xs text-gray-500 font-mono">{message.content}</span>
          {message.durationMs != null && (
            <span className="text-[10px] text-gray-300 ml-1">{message.durationMs}ms</span>
          )}
        </div>
        {message.toolStatus === 'error' && message.errorDetail && (
          <pre className="text-[10px] text-red-400 font-mono whitespace-pre-wrap ml-4 mt-0.5 max-h-20 overflow-hidden">
            {message.errorDetail}
          </pre>
        )}
      </div>
    )
  }

  if (message.role === 'tool-result') {
    // Check for inline widget (from UIControl showQuote/showTable/showChart/showHtml)
    try {
      const parsed = JSON.parse(message.content)
      if (parsed._widget) {
        if (parsed.action === 'showHtml' && parsed.params?.html) {
          return (
            <div className="py-1 border rounded-lg overflow-hidden my-1" style={{ background: '#131722' }}>
              <div dangerouslySetInnerHTML={{ __html: parsed.params.html }} />
            </div>
          )
        }
        if (parsed.action === 'showTable' && parsed.params?.data) {
          const data = parsed.params.data as any[]
          const columns = parsed.params.columns as string[] ?? (data.length > 0 ? Object.keys(data[0]) : [])
          return (
            <div className="py-1 overflow-x-auto">
              {parsed.params.title && <div className="text-xs font-medium text-gray-600 mb-1">{parsed.params.title}</div>}
              <table className="text-xs border-collapse w-full">
                <thead><tr>{columns.map((c: string) => <th key={c} className="border border-gray-200 px-2 py-1 bg-gray-50 text-left">{c}</th>)}</tr></thead>
                <tbody>{(data as any[]).slice(0, 50).map((row: any, i: number) => (
                  <tr key={i}>{columns.map((c: string) => <td key={c} className="border border-gray-200 px-2 py-0.5">{String(row[c] ?? '')}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          )
        }
        if (parsed.action === 'showQuote') {
          return <StockQuoteCard content={JSON.stringify(parsed.params?.data ?? {})} />
        }
      }
    } catch { /* not JSON widget */ }

    // Rich content cards
    const contentType = detectContentType(message)
    if (contentType === 'quote') return <StockQuoteCard content={message.content} />
    if (contentType === 'signal') return <SignalCard content={message.content} />
    if (contentType === 'backtest') return <BacktestCard content={message.content} />
    if (contentType === 'analysis-evidence') return <AnalysisEvidenceCard content={message.content} />
    if (contentType === 'strategy-review') return <StrategyReviewCard content={message.content} />
    if (contentType === 'trade-prep') return <TradePrepCard content={message.content} />
    if (showToolResults) {
      const preview = message.content.length > 220 ? `${message.content.slice(0, 220)}...` : message.content
      return (
        <div className="py-0.5">
          <button
            onClick={() => setToolResultExpanded(!toolResultExpanded)}
            className={`flex items-center gap-1 text-xs ${message.isError ? 'text-red-500 hover:text-red-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <span>{toolResultExpanded ? '▾' : '▸'}</span>
            <span>
              {message.isError ? tt('toolErrorLabel') : tt('toolResultLabel')} ({message.content.length} {tt('chars')})
            </span>
          </button>
          <pre className={`text-[10px] font-mono whitespace-pre-wrap ml-3 mt-1 overflow-y-auto ${message.isError ? 'text-red-400' : 'text-gray-500'} ${toolResultExpanded ? 'max-h-80' : 'max-h-12'}`}>
            {toolResultExpanded ? message.content : preview}
          </pre>
        </div>
      )
    }

    // Default chat behavior: don't show generic tool-result rows; they are folded into tool-use status.
    return null
  }

  // assistant
  const displayContent = stripFinanceContractLines(message.content)
  const hasStrategyReview = !!parseStrategyReview(message.content)
  const hasTradePrep = !!parseTradePrep(message.content)
  return (
    <div className="py-1 text-sm prose prose-sm max-w-none prose-pre:bg-gray-50 prose-pre:text-xs">
      {displayContent && <MarkdownWithHtmlPreview content={displayContent} htmlPreviewLabel={tt('htmlPreview')} />}
      {hasStrategyReview && <StrategyReviewCard content={message.content} />}
      {hasTradePrep && <TradePrepCard content={message.content} />}
    </div>
  )
}

function MarkdownWithHtmlPreview({ content, htmlPreviewLabel }: { content: string; htmlPreviewLabel: string }) {
  return (
    <>
      {splitHtmlFences(content).map((segment, index) => {
        if (segment.kind === 'html') {
          return (
            <HtmlPreview
              key={index}
              html={segment.content}
              label={htmlPreviewLabel}
            />
          )
        }
        return (
          <ReactMarkdown
            key={index}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const lang = match ? match[1] : ''
                const codeStr = String(children).replace(/\n$/, '')

                if (lang || codeStr.includes('\n')) {
                  return (
                    <div className="not-prose relative group">
                      {lang && (
                        <span className="absolute right-2 top-1 text-[10px] text-gray-400 opacity-60">{lang}</span>
                      )}
                      <pre className="bg-gray-50 rounded-lg p-3 overflow-x-auto text-xs font-mono" style={{ margin: '0.5em 0' }}>
                        <code className={className} {...(props as any)}>{children}</code>
                      </pre>
                    </div>
                  )
                }

                return <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono" {...(props as any)}>{children}</code>
              },
            }}
          >
            {segment.content}
          </ReactMarkdown>
        )
      })}
    </>
  )
}

function HtmlPreview({ html, label }: { html: string; label: string }) {
  const safeHtml = normalizeHtmlPreviewTheme(stripUnsafeHtml(html))

  return (
    <div
      className="not-prose border border-gray-200 rounded-lg overflow-hidden my-2 bg-white shadow-sm"
    >
      <div className="text-[10px] text-gray-500 px-3 py-1 bg-gray-50 border-b border-gray-200">{label}</div>
      <div
        className="overflow-auto html-preview-content"
        style={{
          maxHeight: 520,
          padding: 12,
          background: 'transparent',
          color: 'inherit',
        }}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  )
}

function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '')
}

function normalizeHtmlPreviewTheme(html: string): string {
  return html
    .replace(/#131722/gi, '#ffffff')
    .replace(/#1e222d/gi, '#f8fafc')
    .replace(/#2a2e39/gi, '#e5e7eb')
    .replace(/#d1d4dc/gi, '#111827')
    .replace(/#868993/gi, '#6b7280')
    .replace(/#b0b0b0/gi, '#6b7280')
    .replace(/#ff6d6d/gi, '#ef4444')
    .replace(/#26a69a/gi, '#10b981')
    .replace(/background\s*:\s*(?:rgb\(19,\s*23,\s*34\)|#131722)/gi, 'background:#ffffff')
    .replace(/color\s*:\s*(?:rgb\(209,\s*212,\s*220\)|#d1d4dc)/gi, 'color:#111827')
    .replace(/color\s*:\s*(?:rgb\(255,\s*255,\s*255\)|#ffffff|white)/gi, 'color:#111827')
}

function splitHtmlFences(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const pattern = /```html\s*\n?([\s\S]*?)```/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'markdown', content: content.slice(lastIndex, match.index) })
    }
    segments.push({ kind: 'html', content: match[1].trim() })
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push({ kind: 'markdown', content: content.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ kind: 'markdown', content }]
}
