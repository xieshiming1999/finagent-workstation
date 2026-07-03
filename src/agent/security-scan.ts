/**
 * Security scanning for skill and memory content.
 * Detects prompt injection patterns that could compromise the Agent.
 */

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/<system\b/i, 'system tag injection'],
  [/<\/system>/i, 'system tag injection'],
  [/ignore\s+(previous|above|all|prior)\s+instructions/i, 'instruction override'],
  [/you\s+are\s+now\s+/i, 'role hijacking'],
  [/new\s+instructions?\s*:/i, 'instruction injection'],
  [/forget\s+(everything|all|your\s+instructions)/i, 'memory wipe'],
  [/override\s+(system|instructions|rules)/i, 'rule override'],
  [/exfiltrate/i, 'data exfiltration'],
]

export function hasInjectionRisk(content: string): boolean {
  return INJECTION_PATTERNS.some(([pattern]) => pattern.test(content))
}

export function describeRisk(content: string): string | null {
  for (const [pattern, label] of INJECTION_PATTERNS) {
    const match = content.match(pattern)
    if (match) return `Suspicious pattern (${label}): "${match[0]}"`
  }
  return null
}
