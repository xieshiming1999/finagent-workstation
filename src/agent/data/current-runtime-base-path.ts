let currentRuntimeBasePath: string | null = null

export function setCurrentRuntimeBasePath(basePath: string | null | undefined): void {
  const normalized = typeof basePath === 'string' ? basePath.trim() : ''
  currentRuntimeBasePath = normalized ? normalized : null
}

export function getCurrentRuntimeBasePath(): string | null {
  return currentRuntimeBasePath
}
