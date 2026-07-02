import { existsSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs'
import { join } from 'path'

const CLEANUP_MAX_AGE_DAYS = 7
const CLEANUP_TARGETS = ['.tool_outputs', '.screenshots']

/**
 * Run background housekeeping: clean up old temp files.
 * Should be called once, delayed after first agent turn.
 * Matching finagent background_housekeeping.dart.
 */
export async function runBackgroundHousekeeping(memoryDir: string): Promise<void> {
  console.log('[Housekeeping] Starting background housekeeping')
  let totalDeleted = 0

  for (const target of CLEANUP_TARGETS) {
    const dir = join(memoryDir, target)
    if (!existsSync(dir)) continue
    totalDeleted += cleanupOldFiles(dir, CLEANUP_MAX_AGE_DAYS)
  }

  // Clean up old file history (broader age: 30 days)
  const historyDir = join(memoryDir, '.file_history')
  if (existsSync(historyDir)) {
    totalDeleted += cleanupOldFiles(historyDir, 30)
  }

  if (totalDeleted > 0) {
    console.log(`[Housekeeping] Deleted ${totalDeleted} old files`)
  }
}

function cleanupOldFiles(dir: string, maxAgeDays: number): number {
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let count = 0

  try {
    function scan(d: string) {
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        const stat = statSync(full)
        if (stat.isDirectory()) {
          scan(full)
          // Remove empty directories
          try { if (readdirSync(full).length === 0) rmdirSync(full) } catch { /* */ }
        } else if (stat.mtimeMs < cutoffMs) {
          try { unlinkSync(full); count++ } catch { /* */ }
        }
      }
    }
    scan(dir)
  } catch (e) {
    console.error(`[Housekeeping] Cleanup error in ${dir}:`, e)
  }

  return count
}
