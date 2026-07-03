import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Permission rule system with wildcard matching.
 *
 * Reference: opencode/src/permission/index.ts
 * Reference: claude-code-best permission rules
 *
 * Rules: { toolName, pattern?, action: 'allow' | 'deny' | 'ask' }
 * Pattern supports wildcards: 'Bash(git *)' matches any git command
 */

export interface PermissionRule {
  toolName: string
  pattern?: string  // optional input pattern (e.g., 'git *' for Bash)
  action: 'allow' | 'deny' | 'ask'
}

export class PermissionManager {
  private rules: PermissionRule[] = []
  private sessionApproved = new Set<string>()  // tool names approved this session
  private filePath: string

  constructor(basePath: string) {
    this.filePath = join(basePath, 'permissions.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (Array.isArray(data.rules)) this.rules = data.rules
      if (Array.isArray(data.approved)) data.approved.forEach((t: string) => this.sessionApproved.add(t))
    } catch { /* */ }
  }

  save(): void {
    mkdirSync(join(this.filePath, '..'), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({
      rules: this.rules,
      approved: Array.from(this.sessionApproved),
    }, null, 2), 'utf-8')
  }

  addRule(rule: PermissionRule): void {
    // Remove existing rule for same tool+pattern
    this.rules = this.rules.filter((r) => !(r.toolName === rule.toolName && r.pattern === rule.pattern))
    this.rules.push(rule)
    this.save()
  }

  removeRule(toolName: string, pattern?: string): void {
    this.rules = this.rules.filter((r) => !(r.toolName === toolName && r.pattern === pattern))
    this.save()
  }

  approveForSession(toolName: string): void {
    this.sessionApproved.add(toolName)
  }

  approvePermanently(toolName: string): void {
    this.addRule({ toolName, action: 'allow' })
  }

  /**
   * Check if a tool call needs permission.
   * Returns: 'allow' (no prompt needed), 'deny' (rejected), 'ask' (need user approval)
   */
  check(toolName: string, input?: Record<string, unknown>): 'allow' | 'deny' | 'ask' {
    // Session-approved tools always allowed
    if (this.sessionApproved.has(toolName)) return 'allow'

    const rule = this.matchRule(toolName, input)
    if (rule) return rule.action

    // Default: ask
    return 'ask'
  }

  /**
   * Return the explicit matching rule, if one exists.
   * Useful when the caller wants a permissive default while still respecting
   * user-authored deny/ask rules.
   */
  matchRule(toolName: string, input?: Record<string, unknown>): PermissionRule | null {
    // Check rules (most specific first)
    for (const rule of this.rules) {
      if (rule.toolName !== toolName && rule.toolName !== '*') continue

      if (rule.pattern && input) {
        // Pattern matching: check if input matches pattern
        if (matchesPattern(rule.pattern, toolName, input)) {
          return rule
        }
      } else if (!rule.pattern) {
        // No pattern: matches all inputs for this tool
        return rule
      }
    }
    return null
  }

  listRules(): PermissionRule[] {
    return [...this.rules]
  }
}

/**
 * Match a permission pattern against tool input.
 * Examples:
 *   'git *' matches Bash({command: 'git status'})
 *   'memory/*' matches Write({file_path: 'memory/pages/foo.html'})
 */
function matchesPattern(pattern: string, toolName: string, input: Record<string, unknown>): boolean {
  const inputStr = Object.values(input).map(String).join(' ')
  const regexStr = pattern.replace(/\*/g, '.*').replace(/\?/g, '.')
  try {
    return new RegExp(regexStr, 'i').test(inputStr)
  } catch {
    return false
  }
}
