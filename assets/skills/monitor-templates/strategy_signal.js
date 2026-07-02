// Monitor Template: strategy_signal
// Params: ts_code/code/symbol, name, sma_period, volume_period, min_bars, adjust
var code = '{{ts_code}}' || '{{code}}' || '{{symbol}}';
var name = '{{name}}' || code;
var strategyId = '{{strategy_id}}';
var smaPeriod = {{sma_period}};
var volumePeriod = {{volume_period}};
var minBars = {{min_bars}};
var adjust = '{{adjust}}' || 'qfq';
if (!smaPeriod) smaPeriod = 20;
if (!volumePeriod) volumePeriod = 20;
if (!minBars) minBars = 120;
if (!strategyId || strategyId.indexOf('{{') >= 0 || strategyId === 'null') strategyId = '';

var cleanCode = String(code).replace(/\.(SH|SZ|BJ)$/i, '');
var quote = callService('/api/finance/quote', {code: cleanCode});
var kline = callService('/api/finance/kline', {
  code: cleanCode,
  adjust: adjust,
  limit: minBars
});

function rows(resp) {
  if (!resp) return [];
  return resp.data || [];
}
function numberOf(value) {
  var n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function avg(values) {
  if (!values.length) return null;
  var total = 0;
  for (var i = 0; i < values.length; i++) total += numberOf(values[i]);
  return total / values.length;
}
function closeOf(row) {
  return numberOf(row.close || row.price || row.latest || row.current || row['收盘']);
}
function volumeOf(row) {
  return numberOf(row.volume || row.vol || row['成交量']);
}

var bars = rows(kline);
if (!bars.length || bars.length < minBars) {
  return {
    template: 'strategy_signal',
    code: code,
    name: name,
    value: '--',
    state: 'data_missing',
    signal: 'wait',
    reason: 'kline rows ' + bars.length + ' < required ' + minBars,
    source: kline && kline.source,
    cacheStatus: kline && kline.cacheStatus
  };
}

var closes = bars.map(closeOf);
var volumes = bars.map(volumeOf);
var lastClose = closes[closes.length - 1];
var prevClose = closes[closes.length - 2];
var sma = avg(closes.slice(-smaPeriod));
var prevSma = avg(closes.slice(-(smaPeriod + 1), -1));
var volumeAverage = avg(volumes.slice(-volumePeriod));
var lastVolume = volumes[volumes.length - 1];
var entry = prevClose <= prevSma && lastClose > sma && lastVolume > volumeAverage;

if (entry) {
  Bridge.alert(name + ' strategy_signal entry: close crossed SMA' + smaPeriod + ' with volume confirmation.');
  Bridge.sendToAgent(
    '策略信号已触发：' + name + ' ' + code + '。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。',
    {
      template: 'strategy_signal',
      strategyId: strategyId,
      code: code,
      name: name,
      signal: 'entry',
      price: lastClose,
      sma: sma,
      volumeAverage: volumeAverage,
      lastVolume: lastVolume,
      bars: bars.length,
      confirmationRequired: true,
      tradeBoundary: 'No Portfolio or XueqiuTrade action before explicit user confirmation.'
    }
  );
}

var quoteRow = rows(quote)[0] || {};
return {
  template: 'strategy_signal',
  strategyId: strategyId,
  code: code,
  name: quoteRow.name || name,
  value: lastClose,
  state: 'ok',
  signal: entry ? 'entry' : 'wait',
  sma: sma,
  volumeAverage: volumeAverage,
  lastVolume: lastVolume,
  bars: bars.length,
  quoteCacheStatus: quote && quote.cacheStatus,
  klineCacheStatus: kline && kline.cacheStatus,
  sourceDataTime: quoteRow.asOf || quoteRow.as_of || quoteRow.tradeDate || quoteRow.trade_date || null,
  fetchedAt: quoteRow.fetchedAt || quoteRow.fetched_at || null,
  confirmationRequired: true,
  confirmation: 'Strategy signal is alert-only. Confirm symbol, price, size, account, stop and take-profit before any Portfolio or XueqiuTrade action.'
};
