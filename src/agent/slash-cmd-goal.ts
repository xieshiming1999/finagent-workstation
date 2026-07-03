import type { CommandResult, CommandContext } from './slash-command'
import { goalCopy, goalHelpCopy, subgoalHelpCopy } from './runtime-copy'
import { buildGoalPrompt, getGoalTemplate, GOAL_TEMPLATES } from './goal-templates'

interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>
}

export const goalCommands: SlashCommand[] = [
  {
    name: 'goal',
    aliases: [],
    description: 'Set an autonomous goal: /goal <text>, /goal status/pause/resume/clear',
    handler: async (args: string, ctx: CommandContext) => {
      const parts = args.trim().split(/\s+/)
      const subCmd = parts[0]?.toLowerCase()

      switch (subCmd) {
        case 'status':
          return { type: 'text' as const, text: ctx.goalManager.statusLine() }
        case 'templates':
          return {
            type: 'text' as const,
            text: [
              'Goal templates:',
              ...GOAL_TEMPLATES.map((template) => `- ${template.id}: ${template.title}`),
              '',
              'Use: /goal template <id>',
            ].join('\n'),
          }
        case 'template': {
          const id = parts[1]?.trim()
          const template = id ? getGoalTemplate(id) : null
          if (!template) {
            return {
              type: 'text' as const,
              text: `Unknown goal template. Available: ${GOAL_TEMPLATES.map((t) => t.id).join(', ')}`,
            }
          }
          if (ctx.goalManager.isActive()) {
            return { type: 'text' as const, text: goalCopy.alreadyActive() }
          }
          const prompt = buildGoalPrompt(template)
          ctx.goalManager.set(prompt, template.defaultMaxTurns, {
            templateId: template.id,
            successCriteria: template.successCriteria,
            source: `template:${template.id}`,
            planSnapshot: buildRecentContextSnapshot(ctx),
            doneCriteria: template.successCriteria,
            verification: template.verifierChecks.join('; '),
            escalation: template.guardrails.join('; '),
            verifierResult: { status: 'unchecked', checkedAt: Date.now(), reason: 'Manual template goal started; verifier has not run yet.' },
          })
          return { type: 'goal-set' as const, goalPrompt: prompt }
        }
        case 'pause':
          if (!ctx.goalManager.hasGoal()) return { type: 'text' as const, text: goalCopy.noActiveGoal() }
          ctx.goalManager.pause('user-paused')
          return { type: 'text' as const, text: goalCopy.paused() }
        case 'resume': {
          if (!ctx.goalManager.hasGoal()) return { type: 'text' as const, text: goalCopy.noGoalToResume() }
          ctx.goalManager.resume(true)
          const prompt = ctx.goalManager.nextContinuationPrompt()
          if (prompt) return { type: 'goal-set' as const, goalPrompt: prompt }
          return { type: 'text' as const, text: goalCopy.resumed() }
        }
        case 'clear':
        case 'stop':
        case 'done':
          if (!ctx.goalManager.hasGoal()) return { type: 'text' as const, text: goalCopy.noActiveGoal() }
          ctx.goalManager.clear()
          return { type: 'text' as const, text: goalCopy.cleared() }
        case 'help':
        case '':
        case undefined:
          if (!args.trim()) return { type: 'text' as const, text: goalHelpCopy() }
          break
        default:
          break
      }

      const goalText = args.trim()
      if (!goalText) return { type: 'text' as const, text: goalHelpCopy() }
      if (ctx.goalManager.isActive()) {
        return { type: 'text' as const, text: goalCopy.alreadyActive() }
      }
      try {
        ctx.goalManager.set(goalText, undefined, {
          source: 'slash-command:/goal',
          planSnapshot: shouldSnapshotRecentContext(goalText) ? buildRecentContextSnapshot(ctx) : null,
          scope: 'Current conversation and current workspace unless the goal narrows the scope.',
          doneCriteria: ['The objective is completed and verified against the current repository state.'],
          verification: 'Report concrete evidence from files, command output, tests, or runtime behavior.',
          escalation: 'Stop and ask for input before destructive schema changes, real trading side effects, missing credentials, or incompatible backward-compatibility changes.',
        })
        return { type: 'goal-set' as const, goalPrompt: goalText }
      } catch (e) {
        return {
          type: 'text' as const,
          text: `${goalCopy.goalUpdateFailed()}: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    },
  },
  {
    name: 'subgoal',
    aliases: [],
    description: 'Add criteria to active goal: /subgoal <text>, /subgoal remove <N>, /subgoal clear/list',
    handler: async (args: string, ctx: CommandContext) => {
      const parts = args.trim().split(/\s+/)
      const subCmd = parts[0]?.toLowerCase()

      switch (subCmd) {
        case 'remove': {
          const n = Number(parts[1])
          if (!n || isNaN(n)) return { type: 'text' as const, text: goalCopy.usageRemove() }
          try {
            const removed = ctx.goalManager.removeSubgoal(n)
            return { type: 'text' as const, text: goalCopy.removedSubgoal(n, removed) }
          } catch (e) {
            return {
              type: 'text' as const,
              text: `${goalCopy.subgoalUpdateFailed()}: ${e instanceof Error ? e.message : String(e)}`,
            }
          }
        }
        case 'clear': {
          const count = ctx.goalManager.clearSubgoals()
          return {
            type: 'text' as const,
            text: count > 0 ? goalCopy.clearedSubgoals(count) : goalCopy.noSubgoalsToClear(),
          }
        }
        case 'list': {
          const state = ctx.goalManager.getState()
          if (!state || state.subgoals.length === 0) return { type: 'text' as const, text: goalCopy.noSubgoals() }
          const lines = state.subgoals.map((s, i) => `  ${i + 1}. ${s}`)
          return {
            type: 'text' as const,
            text: goalCopy.subgoalsList(state.subgoals.length, lines.join('\n')),
          }
        }
        case 'help':
        case '':
        case undefined:
          return { type: 'text' as const, text: subgoalHelpCopy() }
        default:
          break
      }

      const text = args.trim()
      if (!text) return { type: 'text' as const, text: subgoalHelpCopy() }
      try {
        const added = ctx.goalManager.addSubgoal(text)
        const state = ctx.goalManager.getState()
        return {
          type: 'text' as const,
          text: goalCopy.addedSubgoal(state?.subgoals.length ?? '?', added),
        }
      } catch (e) {
        return {
          type: 'text' as const,
          text: `${goalCopy.subgoalUpdateFailed()}: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    },
  },
]

function shouldSnapshotRecentContext(text: string): boolean {
  return /\b(above|previous|this|that|recent)\s+(plan|discussion|idea|context|report|design)\b/i.test(text)
    || /上面|刚才|前面|这个计划|上述计划|之前/.test(text)
}

function buildRecentContextSnapshot(ctx: CommandContext): string {
  const recent = ctx.messages.slice(-10)
  const lines = recent
    .map((message) => {
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      const compact = content.replace(/\s+/g, ' ').trim()
      if (!compact) return ''
      return `${message.role}: ${compact.slice(0, 800)}`
    })
    .filter(Boolean)
  return lines.join('\n').slice(-6000)
}
