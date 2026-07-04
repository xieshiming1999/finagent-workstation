import { parseQuote, parseSignals, parseBacktest, parseAnalysisEvidence, parseStrategyReview, parseTradePrep } from './parsers'
import { useT } from '../../store/useLanguageStore'

export function StockQuoteCard({ content }: { content: string }) {
  const t = useT()
  const q = parseQuote(content)
  if (!q) return null

  const up = q.changePct >= 0
  const color = up ? 'var(--red)' : 'var(--green)'

  return (
    <div className="rounded-lg p-3 my-1" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{q.name}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>{q.code}</span>
      </div>
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-xl font-bold font-mono" style={{ color }}>{q.price.toFixed(2)}</span>
        <span className="text-sm font-mono" style={{ color }}>
          {up ? '+' : ''}{q.changePct.toFixed(2)}%
        </span>
        <span className="text-xs font-mono" style={{ color }}>
          {up ? '+' : ''}{q.change.toFixed(2)}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-2 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
        <div>{t('quoteOpen')} <span style={{ color: 'var(--text-primary)' }}>{q.open.toFixed(2)}</span></div>
        <div>{t('quoteHigh')} <span style={{ color: 'var(--red)' }}>{q.high.toFixed(2)}</span></div>
        <div>{t('quoteLow')} <span style={{ color: 'var(--green)' }}>{q.low.toFixed(2)}</span></div>
        <div>{t('quotePrevClose')} <span style={{ color: 'var(--text-primary)' }}>{q.prevClose.toFixed(2)}</span></div>
      </div>
      <div className="flex gap-4 mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
        <span>PE {q.pe}</span>
        <span>PB {q.pb}</span>
        <span>{t('volumeShort')} {q.volume}</span>
      </div>
    </div>
  )
}

export function SignalCard({ content }: { content: string }) {
  const t = useT()
  const signals = parseSignals(content)
  if (signals.length === 0) return null

  const overallMatch = content.match(/Overall:\s+(BUY|SELL|HOLD)\s+\(score:\s+([\d.-]+)\)/)
  const overall = overallMatch?.[1] ?? 'HOLD'
  const score = overallMatch?.[2] ?? '0'
  const overallColor = overall === 'BUY' ? 'var(--green)' : overall === 'SELL' ? 'var(--red)' : 'var(--text-tertiary)'
  const overallLabel = overall === 'BUY' ? t('buySignal') : overall === 'SELL' ? t('sellSignal') : t('holdSignal')

  return (
    <div className="rounded-lg p-3 my-1" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t('signalAnalysis')}</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: overallColor, background: 'var(--bg-tertiary)' }}>
          {overallLabel} ({score})
        </span>
      </div>
      {signals.map((s, i) => {
        const icon = s.signal === 'BUY' ? '▲' : s.signal === 'SELL' ? '▼' : '—'
        const c = s.signal === 'BUY' ? 'var(--green)' : s.signal === 'SELL' ? 'var(--red)' : 'var(--text-tertiary)'
        const signalLabel = s.signal === 'BUY' ? t('buySignal') : s.signal === 'SELL' ? t('sellSignal') : t('holdSignal')
        return (
          <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
            <span style={{ color: c }}>{icon}</span>
            <span className="w-12 font-medium" style={{ color: 'var(--text-primary)' }}>{s.indicator}</span>
            <span className="w-10 font-mono" style={{ color: c }}>{signalLabel}</span>
            <span className="flex-1" style={{ color: 'var(--text-tertiary)' }}>{s.reason}</span>
          </div>
        )
      })}
    </div>
  )
}

export function BacktestCard({ content }: { content: string }) {
  const t = useT()
  const data = parseBacktest(content)
  if (!data['Strategy']) return null

  const totalReturn = parseFloat(data['Total Return'] ?? '0')
  const returnColor = totalReturn >= 0 ? 'var(--green)' : 'var(--red)'
  const metricLabels: Record<string, string> = {
    'Annualized Return': t('annualizedReturn'),
    'Max Drawdown': t('maxDrawdown'),
    'Sharpe Ratio': t('sharpeRatio'),
    'Win Rate': t('winRate'),
    'Profit Factor': t('profitFactor'),
    Trades: t('tradesLabel'),
  }

  return (
    <div className="rounded-lg p-3 my-1" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t('backtestPrefix')}: {data['Strategy']}</span>
        <span className="text-sm font-bold font-mono" style={{ color: returnColor }}>{data['Total Return']}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        {['Annualized Return', 'Max Drawdown', 'Sharpe Ratio', 'Win Rate', 'Profit Factor', 'Trades'].map((key) => (
          data[key] ? (
            <div key={key}>
              <div style={{ color: 'var(--text-tertiary)' }}>{metricLabels[key] ?? key}</div>
              <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{data[key]}</div>
            </div>
          ) : null
        ))}
      </div>
    </div>
  )
}

