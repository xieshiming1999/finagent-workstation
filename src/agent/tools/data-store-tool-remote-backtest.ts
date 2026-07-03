import { toolError } from '../tool'
import { dataStoreRemoteCopy } from '../runtime-copy'

export async function runBacktest(input: Record<string, unknown>): Promise<string> {
  const body: Record<string, unknown> = {
    mode: input.mode ?? 'single',
    data: {
      codes: input.codes ? String(input.codes).split(',') : input.code ? [String(input.code)] : [],
      start: input.start ?? '2022-01-01',
      end: input.end,
      source: input.source ?? 'akshare',
    },
    strategy: { name: input.strategy ?? input.func ?? 'rsi', params: (input.params as Record<string, unknown>) ?? {} },
    broker: (input.broker as Record<string, unknown>) ?? {},
    position_sizing: (input.position_sizing as Record<string, unknown>) ?? { type: 'percent_of_cash', value: 0.95 },
    allow_short: input.allow_short ?? false,
    benchmark: input.benchmark ? { code: String(input.benchmark) } : undefined,
    analyzers: input.analyzers as string[] ?? undefined,
  }
  if (input.mode === 'factor') {
    body.factor_config = {
      expression: input.expression ?? input.func,
      codes: (body.data as Record<string, unknown>).codes,
      start: (body.data as Record<string, unknown>).start,
      end: (body.data as Record<string, unknown>).end,
      quantiles: input.quantiles ?? 5,
      rebalance_days: input.rebalance_days ?? 20,
    }
  }

  try {
    const res = await fetch('http://127.0.0.1:19800/backtest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    const json = await res.json() as Record<string, unknown>
    if (json.error) return toolError(dataStoreRemoteCopy.backtestError(String(json.error)))
    if (json.status === 'error') return toolError(dataStoreRemoteCopy.backtestError(String(json.error)))

    const lines = [
      `Backtest: ${json.strategy ?? ''} on ${Array.isArray(json.codes) ? json.codes.join(',') : ''} (${json.bars ?? 0} bars, ${json.elapsed_seconds ?? 0}s)`,
      '',
      'Metrics:',
      ...Object.entries((json.metrics as Record<string, unknown>) ?? {}).map(([k, v]) => `  ${k}: ${v}`),
    ]
    const trades = Array.isArray(json.trades) ? json.trades as Array<Record<string, unknown>> : []
    if (trades.length) {
      lines.push('', `Trades (${json.trade_count ?? trades.length}):`)
      for (const t of trades.slice(0, 20)) lines.push(`  ${t.entry_date}→${t.exit_date ?? 'open'} ${t.code} ${t.side} ${t.size}@${t.entry_price}→${t.exit_price ?? '?'} PnL:${t.pnl}`)
      if (trades.length > 20) lines.push(`  ... (${trades.length - 20} more)`)
    }
    return lines.join('\n')
  } catch (e) {
    return toolError(dataStoreRemoteCopy.backtestFailed(e instanceof Error ? e.message : String(e)))
  }
}
