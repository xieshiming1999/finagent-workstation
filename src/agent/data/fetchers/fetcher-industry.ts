import type { FetchResult } from './base-fetcher'
import { fetchSectors, fetchSectorStocks } from '../eastmoney-fetcher'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export interface IndustryMapRow {
  code: string; industry_l1: string | null; industry_l2: string | null
  industry_l3: string | null; updated_at: string
}

export async function fetchIndustryMap(opts: {
  maxBoards?: number
  perBoardTimeoutMs?: number
  perBoardDelayMs?: number
  onProgress?: (progress: { board: string; index: number; total: number; rows: number; failed: number }) => void
} = {}): Promise<FetchResult<IndustryMapRow>> {
  let boards = await fetchDirectIndustryBoards()
  if (boards.length === 0) boards = await fetchAkshareIndustryBoards()

  const now = new Date().toISOString()
  const allRows: IndustryMapRow[] = []
  const maxBoards = Math.max(1, opts.maxBoards ?? 50)
  const boardsToFetch = boards.slice(0, maxBoards)
  let failed = 0

  for (let i = 0; i < boardsToFetch.length; i++) {
    const board = boardsToFetch[i]
    const boardName = board.name
    if (!boardName) continue

    try {
      const cons = await fetchSectorStocks(board, 'industry', 200, opts.perBoardTimeoutMs ?? 15_000)

      for (const c of cons) {
        const code = String(c.code ?? '')
        if (code) {
          allRows.push({
            code,
            industry_l1: boardName,
            industry_l2: null,
            industry_l3: null,
            updated_at: now,
          })
        }
      }
    } catch {
      failed++
    }
    opts.onProgress?.({ board: boardName, index: i + 1, total: boardsToFetch.length, rows: allRows.length, failed })

    // Rate limit
    await new Promise((r) => setTimeout(r, opts.perBoardDelayMs ?? 1500))
  }

  return { data: allRows, source: 'eastmoney', fetchedAt: now }
}

async function fetchDirectIndustryBoards(): Promise<Array<{ code: string; name: string }>> {
  try {
    return (await fetchSectors('industry')).map((board) => ({
      code: String(board.code ?? ''),
      name: String(board.name ?? ''),
    })).filter((board) => board.code && board.name)
  } catch {
    return []
  }
}

async function fetchAkshareIndustryBoards(): Promise<Array<{ code: string; name: string }>> {
  const url = `${SIDECAR_AKSHARE}/stock_board_industry_name_em?_provider=eastmoney`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare industry map failed: ${res.status}`)
  const json = await res.json() as any
  return ((json.data ?? json) as Array<Record<string, unknown>>).map((board) => ({
    code: String(board['板块代码'] ?? board.code ?? ''),
    name: String(board['板块名称'] ?? board.name ?? ''),
  })).filter((board) => board.code && board.name)
}
