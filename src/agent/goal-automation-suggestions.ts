import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { GoalTemplate, GoalTemplateId } from './goal-automation-types'

export type GoalAutomationSuggestionStatus = 'pending' | 'accepted' | 'dismissed'
export type GoalAutomationSuggestionSource = 'catalog' | 'usage' | 'integration'

export interface GoalAutomationSuggestion {
  id: string
  title: string
  description: string
  templateId: GoalTemplateId
  source: GoalAutomationSuggestionSource
  dedupKey: string
  status: GoalAutomationSuggestionStatus
  createdAt: number
  resolvedAt: number | null
}

const MAX_PENDING = 5

export interface GoalAutomationSuggestionInput {
  title: string
  description: string
  templateId: GoalTemplateId
  source: GoalAutomationSuggestionSource
  dedupKey: string
}

export class GoalAutomationSuggestionStore {
  private readonly filePath: string
  private suggestions: GoalAutomationSuggestion[] = []

  constructor(basePath: string) {
    this.filePath = join(basePath, 'memory', 'goal-automation-suggestions.json')
    this.load()
  }

  listPending(): GoalAutomationSuggestion[] {
    return this.suggestions.filter((suggestion) => suggestion.status === 'pending')
  }

  seedCatalog(templates: GoalTemplate[], enabled: (id: GoalTemplateId) => boolean): GoalAutomationSuggestion[] {
    for (const template of templates) {
      if (enabled(template.id)) continue
      this.add({
        title: `Enable ${template.title}`,
        description: template.objective,
        templateId: template.id,
        source: 'catalog',
        dedupKey: `goal-template:${template.id}`,
      })
    }
    return this.listPending().filter((suggestion) => !enabled(suggestion.templateId))
  }

  seed(inputs: GoalAutomationSuggestionInput[], enabled: (id: GoalTemplateId) => boolean): GoalAutomationSuggestion[] {
    for (const input of inputs) {
      if (enabled(input.templateId)) continue
      this.add(input)
    }
    return this.listPending().filter((suggestion) => !enabled(suggestion.templateId))
  }

  accept(ref: string): GoalAutomationSuggestion | null {
    return this.resolve(ref, 'accepted')
  }

  dismiss(ref: string): GoalAutomationSuggestion | null {
    return this.resolve(ref, 'dismissed')
  }

  private add(input: GoalAutomationSuggestionInput): GoalAutomationSuggestion | null {
    const existing = this.suggestions.find((suggestion) => suggestion.dedupKey === input.dedupKey)
    if (existing) return null
    if (this.listPending().length >= MAX_PENDING) return null
    const suggestion: GoalAutomationSuggestion = {
      ...input,
      id: `${input.templateId}-${Date.now()}`,
      status: 'pending',
      createdAt: Date.now(),
      resolvedAt: null,
    }
    this.suggestions.push(suggestion)
    this.save()
    return suggestion
  }

  private resolve(ref: string, status: Exclude<GoalAutomationSuggestionStatus, 'pending'>): GoalAutomationSuggestion | null {
    const suggestion = this.find(ref)
    if (!suggestion || suggestion.status !== 'pending') return null
    suggestion.status = status
    suggestion.resolvedAt = Date.now()
    this.save()
    return suggestion
  }

  private find(ref: string): GoalAutomationSuggestion | null {
    return this.suggestions.find((suggestion) => suggestion.id === ref || suggestion.templateId === ref || suggestion.dedupKey === ref) ?? null
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as { suggestions?: GoalAutomationSuggestion[] } | GoalAutomationSuggestion[]
      const suggestions = Array.isArray(data) ? data : data.suggestions
      this.suggestions = Array.isArray(suggestions) ? suggestions.filter(isSuggestion) : []
    } catch {
      this.suggestions = []
    }
  }

  private save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({ suggestions: this.suggestions, updatedAt: Date.now() }, null, 2), 'utf-8')
  }
}

function isSuggestion(value: unknown): value is GoalAutomationSuggestion {
  const row = value as Partial<GoalAutomationSuggestion>
  return Boolean(row?.id && row.templateId && row.dedupKey && row.status)
}
