import { create } from 'zustand'
import { panelTitle, t } from './useLanguageStore'

export type PanelType = 'chat' | 'webview' | 'dashboard' | 'settings' | 'strategy-library' | 'data-manager'

export interface PanelConfig {
  id: string
  type: PanelType
  title: string
  url?: string
  closable?: boolean
}

export interface WebViewSummary {
  id: string
  title: string
  url: string
  type: PanelType
  isActive: boolean
}

interface PanelState {
  panels: PanelConfig[]
  activePanel: string | null

  addPanel: (panel: PanelConfig) => void
  removePanel: (id: string) => void
  setActive: (id: string) => void
  openWebView: (id: string, url: string, title?: string) => void
  refreshPanel: (id: string) => void
  findByUrl: (url: string) => PanelConfig | undefined
  getWebViewSummary: () => WebViewSummary[]
  localizeBuiltinTitles: () => void
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panels: [
    { id: 'workspace', type: 'dashboard', title: panelTitle('workspace'), closable: false },
  ],
  activePanel: 'workspace',

  addPanel: (panel) => {
    const normalizedPanel = normalizePanel(panel)
    // Dedup by id first
    const existingById = get().panels.find((p) => p.id === normalizedPanel.id)
    if (existingById) {
      set((s) => ({
        panels: s.panels.map((p) => p.id === normalizedPanel.id ? { ...p, ...normalizedPanel } : p),
        activePanel: normalizedPanel.id,
      }))
      return
    }

    // Dedup by URL: if same file/URL already open, activate + refresh that panel
    if (normalizedPanel.url) {
      const normalizedUrl = normalizeUrl(normalizedPanel.url)
      const existingByUrl = get().panels.find((p) => p.url && normalizeUrl(p.url) === normalizedUrl)
      if (existingByUrl) {
        set((s) => ({
          panels: s.panels.map((p) => p.id === existingByUrl.id ? { ...p, title: normalizedPanel.title || p.title, url: normalizedPanel.url } : p),
          activePanel: existingByUrl.id,
        }))
        return
      }
    }

    set((s) => ({
      panels: [...s.panels, normalizedPanel],
      activePanel: normalizedPanel.id,
    }))
  },

  removePanel: (id) => {
    set((s) => {
      const panels = s.panels.filter((p) => p.id !== id)
      const activePanel = s.activePanel === id
        ? panels[panels.length - 1]?.id ?? null
        : s.activePanel
      return { panels, activePanel }
    })
  },

  setActive: (id) => set({ activePanel: id }),

  openWebView: (id, url, title) => {
    // Check if this URL is already open in any panel
    const normalizedUrl = normalizeUrl(url)
    const existingByUrl = get().panels.find((p) => p.url && normalizeUrl(p.url) === normalizedUrl)
    if (existingByUrl) {
      set((s) => ({
        panels: s.panels.map((p) => p.id === existingByUrl.id ? { ...p, url } : p),
        activePanel: existingByUrl.id,
      }))
      return
    }

    const existing = get().panels.find((p) => p.id === id)
    if (existing) {
      set((s) => ({
        panels: s.panels.map((p) => (p.id === id ? { ...p, url } : p)),
        activePanel: id,
      }))
      return
    }

    set((s) => ({
      panels: [
        ...s.panels,
        normalizePanel({ id, type: 'webview', title: title ?? id, url, closable: true }),
      ],
      activePanel: id,
    }))
  },

  refreshPanel: (id) => {
    const panel = get().panels.find((p) => p.id === id)
    if (panel?.url) {
      // Cache bust by appending timestamp
      const base = panel.url.split('?')[0]
      set((s) => ({
        panels: s.panels.map((p) => p.id === id ? { ...p, url: `${base}?t=${Date.now()}` } : p),
      }))
    }
  },

  findByUrl: (url) => {
    const normalized = normalizeUrl(url)
    return get().panels.find((p) => p.url && normalizeUrl(p.url) === normalized)
  },

  getWebViewSummary: () => {
    const { panels, activePanel } = get()
    return panels
      .filter((p) => (p.type === 'webview' || p.type === 'dashboard') && p.url)
      .map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url!,
        type: p.type,
        isActive: p.id === activePanel,
      }))
  },

  localizeBuiltinTitles: () => set((s) => ({
    panels: s.panels.map((p) => {
      if (p.id === 'workspace') return { ...p, title: panelTitle('workspace') }
      if (p.type === 'settings') return { ...p, title: panelTitle('settings') }
      return p
    }),
  })),
}))

/** Normalize URL for comparison: strip query params and trailing slashes */
function normalizeUrl(url: string): string {
  return url.split('?')[0].replace(/\/+$/, '')
}

function normalizePanel(panel: PanelConfig): PanelConfig {
  const title = displayTitle(panel.title, panel.url)
  return { ...panel, title }
}

function displayTitle(title: string, url?: string): string {
  if (!looksLikePath(title)) return title
  if (!url && !title) return t('pageFallback')
  const source = url ?? title
  const file = source.split('?')[0].split(/[\\/]/).filter(Boolean).pop() ?? t('pageFallback')
  return file.replace(/\.html?$/i, '') || t('pageFallback')
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.startsWith('file:')
}
