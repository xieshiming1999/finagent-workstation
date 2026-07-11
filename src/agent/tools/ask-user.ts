import type { Tool, ToolContext } from '../tool'
import { appendInteractionEvidence } from '../interaction-evidence'

export class AskUserQuestionTool implements Tool {
  name = 'AskUserQuestion'
  description =
    'Ask the user a question and wait for their response. Use this tool, not prose-only questions, when execution cannot continue without clarification or user approval. Required for guarded finance actions with missing symbol, portfolio, size, price, execution mode, or approval.'
  isReadOnly = true
  requiresUserInteraction = true
  inputSchema = {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of choices (user can also type a custom answer)',
      },
      questions: {
        type: 'array',
        description: 'Optional multi-question form. Use only when multiple fields must be confirmed together.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            header: { type: 'string' },
            options: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  }

  private pendingResolve: ((answer: string) => void) | null = null
  private emitEvent: ((event: Record<string, unknown>) => void) | null = null
  private pendingQuestion: { question: string; options: string[]; requestId: string } | null = null
  private pendingContext: ToolContext | null = null

  setEventEmitter(fn: (event: Record<string, unknown>) => void) {
    this.emitEvent = fn
  }

  respondToQuestion(answer: string) {
    if (this.pendingResolve) {
      const pending = this.pendingQuestion
      if (pending && this.pendingContext) {
        appendInteractionEvidence(this.pendingContext, {
          type: 'user_question_resolved',
          requestId: pending.requestId,
          toolName: this.name,
          question: pending.question,
          options: pending.options,
          answer,
        })
      }
      this.pendingResolve(answer)
      this.pendingResolve = null
      this.pendingQuestion = null
      this.pendingContext = null
    }
  }

  getPendingQuestion() {
    return this.pendingQuestion
  }


  validateInput(input: Record<string, unknown>): string | null {
    if (!input.question && !Array.isArray(input.questions)) {
      return 'question or questions is required. Provide the question to ask the user.'
    }
    return null
  }
  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const normalized = normalizeAskInput(input)
    const question = normalized.question
    const options = normalized.options

    this.emitEvent?.({
      type: 'ask-user',
      question,
      options,
      requestId: _id,
    })
    this.pendingQuestion = { question, options, requestId: _id }
    this.pendingContext = ctx
    appendInteractionEvidence(ctx, {
      type: 'user_question_pending',
      requestId: _id,
      toolName: this.name,
      question,
      options,
    })

    return new Promise<string>((resolve) => {
      this.pendingResolve = resolve
      setTimeout(() => {
        if (this.pendingResolve === resolve) {
          appendInteractionEvidence(ctx, {
            type: 'user_question_timeout',
            requestId: _id,
            toolName: this.name,
            question,
            options,
          })
          this.pendingResolve = null
          this.pendingQuestion = null
          this.pendingContext = null
          resolve('(User did not respond within timeout)')
        }
      }, 300_000)
    })
  }
}

function normalizeAskInput(input: Record<string, unknown>): {
  question: string
  options: string[]
} {
  if (input.question) {
    return {
      question: String(input.question),
      options: Array.isArray(input.options)
        ? input.options.map((option) => String(option)).filter(Boolean)
        : [],
    }
  }
  const questions = Array.isArray(input.questions)
    ? (input.questions as Array<Record<string, unknown>>)
    : []
  const lines: string[] = []
  const options: string[] = []
  for (const q of questions) {
    const text = String(q.question ?? '').trim()
    if (text) lines.push(text)
    const qOptions = Array.isArray(q.options) ? q.options : []
    for (const option of qOptions) {
      if (typeof option === 'string') {
        if (option.trim()) options.push(option.trim())
      } else {
        const label = String((option as Record<string, unknown>)?.label ?? '').trim()
        if (label) options.push(label)
      }
    }
  }
  return {
    question: lines.join('\n') || 'Please answer the pending question.',
    options,
  }
}
