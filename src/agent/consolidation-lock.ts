import { existsSync, writeFileSync, statSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'

const LOCK_FILE_NAME = '.consolidate-lock'
const STALE_THRESHOLD_MS = 60 * 60 * 1000

export function readLastConsolidatedAt(memoryDir: string): number {
  const lockFile = join(memoryDir, LOCK_FILE_NAME)
  if (!existsSync(lockFile)) return 0
  return statSync(lockFile).mtimeMs
}

export function tryAcquireConsolidationLock(memoryDir: string): number | null {
  const lockPath = join(memoryDir, LOCK_FILE_NAME)
  const priorMtime = existsSync(lockPath) ? statSync(lockPath).mtimeMs : 0

  if (existsSync(lockPath)) {
    const age = Date.now() - priorMtime
    const { readFileSync } = require('fs')
    const body = readFileSync(lockPath, 'utf-8').trim()
    if (age < STALE_THRESHOLD_MS && body) return null
  }

  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(lockPath, 'dream-active', 'utf-8')
  return priorMtime
}

export function releaseConsolidationLock(memoryDir: string): void {
  const lockFile = join(memoryDir, LOCK_FILE_NAME)
  if (existsSync(lockFile)) writeFileSync(lockFile, '', 'utf-8')
}

export function rollbackConsolidationLock(memoryDir: string, priorMtime: number): void {
  const lockFile = join(memoryDir, LOCK_FILE_NAME)
  if (priorMtime === 0) {
    if (existsSync(lockFile)) unlinkSync(lockFile)
  } else {
    writeFileSync(lockFile, '', 'utf-8')
    const { utimesSync } = require('fs')
    const time = priorMtime / 1000
    utimesSync(lockFile, time, time)
  }
}

export function recordConsolidation(memoryDir: string): void {
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(join(memoryDir, LOCK_FILE_NAME), '', 'utf-8')
}
