import * as vm from 'vm'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import type { Monitor, MonitorStore } from '../monitor-store'

function newMonitorId(): string {
  return `monitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseIntervalSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  const text = String(value ?? '60').trim()
  const match = text.match(/^(\d+)\s*([smhd])?$/i)
  if (!match) return 60
  const n = Number(match[1])
  const unit = (match[2] ?? 's').toLowerCase()
  if (unit === 'm') return n * 60
  if (unit === 'h') return n * 3600
  if (unit === 'd') return n * 86400
  return n
}

function normalizeMonitorScript(value: unknown): string {
  return String(value ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

function validateMonitorScript(script: string): string | null {
  try {
    new vm.Script(`(async () => { ${script} })()`)
    return null
  } catch (error) {
    return `invalid monitor script: ${error instanceof Error ? error.message : String(error)}`
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function js(value: unknown): string {
  return JSON.stringify(value)
}

function compileMonitorTemplate(template: unknown, paramsInput: unknown): { script: string, displayType: string, condition?: string } | { error: string } {
  const name = String(template ?? '').trim()
  const params = asRecord(paramsInput)
  if (!name) return { error: 'template is empty. Provide script or a supported template.' }
  if (name === 'portfolio_rebalance_monitor') {
    const rules = normalizeStrategyRules({ strategyRules: params.strategyRules, portfolioEvidence: params.portfolioEvidence, rebalanceDraft: params.rebalanceDraft })
    const rebalanceDraft = asRecord(rules?.rebalanceDraft)
    const portfolioEvidence = asRecord(rules?.portfolioEvidence)
    const positions = Array.isArray(rebalanceDraft.positions) ? rebalanceDraft.positions : []
    const symbols = Array.from(new Set(positions
      .map((item) => isPlainRecord(item) ? String(item.symbol ?? item.code ?? '').trim() : '')
      .filter(Boolean)))
    const strategyId = String(
      params.strategyId ??
      rules?.id ??
      rules?.strategyId ??
      rebalanceDraft.strategyId ??
      portfolioEvidence.strategyId ??
      '',
    ).trim()
    const reviewInterval = String(params.review_interval ?? params.reviewInterval ?? rebalanceDraft.rebalanceInterval ?? 'manual').trim()
    if (!strategyId) return { error: 'portfolio_rebalance_monitor requires strategyId.' }
    if (positions.length === 0) return { error: 'portfolio_rebalance_monitor requires rebalanceDraft.positions.' }
    if (!portfolioEvidence.mode || !rebalanceDraft.mode) {
      return {
        error: 'portfolio_rebalance_monitor requires structured portfolioEvidence.mode and rebalanceDraft.mode from MarketData(action:"custom_strategy_rank") or MarketData(action:"custom_strategy_read"). Use custom_strategy_list/read to retrieve the saved ranked strategy artifact before creating the monitor; do not invent portfolio evidence from quotes or monitor history.',
      }
    }
    return {
      displayType: 'status_row',
      condition: "result.signal === 'review_rebalance'",
      script: `
const rebalanceDraft = ${js(rebalanceDraft)};
const portfolioEvidence = ${js(portfolioEvidence)};
const positions = Array.isArray(rebalanceDraft.positions) ? rebalanceDraft.positions : [];
const symbols = ${js(symbols)};
const quoteResponse = Bridge.callService('/api/finance/quote', { code: ${js(symbols.map((symbol) => symbol.replace(/\.(SH|SZ|BJ)$/i, '')).join(','))} });
const quoteRows = ((quoteResponse && quoteResponse.data) || []);
const rows = symbols.map((symbol) => {
  const code = String(symbol).replace(/\\.(SH|SZ|BJ)$/i, '');
  const row = quoteRows.find((item) => {
    const value = String(item && (item.symbol || item.code || item.ts_code || '')).replace(/\\.(SH|SZ|BJ)$/i, '');
    return value === code;
  }) || {};
  return {
    symbol,
    name: row.name || symbol,
    price: Number(row.price || row.close || row.latest || row.current || 0),
    changePct: Number(row.changePct || row.change_pct || row.percent || row.pct_chg || 0),
    sourceDataTime: row.asOf || row.as_of || row.tradeDate || row.trade_date || null,
    fetchedAt: row.fetchedAt || row.fetched_at || null,
    cacheStatus: quoteResponse && quoteResponse.cacheStatus,
  };
});
const selectedCount = Number(portfolioEvidence.selectedCount || positions.length || rows.length);
const portfolioReturnPct = Number(
  portfolioEvidence.portfolioReturnPct ??
  (portfolioEvidence.portfolioBacktestEvidence && portfolioEvidence.portfolioBacktestEvidence.portfolioReturnPct) ??
  (portfolioEvidence.aggregateMetrics && portfolioEvidence.aggregateMetrics.portfolioReturnPct) ??
  NaN
);
const portfolioMaxDrawdownPct = Number(
  portfolioEvidence.portfolioMaxDrawdownPct ??
  (portfolioEvidence.portfolioBacktestEvidence && portfolioEvidence.portfolioBacktestEvidence.portfolioMaxDrawdownPct) ??
  (portfolioEvidence.aggregateMetrics && portfolioEvidence.aggregateMetrics.portfolioMaxDrawdownPct) ??
  NaN
);
const signal = rows.length > 0 ? 'review_rebalance' : 'wait';
if (signal === 'review_rebalance') {
  Bridge.sendToAgent(
    '组合策略复核触发：strategyId=' + ${js(strategyId)} + '。请复核 portfolioEvidence、rebalanceDraft、当前报价和再平衡边界，不要自动调仓或下单。',
    {
      template: 'portfolio_rebalance_monitor',
      strategyId: ${js(strategyId)},
      signal,
      symbols,
      rows,
      portfolioEvidence,
      rebalanceDraft,
      reviewInterval: ${js(reviewInterval)},
      confirmationRequired: true,
      tradeBoundary: 'Portfolio rebalance review only. Do not place Portfolio or XueqiuTrade orders before explicit user confirmation and post-action readback.'
    }
  );
}
return {
  template: 'portfolio_rebalance_monitor',
  strategyId: ${js(strategyId)},
  signal,
  items: rows.map((row) => ({ label: row.symbol, value: Number.isFinite(row.changePct) ? row.changePct : 0 })),
  selectedCount,
  portfolioReturnPct: Number.isFinite(portfolioReturnPct) ? portfolioReturnPct : null,
  portfolioMaxDrawdownPct: Number.isFinite(portfolioMaxDrawdownPct) ? portfolioMaxDrawdownPct : null,
  rebalanceInterval: rebalanceDraft.rebalanceInterval || ${js(reviewInterval)},
  sourceDataTime: rows.map((row) => row.sourceDataTime).filter(Boolean)[0] || null,
  fetchedAt: rows.map((row) => row.fetchedAt).filter(Boolean)[0] || null,
  confirmationRequired: true,
  tradeBoundary: 'Review only. No automatic rebalance or order.'
};`,
    }
  }
  if (name === 'strategy_signal') {
    const rules = normalizeStrategyRules({ strategyRules: params.strategyRules })
    const rawCode = String(params.ts_code ?? params.code ?? params.symbol ?? rules?.symbol ?? '').trim()
    const code = rawCode.replace(/\.(SH|SZ|BJ)$/i, '')
    const displayName = String(params.name ?? rawCode ?? code).trim()
    const smaPeriod = positiveInt(params.sma_period ?? params.smaPeriod, indicatorPeriod(rules, 'sma', 20))
    const volumePeriod = positiveInt(params.volume_period ?? params.volumePeriod, indicatorPeriod(rules, 'volume_sma', 20))
    const dataRequirements = asRecord(rules?.dataRequirements)
    const minBars = positiveInt(params.min_bars ?? params.minBars ?? dataRequirements.minBars, 120)
    const adjust = String(params.adjust ?? dataRequirements.adjust ?? 'qfq').trim() || 'qfq'
    const strategyId = String(params.strategyId ?? rules?.id ?? rules?.strategyId ?? '').trim()
    if (!code) return { error: 'strategy_signal requires params.ts_code, params.code, params.symbol, or strategyRules.symbol.' }
    return {
      displayType: 'value_card',
      condition: "result.signal === 'entry'",
      script: `
const quote = Bridge.callService('/api/finance/quote', { code: ${js(code)} });
const kline = Bridge.callService('/api/finance/kline', { code: ${js(code)}, adjust: ${js(adjust)}, limit: ${minBars} });
const bars = ((kline && kline.data) || []);
function numberOf(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function avg(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + numberOf(value), 0) / values.length;
}
function closeOf(row) { return numberOf(row.close ?? row.price ?? row.latest ?? row.current ?? row['收盘']); }
function volumeOf(row) { return numberOf(row.volume ?? row.vol ?? row['成交量']); }
if (!bars.length || bars.length < ${minBars}) {
  return {
    template: 'strategy_signal',
    code: ${js(rawCode || code)},
    name: ${js(displayName || code)},
    value: '--',
    state: 'data_missing',
    signal: 'wait',
    reason: 'kline rows ' + bars.length + ' < required ${minBars}',
    source: kline && kline.source,
    cacheStatus: kline && kline.cacheStatus,
  };
}
const closes = bars.map(closeOf);
const volumes = bars.map(volumeOf);
const lastClose = closes[closes.length - 1];
const prevClose = closes[closes.length - 2];
const sma = avg(closes.slice(-${smaPeriod}));
const prevSma = avg(closes.slice(-(${smaPeriod} + 1), -1));
const volumeAverage = avg(volumes.slice(-${volumePeriod}));
const lastVolume = volumes[volumes.length - 1];
const entry = prevClose <= prevSma && lastClose > sma && lastVolume > volumeAverage;
if (entry) {
  Bridge.alert(${js(displayName || code)} + ' strategy_signal entry: close crossed SMA${smaPeriod} with volume confirmation.');
  Bridge.sendToAgent(
    '策略信号已触发：' + ${js(displayName || code)} + ' ' + ${js(rawCode || code)} + '。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。',
    {
      template: 'strategy_signal',
      strategyId: ${js(strategyId)},
      code: ${js(rawCode || code)},
      name: ${js(displayName || code)},
      signal: 'entry',
      price: lastClose,
      sma,
      volumeAverage,
      lastVolume,
      bars: bars.length,
      confirmationRequired: true,
      tradeBoundary: 'No Portfolio or XueqiuTrade action before explicit user confirmation.'
    }
  );
}
const quoteRow = ((quote && quote.data) || [])[0] || {};
return {
  template: 'strategy_signal',
  strategyId: ${js(strategyId)},
  code: ${js(rawCode || code)},
  name: quoteRow.name || ${js(displayName || code)},
  value: lastClose,
  state: 'ok',
  signal: entry ? 'entry' : 'wait',
  sma,
  volumeAverage,
  lastVolume,
  bars: bars.length,
  quoteCacheStatus: quote && quote.cacheStatus,
  klineCacheStatus: kline && kline.cacheStatus,
  sourceDataTime: quoteRow.asOf || quoteRow.as_of || quoteRow.tradeDate || quoteRow.trade_date || null,
  fetchedAt: quoteRow.fetchedAt || quoteRow.fetched_at || null,
  confirmationRequired: true,
  confirmation: 'Strategy signal is alert-only. Confirm symbol, price, size, account, stop and take-profit before any Portfolio or XueqiuTrade action.'
};`,
    }
  }
  if (name === 'fund_rule_monitor') {
    const rules = normalizeStrategyRules({ strategyRules: params.strategyRules, monitorDraft: params.monitorDraft, dcaObservation: params.dcaObservation })
    const monitorDraft = asRecord(rules?.monitorDraft)
    const dcaObservation = asRecord(rules?.dcaObservation)
    const rawCode = String(params.fund_code ?? params.code ?? params.symbol ?? rules?.fundCode ?? rules?.code ?? rules?.symbol ?? monitorDraft.fundCode ?? monitorDraft.code ?? monitorDraft.symbol ?? '').trim()
    const code = rawCode
    const displayName = String(params.name ?? rawCode ?? code).trim()
    const strategyId = String(params.strategyId ?? rules?.id ?? rules?.strategyId ?? monitorDraft.strategyId ?? '').trim()
    const minRows = positiveInt(params.min_rows ?? params.minRows, 30)
    if (!code) return { error: 'fund_rule_monitor requires params.fund_code, params.code, params.symbol, or strategyRules.code.' }
    return {
      displayType: 'value_card',
      condition: "result.signal === 'observe_or_prepare' || result.signal === 'review_or_pause'",
      script: `
const nav = Bridge.callService('/api/finance/fund/nav', { code: ${js(code)}, limit: ${minRows} });
const allRows = ((nav && nav.data) || [])
  .slice()
  .sort((a, b) => String(dateOf(a) || '').localeCompare(String(dateOf(b) || '')));
const rows = allRows.slice(-${minRows});
const monitorDraft = ${js(monitorDraft)};
const dcaObservation = ${js(dcaObservation)};
function numberOf(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function navOf(row) { return numberOf(row.nav || row.unit_nav || row.netValue || row.value || row.close); }
function dateOf(row) { return row.date || row.asOf || row.as_of || row.tradeDate || row.trade_date || null; }
function pct(from, to) { return from && to ? ((to - from) / from) * 100 : null; }
function volatility(values) {
  if (values.length < 2) return null;
  const returns = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1]) returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }
  if (returns.length < 2) return null;
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
}
function drawdown(values) {
  let peak = null;
  let worst = 0;
  for (const value of values) {
    if (!value) continue;
    if (peak == null || value > peak) peak = value;
    if (peak) worst = Math.min(worst, ((value - peak) / peak) * 100);
  }
  return worst;
}
function evaluateRule(rule, indicators) {
  if (!rule) return false;
  const left = String(rule.left || rule.indicator || '').toLowerCase();
  const op = String(rule.op || rule.operator || '');
    const right = Number(rule.right != null ? rule.right : (rule.value != null ? rule.value : rule.threshold));
  let value = null;
  if (left.includes('drawdown') || left.includes('回撤')) value = indicators.drawdownPct;
  else if (left.includes('vol') || left.includes('波动')) value = indicators.volatilityPct;
  else if (left.includes('trend') || left.includes('return') || left.includes('收益')) value = indicators.navTrendPct;
  if (value == null || !Number.isFinite(right)) return false;
  if (op === '>' || op === 'gt') return value > right;
  if (op === '>=' || op === 'gte') return value >= right;
  if (op === '<' || op === 'lt') return value < right;
  if (op === '<=' || op === 'lte') return value <= right;
  return false;
}
if (!rows.length || rows.length < ${minRows}) {
  return {
    template: 'fund_rule_monitor',
    strategyId: ${js(strategyId)},
    code: ${js(rawCode || code)},
    name: ${js(displayName || code)},
    value: '--',
    state: 'data_missing',
    signal: 'wait',
    reason: 'fund nav rows ' + rows.length + ' < required ${minRows}',
    source: nav && nav.source,
    cacheStatus: nav && nav.cacheStatus,
    confirmationRequired: true,
  };
}
const values = rows.map(navOf).filter((value) => value != null);
const latest = values[values.length - 1];
const indicators = {
  navTrendPct: pct(values[0], latest),
  drawdownPct: drawdown(values),
  volatilityPct: volatility(values),
};
const entryRules = Array.isArray(monitorDraft.entryRules) ? monitorDraft.entryRules : [];
const exitRules = Array.isArray(monitorDraft.exitRules) ? monitorDraft.exitRules : [];
const entry = entryRules.length > 0 && entryRules.every((rule) => evaluateRule(rule, indicators));
const exit = exitRules.length > 0 && exitRules.some((rule) => evaluateRule(rule, indicators));
const signal = exit ? 'review_or_pause' : (entry ? 'observe_or_prepare' : 'wait');
if (signal !== 'wait') {
  Bridge.alert(${js(displayName || code)} + ' fund_rule_monitor ' + signal);
  Bridge.sendToAgent(
    '基金观察策略已触发：' + ${js(displayName || code)} + ' ' + ${js(rawCode || code)} + '。请先复核基金净值、回撤、波动和定投边界，不要直接申购、赎回或写入模拟交易。',
    {
      template: 'fund_rule_monitor',
      strategyId: ${js(strategyId)},
      code: ${js(rawCode || code)},
      name: ${js(displayName || code)},
      value: latest,
      signal,
      indicators,
      rows: rows.length,
      sourceDataTime: dateOf(rows[rows.length - 1]),
      fetchedAt: rows[rows.length - 1].fetchedAt || rows[rows.length - 1].fetched_at || null,
      cacheStatus: nav && nav.cacheStatus,
      monitorDraft,
      dcaObservation,
      confirmationRequired: true,
      tradeBoundary: 'Fund observation only. No subscription, redemption, Portfolio trade, or XueqiuTrade action before explicit user confirmation.'
    }
  );
}
const lastRow = rows[rows.length - 1] || {};
return {
  template: 'fund_rule_monitor',
  strategyId: ${js(strategyId)},
  code: ${js(rawCode || code)},
  name: ${js(displayName || code)},
  value: latest,
  state: 'ok',
  signal,
  indicators,
  rows: rows.length,
  sourceDataTime: dateOf(lastRow),
  fetchedAt: lastRow.fetchedAt || lastRow.fetched_at || null,
  cacheStatus: nav && nav.cacheStatus,
  confirmationRequired: true,
  confirmation: 'Fund monitor is observation-only. Confirm fund, amount, account, risk and timing before any subscription/redemption or simulated trade.'
};`,
    }
  }
  if (name === 'price_alert') {
    const code = String(params.ts_code ?? params.code ?? '').trim()
    const displayName = String(params.name ?? code).trim()
    const upper = Number(params.upper)
    const lower = Number(params.lower)
    if (!code) return { error: 'price_alert requires params.ts_code or params.code.' }
    if (!Number.isFinite(upper) && !Number.isFinite(lower)) return { error: 'price_alert requires params.upper or params.lower.' }
    return {
      displayType: 'value_card',
      condition: 'result.triggered === true',
      script: `
