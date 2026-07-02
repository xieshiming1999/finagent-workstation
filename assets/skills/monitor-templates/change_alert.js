// Monitor Template: change_alert
// Params: ts_code (e.g. "600519"), name, threshold
// Uses FinAgent Workstation local finance quote route.
var zh = (navigator.language || '').toLowerCase().indexOf('zh') === 0;
var code = '{{ts_code}}'.replace(/\.\w+$/, '');
var resp = callService('/api/finance/quote', {code: code});
var rows = resp.data || [];
var row = rows[0] || null;
if (!row) return {value: '--', label: '{{name}}', change: 0};

var price = parseFloat(row.price || row['最新价'] || 0);
var change = parseFloat(row.changePct || row['涨跌幅'] || 0);
var threshold = {{threshold}};

if (Math.abs(change) >= threshold) {
  var direction = change > 0 ? (zh ? '涨' : 'rose') : (zh ? '跌' : 'fell');
  Bridge.alert(zh
    ? '{{name}} ' + direction + ' ' + Math.abs(change).toFixed(2) + '%，超过阈值 ' + threshold + '%'
    : '{{name}} ' + direction + ' ' + Math.abs(change).toFixed(2) + '%, beyond the ' + threshold + '% threshold');
}

return {value: price, label: '{{name}}', change: parseFloat(change.toFixed(2))};
