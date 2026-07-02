export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000
export const EASTMONEY_RUNTIME_TIMEOUT_MS = 120_000

export function timeoutForEastmoneyBackedUrl(
  urlOrPath: string,
  fallbackMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): number {
  return isEastmoneyBackedUrl(urlOrPath) ? EASTMONEY_RUNTIME_TIMEOUT_MS : fallbackMs
}

export function isEastmoneyBackedUrl(urlOrPath: string): boolean {
  return /eastmoney\.com|_provider(?:=|%3D)eastmoney|_provider["':\s]+eastmoney/i.test(urlOrPath)
}
