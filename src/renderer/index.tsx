import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initTheme } from './store/useThemeStore'
import { usePanelStore } from './store/usePanelStore'
import { useAgentStore } from './store/useAgentStore'
import { initLanguage } from './store/useLanguageStore'

initTheme()
initLanguage()

// Expose panel store for main process queries (WebViewTool.panelQuery)
;(window as any).__panelStore = usePanelStore
;(window as any).__agentStore = useAgentStore

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
