import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'warm' | 'system'

interface ThemeState {
  mode: ThemeMode
  resolved: 'light' | 'dark' | 'warm'
  setMode: (mode: ThemeMode) => void
}

function resolveSystem(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'light',
  resolved: 'light',

  setMode: (mode) => {
    const resolved = mode === 'system' ? resolveSystem() : mode
    set({ mode, resolved })
    applyTheme(resolved)
  },
}))

export function applyTheme(theme: 'light' | 'dark' | 'warm') {
  document.documentElement.setAttribute('data-theme', theme)
}

export function initTheme() {
  const store = useThemeStore.getState()
  applyTheme(store.resolved)

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (useThemeStore.getState().mode === 'system') {
      const resolved = e.matches ? 'dark' : 'light'
      useThemeStore.setState({ resolved })
      applyTheme(resolved)
    }
  })
}
