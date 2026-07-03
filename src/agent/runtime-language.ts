import { loadConfig } from '../main/config'
import { globalConfigPath } from '../main/main-runtime'

export type RuntimeResolvedLanguage = 'en' | 'zh-CN'

export function resolveRuntimeLanguage(): RuntimeResolvedLanguage {
  try {
    const mode = loadConfig(globalConfigPath()).language
    if (mode === 'en' || mode === 'zh-CN') return mode
  } catch {
    // fall through to system detection
  }
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
  return locale.startsWith('zh') ? 'zh-CN' : 'en'
}

export function isChineseRuntime(): boolean {
  return resolveRuntimeLanguage() === 'zh-CN'
}

export function runtimeText(en: string, zhCn: string): string {
  return isChineseRuntime() ? zhCn : en
}
