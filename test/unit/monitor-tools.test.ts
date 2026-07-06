import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MonitorStore } from '../../src/agent/monitor-store'
import { MonitorCreateTool, MonitorDeleteTool, MonitorListTool, MonitorUpdateTool } from '../../src/agent/tools/monitor'

describe('monitor tools', () => {
  it('create, update, list, and delete monitors through the scheduler-visible MonitorStore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fin-monitor-'))
    const store = new MonitorStore(dir)
    store.load()
    let changed = 0
    store.onChanged = () => { changed++ }

    const create = new MonitorCreateTool(store)
    const update = new MonitorUpdateTool(store)
    const list = new MonitorListTool(store)
    const remove = new MonitorDeleteTool(store)

    const created = JSON.parse(await create.call('tc1', {
      name: 'price watch',
      script: 'return { value: 1 }',
      interval: '5m',
      display: 'value_card',
    }, {} as any))

    expect(created.ok).toBe(true)
    expect(store.count).toBe(1)
    expect(store.get(created.id)?.intervalSeconds).toBe(300)
    expect(changed).toBeGreaterThan(0)

    await update.call('tc2', { id: created.id, enabled: false, interval: '30s' }, {} as any)
    expect(store.get(created.id)?.enabled).toBe(false)
    expect(store.get(created.id)?.intervalSeconds).toBe(30)

    expect(await list.call('tc3', {}, {} as any)).toContain('price watch')
    expect(JSON.parse(await remove.call('tc4', { id: created.id }, {} as any)).ok).toBe(true)
    expect(store.count).toBe(0)
  })
})
