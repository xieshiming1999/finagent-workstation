import fs from 'node:fs'
import path from 'node:path'

export const STRATEGY_ARTIFACT_DIR = 'strategies'
export const STRATEGY_ITEM_DIR = 'items'
export const STRATEGY_LIBRARY_FILE = 'custom-strategies.json'
export const LEGACY_STRATEGY_LIBRARY_FILE = path.join('data', STRATEGY_LIBRARY_FILE)

export interface StrategyArtifactPaths {
  strategyDir: string
  itemDir: string
  libraryPath: string
  legacyLibraryPath: string
}

export function strategyArtifactPaths(basePath: string): StrategyArtifactPaths {
  const strategyDir = path.join(basePath, STRATEGY_ARTIFACT_DIR)
  return {
    strategyDir,
    itemDir: path.join(strategyDir, STRATEGY_ITEM_DIR),
    libraryPath: path.join(strategyDir, STRATEGY_LIBRARY_FILE),
    legacyLibraryPath: path.join(basePath, LEGACY_STRATEGY_LIBRARY_FILE),
  }
}

export function strategyItemPath(basePath: string, strategyId: string): string {
  return path.join(strategyArtifactPaths(basePath).itemDir, `${safeStrategyFileName(strategyId)}.json`)
}

export function readableStrategyLibraryPath(basePath: string): string {
  const paths = strategyArtifactPaths(basePath)
  if (fs.existsSync(paths.libraryPath)) return paths.libraryPath
  if (fs.existsSync(paths.legacyLibraryPath)) return paths.legacyLibraryPath
  return paths.libraryPath
}

export function ensureStrategyArtifactDirs(basePath: string): StrategyArtifactPaths {
  const paths = strategyArtifactPaths(basePath)
  fs.mkdirSync(paths.strategyDir, { recursive: true })
  fs.mkdirSync(paths.itemDir, { recursive: true })
  return paths
}

function safeStrategyFileName(strategyId: string): string {
  const normalized = strategyId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return normalized || 'strategy'
}
