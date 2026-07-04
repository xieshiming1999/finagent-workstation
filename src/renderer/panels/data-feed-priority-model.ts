export function parseSourcePriorityInput(input: string): string[] {
  const text = input.trim()
  if (!text) return []

  if (text.startsWith('[')) {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('source priority must be an array')
    return normalizeSourcePriority(parsed.map((item) => String(item)))
  }

  return normalizeSourcePriority(
    text
      .split(/(?:->|→|,|\s+)/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

export function normalizeSourcePriority(items: string[]): string[] {
  const rows: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    rows.push(value)
  }
  return rows
}

export function serializeSourcePriorityInput(input: string): string {
  return JSON.stringify(parseSourcePriorityInput(input))
}

export function displaySourcePriority(value: string): string {
  try {
    return parseSourcePriorityInput(value).join(' -> ')
  } catch {
    return value
  }
}
