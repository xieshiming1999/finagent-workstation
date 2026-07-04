import { create } from 'zustand'
import { widgetTitle } from './useLanguageStore'
import {
  defaultSidebarWidgetTypes,
  sidebarWidgetCategory,
  type SidebarWidgetCategory,
  type WidgetType,
} from '../panels/sidebar-panel-contract'

export type { SidebarWidgetCategory, WidgetType }
export { defaultSidebarWidgetTypes, sidebarWidgetCategory }

export interface SidebarWidget {
  id: string
  type: WidgetType
  title: string
}

function createDefaultWidgets(): SidebarWidget[] {
  return defaultSidebarWidgetTypes.map((type) => ({
    id: type,
    type,
    title: widgetTitle(type),
  }))
}

const DEFAULT_WIDGETS: SidebarWidget[] = createDefaultWidgets()

interface SidebarState {
  widgets: SidebarWidget[]
  activeWidget: string | null
  visible: boolean

  addWidget: (widget: SidebarWidget) => void
  removeWidget: (id: string) => void
  setActive: (id: string) => void
  toggleSidebar: () => void
  setSidebarVisible: (v: boolean) => void
  localizeBuiltinTitles: () => void
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  widgets: DEFAULT_WIDGETS,
  activeWidget: DEFAULT_WIDGETS[0]?.id ?? null,
  visible: true,

  addWidget: (widget) => {
    if (get().widgets.some((w) => w.id === widget.id)) {
      set({ activeWidget: widget.id, visible: true })
      return
    }
    set((s) => ({ widgets: [...s.widgets, widget], activeWidget: widget.id, visible: true }))
  },

  removeWidget: (id) => {
    set((s) => {
      const widgets = s.widgets.filter((w) => w.id !== id)
      const activeWidget = s.activeWidget === id ? widgets[0]?.id ?? null : s.activeWidget
      return { widgets, activeWidget }
    })
  },

  setActive: (id) => set({ activeWidget: id }),
  toggleSidebar: () => set((s) => ({ visible: !s.visible })),
  setSidebarVisible: (v) => set({ visible: v }),
  localizeBuiltinTitles: () => set((s) => ({
    widgets: s.widgets.map((w) => ({ ...w, title: widgetTitle(w.type) })),
  })),
}))
