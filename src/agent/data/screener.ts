import type { Quote } from './data-manager'

export interface ScreenFilter {
  field: string
  op: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'between'
  value: number | [number, number]
}

export function screenQuotes(quotes: Quote[], filters: ScreenFilter[]): Quote[] {
  return quotes.filter((q) => {
    for (const f of filters) {
      const val = (q as unknown as Record<string, unknown>)[f.field]
      if (val == null) return false
      const v = Number(val)
      switch (f.op) {
        case '>': if (!(v > (f.value as number))) return false; break
        case '<': if (!(v < (f.value as number))) return false; break
        case '>=': if (!(v >= (f.value as number))) return false; break
        case '<=': if (!(v <= (f.value as number))) return false; break
        case '==': if (v !== (f.value as number)) return false; break
        case '!=': if (v === (f.value as number)) return false; break
        case 'between': {
          const [lo, hi] = f.value as [number, number]
          if (v < lo || v > hi) return false
          break
        }
      }
    }
    return true
  })
}

export function sortQuotes(quotes: Quote[], field: string, desc = true): Quote[] {
  return [...quotes].sort((a, b) => {
    const va = Number((a as unknown as Record<string, unknown>)[field] ?? 0)
    const vb = Number((b as unknown as Record<string, unknown>)[field] ?? 0)
    return desc ? vb - va : va - vb
  })
}
