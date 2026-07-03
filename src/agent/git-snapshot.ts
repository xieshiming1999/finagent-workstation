import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Git snapshot/revert for session-level undo.
 * Creates lightweight git snapshots (stash-like) at key points
 * so the user can revert to a previous state.
 *
 * Reference: opencode/src/snapshot/index.ts
 */

export class GitSnapshot {
  private snapshotDir: string
  private snapshots: Array<{ hash: string; timestamp: number; description: string }> = []
  private cwd: string

  constructor(basePath: string, cwd: string) {
    this.snapshotDir = join(basePath, 'snapshots')
    this.cwd = cwd
    mkdirSync(this.snapshotDir, { recursive: true })
  }

  /** Check if current directory is a git repo */
  isGitRepo(): boolean {
    try {
      execSync('git rev-parse --git-dir', { cwd: this.cwd, stdio: 'pipe' })
      return true
    } catch { return false }
  }

  /** Take a snapshot of the current working tree state */
  track(description: string): string | null {
    if (!this.isGitRepo()) return null
    try {
      // Create a tree object from the current index
      execSync('git add -A', { cwd: this.cwd, stdio: 'pipe' })
      const tree = execSync('git write-tree', { cwd: this.cwd, encoding: 'utf-8' }).trim()
      const hash = execSync(`git commit-tree ${tree} -m "snapshot: ${description}"`, { cwd: this.cwd, encoding: 'utf-8' }).trim()

      // Reset the index (don't keep the staging)
      execSync('git reset', { cwd: this.cwd, stdio: 'pipe' })

      this.snapshots.push({ hash, timestamp: Date.now(), description })
      if (this.snapshots.length > 50) this.snapshots.shift()

      return hash
    } catch (e) {
      console.error('[GitSnapshot] track error:', e)
      return null
    }
  }

  /** Revert to a specific snapshot */
  restore(hash: string): boolean {
    if (!this.isGitRepo()) return false
    try {
      execSync(`git read-tree ${hash}`, { cwd: this.cwd, stdio: 'pipe' })
      execSync('git checkout-index -a -f', { cwd: this.cwd, stdio: 'pipe' })
      return true
    } catch (e) {
      console.error('[GitSnapshot] restore error:', e)
      return false
    }
  }

  /** Revert to the most recent snapshot */
  revertLast(): boolean {
    if (this.snapshots.length === 0) return false
    const last = this.snapshots[this.snapshots.length - 1]
    return this.restore(last.hash)
  }

  /** List available snapshots */
  list(): Array<{ hash: string; timestamp: number; description: string }> {
    return [...this.snapshots]
  }
}
