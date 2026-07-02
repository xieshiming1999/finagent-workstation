var fundCode = '{{fund_code}}';
var fundName = '{{name}}';
var strategyId = '{{strategy_id}}';
var monitorDraft = {{monitor_draft}};
var dcaObservation = {{dca_observation}};
var minRows = Number('{{min_rows}}') || 30;

var nav = callService('/api/finance/fund/nav', {
  code: '{{fund_code}}',
  limit: {{min_rows}}
});

function numberOf(value) {
  var n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function navOf(row) {
  return numberOf(row.nav || row.unit_nav || row.netValue || row.value || row.close);
}

function dateOf(row) {
  return row.date || row.asOf || row.as_of || row.tradeDate || row.trade_date || null;
}

var allRows = ((nav && nav.data) || []).slice().sort(function (a, b) {
  return String(dateOf(a) || '').localeCompare(String(dateOf(b) || ''));
});
var rows = allRows.slice(-minRows);

function pct(from, to) {
  return from && to ? ((to - from) / from) * 100 : null;
}

function volatility(values) {
  if (values.length < 2) return null;
  var returns = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i - 1]) returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }
  if (returns.length < 2) return null;
  var avg = returns.reduce(function (sum, value) { return sum + value; }, 0) / returns.length;
  var variance = returns.reduce(function (sum, value) {
    var diff = value - avg;
    return sum + diff * diff;
  }, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

function drawdown(values) {
  var peak = null;
  var worst = 0;
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    if (!value) continue;
    if (peak == null || value > peak) peak = value;
    if (peak) {
      var dd = ((value - peak) / peak) * 100;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

function evaluateRule(rule, indicators) {
  if (!rule) return false;
  var left = String(rule.left || rule.indicator || '').toLowerCase();
  var op = String(rule.op || rule.operator || '');
  var right = Number(rule.right != null ? rule.right : (rule.value != null ? rule.value : rule.threshold));
  var value = null;
  if (left.indexOf('drawdown') >= 0 || left.indexOf('回撤') >= 0) value = indicators.drawdownPct;
  else if (left.indexOf('vol') >= 0 || left.indexOf('波动') >= 0) value = indicators.volatilityPct;
  else if (left.indexOf('trend') >= 0 || left.indexOf('return') >= 0 || left.indexOf('收益') >= 0) value = indicators.navTrendPct;
  if (value == null || !Number.isFinite(right)) return false;
  if (op === '>' || op === 'gt') return value > right;
  if (op === '>=' || op === 'gte') return value >= right;
  if (op === '<' || op === 'lt') return value < right;
  if (op === '<=' || op === 'lte') return value <= right;
  return false;
}

if (!rows.length || rows.length < minRows) {
  return {
    template: 'fund_rule_monitor',
    strategyId: strategyId,
    code: fundCode,
    name: fundName,
    state: 'data_missing',
    signal: 'wait',
    reason: 'fund nav rows ' + rows.length + ' < required ' + minRows,
    source: nav && nav.source,
    cacheStatus: nav && nav.cacheStatus,
    confirmationRequired: true
  };
}

var values = rows.map(navOf).filter(function (value) { return value != null; });
var latest = values[values.length - 1];
var first = values[0];
var indicators = {
  navTrendPct: pct(first, latest),
  drawdownPct: drawdown(values),
  volatilityPct: volatility(values)
};
var entryRules = Array.isArray(monitorDraft.entryRules) ? monitorDraft.entryRules : [];
var exitRules = Array.isArray(monitorDraft.exitRules) ? monitorDraft.exitRules : [];
var entry = entryRules.length > 0 && entryRules.every(function (rule) { return evaluateRule(rule, indicators); });
var exit = exitRules.length > 0 && exitRules.some(function (rule) { return evaluateRule(rule, indicators); });
var signal = exit ? 'review_or_pause' : (entry ? 'observe_or_prepare' : 'wait');

if (signal !== 'wait') {
  Bridge.alert(fundName + ' fund_rule_monitor ' + signal);
  Bridge.sendToAgent(
    '基金观察策略已触发：' + fundName + ' ' + fundCode + '。请先复核基金净值、回撤、波动和定投边界，不要直接申购、赎回或写入模拟交易。',
    {
      template: 'fund_rule_monitor',
      strategyId: strategyId,
      code: fundCode,
      name: fundName,
      value: latest,
      signal: signal,
      indicators: indicators,
      rows: rows.length,
      sourceDataTime: dateOf(rows[rows.length - 1]),
      fetchedAt: rows[rows.length - 1].fetchedAt || rows[rows.length - 1].fetched_at || null,
      cacheStatus: nav && nav.cacheStatus,
      monitorDraft: monitorDraft,
      dcaObservation: dcaObservation,
      confirmationRequired: true,
      tradeBoundary: 'Fund observation only. No subscription, redemption, Portfolio trade, or XueqiuTrade action before explicit user confirmation.'
    }
  );
}

return {
  template: 'fund_rule_monitor',
  strategyId: strategyId,
  code: fundCode,
  name: fundName,
  value: latest,
  state: 'ok',
  signal: signal,
  indicators: indicators,
  rows: rows.length,
  sourceDataTime: dateOf(rows[rows.length - 1]),
  fetchedAt: rows[rows.length - 1].fetchedAt || rows[rows.length - 1].fetched_at || null,
  cacheStatus: nav && nav.cacheStatus,
  confirmationRequired: true,
  confirmation: 'Fund monitor is observation-only. Confirm fund, amount, account, risk and timing before any subscription/redemption or simulated trade.'
};
