import { existsSync, statSync, copyFileSync, readdirSync, unlinkSync, mkdirSync, readFileSync } from 'fs'
import { resolve, normalize, relative, dirname, basename, extname, join, sep } from 'path'

const MAX_VERSIONS_PER_FILE = 10

/**
 * Normalize a file path, resolving relative paths against basePath.
 * Throws if the resolved path escapes basePath (sandbox enforcement).
 */
export function normalizePath(filePath: string, basePath: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) throw new Error('file_path cannot be empty')

  const resolved = trimmed.startsWith('/') ? normalize(trimmed) : normalize(join(basePath, trimmed))
  const normalizedBase = normalize(basePath)

  if (!resolved.startsWith(normalizedBase)) {
    throw new Error(`Path "${resolved}" is outside sandbox "${normalizedBase}"`)
  }

  return resolved
}

/**
 * Check if a path is in the bundle/ directory (read-only).
 */
export function isInBundleDir(path: string, basePath: string): boolean {
  return normalize(path).startsWith(normalize(join(basePath, 'bundle')))
}

/**
 * Check if a path is in the memory/ directory (writes allowed without permission).
 */
export function isInMemoryDir(path: string, basePath: string): boolean {
  return normalize(path).startsWith(normalize(join(basePath, 'memory')))
}

/**
 * Save a snapshot of a file before overwriting/editing.
 * Returns the backup path, or null if file doesn't exist or snapshot failed.
 */
export function snapshotBeforeWrite(filePath: string, basePath: string): string | null {
  if (!existsSync(filePath)) return null

  try {
    const rel = relative(basePath, filePath)
    const safeName = rel.split(sep).join('__')
    const historyDir = join(basePath, 'memory', '.file_history', safeName)
    mkdirSync(historyDir, { recursive: true })

    const timestamp = Date.now()
    const backupPath = join(historyDir, `${timestamp}.bak`)
    copyFileSync(filePath, backupPath)

    pruneHistory(historyDir)
    return backupPath
  } catch {
    return null
  }
}

/**
 * Find a file with same base name but different extension in the same directory.
 */
export function findSimilarFile(path: string): string | null {
  const dir = dirname(path)
  if (!existsSync(dir)) return null
  const baseName = basename(path, extname(path))
  try {
    for (const f of readdirSync(dir)) {
      const name = basename(f, extname(f))
      if (name === baseName && join(dir, f) !== path) {
        return join(dir, f)
      }
    }
  } catch { /* */ }
  return null
}

function pruneHistory(historyDir: string) {
  try {
    const files = readdirSync(historyDir)
      .filter((f) => f.endsWith('.bak'))
      .sort()
    if (files.length <= MAX_VERSIONS_PER_FILE) return
    const toDelete = files.slice(0, files.length - MAX_VERSIONS_PER_FILE)
    for (const f of toDelete) {
      unlinkSync(join(historyDir, f))
    }
  } catch { /* */ }
}

/**
 * List available snapshots for a file, newest first.
 */
export function listSnapshots(filePath: string, basePath: string): Array<{ path: string; timestamp: number }> {
  const rel = relative(basePath, filePath)
  const safeName = rel.split(sep).join('__')
  const historyDir = join(basePath, 'memory', '.file_history', safeName)
  if (!existsSync(historyDir)) return []

  return readdirSync(historyDir)
    .filter((f) => f.endsWith('.bak'))
    .map((f) => ({
      path: join(historyDir, f),
      timestamp: parseInt(basename(f, '.bak'), 10) || 0,
    }))
    .sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Restore a file from its most recent snapshot. Returns the snapshot timestamp
 * on success so callers can disclose exactly what was restored.
 */
export function restoreLatest(filePath: string, basePath: string): number | null {
  const snapshots = listSnapshots(filePath, basePath)
  if (snapshots.length === 0) return null
  try {
    copyFileSync(snapshots[0].path, filePath)
    return snapshots[0].timestamp
  } catch {
    return null
  }
}