const quote = Bridge.callService('/api/finance/quote', { code: ${js(code.replace(/\.(SH|SZ|BJ)$/i, ''))} });
const row = ((quote && quote.data) || [])[0] || {};
const price = Number(row.price || row.close || row.latest || row.current || 0);
const upper = ${Number.isFinite(upper) ? upper : 'null'};
const lower = ${Number.isFinite(lower) ? lower : 'null'};
return {
  template: 'price_alert',
  code: ${js(code)},
  name: row.name || ${js(displayName)},
  price,
  upper,
  lower,
  triggered: Number.isFinite(price) && ((upper != null && price >= upper) || (lower != null && price <= lower)),
  sourceDataTime: row.asOf || row.as_of || row.tradeDate || row.trade_date || null,
  fetchedAt: row.fetchedAt || row.fetched_at || null
};`,
    }
  }
  if (name === 'change_alert') {
    const code = String(params.ts_code ?? params.code ?? '').trim()
    const displayName = String(params.name ?? code).trim()
    const threshold = Number(params.threshold)
    if (!code) return { error: 'change_alert requires params.ts_code or params.code.' }
    if (!Number.isFinite(threshold) || threshold <= 0) return { error: 'change_alert requires a positive params.threshold.' }
    return {
      displayType: 'status_row',
      condition: 'result.triggered === true',
      script: `