export function AnalysisEvidenceCard({ content }: { content: string }) {
  const evidence = parseAnalysisEvidence(content)
  if (!evidence) return null

  return (
    <div className="rounded-lg p-3 my-1" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{evidence.subjectLabel}</div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{evidence.kind} · {evidence.strategyReadiness}</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--bg-tertiary)' }}>
          confidence {evidence.confidence}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
        <EvidenceList title="Observed" rows={evidence.observedFacts} />
        <EvidenceList title="Interpretation" rows={evidence.interpretations} />
        <EvidenceList title="Missing" rows={evidence.missingEvidence} muted />
      </div>
      <div className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
        {evidence.sources.length > 0 && <span>sources: {evidence.sources.join(', ')}</span>}
        {evidence.interfaceId && <span> · interface: {evidence.interfaceId}</span>}
        {evidence.canonicalTable && <span> · table: {evidence.canonicalTable}</span>}
        {evidence.readbackAction && <span> · readback: {evidence.readbackAction}</span>}
        {evidence.sourceDataTime && <span> · data: {evidence.sourceDataTime}</span>}
        {evidence.fetchedAt && <span> · fetched: {evidence.fetchedAt}</span>}
        {evidence.cacheStatus && <span> · cache: {evidence.cacheStatus}</span>}
        {evidence.coverageStatus && <span> · coverage: {evidence.coverageStatus}</span>}
      </div>
    </div>
  )
}

export function StrategyReviewCard({ content }: { content: string }) {
  const review = parseStrategyReview(content)
  if (!review) return null

  return (
    <div className="rounded-lg p-3 my-1" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{review.strategyId}</div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{review.reviewKind} · {review.signal}</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--bg-tertiary)' }}>
          strategy review
        </span>
      </div>
      <ContractLine label="Subjects" value={review.subjects.join(', ') || '-'} />
      <ContractLine label="Boundaries" value={review.boundaries.join(', ') || '-'} />
      {review.confirmation && <ContractLine label="Confirmation" value={review.confirmation} />}
    </div>
  )
}

export function TradePrepCard({ content }: { content: string }) {
  const prep = parseTradePrep(content)
  if (!prep) return null

  const sizing = [
    prep.sizing.budget != null ? `budget ${prep.sizing.budget}` : null,
    prep.sizing.referencePrice != null ? `price ${prep.sizing.referencePrice}` : null,
    prep.sizing.shares != null ? `shares ${prep.sizing.shares}` : null,
    prep.sizing.amount != null ? `amount ${prep.sizing.amount}` : null,
  ].filter(Boolean).join(' · ')

  const evidence = Object.entries(prep.evidence)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(', ')
  const previews = Object.entries(prep.previews)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(', ')

  return (
    <div className="rounded-lg p-3 my-1" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{prep.symbol}</div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{prep.prepKind} · {prep.signal}</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--bg-tertiary)' }}>
          trade prep
        </span>
      </div>
      <ContractLine label="Strategy" value={prep.strategyId} />
      <ContractLine label="Sizing" value={sizing || '-'} />
      <ContractLine label="Evidence" value={evidence || '-'} />
      <ContractLine label="Preview" value={previews || '-'} />
      <ContractLine label="Boundaries" value={prep.boundaries.join(', ') || '-'} />
      {prep.confirmation && <ContractLine label="Confirmation" value={prep.confirmation} />}
    </div>
  )
}

function ContractLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[10px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
      <span className="uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{label}: </span>
      <span>{value}</span>
    </div>
  )
}

function EvidenceList({ title, rows, muted = false }: { title: string; rows: string[]; muted?: boolean }) {
  return (
    <div>
      <div className="uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)' }}>-</div>
      ) : rows.map((row, index) => (
        <div key={`${title}-${index}`} className="truncate" title={row} style={{ color: muted ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>
          {row}
        </div>
      ))}
    </div>
  )
}
