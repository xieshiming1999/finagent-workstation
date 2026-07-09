import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import * as dm from '../data/data-manager'
import * as ind from '../data/indicators'
import * as adv from '../data/advanced-indicators'
import * as opt from '../data/portfolio-optimizer'
import { lastValue, fmtN, fmtLast, computeHurst, DP_HELP_TEXT } from './data-process-helpers'
import { detectPatterns, findSupportResistance } from '../data/patterns'
import { generateSignals, signalSummary } from '../data/signals'
import { screenQuotes, sortQuotes } from '../data/screener'
import { scoreFundamentals } from '../data/fundamental-scorer'
import { MarketDataResolveService } from '../../domain/market/services/market-data-resolve-service'
import {
  createAnalysisEvidencePackage,
  type AnalysisConfidence,
} from '../../domain/market/analysis/analysis-evidence-contract'
import { dataProcessCopy } from '../runtime-copy'
import { DataStore } from '../data/store/data-store'
import type { WatchlistItem } from '../watchlist-store'
import { isCoreCnMarketIndexCode } from '../../domain/market/market-index-universe'

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface WatchSignalEvidence {
  symbol: string
  type: string
  metricName: string
  metricValue: number | null
  sourceDataTime: string
  provider: string
  fetchedAt: string
  interfaceId: string
  canonicalTable: string
}

function normalizeWatchSymbol(value: string): string {
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) return ''
  const match = trimmed.match(/\d{6}/)
  return match ? match[0] : trimmed
}

function numericValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compareNumber(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case '>': return actual > expected
    case '<': return actual < expected
    case '>=': return actual >= expected
    case '<=': return actual <= expected
    case '==': return Math.abs(actual - expected) < 0.000001
    default: return false
  }
}

export class DataProcessTool implements Tool {
  private readonly readService = new MarketDataResolveService()
  private stores = new Map<string, Promise<DataStore>>()
  private readonly watchlistItems?: (basePath: string) => WatchlistItem[]

  constructor(options: { watchlistItems?: (basePath: string) => WatchlistItem[] } = {}) {
    this.watchlistItems = options.watchlistItems
  }

