import { create } from 'zustand'
import { t } from './useLanguageStore'

export type LayoutMode = 'default' | 'analysis' | 'monitor' | 'reading' | 'trading'

interface LayoutState {
  mode: LayoutMode
  setMode: (mode: LayoutMode) => void
}

export const LAYOUT_CONFIGS: Record<LayoutMode, { label: string; chatWidth: string; description: string }> = {
  default: { label: t('layoutDefault'), chatWidth: '30%', description: t('layoutDefaultDesc') },
  analysis: { label: t('layoutAnalysis'), chatWidth: '25%', description: t('layoutAnalysisDesc') },
  monitor: { label: t('layoutMonitor'), chatWidth: '0%', description: t('layoutMonitorDesc') },
  reading: { label: t('layoutReading'), chatWidth: '0%', description: t('layoutReadingDesc') },
  trading: { label: t('layoutTrading'), chatWidth: '35%', description: t('layoutTradingDesc') },
}

export const useLayoutStore = create<LayoutState>((set) => ({
  mode: 'default',
  setMode: (mode) => set({ mode }),
}))
