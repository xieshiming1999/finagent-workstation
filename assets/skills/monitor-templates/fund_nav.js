// Monitor Template: fund_nav
// Params: ts_code (e.g. "110011"), name, upper, lower
// Uses FinAgent Workstation local fund NAV requirement route.
var zh = (navigator.language || '').toLowerCase().indexOf('zh') === 0;
var code = '{{ts_code}}'.replace(/\.\w+$/, '');
var resp = callService('/api/finance/fund/nav', {code: code, _priority: 'background'});
var rows = resp.data || resp;
if (!rows || rows.length === 0) return {value: '--', label: '{{name}}', change: 0};

var latest = rows[rows.length - 1];
var nav = parseFloat(latest['单位净值'] || latest['y'] || 0);
var prevNav = state.lastNav || nav;
var change = prevNav > 0 ? ((nav - prevNav) / prevNav * 100) : 0;
state.lastNav = nav;

var upper = {{upper}};
var lower = {{lower}};
if (upper && nav >= upper) {
  Bridge.alert(zh
    ? '{{name}} 净值突破 ' + upper + '，当前 ' + nav.toFixed(4)
    : '{{name}} NAV broke above ' + upper + '; current NAV ' + nav.toFixed(4));
}
if (lower && nav <= lower) {
  Bridge.alert(zh
    ? '{{name}} 净值跌破 ' + lower + '，当前 ' + nav.toFixed(4)
    : '{{name}} NAV fell below ' + lower + '; current NAV ' + nav.toFixed(4));
}

if (!state.series) state.series = [];
state.series.push(nav);
if (state.series.length > 60) state.series = state.series.slice(-60);

return {value: nav, label: '{{name}}', change: parseFloat(change.toFixed(2))};