  name = 'DataProcess'
  description = 'Code-specific stock/K-line analysis: indicators, patterns, signals, scoring, support/resistance, portfolio optimization, AI prediction tracking. Use after selecting concrete stock code(s); for broad discovery or shortlist generation prefer DataStore screen/query actions.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['indicators', 'advanced', 'ichimoku', 'pivot', 'hurst', 'trend', 'stats', 'patterns', 'signals', 'score', 'score_technical', 'breakout_summary', 'screen', 'summary', 'support', 'support_summary', 'volume', 'optimize', 'watch_signal_check', 'ai_record', 'ai_validate', 'calendar', 'help'],
        description: 'Analysis action. Use action="help" for full documentation.',
      },
      code: { type: 'string', description: 'Stock code (e.g., "000001"). For screen/optimize/breakout_summary: comma-separated codes.' },
      type: { type: 'string', description: '(watch_signal_check) stock/fund/etf; default fund' },
      status: { type: 'string', description: '(watch_signal_check) watchlist status; default watching' },
      period: { type: 'string', description: 'K-line period (default: daily)' },
      indicators: {
        type: 'array',
        items: { type: 'string' },
        description: 'Indicators to compute: sma5, sma10, sma20, sma60, ema12, ema26, rsi, macd, boll, kdj, atr',
      },
      limit: { type: 'number', description: 'Number of bars (default: 120)' },
      symbol: { type: 'string', description: '(ai_record/ai_validate) Stock symbol' },
      prediction: { type: 'string', description: '(ai_record) Prediction direction: up/down/neutral' },
      targetPrice: { type: 'number', description: '(ai_record) Target price' },
      reasoning: { type: 'string', description: '(ai_record) Analysis reasoning' },
      method: { type: 'string', description: '(optimize) equalWeight/riskParity/momentum' },
    },
    required: ['action'],
  }


  validateInput(input: Record<string, unknown>): string | null {
    if (!input.action) return 'action is required. Use action="help" for all available actions.'
    if (!input.code && !['calendar', 'help', 'ai_validate', 'watch_signal_check'].includes(String(input.action))) return 'code is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action)
    const code = String(input.code)
    const period = String(input.period ?? 'daily')
    const limit = Number(input.limit ?? 120)

    if (action === 'help') return DP_HELP_TEXT
    if (action === 'watch_signal_check') return this.watchSignalCheck(ctx, input)
    if (action === 'breakout_summary') return this.breakoutSummary(ctx, code, limit)
    if (action === 'screen') return this.screenCandidates(ctx, code)
    if (this.isStockOnlyAction(action) && period !== 'daily') {
      return toolError(
        `DataProcess(action:"${action}") supports governed daily K-line only in the current desktop workflow; requested period "${period}". Use period:"daily" or a provider diagnostic path when validating a non-daily data contract.`
      )
    }

    if (this.isStockOnlyAction(action) && code && await this.isExplicitFundCode(ctx, code)) {
      return toolError(
        `DataProcess(action:"${action}") is stock/K-line analysis, but ${code} is a known fund code in fund_list. ` +
        'For fund watchlist signal checks use DataProcess(action:"watch_signal_check", type:"fund", status:"watching"). ' +
        'For fund analysis use DataStore(action:"query_fund_nav"|"query_fund_money_yield"|"query_fund_performance"|"query_fund_holding", code/fundCode: "...").'
      )
    }
    if (this.isStockOnlyAction(action) && code && isCoreCnMarketIndexCode(code)) {
      return toolError(
        `DataProcess(action:"${action}") is stock/K-line analysis and does not provide governed index technical indicators for core market index code ${code}. ` +
        'Use DataStore(action:"query_index_quote", code:"000001,399001,399006,000688,000300,000905") or MarketData(action:"quote", code:"000001,399001,399006") for index evidence, and state index technical-indicator coverage as missing unless a governed index K-line/indicator contract is available.'
      )
    }

    const klineRead = code
      ? await this.readKline(ctx, code, period, limit)
      : null
    const bars = klineRead?.bars ?? []
    if (bars.length === 0) return `No K-line data for ${code}. DataProcess is code-specific technical analysis; for broad stock discovery use DataStore(action:"screen_stock"), DataStore(action:"query_hot_rank"), DataStore(action:"query_quote", code:"..."), or DataTask batch_quote after candidates are known.`

    switch (action) {
      case 'indicators':
        return this.computeIndicators(code, bars, input.indicators as string[] | undefined)
      case 'trend':
        return this.analyzeTrend(bars)
      case 'stats':
        return this.computeStats(bars)
      case 'patterns': {
        const patterns = detectPatterns(bars)
        if (patterns.length === 0) return `No candlestick patterns detected in recent ${bars.length} bars`
        const recent = patterns.slice(-15)
        return `Candlestick Patterns (${patterns.length} total, showing last ${recent.length}):\n` +
          recent.map((p) => `${p.date} ${p.pattern} [${p.type}] reliability: ${p.reliability}`).join('\n')
      }
      case 'signals': {
        const signals = generateSignals(bars)
        if (signals.length === 0) return 'Not enough data to generate signals'
        const summary = signalSummary(signals)
        const lines = [`Signal Analysis for ${code} (${bars[bars.length - 1].date})`, '']
        for (const s of signals) {
          const icon = s.signal === 'buy' ? '▲' : s.signal === 'sell' ? '▼' : '—'
          lines.push(`${icon} ${s.indicator}: ${s.signal.toUpperCase()} (${(s.strength * 100).toFixed(0)}%) — ${s.reason}`)
        }
        lines.push('')
        lines.push(`Overall: ${summary.overall.toUpperCase()} (score: ${summary.score.toFixed(2)})`)
        return lines.join('\n')
      }
      case 'score': {
        const quotes = await this.readQuotes(ctx, code.split(',').map((c) => c.trim()))
        if (quotes.length === 0) return toolError(`no quote data for ${code}. Provide stock codes. Example: DataProcess(action: "score", code: "600519,000001")`)
        const scores = scoreFundamentals(quotes)
        return scores.map((s) =>
          `${s.code} ${s.name}: ${s.totalScore}pts (${Object.entries(s.breakdown).map(([k, v]) => `${k}:${v}`).join(', ')})`
        ).join('\n')
      }
      case 'summary': {
        if (bars.length < 20) return 'Not enough data for summary (need 20+ bars)'
        const signals = generateSignals(bars)
        const sum = signalSummary(signals)
        const patterns = detectPatterns(bars).slice(-5)
        const sr = findSupportResistance(bars)
        const last = bars[bars.length - 1]
        const sma20v = lastValue(ind.sma(bars, 20))
        const rsiV = lastValue(ind.rsi(bars))
        const quote = await this.readQuote(ctx, code).catch(() => undefined)
        const provenance = klineRead?.provenance
        const interpretations = [
          `price_vs_sma20:${last.close > (sma20v ?? 0) ? 'above' : 'below'}`,
          rsiV != null ? `rsi:${rsiV.toFixed(1)}` : '',
          `signal:${sum.overall.toUpperCase()} score=${sum.score.toFixed(2)}`,
          ...signals.map((s) => `${s.signal}:${s.indicator}:${s.reason}`),
          patterns.length > 0 ? `patterns:${patterns.map((p) => `${p.pattern}[${p.type}]`).join(',')}` : 'patterns:none_recent',
          sr.support.length > 0 ? `support:${sr.support.map((v) => v.toFixed(2)).join(',')}` : '',
          sr.resistance.length > 0 ? `resistance:${sr.resistance.map((v) => v.toFixed(2)).join(',')}` : '',
        ].filter(Boolean)
        return JSON.stringify({
          action: 'summary',
          symbol: code,
          name: quote?.name,
          price: {
            current: last.close,
            position: last.close > (sma20v ?? 0) ? 'above_sma20' : 'below_sma20',
          },
          signal: {
            overall: sum.overall,
            score: Number(sum.score.toFixed(2)),
          },
          patterns: patterns.map((p) => ({ date: p.date, pattern: p.pattern, type: p.type, reliability: p.reliability })),
          support: sr.support,
          resistance: sr.resistance,
          interfaceId: provenance?.interfaceId ?? 'stock.daily_kline',
          capabilityId: provenance?.capabilityId ?? (klineRead?.source === 'local' ? 'local.cache' : `${klineRead?.source ?? 'unknown'}.stock.daily_kline`),
          canonicalSchema: provenance?.canonicalSchema ?? 'kline_daily',
          canonicalTable: provenance?.canonicalTable ?? 'kline_daily',
          cacheStatus: provenance?.cacheStatus ?? (klineRead?.source === 'local' ? 'cache-hit' : 'provider-hit'),
          analysisEvidence: createAnalysisEvidencePackage({
            kind: 'stock_analysis',
            subject: { type: 'stock', id: code, ...(quote?.name ? { name: quote.name } : {}) },
            observedFacts: [
              `bars=${bars.length}`,
              `latestDate=${last.date}`,
              `latestClose=${last.close}`,
              `source=${klineRead?.source ?? 'unknown'}`,
              `storageStatus=${klineRead?.status ?? 'unknown'}`,
            ],
            interpretations,
            missingEvidence: ['fundamental_valuation', 'money_flow', 'news_context'],
            confidence: bars.length >= 120 ? 'medium' as AnalysisConfidence : 'low' as AnalysisConfidence,
            strategyReadiness: 'analysis_only',
            sourceCoverage: {
              sources: [klineRead?.source ?? 'unknown', ...(quote?.source ? [quote.source] : [])],
              interfaceId: provenance?.interfaceId ?? 'stock.daily_kline',
              capabilityId: provenance?.capabilityId ?? (klineRead?.source === 'local' ? 'local.cache' : `${klineRead?.source ?? 'unknown'}.stock.daily_kline`),
              canonicalSchema: provenance?.canonicalSchema ?? 'kline_daily',
              canonicalTable: provenance?.canonicalTable ?? 'kline_daily',
              readbackAction: 'query_kline',
              sourceDataTime: last.date,
              fetchedAt: provenance?.fetchedAt ?? quote?.fetchedAt ?? undefined,
              cacheStatus: provenance?.cacheStatus ?? (klineRead?.source === 'local' ? 'cache-hit' : 'provider-hit'),
              coverageStatus: quote ? 'sufficient_for_technical' : 'partial',
            },
          }),
        }, null, 2)
      }
      case 'calendar': {
        const now = new Date()
        const day = now.getDay()
        const isWeekday = day >= 1 && day <= 5
        const hour = now.getHours()
        const min = now.getMinutes()
        const time = hour * 100 + min
        const isMarketOpen = isWeekday && ((time >= 930 && time <= 1130) || (time >= 1300 && time <= 1500))
        return [
          `Time: ${now.toISOString()}`,
          `Trading day: ${isWeekday ? 'Yes (weekday)' : 'No (weekend)'}`,
          `Market hours: ${isMarketOpen ? 'OPEN' : 'CLOSED'}`,
          `A-share sessions: 09:30-11:30, 13:00-15:00`,
        ].join('\n')
      }
      case 'hurst': {
        if (bars.length < 50) return toolError('need 50+ bars for Hurst exponent.')
        const closes = bars.map((b) => b.close)
        const h = computeHurst(closes)
        const regime = h > 0.6 ? 'Trending (momentum)' : h < 0.4 ? 'Mean-reverting' : 'Random walk'
        return dataProcessCopy.hurstExplanation(h.toFixed(3), regime)
      }

      case 'advanced': {
        const vwapR = adv.vwap(bars)
        const obvR = adv.obv(bars)
        const wrR = adv.williamsR(bars)
        const vwapV = lastValue(vwapR)
        const obvV = lastValue(obvR)
        const wrV = lastValue(wrR)
        return [
          `Advanced Indicators for ${code} (${bars[bars.length - 1].date})`,
          `VWAP: ${fmtN(vwapV)}`,
          `OBV: ${obvV != null ? obvV.toFixed(0) : '-'}`,
          `Williams %R(14): ${fmtN(wrV)}${wrV != null ? (wrV < -80 ? ' [Oversold]' : wrV > -20 ? ' [Overbought]' : '') : ''}`,
        ].join('\n')
      }

      case 'ichimoku': {
        if (bars.length < 52) return toolError('need 52+ bars for Ichimoku.')
        const ich = adv.ichimoku(bars)
        const last = bars.length - 1
        const ichResult = ich as any
        return JSON.stringify({
          action: 'ichimoku', code, date: bars[last].date,
          tenkan: ichResult.tenkan[last]?.toFixed(2) ?? null,
          kijun: ichResult.kijun[last]?.toFixed(2) ?? null,
          senkouA: ichResult.senkouA[last]?.toFixed(2) ?? null,
          senkouB: ichResult.senkouB[last]?.toFixed(2) ?? null,
          chikou: ichResult.chikou[last]?.toFixed(2) ?? null,
          signal: ichResult.tenkan[last] != null && ichResult.kijun[last] != null
            ? (ichResult.tenkan[last]! > ichResult.kijun[last]!
                ? dataProcessCopy.ichimokuBullish()
                : dataProcessCopy.ichimokuBearish())
            : 'insufficient data',
        }, null, 2)
      }

      case 'pivot': {
        const pp = adv.pivotPoints(bars)
        if (!pp) return toolError('not enough data for pivot points.')
        return JSON.stringify({ action: 'pivot', code, ...pp }, null, 2)
      }

      case 'support': {
        const sr = findSupportResistance(bars)
        return JSON.stringify({ action: 'support', code, price: bars[bars.length - 1].close, ...sr }, null, 2)
      }

      case 'support_summary': {
        if (bars.length < 20) return toolError('need 20+ daily bars for support_summary.')
        const sr = findSupportResistance(bars)
        const signals = generateSignals(bars)
        const sum = signalSummary(signals)
        const patterns = detectPatterns(bars).slice(-5)
        const last = bars[bars.length - 1]
        const macd = ind.macd(bars)
        const boll = ind.boll(bars)
        const kdj = ind.kdj(bars)
        return JSON.stringify({
          action: 'support_summary',
          code,
          bars: bars.length,
          range: `${bars[0].date} ~ ${last.date}`,
          latestDate: last.date,
          latestClose: last.close,
          supportResistance: { price: last.close, ...sr },
          pivot: adv.pivotPoints(bars),
          indicators: {
            ma5: lastValue(ind.sma(bars, 5)),
            ma10: lastValue(ind.sma(bars, 10)),
            ma20: lastValue(ind.sma(bars, 20)),
            ma60: lastValue(ind.sma(bars, 60)),
            rsi: lastValue(ind.rsi(bars)),
            macdDif: lastValue(macd.dif),
            macdDea: lastValue(macd.dea),
            macdHist: lastValue(macd.macd),
            bollUpper: lastValue(boll.upper),
            bollMid: lastValue(boll.middle),
            bollLower: lastValue(boll.lower),
            kdjK: lastValue(kdj.k),
            kdjD: lastValue(kdj.d),
            kdjJ: lastValue(kdj.j),
            atr: lastValue(ind.atr(bars)),
            signal: sum.overall,
            signalScore: +sum.score.toFixed(2),
          },
          recentPatterns: patterns.map((p) => ({ date: p.date, pattern: p.pattern, type: p.type, reliability: p.reliability })),
          analysisEvidence: createAnalysisEvidencePackage({
            kind: 'stock_analysis',
            subject: { type: 'stock', id: code },
            observedFacts: [
              `bars=${bars.length}`,
              `latestDate=${last.date}`,
              `latestClose=${last.close}`,
              `source=${klineRead?.source ?? 'unknown'}`,
              `supportLevels=${sr.support.length}`,
              `resistanceLevels=${sr.resistance.length}`,
            ],
            interpretations: [
              'support_resistance:bounded_summary',
              sr.support.length > 0 ? 'support:levels_available' : 'support:no_level_detected',
              sr.resistance.length > 0 ? 'resistance:levels_available' : 'resistance:no_level_detected',
              `signal:${sum.overall}`,
            ],
            missingEvidence: [
              'fundamental_valuation',
              'money_flow',
              'news_context',
              'strategy_validation',
            ],
            confidence: bars.length >= 60 ? 'medium' : 'low',
            strategyReadiness: 'analysis_only',
            sourceCoverage: {
              sources: [klineRead?.source ?? 'unknown'],
              interfaceId: klineRead?.provenance?.interfaceId ?? 'stock.daily_kline',
              capabilityId: klineRead?.provenance?.capabilityId ?? (klineRead?.source === 'local' ? 'local.cache' : `${klineRead?.source ?? 'unknown'}.stock.daily_kline`),
              canonicalSchema: klineRead?.provenance?.canonicalSchema ?? 'kline_daily',
              canonicalTable: klineRead?.provenance?.canonicalTable ?? 'kline_daily',
              readbackAction: 'query_kline',
              sourceDataTime: last.date,
              fetchedAt: klineRead?.provenance?.fetchedAt,
              cacheStatus: klineRead?.provenance?.cacheStatus ?? (klineRead?.source === 'local' ? 'cache-hit' : 'provider-hit'),
              coverageStatus: bars.length >= 60 ? 'sufficient_for_technical' : 'partial',
            },
          }),
          usage: 'Use this as the bounded evidence set for support/resistance answers before adding separate support, pivot, indicators, or live fetch calls.',
        }, null, 2)
      }

      case 'volume': {
        const obvR = adv.obv(bars)
        const vwapR = adv.vwap(bars)
        const recentBars = bars.slice(-20)
        const avgVol = recentBars.reduce((s, b) => s + b.volume, 0) / recentBars.length
        const lastVol = bars[bars.length - 1].volume
        const last = bars[bars.length - 1]
        const volRatio = avgVol > 0 ? lastVol / avgVol : 0
        const volumeTrend = volRatio > 1.5
          ? dataProcessCopy.volumeTrendExpanding()
          : volRatio < 0.5
            ? dataProcessCopy.volumeTrendContracting()
            : dataProcessCopy.volumeTrendNormal()
        const summary = [
          `Volume Analysis for ${code} (${last.date})`,
          `Current Volume: ${lastVol} (${volRatio.toFixed(2)}x avg)`,
          `20-day Avg Volume: ${avgVol.toFixed(0)}`,
          `Volume Trend: ${volumeTrend}`,
          `OBV: ${lastValue(obvR)?.toFixed(0) ?? '-'}`,
          `VWAP: ${lastValue(vwapR)?.toFixed(2) ?? '-'}`,
        ].join('\n')
        return JSON.stringify({
          action: 'volume',
          code,
          bars: bars.length,
          range: `${bars[0].date} ~ ${last.date}`,
          latestDate: last.date,
          latestVolume: lastVol,
          avgVolume20: +avgVol.toFixed(0),
          volumeRatio: +volRatio.toFixed(4),
          volumeTrend,
          obv: lastValue(obvR) != null ? +(lastValue(obvR) as number).toFixed(0) : null,
          vwap: lastValue(vwapR) != null ? +(lastValue(vwapR) as number).toFixed(2) : null,
          summary,
          analysisEvidence: createAnalysisEvidencePackage({
            kind: 'stock_analysis',
            subject: { type: 'stock', id: code },
            observedFacts: [
              `bars=${bars.length}`,
              `latestDate=${last.date}`,
              `latestVolume=${lastVol}`,
              `volumeRatio=${volRatio.toFixed(4)}`,
              `source=${klineRead?.source ?? 'unknown'}`,
            ],
            interpretations: [
              'volume:bounded_analysis',
              `volumeTrend:${volumeTrend}`,
              'price_volume:requires_price_context',
            ],
            missingEvidence: [
              'fundamental_valuation',
              'money_flow',
              'news_context',
              'strategy_validation',
            ],
            confidence: bars.length >= 60 ? 'medium' : 'low',
            strategyReadiness: 'analysis_only',
            sourceCoverage: {
              sources: [klineRead?.source ?? 'unknown'],
              interfaceId: klineRead?.provenance?.interfaceId ?? 'stock.daily_kline',
              capabilityId: klineRead?.provenance?.capabilityId ?? (klineRead?.source === 'local' ? 'local.cache' : `${klineRead?.source ?? 'unknown'}.stock.daily_kline`),
              canonicalSchema: klineRead?.provenance?.canonicalSchema ?? 'kline_daily',
              canonicalTable: klineRead?.provenance?.canonicalTable ?? 'kline_daily',
              readbackAction: 'query_kline',
              sourceDataTime: last.date,
              fetchedAt: klineRead?.provenance?.fetchedAt,
              cacheStatus: klineRead?.provenance?.cacheStatus ?? (klineRead?.source === 'local' ? 'cache-hit' : 'provider-hit'),
              coverageStatus: bars.length >= 60 ? 'sufficient_for_technical' : 'partial',
            },
          }),
          usage: 'Use this as volume/price-volume analysis evidence only. Do not treat it as a validated strategy, watchlist rule, or trade instruction.',
        }, null, 2)
      }

      case 'score_technical': {
        const signals = generateSignals(bars)
        const sum = signalSummary(signals)
        const rsiV = lastValue(ind.rsi(bars))
        let score = 50 + sum.score * 30
        if (rsiV != null) {
          if (rsiV < 30) score += 10
          else if (rsiV > 70) score -= 10
        }
        score = Math.max(0, Math.min(100, score))
        const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
        return JSON.stringify({
          action: 'score_technical', code, score: +score.toFixed(0), grade,
          signal: sum.overall, signalScore: +sum.score.toFixed(2),
          rsi: rsiV ? +rsiV.toFixed(1) : null,
          details: signals.map((s) => `${s.indicator}: ${s.signal} (${(s.strength * 100).toFixed(0)}%)`),
        }, null, 2)
      }

      case 'breakout_summary':
        return this.breakoutSummary(ctx, code, limit)

      case 'optimize': {
        const codes = code.split(',').map((c) => c.trim()).filter(Boolean)
        if (codes.length < 2) return toolError('need 2+ codes for portfolio optimization. Example: DataProcess(action: "optimize", code: "600519,000858,601318")')
        const optimizeMethod = String(input.method ?? 'riskParity')
        const barsMap = new Map<string, dm.KlineBar[]>()
        for (const c of codes) {
          const b = await this.readBars(ctx, c, 'daily', 120)
          if (b.length > 20) barsMap.set(c, b)
        }
        if (barsMap.size < 2) return toolError('need data for at least 2 stocks.')
        let result: opt.OptimizeResult
        switch (optimizeMethod) {
          case 'equalWeight': result = opt.equalWeight(Array.from(barsMap.keys())); break
          case 'momentum': result = opt.momentumWeight(barsMap); break
          default: result = opt.riskParity(barsMap); break
        }
        return JSON.stringify({ action: 'optimize', optimizeMethod, ...result }, null, 2)
      }

      case 'ai_record': {
        const sym = String(input.symbol ?? input.code ?? '')
        const prediction = String(input.prediction ?? '')
        const targetPrice = input.targetPrice != null ? Number(input.targetPrice) : null
        const reasoning = String(input.reasoning ?? '')
        if (!sym || !prediction) return toolError('symbol and prediction(up/down/neutral) required.')
        const recordsPath = join(ctx.basePath, 'memory', 'ai_predictions.json')
        let records: any[] = []
        if (existsSync(recordsPath)) {
          try { records = JSON.parse(readFileSync(recordsPath, 'utf-8')) } catch { /* */ }
        }
        const currentPrice = (await this.readQuote(ctx, sym))?.price ?? 0
        records.push({
          symbol: sym, prediction, targetPrice, reasoning, currentPrice,
          date: new Date().toISOString().split('T')[0], validated: false,
        })
        mkdirSync(join(ctx.basePath, 'memory'), { recursive: true })
        writeFileSync(recordsPath, JSON.stringify(records, null, 2), 'utf-8')
        return JSON.stringify({ ok: true, action: 'ai_record', symbol: sym, prediction, currentPrice, total: records.length })
      }

      case 'ai_validate': {
        const recordsPath = join(ctx.basePath, 'memory', 'ai_predictions.json')
        if (!existsSync(recordsPath)) return 'No predictions recorded yet. Use ai_record first.'
        let records: any[] = []
        try { records = JSON.parse(readFileSync(recordsPath, 'utf-8')) } catch { return toolError('Error parsing predictions file.') }
        const unvalidated = records.filter((r: any) => !r.validated)
        if (unvalidated.length === 0) return 'All predictions already validated.'
        let correct = 0, total = 0
        for (const r of unvalidated) {
          const q = await this.readQuote(ctx, r.symbol)
          if (!q) continue
          const actual = q.price > r.currentPrice ? 'up' : q.price < r.currentPrice ? 'down' : 'neutral'
          r.actualPrice = q.price
          r.actualDirection = actual
          r.correct = r.prediction === actual
          r.validated = true
          r.validatedDate = new Date().toISOString().split('T')[0]
          total++
          if (r.correct) correct++
        }
        writeFileSync(recordsPath, JSON.stringify(records, null, 2), 'utf-8')
        const allValidated = records.filter((r: any) => r.validated)
        const allCorrect = allValidated.filter((r: any) => r.correct).length
        return JSON.stringify({
          action: 'ai_validate',
          thisRun: { validated: total, correct, accuracy: total > 0 ? `${(correct / total * 100).toFixed(1)}%` : 'N/A' },
          overall: { total: allValidated.length, correct: allCorrect, accuracy: allValidated.length > 0 ? `${(allCorrect / allValidated.length * 100).toFixed(1)}%` : 'N/A' },
        }, null, 2)
      }

      case 'help':
        return DP_HELP_TEXT

      default:
        return toolError(`Unknown action: ${action}. Use action="help".`)
    }
  }

  private async readBars(
    ctx: ToolContext,
    code: string,
    period: string,
    limit: number,
  ): Promise<dm.KlineBar[]> {
    return (await this.readKline(ctx, code, period, limit)).bars
  }

  private async readKline(
    ctx: ToolContext,
    code: string,
    period: string,
    limit: number,
  ) {
    const result = await this.readService.readKline(ctx, code, {
      period,
      adjust: 'qfq',
      limit,
    })
    return result
  }

  private async readQuotes(
    ctx: ToolContext,
    codes: string[],
  ): Promise<dm.Quote[]> {
    const result = await this.readService.readQuotes(ctx, codes.filter(Boolean))
    return result.quotes
  }

  private async readQuote(
    ctx: ToolContext,
    code: string,
  ): Promise<dm.Quote | undefined> {
    const quotes = await this.readQuotes(ctx, [code])
    return quotes[0]
  }

  private async screenCandidates(ctx: ToolContext, rawCode: string): Promise<string> {
    const codes = rawCode.split(',').map((c) => c.trim()).filter(Boolean)
    if (codes.length === 0) return toolError('codes required for screen. Example: DataProcess(action: "screen", code: "000001,600036,300750,601398,600519")')
    const read = await this.readService.readQuotes(ctx, codes)
    const quotes = read.quotes
    const sorted = sortQuotes(quotes, 'changePct', true)
    const results = sorted.map((q) => ({
      code: q.code,
      name: q.name,
      price: q.price,
      changePct: Number(q.changePct.toFixed(2)),
      pe: q.pe ?? null,
      pb: q.pb ?? null,
      source: q.source ?? null,
      sourceDataTime: q.timestamp ?? null,
      fetchedAt: q.fetchedAt ?? null,
    }))
    const summary = `Screened ${sorted.length} stocks (sorted by changePct desc):\n` +
      sorted.map((q) => `${q.code} ${q.name} ${q.price} ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}% PE:${q.pe?.toFixed(1) ?? '-'} PB:${q.pb?.toFixed(2) ?? '-'}`).join('\n')
    return JSON.stringify({
      action: 'screen',
      mode: 'filtered',
      requested: codes,
      evaluated: quotes.length,
      count: results.length,
      sortBy: 'changePct',
      results,
      summary,
      analysisEvidence: this.buildScreenAnalysisEvidence(codes, quotes.length, results, read.freshCount > 0 ? 'provider-hit' : 'cache-hit'),
      usage: 'Use results and analysisEvidence as candidate-research evidence only. Do not treat screen output as a validated strategy, watchlist mutation, or trade instruction.',
    }, null, 2)
  }

  private async readStockNames(ctx: ToolContext, codes: string[]): Promise<Map<string, string>> {
    try {
      const ds = await this.storeFor(ctx.basePath)
      const placeholders = codes.map(() => '?').join(',')
      const rows = ds.query<{ code: string; name: string }>(
        `SELECT code, name FROM stock_list WHERE code IN (${placeholders})`,
        ...codes,
      )
      return new Map(
        rows
          .map((row) => [String(row.code), String(row.name ?? '')] as const)
          .filter(([, name]) => name.length > 0),
      )
    } catch {
      return new Map()
    }
  }

  private async breakoutSummary(ctx: ToolContext, rawCodes: string, rawLimit: number): Promise<string> {
    const codes = rawCodes.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 8)
    if (codes.length === 0) return toolError('code is required for breakout_summary. Provide a bounded comma-separated shortlist.')
    const limit = Math.max(60, Math.min(Number.isFinite(rawLimit) ? rawLimit : 120, 240))
    const quotes = await this.readQuotes(ctx, codes).catch(() => [])
    const quoteMap = new Map(quotes.map((q) => [q.code, q]))
    const nameMap = await this.readStockNames(ctx, codes)
    const results = []
    const gaps: string[] = []

    for (const code of codes) {
      try {
        const bars = await this.readBars(ctx, code, 'daily', limit)
        if (bars.length < 21) {
          gaps.push(`${code}: kline rows ${bars.length}/21`)
          results.push({ code, status: 'insufficient_kline', bars: bars.length, score: 0 })
          continue
        }
        const last = bars[bars.length - 1]
        const prev = bars[bars.length - 2]
        const recent = bars.slice(-21, -1)
        const high20 = Math.max(...recent.map((b) => b.high))
        const avgVolume20 = recent.reduce((sum, b) => sum + (b.volume ?? 0), 0) / recent.length
        const volumeRatio = avgVolume20 > 0 ? (last.volume ?? 0) / avgVolume20 : null
        const ma5 = lastValue(ind.sma(bars, 5))
        const ma10 = lastValue(ind.sma(bars, 10))
        const ma20 = lastValue(ind.sma(bars, 20))
        const macd = ind.macd(bars)
        const macdHist = lastValue(macd.macd)
        const quote = quoteMap.get(code)
        const changePct = quote?.changePct ?? last.changePct ?? ((last.close - prev.close) / prev.close * 100)
        const breaksHigh20 = last.close >= high20 || last.high >= high20
        const maAligned = ma5 != null && ma10 != null && ma20 != null && ma5 >= ma10 && ma10 >= ma20
        let score = 30
        if (breaksHigh20) score += 25
        if (volumeRatio != null && volumeRatio >= 1.5) score += 20
        else if (volumeRatio != null && volumeRatio >= 1.1) score += 10
        if (maAligned) score += 15
        if (macdHist != null && macdHist > 0) score += 10
        if (changePct > 0) score += 5
        score = Math.max(0, Math.min(100, Math.round(score)))
        results.push({
          code,
          name: quote?.name || nameMap.get(code) || null,
          status: 'ok',
          score,
          decision: score >= 80 ? 'candidate' : score >= 60 ? 'watch' : 'weak',
          latestDate: last.date,
          latestClose: last.close,
          quotePrice: quote?.price ?? null,
          quoteSource: quote?.source ?? null,
          quoteAsOf: quote?.timestamp ?? null,
          quoteFetchedAt: quote?.fetchedAt ?? null,
          changePct: +changePct.toFixed(2),
          high20: +high20.toFixed(2),
          breaksHigh20,
          volumeRatio: volumeRatio != null ? +volumeRatio.toFixed(2) : null,
          ma5: ma5 != null ? +ma5.toFixed(2) : null,
          ma10: ma10 != null ? +ma10.toFixed(2) : null,
          ma20: ma20 != null ? +ma20.toFixed(2) : null,
          maAligned,
          macdHist: macdHist != null ? +macdHist.toFixed(4) : null,
          bars: bars.length,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        gaps.push(`${code}: ${message}`)
        results.push({ code, status: 'error', score: 0, error: message })
      }
    }

    results.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    return JSON.stringify({
      action: 'breakout_summary',
      mode: 'batch',
      requested: rawCodes,
      evaluated: results.length,
      cap: 8,
      limit,
      sourcePolicy: 'quote/kline resolved through governed market-data read service; local reusable rows are preferred before provider refresh',
      results,
      gaps,
      usage: 'Use this as the bounded technical evidence for the first breakout shortlist answer. Stop and answer from these ranked results; disclose missing money-flow/company-info/fundamental evidence as coverage gaps instead of querying every candidate.',
    }, null, 2)
  }

  private isStockOnlyAction(action: string): boolean {
    return new Set([
      'indicators',
      'advanced',
      'ichimoku',
      'pivot',
      'hurst',
      'trend',
      'stats',
      'patterns',
      'signals',
      'score',
      'score_technical',
      'summary',
      'support',
      'support_summary',
      'volume',
    ]).has(action)
  }

  private async isExplicitFundCode(ctx: ToolContext, rawCode: string): Promise<boolean> {
    const normalized = rawCode.trim().toUpperCase()
    const hasFundMarker = /\.OF$|^FUND[:._-]/.test(normalized)
    const match = rawCode.match(/\d{6}/)
    if (!match) return false
    const code = match[0]
    if (!hasFundMarker && isCoreCnMarketIndexCode(code)) return false
    try {
      const ds = await this.storeFor(ctx.basePath)
      const isKnownFund = ds.queryFundList({ limit: 50_000 }).some((row) => String(row.code ?? '') === code)
      if (!isKnownFund) return false
      if (hasFundMarker) return true
      const stockRows = ds.queryKline(code, { limit: 1 })
      return stockRows.length === 0
    } catch {
      return false
    }
  }

  private async storeFor(basePath: string): Promise<DataStore> {
    let promise = this.stores.get(basePath)
    if (!promise) {
      promise = (async () => {
        const ds = new DataStore(basePath)
        await ds.init()
        return ds
      })()
      this.stores.set(basePath, promise)
    }
    return promise
  }

  private buildScreenAnalysisEvidence(
    requested: string[],
    evaluated: number,
    results: Array<Record<string, unknown>>,
    cacheStatus: string,
  ): Record<string, unknown> {
    const source = String(results.find((row) => typeof row.source === 'string')?.source ?? 'local quote_snapshot')
    const cacheHit = cacheStatus === 'cache-hit'
    const top = results.slice(0, 3).map((row) => String(row.code ?? '')).filter(Boolean).join(',')
    const sourceDataTime = String(results.find((row) => row.sourceDataTime)?.sourceDataTime ?? '')
    const fetchedAt = String(results.find((row) => row.fetchedAt)?.fetchedAt ?? '')
    return createAnalysisEvidencePackage({
      kind: 'candidate_research',
      subject: {
        type: 'candidate_set',
        id: `stock_screen:${requested.slice(0, 8).join(',')}`,
        name: 'stock screen candidate set',
      },
      observedFacts: [
        `requested=${requested.length}`,
        `evaluated=${evaluated}`,
        `matched=${results.length}`,
        'mode=filtered',
        ...(top ? [`top=${top}`] : []),
      ],
      interpretations: [
        results.length === 0 ? 'screen:no_matches' : 'screen:candidates_returned',
        'screen:condition_filter',
      ],
      missingEvidence: [
        'fundamental_valuation_if_not_in_quote',
        'money_flow',
        'news_context',
        'strategy_validation',
      ],
      confidence: results.length === 0 ? 'low' : (evaluated >= requested.length ? 'medium' : 'low'),
      strategyReadiness: 'candidate',
      sourceCoverage: {
        sources: [source],
        interfaceId: 'stock.quote',
        capabilityId: cacheHit ? 'local.cache' : `${source}.stock.quote`,
        canonicalSchema: 'quote_snapshot',
        canonicalTable: 'quote_snapshot',
        readbackAction: 'query_quote',
        sourceDataTime: sourceDataTime || undefined,
        fetchedAt: fetchedAt || undefined,
        cacheStatus,
        coverageStatus: evaluated >= requested.length ? 'sufficient_for_analysis' : 'partial',
      },
    }) as unknown as Record<string, unknown>
  }

  private async watchSignalCheck(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
    const requestedType = String(input.type ?? 'fund').toLowerCase()
    const status = String(input.status ?? 'watching')
    const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100))
    const store = await this.storeFor(ctx.basePath)
    const items = (this.watchlistItems?.(ctx.basePath) ?? [])
      .filter((item) => !requestedType || String(item.type ?? '').toLowerCase() === requestedType)
      .filter((item) => !status || String(item.status ?? '') === status)
      .slice(0, limit)
    if (items.length === 0) {
      const detail = this.watchlistItems
        ? `No ${requestedType} watchlist items with status ${status}.`
        : 'Watchlist state provider is not attached to DataProcess.'
      return toolError(`${detail} Use Watchlist(action:"list", type:"${requestedType}", status:"${status}") to inspect current watch state.`)
    }

    const results = []
    const gaps: string[] = []
    for (const item of items) {
      const symbol = normalizeWatchSymbol(item.symbol)
      if (!symbol) {
        gaps.push(`${item.id ?? 'unknown'}: symbol missing`)
        continue
      }
      const type = String(item.type ?? requestedType).toLowerCase()
      if (type === 'fund' || type === 'etf') {
        const fundRows = store.queryFundNav(symbol, { limit: 2, order: 'desc' })
        const moneyRows = fundRows.length === 0 ? store.queryFundMoneyYield(symbol, { limit: 2, order: 'desc' }) : []
        const evidence = fundRows[0] ?? moneyRows[0] ?? null
        const metric = fundRows.length > 0 ? Number(evidence?.nav) : Number(evidence?.million_copies_income)
        const metricName = fundRows.length > 0 ? 'nav' : 'million_copies_income'
        results.push(this.evaluateWatchItem(item, {
          symbol,
          type,
          metricName,
          metricValue: Number.isFinite(metric) ? metric : null,
          sourceDataTime: String(evidence?.date ?? ''),
          provider: String(evidence?.source ?? 'local'),
          fetchedAt: String(evidence?.fetched_at ?? ''),
          interfaceId: fundRows.length > 0 ? 'fund.nav_history' : 'fund.money_yield_history',
          canonicalTable: fundRows.length > 0 ? 'fund_nav' : 'fund_money_yield',
        }))
      } else if (type === 'stock') {
        const quote = await this.readQuote(ctx, symbol)
        results.push(this.evaluateWatchItem(item, {
          symbol,
          type,
          metricName: 'price',
          metricValue: quote?.price ?? null,
          sourceDataTime: quote?.timestamp ?? '',
          provider: quote?.source ?? 'local',
          fetchedAt: quote?.fetchedAt ?? '',
          interfaceId: 'stock.quote',
          canonicalTable: 'quote_snapshot',
        }))
      } else {
        results.push({
          itemId: item.id ?? null,
          symbol,
          name: item.name ?? symbol,
          type,
          status: 'unsupported',
          triggered: false,
          unsupportedRules: [`unsupported watchlist type ${type}`],
        })
      }
    }

    return JSON.stringify({
      action: 'watch_signal_check',
      type: requestedType,
      status,
      count: results.length,
      results,
      gaps,
      analysisEvidence: this.buildWatchSignalAnalysisEvidence(requestedType, status, results, gaps),
      usage: 'Use this structured result for watchlist signal answers. Do not run Script or parse entryCondition text to invent unsupported rule execution.',
    }, null, 2)
  }

  private buildWatchSignalAnalysisEvidence(
    requestedType: string,
    status: string,
    results: Array<Record<string, unknown>>,
    gaps: string[],
  ): Record<string, unknown> | undefined {
    if (requestedType !== 'fund' && requestedType !== 'etf') return undefined
    const triggeredCount = results.filter((row) => row.triggered === true).length
    const noEvidenceCount = results.filter((row) => row.status === 'no_evidence').length
    const unsupportedCount = results.filter((row) => Array.isArray(row.unsupportedRules) && row.unsupportedRules.length > 0).length
    const provenance = this.firstWatchSignalProvenance(results)
    const canonicalTable = String(provenance?.canonicalTable ?? 'fund_nav')
    const interfaceId = String(provenance?.interfaceId ?? (canonicalTable === 'fund_money_yield' ? 'fund.money_yield_history' : 'fund.nav_history'))
    const provider = String(provenance?.provider ?? 'local')
    const hasAnyEvidence = results.some((row) => row.status !== 'no_evidence')
    return createAnalysisEvidencePackage({
      kind: 'fund_analysis',
      subject: {
        type: requestedType === 'etf' ? 'etf' : 'fund',
        id: `watch_signal_check:${requestedType}:${status}`,
        name: `${requestedType} watch signal check`,
      },
      observedFacts: [
        `items=${results.length}`,
        `triggered=${triggeredCount}`,
        `noEvidence=${noEvidenceCount}`,
        `unsupportedRules=${unsupportedCount}`,
        ...(gaps.length > 0 ? [`gaps=${gaps.length}`] : []),
      ],
      interpretations: [
        triggeredCount > 0 ? `signal:triggered_count=${triggeredCount}` : 'signal:no_triggered_items',
        unsupportedCount > 0 ? 'unsupported_rules_present' : 'structured_numeric_rules_checked',
      ],
      missingEvidence: [
        ...(noEvidenceCount > 0 ? ['fund_nav_or_money_yield'] : []),
        ...(unsupportedCount > 0 ? ['structured_numeric_watch_conditions'] : []),
        ...(gaps.length > 0 ? ['watchlist_symbol_gaps'] : []),
      ],
      confidence: !hasAnyEvidence ? 'low' : (noEvidenceCount > 0 || unsupportedCount > 0 ? 'medium' : 'high'),
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        sources: [provider],
        interfaceId,
        capabilityId: provider === 'local' ? 'local.cache' : `${provider}.${interfaceId}`,
        canonicalSchema: canonicalTable,
        canonicalTable,
        readbackAction: interfaceId === 'fund.money_yield_history' ? 'query_fund_money_yield' : 'query_fund_nav',
        sourceDataTime: provenance?.sourceDataTime == null ? undefined : String(provenance.sourceDataTime),
        fetchedAt: provenance?.fetchedAt == null ? undefined : String(provenance.fetchedAt),
        cacheStatus: provenance?.cacheStatus == null ? 'local-hit' : String(provenance.cacheStatus),
        coverageStatus: !hasAnyEvidence ? 'none' : (noEvidenceCount > 0 ? 'partial' : 'sufficient_for_analysis'),
      },
    }) as unknown as Record<string, unknown>
  }

  private firstWatchSignalProvenance(results: Array<Record<string, unknown>>): Record<string, unknown> | null {
    for (const result of results) {
      if (result.provenance && typeof result.provenance === 'object' && !Array.isArray(result.provenance)) {
        return result.provenance as Record<string, unknown>
      }
    }
    return null
  }

  private evaluateWatchItem(item: WatchlistItem, evidence: WatchSignalEvidence): Record<string, unknown> {
    const unsupportedRules: string[] = []
    const checks: Array<Record<string, unknown>> = []
    const value = evidence.metricValue
    const conditions = item.conditions ?? []
    let triggered = false

    if (value != null) {
      for (const condition of conditions) {
        const field = condition.field
        const op = condition.op
        const threshold = numericValue(condition.value)
        if (threshold == null || !['price', 'nav', evidence.metricName].includes(field) || !['>', '<', '>=', '<=', '=='].includes(op)) {
          unsupportedRules.push(`unsupported structured condition ${JSON.stringify(condition)}`)
          continue
        }
        const ok = compareNumber(value, op, threshold)
        if (ok) triggered = true
        checks.push({ field, op, threshold, actual: value, triggered: ok, source: 'conditions' })
      }
      const targetEntry = numericValue(item.targetEntryPrice ?? item.priceAtAdd)
      if (targetEntry != null && targetEntry > 0) {
        const ok = value <= targetEntry
        if (ok) triggered = true
        checks.push({ field: evidence.metricName, op: '<=', threshold: targetEntry, actual: value, triggered: ok, source: 'targetEntryPrice' })
      }
      const stopLoss = numericValue(item.stopLoss)
      if (stopLoss != null && stopLoss > 0) {
        const ok = value <= stopLoss
        if (ok) triggered = true
        checks.push({ field: evidence.metricName, op: '<=', threshold: stopLoss, actual: value, triggered: ok, source: 'stopLoss', riskAction: 'pause_or_stop' })
      }
    }

    const entryCondition = String(item.entryCondition ?? '').trim()
    if (entryCondition && checks.length === 0) {
      unsupportedRules.push('entryCondition is text-only; rewrite it as conditions[] or numeric targetEntryPrice/stopLoss before automatic execution')
    } else if (entryCondition && conditions.length === 0) {
      unsupportedRules.push('entryCondition text was preserved as explanation only; executable checks used structured numeric fields')
    }

    const status = value == null
      ? 'no_evidence'
      : triggered
        ? 'triggered'
        : unsupportedRules.length > 0 && checks.length === 0
          ? 'unsupported_rules'
          : 'not_triggered'

    return {
      itemId: item.id ?? null,
      symbol: evidence.symbol,
      name: item.name ?? evidence.symbol,
      type: evidence.type,
      watchStatus: item.status ?? null,
      status,
      triggered,
      metric: { name: evidence.metricName, value },
      checks,
      unsupportedRules,
      entryCondition: entryCondition || null,
      provenance: {
        interfaceId: evidence.interfaceId,
        provider: evidence.provider,
        cacheStatus: 'local-hit',
        sourceDataTime: evidence.sourceDataTime || null,
        fetchedAt: evidence.fetchedAt || null,
        canonicalTable: evidence.canonicalTable,
      },
    }
  }

  private computeIndicators(code: string, bars: ind.IndicatorResult['values'] extends Array<infer _> ? import('../data/data-manager').KlineBar[] : never, requested?: string[]): string {
    const want = new Set(requested ?? ['sma20', 'rsi', 'macd', 'boll', 'kdj'])
    const latest = bars[bars.length - 1]
    const indicators: Record<string, unknown> = {}
    if (want.has('sma5') || want.has('sma')) indicators.sma5 = lastValue(ind.sma(bars, 5))
    if (want.has('sma10') || want.has('sma')) indicators.sma10 = lastValue(ind.sma(bars, 10))
    if (want.has('sma20') || want.has('sma')) indicators.sma20 = lastValue(ind.sma(bars, 20))
    if (want.has('sma60') || want.has('sma')) indicators.sma60 = lastValue(ind.sma(bars, 60))
    if (want.has('ema12')) indicators.ema12 = lastValue(ind.ema(bars, 12))
    if (want.has('ema26')) indicators.ema26 = lastValue(ind.ema(bars, 26))
    if (want.has('rsi')) indicators.rsi14 = lastValue(ind.rsi(bars))
    if (want.has('macd')) {
      const value = ind.macd(bars)
      indicators.macd = { dif: lastValue(value.dif), dea: lastValue(value.dea), histogram: lastValue(value.macd) }
    }
    if (want.has('boll')) {
      const value = ind.boll(bars)
      indicators.boll = { upper: lastValue(value.upper), middle: lastValue(value.middle), lower: lastValue(value.lower) }
    }
    if (want.has('kdj')) {
      const value = ind.kdj(bars)
      indicators.kdj = { k: lastValue(value.k), d: lastValue(value.d), j: lastValue(value.j) }
    }
    if (want.has('atr')) indicators.atr14 = lastValue(ind.atr(bars))

    return JSON.stringify({
      action: 'indicators',
      code,
      bars: bars.length,
      range: { start: bars[0].date, end: latest.date },
      latest: { date: latest.date, open: latest.open, high: latest.high, low: latest.low, close: latest.close },
      indicators,
      interfaceId: 'technical.indicator_series',
      canonicalSchema: 'technical_indicator_series',
      canonicalTable: 'technical_indicator_series',
      provider: 'local',
      capabilityId: 'local.technical.indicator_series',
      cacheStatus: 'local-hit',
      sourceDataTime: latest.date,
    }, null, 2)
  }

  private analyzeTrend(bars: dm.KlineBar[]): string {
    if (bars.length < 20) return 'Not enough data for trend analysis (need 20+ bars)'

    const sma5 = ind.sma(bars, 5)
    const sma20 = ind.sma(bars, 20)
    const sma60 = bars.length >= 60 ? ind.sma(bars, 60) : null

    const last = bars[bars.length - 1]
    const s5 = lastValue(sma5)
    const s20 = lastValue(sma20)
    const s60 = sma60 ? lastValue(sma60) : null

    const lines: string[] = [`Trend Analysis: ${last.date} Close=${last.close}\n`]

    if (s5 != null && s20 != null) {
      if (s5 > s20) lines.push('Short-term trend: Bullish (SMA5 > SMA20)')
      else lines.push('Short-term trend: Bearish (SMA5 < SMA20)')
    }

    if (s20 != null && s60 != null) {
      if (s20 > s60) lines.push('Medium-term trend: Bullish (SMA20 > SMA60)')
      else lines.push('Medium-term trend: Bearish (SMA20 < SMA60)')
    }

    const highs = bars.slice(-20).map((b) => b.high)
    const lows = bars.slice(-20).map((b) => b.low)
    const resistance = Math.max(...highs)
    const support = Math.min(...lows)
    lines.push(`\n20-day Range: ${support.toFixed(2)} ~ ${resistance.toFixed(2)}`)
    lines.push(`Price position: ${((last.close - support) / (resistance - support) * 100).toFixed(0)}%`)

    const sr = findSupportResistance(bars)
    if (sr.support.length > 0) lines.push(`Key supports: ${sr.support.map((v) => v.toFixed(2)).join(', ')}`)
    if (sr.resistance.length > 0) lines.push(`Key resistances: ${sr.resistance.map((v) => v.toFixed(2)).join(', ')}`)

    const r = ind.rsi(bars)
    const rsiVal = lastValue(r)
    if (rsiVal != null) {
      lines.push(`\nRSI: ${rsiVal.toFixed(1)}${rsiVal > 70 ? ' [Overbought]' : rsiVal < 30 ? ' [Oversold]' : ' [Neutral]'}`)
    }

    return lines.join('\n')
  }

  private computeStats(bars: dm.KlineBar[]): string {
    if (bars.length < 5) return 'Not enough data for statistics'

    const returns: number[] = []
    for (let i = 1; i < bars.length; i++) {
      returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close * 100)
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
    const std = Math.sqrt(variance)
    const annualizedVol = std * Math.sqrt(252)

    let maxDD = 0, peak = bars[0].close
    for (const b of bars) {
      if (b.close > peak) peak = b.close
      const dd = (peak - b.close) / peak * 100
      if (dd > maxDD) maxDD = dd
    }

    const totalReturn = (bars[bars.length - 1].close - bars[0].close) / bars[0].close * 100
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0

    return [
      `Statistics (${bars.length} bars, ${bars[0].date} ~ ${bars[bars.length - 1].date})`,
      `Total Return: ${totalReturn.toFixed(2)}%`,
      `Daily Mean Return: ${mean.toFixed(3)}%`,
      `Daily Volatility: ${std.toFixed(3)}%`,
      `Annualized Volatility: ${annualizedVol.toFixed(1)}%`,
      `Sharpe Ratio (annualized): ${sharpe.toFixed(2)}`,
      `Max Drawdown: ${maxDD.toFixed(2)}%`,
      `Win Rate: ${(returns.filter((r) => r > 0).length / returns.length * 100).toFixed(1)}%`,
    ].join('\n')
  }
}
