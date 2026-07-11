import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('main logger', () => {
  it('keeps file logging when the inherited stdout socket is closed', async () => {
    const originalLog = console.log
    const error = new Error('write EIO') as NodeJS.ErrnoException
    error.code = 'EIO'
    console.log = (() => {
      throw error
    }) as typeof console.log

    try {
      const { initLogger, readRecentLog } = await import('../../src/main/logger')
      const basePath = mkdtempSync(join(tmpdir(), 'finagent-workstation-logger-'))

      expect(() => initLogger(basePath)).not.toThrow()
      expect(() => console.log('message after closed stdout')).not.toThrow()
      expect(readRecentLog().content).toContain('message after closed stdout')
    } finally {
      console.log = originalLog
    }
  })
})