const quote = Bridge.callService('/api/finance/quote', { code: ${js(code.replace(/\.(SH|SZ|BJ)$/i, ''))} });
const row = ((quote && quote.data) || [])[0] || {};
const changePct = Number(row.changePct || row.change_pct || row.percent || row.pct_chg || 0);
const threshold = ${threshold};
return {
  template: 'change_alert',
  code: ${js(code)},
  name: row.name || ${js(displayName)},
  changePct,
  threshold,
  triggered: Number.isFinite(changePct) && Math.abs(changePct) >= threshold,
  sourceDataTime: row.asOf || row.as_of || row.tradeDate || row.trade_date || null,
  fetchedAt: row.fetchedAt || row.fetched_at || null
};`,
    }
  }
  if (name === 'fund_nav') {
    const code = String(params.ts_code ?? params.code ?? '').trim()
    const displayName = String(params.name ?? code).trim()
    const upper = Number(params.upper)
    const lower = Number(params.lower)
    if (!code) return { error: 'fund_nav requires params.ts_code or params.code.' }
    if (!Number.isFinite(upper) && !Number.isFinite(lower)) return { error: 'fund_nav requires params.upper or params.lower.' }
    return {
      displayType: 'value_card',
      condition: 'result.triggered === true',
      script: `
const nav = Bridge.callService('/api/finance/fund/nav', { code: ${js(code)} });
const row = ((nav && nav.data) || [])[0] || {};
const value = Number(row.nav || row.unit_nav || row.netValue || row.value || 0);
const upper = ${Number.isFinite(upper) ? upper : 'null'};
const lower = ${Number.isFinite(lower) ? lower : 'null'};
return {
  template: 'fund_nav',
  code: ${js(code)},
  name: row.name || ${js(displayName)},
  value,
  upper,
  lower,
  triggered: Number.isFinite(value) && ((upper != null && value >= upper) || (lower != null && value <= lower)),
  sourceDataTime: row.date || row.asOf || row.as_of || null,
  fetchedAt: row.fetchedAt || row.fetched_at || null
};`,
    }
  }
  if (name === 'volume_surge') {
    const code = String(params.ts_code ?? params.code ?? '').trim()
    const displayName = String(params.name ?? code).trim()
    const multiplier = Number(params.multiplier)
    if (!code) return { error: 'volume_surge requires params.ts_code or params.code.' }
    if (!Number.isFinite(multiplier) || multiplier <= 1) return { error: 'volume_surge requires params.multiplier greater than 1.' }
    return {
      displayType: 'status_row',
      condition: 'result.triggered === true',
      script: `
