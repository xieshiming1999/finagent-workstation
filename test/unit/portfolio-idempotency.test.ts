import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { PortfolioTool } from '../../src/agent/tools/portfolio'
import { readPaperExecutionReceipt, readPaperExecutionState } from '../../src/agent/paper-execution-readback'
import type { ToolContext } from '../../src/agent/tool'

describe('Portfolio execution idempotency', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('returns a typed snapshot for an empty paper portfolio', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-portfolio-empty-snapshot-'))
    roots.push(basePath)

    const payload = JSON.parse(await new PortfolioTool().call(
      'snapshot',
      { action: 'snapshot', market: 'cn' },
      { basePath } as ToolContext,
    ))

    expect(payload).toMatchObject({
      action: 'snapshot',
      market: 'cn',
      cash: 1000000,
      totalAssets: 1000000,
      positions: 0,
      holdings: [],
    })
  })

  it('returns the original receipt without duplicating a paper trade', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-portfolio-idempotency-'))
    roots.push(basePath)
    const tool = new PortfolioTool()
    const context = { basePath } as ToolContext
    const input = {
      action: 'trade', market: 'cn', symbol: '600519', side: 'buy',
      shares: 100, price: 100, idempotencyKey: 'workstation-receipt-test-1',
    }

    const first = JSON.parse(await tool.call('first', input, context))
    const replay = JSON.parse(await tool.call('replay', input, context))

    expect(first).toMatchObject({
      contract: 'finagent.execution-receipt.v1',
      idempotencyKey: 'workstation-receipt-test-1',
      idempotentReplay: false,
    })
    expect(replay.idempotentReplay).toBe(true)
    const stored = JSON.parse(readFileSync(join(basePath, 'memory', '.portfolio_cn.json'), 'utf8'))
    expect(stored.trades).toHaveLength(1)
    expect(stored.positions['600519'].shares).toBe(100)
    expect(Object.keys(stored.executionReceipts)).toHaveLength(1)
    expect(readPaperExecutionState(basePath)).toMatchObject({
      contract: 'finagent.paper-execution-state.v1', tradeCount: 1, receiptCount: 1,
    })
    expect(readPaperExecutionReceipt(basePath, 'workstation-receipt-test-1')).toMatchObject({
      contract: 'finagent.execution-receipt-readback.v1', found: true,
      receipt: { contract: 'finagent.execution-receipt.v1' },
    })
  })

  it('rejects reuse of a key for a different order', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-portfolio-conflict-'))
    roots.push(basePath)
    const tool = new PortfolioTool()
    const context = { basePath } as ToolContext
    const base = {
      action: 'trade', market: 'cn', symbol: '600519', side: 'buy',
      shares: 100, price: 100, idempotencyKey: 'workstation-conflict-1',
    }
    await tool.call('first', base, context)
    await expect(tool.call('conflict', { ...base, price: 101 }, context))
      .rejects.toThrow('idempotencyKey already belongs to a different order')
  })
})
