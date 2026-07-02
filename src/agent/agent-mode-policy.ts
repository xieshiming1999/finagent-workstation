export type AgentMode = 'chat' | 'event' | 'subagent' | 'goal' | 'loop-controller'

export interface AgentModePolicy {
  mode: AgentMode
  drainNotificationsInLoop: boolean
  enablePostTurnHooks: boolean
  enableRecap: boolean
  historySource: string
  allowInteractiveTools: boolean
}

const DEFAULT_POLICIES: Record<AgentMode, AgentModePolicy> = {
  chat: {
    mode: 'chat',
    drainNotificationsInLoop: true,
    enablePostTurnHooks: true,
    enableRecap: true,
    historySource: 'chat',
    allowInteractiveTools: true,
  },
  event: {
    mode: 'event',
    drainNotificationsInLoop: false,
    enablePostTurnHooks: false,
    enableRecap: false,
    historySource: 'event',
    allowInteractiveTools: false,
  },
  subagent: {
    mode: 'subagent',
    drainNotificationsInLoop: false,
    enablePostTurnHooks: false,
    enableRecap: false,
    historySource: 'subagent',
    allowInteractiveTools: false,
  },
  goal: {
    mode: 'goal',
    drainNotificationsInLoop: true,
    enablePostTurnHooks: true,
    enableRecap: false,
    historySource: 'goal',
    allowInteractiveTools: false,
  },
  'loop-controller': {
    mode: 'loop-controller',
    drainNotificationsInLoop: false,
    enablePostTurnHooks: false,
    enableRecap: false,
    historySource: 'loop',
    allowInteractiveTools: false,
  },
}

export function resolveAgentModePolicy(args: {
  agentRole?: string
  drainNotificationsInLoop?: boolean
  modePolicy?: Partial<AgentModePolicy>
}): AgentModePolicy {
  const mode = normalizeAgentMode(args.modePolicy?.mode ?? args.agentRole)
  const base = DEFAULT_POLICIES[mode]
  return {
    ...base,
    ...args.modePolicy,
    mode,
    drainNotificationsInLoop: args.drainNotificationsInLoop ?? args.modePolicy?.drainNotificationsInLoop ?? base.drainNotificationsInLoop,
  }
}

function normalizeAgentMode(value?: string): AgentMode {
  if (value === 'event' || value === 'subagent' || value === 'goal' || value === 'loop-controller') return value
  return 'chat'
}
