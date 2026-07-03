import type { Message, ToolUse } from './message'

export interface DomainToolInterception {
  skippedReason: string
  answer: string | null
  autoToolCalls?: ToolUse[]
  autoAnswerProbe?: ToolUse[]
}

export interface DomainRecovery {
  toolCalls: ToolUse[]
  answerAfterTools: (messages: Message[]) => string | null
}

export interface DomainWorkflowHooks {
  buildPreflightToolCalls(messages: Message[]): ToolUse[] | null
  maybeBuildPreflightAnswer(messages: Message[]): string | null
  maybeInterceptToolCalls(messages: Message[], proposedToolCalls: ToolUse[]): DomainToolInterception | null
  maybeBuildBoundedAnswer(messages: Message[]): string | null
  buildRecovery(messages: Message[]): DomainRecovery | null
}

export const emptyDomainWorkflowHooks: DomainWorkflowHooks = {
  buildPreflightToolCalls: () => null,
  maybeBuildPreflightAnswer: () => null,
  maybeInterceptToolCalls: () => null,
  maybeBuildBoundedAnswer: () => null,
  buildRecovery: () => null,
}
