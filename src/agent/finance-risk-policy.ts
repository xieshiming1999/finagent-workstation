export type FinanceRiskTier =
  | 'local_read'
  | 'external_read'
  | 'local_write'
  | 'quota_consuming'
  | 'notification'
  | 'paper_trading'
  | 'real_trading'
  | 'irreversible'
  | 'unknown'

export interface FinanceRiskPolicy {
  tier: FinanceRiskTier
  requiresPermission: boolean
  automationAllowed: boolean
  denialBehavior: 'stop' | 'read_only_fallback' | 'escalate'
  reason: string
}

const LOCAL_READ_TOOLS = new Set(['Read', 'LS', 'Glob', 'Grep', 'Environment', 'SessionSearch'])
const LOCAL_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'FileManage', 'Bash', 'Script', 'Dashboard', 'Report', 'ReportDownload', 'WebView'])
const QUOTA_TOOLS = new Set(['DataStore', 'MarketData', 'Research', 'WebFetch', 'WindMcp', 'ServiceCall'])
const NOTIFICATION_TOOLS = new Set([
  'UINotify',
  'CronCreate',
  'CronDelete',
  'MonitorCreate',
  'MonitorUpdate',
  'MonitorDelete',
])
const REAL_TRADING_TOOLS = new Set(['XueqiuTrade'])

export function financeRiskPolicyForTool(toolName: string, input: Record<string, unknown> = {}): FinanceRiskPolicy {
  if (REAL_TRADING_TOOLS.has(toolName)) {
    const action = String(input.action ?? '').toLowerCase()
    if (['portfolios', 'balance', 'position', 'history', 'preview_order', 'help'].includes(action)) {
      return {
        tier: 'external_read',
        requiresPermission: false,
        automationAllowed: true,
        denialBehavior: 'read_only_fallback',
        reason: 'Xueqiu portfolio reads and preview_order provide evidence without MONI write endpoints.',
      }
    }
    return {
      tier: 'real_trading',
      requiresPermission: true,
      automationAllowed: false,
      denialBehavior: 'stop',
      reason: 'Real broker or broker-like trading action must be explicitly gated and cannot be silently rerouted.',
    }
  }

  if (toolName === 'Portfolio') {
    const action = String(input.action ?? '').toLowerCase()
    if (action === 'trade' || action === 'add' || action === 'remove' || action === 'clear') {
      return {
        tier: 'paper_trading',
        requiresPermission: true,
        automationAllowed: false,
        denialBehavior: 'escalate',
        reason: 'Portfolio mutation is local paper-trading state; automation may analyze it but should not mutate it without a user action.',
      }
    }
    return {
      tier: 'local_read',
      requiresPermission: false,
      automationAllowed: true,
      denialBehavior: 'read_only_fallback',
      reason: 'Portfolio snapshot and risk reads are local analysis.',
    }
  }

  if (NOTIFICATION_TOOLS.has(toolName)) {
    return {
      tier: 'notification',
      requiresPermission: true,
      automationAllowed: false,
      denialBehavior: 'escalate',
      reason: 'External or user-visible notification side effects require explicit gating.',
    }
  }

  if (QUOTA_TOOLS.has(toolName)) {
    return {
      tier: 'quota_consuming',
      requiresPermission: false,
      automationAllowed: true,
      denialBehavior: 'read_only_fallback',
      reason: 'Provider calls may consume quota or rate limit; retry policy must prefer cache, serial probes, and stop on quota/auth errors.',
    }
  }

  if (LOCAL_WRITE_TOOLS.has(toolName)) {
    return {
      tier: 'local_write',
      requiresPermission: true,
      automationAllowed: true,
      denialBehavior: 'stop',
      reason: 'Local writes are allowed only inside approved runtime/project boundaries and must stop on denial.',
    }
  }

  if (LOCAL_READ_TOOLS.has(toolName)) {
    return {
      tier: 'local_read',
      requiresPermission: false,
      automationAllowed: true,
      denialBehavior: 'read_only_fallback',
      reason: 'Local read-only inspection is safe as a fallback after denied write or side-effect actions.',
    }
  }

  return {
    tier: 'unknown',
    requiresPermission: true,
    automationAllowed: false,
    denialBehavior: 'escalate',
    reason: 'Unknown finance action must be treated as gated until its side effects are classified.',
  }
}
