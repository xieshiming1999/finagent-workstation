export class Semaphore {
  private running = 0
  private queue: Array<() => void> = []

  constructor(public maxConcurrent = 1) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++
      return
    }
    return new Promise<void>((resolve) => this.queue.push(resolve))
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) {
      this.running++
      next()
    }
  }

  get stats() {
    return { running: this.running, waiting: this.queue.length, max: this.maxConcurrent }
  }
}

export const llmSemaphore = new Semaphore(4)
