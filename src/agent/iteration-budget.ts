export class IterationBudget {
  private remaining: number
  private initial: number
  private refundable: Set<string>

  constructor(maxIterations = 100, refundableTools?: string[]) {
    this.initial = maxIterations
    this.remaining = maxIterations
    this.refundable = new Set(refundableTools ?? [
      'Read', 'LS', 'Glob', 'Grep', 'Echo', 'Environment',
      'TaskList', 'TaskGet', 'CronList', 'MonitorList', 'SessionSearch',
    ])
  }

  consume(toolName?: string): boolean {
    if (this.initial <= 0) return true
    if (this.remaining <= 0) return false
    this.remaining--
    return true
  }

  refund(toolName: string): void {
    if (this.refundable.has(toolName) && this.remaining < this.initial) {
      this.remaining++
    }
  }

  get budget(): number {
    return this.remaining
  }

  get used(): number {
    return this.initial - this.remaining
  }

  get exhausted(): boolean {
    if (this.initial <= 0) return false
    return this.remaining <= 0
  }

  reset(): void {
    this.remaining = this.initial
  }
}
