// Monitor Template: volume_surge
// Params: ts_code (e.g. "600519"), name, multiplier
// Uses FinAgent Workstation local finance quote route plus state for previous volume.
var zh = (navigator.language || '').toLowerCase().indexOf('zh') === 0;
var code = '{{ts_code}}'.replace(/\.\w+$/, '');
var resp = callService('/api/finance/quote', {code: code});
var rows = resp.data || [];
var row = rows[0] || null;
if (!row) return {value: '--', label: zh ? '{{name}} 量能' : '{{name}} Volume'};

var todayVol = parseFloat(row.volume || row['成交量'] || 0);
var price = parseFloat(row.price || row['最新价'] || 0);
var change = parseFloat(row.changePct || row['涨跌幅'] || 0);

var prevVol = state.lastVol || todayVol;
var ratio = prevVol > 0 ? (todayVol / prevVol) : 0;
state.lastVol = todayVol;

var multiplier = {{multiplier}};
if (ratio >= multiplier && state.lastVol) {
  Bridge.alert(zh
    ? '{{name}} 成交量放大 ' + ratio.toFixed(1) + ' 倍（阈值 ' + multiplier + ' 倍），价格 ' + price.toFixed(2)
    : '{{name}} volume expanded to ' + ratio.toFixed(1) + 'x (threshold ' + multiplier + 'x), price ' + price.toFixed(2));
}

return {value: price, label: '{{name}}', change: parseFloat(change.toFixed(2)), unit: ''};
