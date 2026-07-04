import { create } from 'zustand'
import { bottomTabTitle } from './useLanguageStore'

export type BottomPanelType = 'terminal' | 'logs' | 'api-health' | 'tasks'

export interface BottomTab {
  id: string
  type: BottomPanelType
  title: string
}

interface BottomPanelState {
  tabs: BottomTab[]
  activeTab: string | null
  visible: boolean

  addTab: (tab: BottomTab) => void
  removeTab: (id: string) => void
  setActive: (id: string) => void
  toggle: () => void
  setVisible: (v: boolean) => void
  localizeBuiltinTitles: () => void
}

export const useBottomPanelStore = create<BottomPanelState>((set, get) => ({
  tabs: [
    { id: 'logs', type: 'logs', title: bottomTabTitle('logs') },
  ],
  activeTab: 'logs',
  visible: false,

  addTab: (tab) => {
    if (get().tabs.some((t) => t.id === tab.id)) {
      set({ activeTab: tab.id, visible: true })
      return
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id, visible: true }))
  },

  removeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, activeTab: s.activeTab === id ? tabs[0]?.id ?? null : s.activeTab }
    })
  },

  setActive: (id) => set({ activeTab: id, visible: true }),
  toggle: () => set((s) => ({ visible: !s.visible })),
  setVisible: (v) => set({ visible: v }),
  localizeBuiltinTitles: () => set((s) => ({
    tabs: s.tabs.map((tab) => {
      if (tab.type === 'logs' || tab.type === 'terminal' || tab.type === 'api-health' || tab.type === 'tasks') {
        return { ...tab, title: bottomTabTitle(tab.type) }
      }
      return tab
    }),
  })),
}))
