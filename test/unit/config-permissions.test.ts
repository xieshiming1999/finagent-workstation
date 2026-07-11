import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/main/config'

describe('permission config migration', () => {
  it('defaults to globally skipping tool permission prompts', () => {
    const dir = join(tmpdir(), `fin-config-permission-default-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    const config = loadConfig(dir)

    expect(config.skipToolPermissions).toBe(true)
    expect(config.chatSkipPermissions).toBe(true)
  })

  it('uses legacy chatSkipPermissions as skipToolPermissions when the global field is absent', () => {
    const dir = join(tmpdir(), `fin-config-permission-legacy-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      chatSkipPermissions: false,
    }))

    const config = loadConfig(dir)

    expect(config.skipToolPermissions).toBe(false)
    expect(config.chatSkipPermissions).toBe(false)
  })

  it('prefers skipToolPermissions when both old and new fields are present', () => {
    const dir = join(tmpdir(), `fin-config-permission-global-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      skipToolPermissions: true,
      chatSkipPermissions: false,
    }))

    const config = loadConfig(dir)

    expect(config.skipToolPermissions).toBe(true)
    expect(config.chatSkipPermissions).toBe(true)
  })
})
