import type { Quote } from './eastmoney-fetcher'

export async function sinaQuotes(codes: string[]): Promise<Quote[]> {
  const sinaCodes = codes.map((c) => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',')
  const res = await fetch(`https://hq.sinajs.cn/list=${sinaCodes}`, {
    headers: { Referer: 'http://finance.sina.com.cn' },
  })
  const text = await res.text()
  const results: Quote[] = []

  for (const line of text.split('\n')) {
    if (!line.includes('"')) continue
    const codeMatch = /hq_str_(s[hz]\d{6})/.exec(line)
    const dataMatch = /"(.+)"/.exec(line)
    if (!codeMatch || !dataMatch) continue

    const parts = dataMatch[1].split(',')
    if (parts.length < 32) continue

    const price = parseFloat(parts[3])
    const prevClose = parseFloat(parts[2])
    results.push({
      code: codeMatch[1].slice(2),
      name: parts[0],
      price,
      change: price - prevClose,
      changePct: prevClose ? (price - prevClose) / prevClose * 100 : 0,
      open: parseFloat(parts[1]),
      high: parseFloat(parts[4]),
      low: parseFloat(parts[5]),
      prevClose,
      volume: parseFloat(parts[8]),
      amount: parseFloat(parts[9]),
      pe: null,
      pb: null,
      marketCap: null,
      turnoverRate: null,
    })
  }
  return results
}
