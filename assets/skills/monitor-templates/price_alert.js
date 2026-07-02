// Monitor Template: price_alert
// Params: ts_code (e.g. "600519"), name, upper, lower
// Uses FinAgent Workstation local finance quote route.
var zh = (navigator.language || '').toLowerCase().indexOf('zh') === 0;
var code = '{{ts_code}}'.replace(/\.\w+$/, '');
var resp = callService('/api/finance/quote', {code: code});
var rows = resp.data || [];
var row = rows[0] || null;
if (!row) return {value: '--', label: '{{name}}', change: 0};

var price = parseFloat(row.price || row['最新价'] || 0);
var change = parseFloat(row.changePct || row['涨跌幅'] || 0);

var upper = {{upper}};
var lower = {{lower}};
if (upper && price >= upper) {
  Bridge.alert(zh
    ? '{{name}} 突破上限 ' + upper + '，当前价格 ' + price.toFixed(2)
    : '{{name}} broke above the upper limit ' + upper + '; current price ' + price.toFixed(2));
}
if (lower && price <= lower) {
  Bridge.alert(zh
    ? '{{name}} 跌破下限 ' + lower + '，当前价格 ' + price.toFixed(2)
    : '{{name}} fell below the lower limit ' + lower + '; current price ' + price.toFixed(2));
}

if (!state.series) state.series = [];
state.series.push(price);
if (state.series.length > 60) state.series = state.series.slice(-60);

return {value: price, label: '{{name}}', change: parseFloat(change.toFixed(2)), unit: ''};
