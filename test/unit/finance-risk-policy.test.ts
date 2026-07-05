import { describe, expect, it } from 'vitest'
import { financeRiskPolicyForTool } from '../../src/agent/finance-risk-policy'
import { needsPermissionForInput } from '../../src/agent/tool'
import { BashTool } from '../../src/agent/tools/bash'
import { CronCreateTool, CronDeleteTool, CronListTool } from '../../src/agent/tools/cron'
import { MonitorCreateTool, MonitorDeleteTool, MonitorListTool, MonitorUpdateTool } from '../../src/agent/tools/monitor'
import { PortfolioTool } from '../../src/agent/tools/portfolio'
import { ScriptTool } from '../../src/agent/tools/script'
import { UINotifyTool } from '../../src/agent/tools/ui-tools'

describe('finance risk policy', () => {
  it('classifies real trading as gated and not automation-safe', () => {
    const policy = financeRiskPolicyForTool('XueqiuTrade', { action: 'buy' })

    expect(policy.tier).toBe('real_trading')
    expect(policy.requiresPermission).toBe(true)
    expect(policy.automationAllowed).toBe(false)
    expect(policy.denialBehavior).toBe('stop')
  })

  it('classifies Xueqiu preview as read-only evidence', () => {
    const policy = financeRiskPolicyForTool('XueqiuTrade', { action: 'preview_order' })

    expect(policy.tier).toBe('external_read')
    expect(policy.requiresPermission).toBe(false)
    expect(policy.automationAllowed).toBe(true)
    expect(policy.denialBehavior).toBe('read_only_fallback')
  })

  it('separates paper portfolio mutation from portfolio reads', () => {
    const mutationPolicy = financeRiskPolicyForTool('Portfolio', { action: 'trade' })
    const readPolicy = financeRiskPolicyForTool('Portfolio', { action: 'risk' })

    expect(mutationPolicy.tier).toBe('paper_trading')
    expect(mutationPolicy.requiresPermission).toBe(true)
    expect(mutationPolicy.automationAllowed).toBe(false)
    expect(readPolicy.tier).toBe('local_read')
    expect(readPolicy.requiresPermission).toBe(false)
  })

  it('keeps portfolio mutation gated while read actions stay permission-free', () => {
    const tool = new PortfolioTool()

    for (const action of ['add', 'remove', 'trade', 'clear']) {
      expect(tool.needsPermissions?.({ action }), action).toBe(true)
    }
    for (const action of ['preview_trade', 'snapshot', 'risk', 'history', 'help']) {
      expect(tool.needsPermissions?.({ action }), action).toBe(false)
    }
  })

  it('keeps quota-consuming providers automation-safe only with cache/rate-limit guardrails', () => {
    const policy = financeRiskPolicyForTool('DataStore', { action: 'akshare' })

    expect(policy.tier).toBe('quota_consuming')
    expect(policy.automationAllowed).toBe(true)
    expect(policy.denialBehavior).toBe('read_only_fallback')
    expect(policy.reason).toContain('quota')
  })

  it('classifies local execution and script tools as permission-gated local writes', () => {
    const approved = new Set<string>()
    for (const tool of [new BashTool(), new ScriptTool()]) {
      const policy = financeRiskPolicyForTool(tool.name)
      expect(policy.tier, tool.name).toBe('local_write')
      expect(policy.requiresPermission, tool.name).toBe(true)
      expect(policy.denialBehavior, tool.name).toBe('stop')
      expect(needsPermissionForInput(tool, { command: 'touch a', code: 'writeFile("a.txt", "x")' }, approved, false), tool.name).toBe(true)
    }
  })

  it('gates notification and scheduler side effects while leaving list actions read-only', () => {
    const scheduler = {} as any
    const monitorStore = {} as any
    const approved = new Set<string>()
    const gatedTools = [
      new UINotifyTool(),
      new CronCreateTool(scheduler),
      new CronDeleteTool(scheduler),
      new MonitorCreateTool(monitorStore),
      new MonitorUpdateTool(monitorStore),
      new MonitorDeleteTool(monitorStore),
    ]
    const readOnlyTools = [
      new CronListTool(scheduler),
      new MonitorListTool(monitorStore),
    ]

    for (const tool of gatedTools) {
      const policy = financeRiskPolicyForTool(tool.name)
      expect(policy.tier, tool.name).toBe('notification')
      expect(policy.requiresPermission, tool.name).toBe(true)
      expect(needsPermissionForInput(tool, {}, approved, false), tool.name).toBe(true)
    }
    for (const tool of readOnlyTools) {
      expect(needsPermissionForInput(tool, {}, approved, false), tool.name).toBe(false)
    }
  })
})
