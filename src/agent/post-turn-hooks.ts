export type PostTurnHook = (context: HookContext) => Promise<void>

export interface HookContext {
  basePath: string
  messageCount: number
  userTurnCount: number
  toolCallCount: number
  lastToolNames: string[]
  timeSinceLastHook: number
}

export class PostTurnHookRegistry {
  private hooks: Array<{ name: string; fn: PostTurnHook }> = []
  private lastRunTimes: Map<string, number> = new Map()

  register(name: string, fn: PostTurnHook): void {
    this.hooks.push({ name, fn })
  }

  async runAll(context: HookContext): Promise<void> {
    for (const hook of this.hooks) {
      const lastRun = this.lastRunTimes.get(hook.name) ?? 0
      const ctx = { ...context, timeSinceLastHook: Date.now() - lastRun }
      try {
        await hook.fn(ctx)
        this.lastRunTimes.set(hook.name, Date.now())
      } catch (err) {
        // hooks never block the agent — log and continue
        console.error(`Post-turn hook "${hook.name}" failed:`, err)
      }
    }
  }
}
