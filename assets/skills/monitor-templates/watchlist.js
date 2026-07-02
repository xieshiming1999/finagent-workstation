// Monitor Template: watchlist
// Params: items (JSON array [{ts_code, name}, ...]), change_threshold
// Uses FinAgent Workstation local finance quote route with a comma-separated code list.
var zh = (navigator.language || '').toLowerCase().indexOf('zh') === 0;
var items = {{items}};
var threshold = {{change_threshold}};

var codes = [];
for (var c = 0; c < items.length; c++) {
  codes.push(items[c].ts_code.replace(/\.\w+$/, ''));
}
var resp = callService('/api/finance/quote', {code: codes.join(',')});
var allRows = resp.data || resp;

var lookup = {};
for (var i = 0; i < allRows.length; i++) {
  lookup[allRows[i].code || allRows[i]['代码']] = allRows[i];
}

var rows = [];
var alerts = [];

for (var j = 0; j < items.length; j++) {
  var item = items[j];
  var code = item.ts_code.replace(/\.\w+$/, '');
  var row = lookup[code];
  if (!row) {
    rows.push({name: item.name, code: item.ts_code, price: '--', change: 0, signal: ''});
    continue;
  }
  var price = parseFloat(row.price || row['最新价'] || 0);
  var change = parseFloat(row.changePct || row['涨跌幅'] || 0);
  var signal = '';
  if (Math.abs(change) >= threshold) {
    signal = change > 0 ? 'up' : 'down';
    alerts.push(zh
      ? item.name + (change > 0 ? ' 涨 ' : ' 跌 ') + Math.abs(change).toFixed(2) + '%'
      : item.name + ' ' + (change > 0 ? 'rose ' : 'fell ') + Math.abs(change).toFixed(2) + '%');
  }
  rows.push({name: item.name, code: item.ts_code, price: price, change: parseFloat(change.toFixed(2)), signal: signal});
}

if (alerts.length > 0) {
  Bridge.alert((zh ? '自选异动：' : 'Watchlist moves: ') + alerts.join(zh ? '；' : '; '));
}

return {rows: rows, title: zh ? '自选盯盘' : 'Watchlist Monitor', alerts: alerts};
