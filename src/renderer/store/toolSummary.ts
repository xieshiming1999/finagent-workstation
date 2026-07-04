export function summarizeToolInput(toolName: string | undefined, input: Record<string, unknown> | undefined): string {
  const safeInput = input ?? {}

  if (toolName === 'WebView' && safeInput.action === 'execute') {
    const id = safeInput.id ? String(safeInput.id) : ''
    const script = typeof safeInput.script === 'string' ? safeInput.script : ''
    const parts = ['execute']
    if (id) parts.push(id)
    if (script) parts.push(`script ${formatChars(script.length)}`)
    return parts.join(', ')
  }

  const values = Object.values(safeInput)
    .filter((v) => v != null && v !== '')
    .map((v) => {
      if (typeof v === 'object' && v !== null) return truncate(JSON.stringify(v), 40)
      return truncate(String(v), 40)
    })
  return values.join(', ')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k chars`
  return `${n} chars`
}
