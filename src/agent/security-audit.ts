import { existsSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Security audit report for the agent environment.
 * Checks filesystem permissions, tool safety, config risks.
 *
 * Reference: openclaw/src/security/audit.ts
 */

export interface AuditFinding {
  severity: 'info' | 'warning' | 'critical'
  category: string
  message: string
  suggestion?: string
}

export interface SecurityAuditReport {
  timestamp: string
  findings: AuditFinding[]
  score: number // 0-100, higher is safer
}

export function runSecurityAudit(basePath: string): SecurityAuditReport {
  const findings: AuditFinding[] = []

  // Check basePath permissions
  if (existsSync(basePath)) {
    try {
      const stat = statSync(basePath)
      const mode = stat.mode & 0o777
      if (mode & 0o007) {
        findings.push({ severity: 'warning', category: 'filesystem', message: `Base directory ${basePath} is world-readable/writable (mode: ${mode.toString(8)})`, suggestion: 'Run chmod 700 on the directory' })
      }
    } catch { /* */ }
  }

  // Check for sensitive files in memory
  const sensitivePatterns = ['.env', 'credentials', 'secret', 'private_key', 'id_rsa']
  for (const pattern of sensitivePatterns) {
    const path = join(basePath, 'memory', pattern)
    if (existsSync(path)) {
      findings.push({ severity: 'critical', category: 'sensitive-files', message: `Sensitive file found in memory/: ${pattern}`, suggestion: 'Remove sensitive files from the agent memory directory' })
    }
  }

  // Check config for exposed API keys
  const configPath = join(basePath, '..', '..', 'config.json')
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'))
      for (const model of config.models ?? []) {
        if (model.apiKey && model.apiKey.length < 10) {
          findings.push({ severity: 'warning', category: 'config', message: `Model "${model.name ?? model.model}" has a very short API key`, suggestion: 'Verify the API key is correct' })
        }
      }
    } catch { /* */ }
  }

  // Check approved tools (overly permissive?)
  const approvedPath = join(basePath, 'approved_tools.json')
  if (existsSync(approvedPath)) {
    try {
      const approved = JSON.parse(require('fs').readFileSync(approvedPath, 'utf-8'))
      if (Array.isArray(approved) && approved.includes('Bash')) {
        findings.push({ severity: 'info', category: 'permissions', message: 'Bash tool is always-approved (auto-approved)', suggestion: 'Consider removing Bash from always-approved list for safety' })
      }
    } catch { /* */ }
  }

  // Calculate score
  const criticalCount = findings.filter((f) => f.severity === 'critical').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  const score = Math.max(0, 100 - criticalCount * 30 - warningCount * 10)

  return {
    timestamp: new Date().toISOString(),
    findings,
    score,
  }
}
