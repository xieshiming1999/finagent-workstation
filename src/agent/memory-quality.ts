const REQUIRED_SESSION_SECTIONS = [
  '## Current State',
  '## Task Specification',
  '## Worklog',
]

const PLACEHOLDER_LINE_PATTERN = /^\s*\*[^*\n]+\*\s*$/
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/

export type SessionMemoryQualityResult = {
  accepted: boolean
  content: string
  issues: string[]
}

export type SessionMemoryQualityOptions = {
  sessionId: string
  extractedAt: string
  expires?: string
}

export function normalizeSessionMemoryContent(
  content: string,
  options: SessionMemoryQualityOptions,
): SessionMemoryQualityResult {
  const trimmed = content.trim()
  const issues: string[] = []
  if (!trimmed) {
    return { accepted: false, content: '', issues: ['empty session memory'] }
  }

  const body = stripFrontmatter(trimmed).trim()
  const expires = frontmatterValue(trimmed, 'expires')
  if (expires && isExpired(expires)) {
    issues.push('session memory is expired')
  }

  for (const section of REQUIRED_SESSION_SECTIONS) {
    if (!body.includes(section)) issues.push(`missing required section: ${section}`)
  }

  const meaningfulText = collectMeaningfulText(body)
  if (meaningfulText.length < 80) {
    issues.push('session memory contains too little non-placeholder content')
  }

  if (isMostlyPlaceholder(body)) {
    issues.push('session memory is mostly placeholder template text')
  }

  if (issues.length > 0) {
    return { accepted: false, content: trimmed, issues }
  }

  return {
    accepted: true,
    content: `${sessionMemoryFrontmatter(options)}${body}\n`,
    issues: [],
  }
}

export function isUsableSessionMemory(content: string): boolean {
  return normalizeSessionMemoryContent(content, {
    sessionId: 'unknown',
    extractedAt: 'unknown',
  }).accepted
}

function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, '')
}

function frontmatterValue(content: string, key: string): string | null {
  const match = content.match(FRONTMATTER_PATTERN)
  if (!match) return null
  const line = match[0]
    .split('\n')
    .find((entry) => entry.trim().startsWith(`${key}:`))
  if (!line) return null
  return line.slice(line.indexOf(':') + 1).trim()
}

function isExpired(value: string): boolean {
  if (value === 'session-end' || value === 'unknown') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp < Date.now()
}

function collectMeaningfulText(body: string): string {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('## '))
    .filter((line) => !PLACEHOLDER_LINE_PATTERN.test(line))
    .join('\n')
    .trim()
}

function isMostlyPlaceholder(body: string): boolean {
  const contentLines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('## '))
  if (contentLines.length === 0) return true
  const placeholderLines = contentLines.filter((line) => PLACEHOLDER_LINE_PATTERN.test(line)).length
  return placeholderLines / contentLines.length >= 0.6
}

function sessionMemoryFrontmatter(options: SessionMemoryQualityOptions): string {
  return [
    '---',
    'lifecycle: session',
    'purpose: Session-level summary and recovery state used by compaction.',
    'retention: Current working session.',
    'write_target: sessions/<session-id>/session-memory.md',
    'promotion_rule: Review before promoting stable decisions to durable memory or repeated workflow to a skill.',
    'provenance: session-memory-extraction',
    `source_session_id: ${sanitizeFrontmatterValue(options.sessionId)}`,
    `extracted_at: ${sanitizeFrontmatterValue(options.extractedAt)}`,
    `expires: ${sanitizeFrontmatterValue(options.expires ?? 'session-end')}`,
    '---',
    '',
  ].join('\n')
}

function sanitizeFrontmatterValue(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim()
}