const technical = Bridge.callService('/api/finance/technical', { code: ${js(code.replace(/\.(SH|SZ|BJ)$/i, ''))} });
const data = (technical && technical.data) || {};
const volumeRatio = Number(data.volumeRatio || data.volume_ratio || 0);
const multiplier = ${multiplier};
return {
  template: 'volume_surge',
  code: ${js(code)},
  name: data.name || ${js(displayName)},
  volumeRatio,
  multiplier,
  triggered: Number.isFinite(volumeRatio) && volumeRatio >= multiplier,
  sourceDataTime: data.asOf || data.as_of || null,
  fetchedAt: data.fetchedAt || data.fetched_at || null
};`,
    }
  }
  if (name === 'watchlist') {
    const items = Array.isArray(params.items) ? params.items : []
    if (items.length === 0) return { error: 'watchlist requires params.items.' }
    return {
      displayType: 'watchlist',
      condition: 'Array.isArray(result.items) && result.items.some(item => item.triggered === true)',
      script: `
const items = ${js(items)};
const rows = items.map((item) => {
  const code = String(item.ts_code || item.code || '').replace(/\\.(SH|SZ|BJ)$/i, '');
  const quote = Bridge.callService('/api/finance/quote', { code });
  const row = ((quote && quote.data) || [])[0] || {};
  const changePct = Number(row.changePct || row.change_pct || row.percent || row.pct_chg || 0);
  const threshold = Number(${js(params.change_threshold ?? 5)});
  return {
    code: item.ts_code || item.code,
    name: row.name || item.name || item.ts_code || item.code,
    price: Number(row.price || row.close || row.latest || row.current || 0),
    changePct,
    threshold,
    triggered: Number.isFinite(changePct) && Math.abs(changePct) >= threshold,
    sourceDataTime: row.asOf || row.as_of || row.tradeDate || row.trade_date || null,
    fetchedAt: row.fetchedAt || row.fetched_at || null
  };
});
return { template: 'watchlist', items: rows, triggeredCount: rows.filter(item => item.triggered).length };`,
    }
  }
  return { error: `unsupported monitor template: ${name}. Supported templates: price_alert, change_alert, fund_nav, volume_surge, watchlist, strategy_signal, fund_rule_monitor, portfolio_rebalance_monitor.` }
}

export class MonitorCreateTool implements Tool {
  name = 'MonitorCreate'
  description = 'Create a scheduled monitor that periodically runs JavaScript through the runtime MonitorScheduler. Scripts use the unified Bridge API for HTTP, files, config, notifications, and agent alerts.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Monitor name' },
      script: { type: 'string', description: 'JavaScript code to execute periodically' },
      template: { type: 'string', description: 'Built-in template: price_alert, change_alert, fund_nav, volume_surge, watchlist, strategy_signal, fund_rule_monitor, portfolio_rebalance_monitor' },
      params: { type: 'object', description: 'Template parameters' },
      interval: { type: 'string', description: 'Interval such as 30s, 1m, 5m, 1h. Numeric values are seconds.' },
      condition: { type: 'string', description: 'Optional JavaScript expression evaluated with result/state; truthy triggers an alert.' },
      displayType: { type: 'string', description: 'Display type: value_card, status_row, alert_list, mini_chart, text, carousel, watchlist' },
      display: { type: 'string', description: 'Alias for displayType' },
      user_prompt: { type: 'string', description: 'Original user request' },
      description: { type: 'string', description: 'One-line description' },
      group: { type: 'string', description: 'Optional group name' },
      strategyId: { type: 'string', description: 'Strategy artifact id when this monitor is derived from StrategySpec.' },
      strategyRules: { type: 'object', description: 'Structured strategy-derived rules used for monitor provenance.' },
      monitorDraft: { type: 'object', description: 'Structured monitor draft returned by custom_strategy_observe.' },
      dcaObservation: { type: 'object', description: 'Structured fund DCA observation returned by custom_strategy_observe.' },
      portfolioEvidence: { type: 'object', description: 'Structured portfolio evidence returned by custom_strategy_rank.' },
      rebalanceDraft: { type: 'object', description: 'Structured rebalance draft returned by custom_strategy_rank.' },
      streamUrl: { type: 'string', description: 'Optional WebSocket URL for push-based monitoring' },
    },
    required: ['name'],
  }

  constructor(private store: MonitorStore) {}

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.name) return 'name is required. Give the monitor a descriptive name.'
    if (!input.script && !input.template) return 'script or template is required. Use a supported template when possible.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const id = newMonitorId()
    const templateParams = isPlainRecord(input.params) ? { ...input.params } : {}
    for (const key of ['ts_code', 'code', 'symbol', 'name', 'fund_code']) {
      if (input[key] !== undefined && templateParams[key] === undefined) {
        templateParams[key] = input[key]
      }
    }
    if (input.strategyId !== undefined) templateParams.strategyId = input.strategyId
    if (input.strategyRules !== undefined) templateParams.strategyRules = input.strategyRules
    if (input.monitorDraft !== undefined) templateParams.monitorDraft = input.monitorDraft
    if (input.dcaObservation !== undefined) templateParams.dcaObservation = input.dcaObservation
    if (input.portfolioEvidence !== undefined) templateParams.portfolioEvidence = input.portfolioEvidence
    if (input.rebalanceDraft !== undefined) templateParams.rebalanceDraft = input.rebalanceDraft
    const compiled = input.script
      ? { script: normalizeMonitorScript(input.script), displayType: String(input.displayType ?? input.display ?? 'value_card'), condition: input.condition ? String(input.condition) : undefined }
      : compileMonitorTemplate(input.template, templateParams)
    if ('error' in compiled) return toolError(compiled.error)
    const script = compiled.script
    const scriptError = validateMonitorScript(script)
    if (scriptError) return toolError(scriptError)
    const monitor: Monitor = {
      id,
      name: String(input.name),
      script,
      intervalSeconds: parseIntervalSeconds(input.interval),
      condition: input.condition ? String(input.condition) : compiled.condition,
      displayType: String(input.displayType ?? input.display ?? compiled.displayType),
      enabled: true,
      userPrompt: input.user_prompt ? String(input.user_prompt) : undefined,
      description: input.description ? String(input.description) : undefined,
      groupName: input.group ? String(input.group) : undefined,
      strategyId: input.strategyId ? String(input.strategyId) : undefined,
      strategyRules: normalizeStrategyRules(input),
      streamUrl: input.streamUrl ? String(input.streamUrl) : undefined,
      state: {},
      conditionTriggered: false,
      hasUnreadAlert: false,
    }
    const error = this.store.add(monitor)
    if (error) return toolError(error)
    return JSON.stringify({
      ok: true,
      id,
      name: monitor.name,
      intervalSeconds: monitor.intervalSeconds,
      displayType: monitor.displayType,
      enabled: monitor.enabled,
      next: 'The runtime MonitorScheduler will pick up this monitor from MonitorStore. Use MonitorList to inspect last result/error, MonitorUpdate to disable or edit, and MonitorDelete to remove.',
    }, null, 2)
  }
}

function normalizeStrategyRules(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const rules: Record<string, unknown> = isPlainRecord(input.strategyRules)
    ? { ...input.strategyRules }
    : {}
  if (isPlainRecord(input.monitorDraft)) {
    rules.monitorDraft = { ...input.monitorDraft }
  }
  if (isPlainRecord(input.dcaObservation)) {
    rules.dcaObservation = { ...input.dcaObservation }
  }
  if (isPlainRecord(input.portfolioEvidence)) {
    rules.portfolioEvidence = { ...input.portfolioEvidence }
  }
  if (isPlainRecord(input.rebalanceDraft)) {
    rules.rebalanceDraft = { ...input.rebalanceDraft }
  }
  return Object.keys(rules).length > 0 ? rules : undefined
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function indicatorPeriod(rules: Record<string, unknown> | undefined, type: string, fallback: number): number {
  const indicators = rules?.indicators
  if (!Array.isArray(indicators)) return fallback
  for (const indicator of indicators) {
    if (!isPlainRecord(indicator) || indicator.type !== type) continue
    const params = asRecord(indicator.params)
    return positiveInt(params.period, fallback)
  }
  return fallback
}

export class MonitorUpdateTool implements Tool {
  name = 'MonitorUpdate'
  description = 'Update an existing runtime monitor: enable/disable, interval, script, condition, name, or display type.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Monitor ID' },
      enabled: { type: 'boolean' },
      interval: { type: 'string' },
      script: { type: 'string' },
      condition: { type: 'string' },
      name: { type: 'string' },
      displayType: { type: 'string' },
      display: { type: 'string' },
    },
    required: ['id'],
  }

  constructor(private store: MonitorStore) {}

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.id) return 'id is required. Provide the monitor ID to update.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const monitor = this.store.get(String(input.id))
    if (!monitor) return toolError(`Monitor not found: ${input.id}`)
    if (input.enabled !== undefined) monitor.enabled = Boolean(input.enabled)
    if (input.interval !== undefined) monitor.intervalSeconds = parseIntervalSeconds(input.interval)
    if (input.script !== undefined) {
      const script = normalizeMonitorScript(input.script)
      const scriptError = validateMonitorScript(script)
      if (scriptError) return toolError(scriptError)
      monitor.script = script
    }
    if (input.condition !== undefined) monitor.condition = input.condition ? String(input.condition) : undefined
    if (input.name !== undefined) monitor.name = String(input.name)
    if (input.displayType !== undefined || input.display !== undefined) monitor.displayType = String(input.displayType ?? input.display)
    this.store.save()
    this.store.onChanged?.()
    return JSON.stringify({ ok: true, id: monitor.id, enabled: monitor.enabled, intervalSeconds: monitor.intervalSeconds })
  }
}

export class MonitorDeleteTool implements Tool {
  name = 'MonitorDelete'
  description = 'Delete a monitor by ID.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: { id: { type: 'string', description: 'Monitor ID to delete' } },
    required: ['id'],
  }

  constructor(private store: MonitorStore) {}

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.id) return 'id is required. Provide the monitor ID to delete.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    if (!this.store.remove(String(input.id))) return toolError(`Monitor not found: ${input.id}`)
    return JSON.stringify({ ok: true, deleted: String(input.id) })
  }
}

export class MonitorListTool implements Tool {
  name = 'MonitorList'
  description = 'List runtime monitors with scheduler-visible status and last results.'
  isReadOnly = true
  inputSchema = { type: 'object', properties: {} }

  constructor(private store: MonitorStore) {}

  async call(): Promise<string> {
    if (this.store.count === 0) return 'No monitors configured.'
    return this.store.list.map((m) => this.store.toSummary(m.id)).join('\n')
  }
}
