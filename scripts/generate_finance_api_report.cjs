#!/usr/bin/env node

const fs = require('fs')
const { basename, join, resolve } = require('path')

const inputArg = process.argv[2]
if (!inputArg) {
  console.error('Usage: node scripts/generate_finance_api_report.cjs <probe-json> [output-html]')
  process.exit(1)
}

const input = resolve(inputArg)
const report = JSON.parse(fs.readFileSync(input, 'utf8'))
const probes = report.probes || []
const defaultOutDir = join(process.cwd(), 'reports', 'finance-api')
const output = process.argv[3]
  ? resolve(process.argv[3])
  : join(defaultOutDir, basename(input).replace(/\.json$/, '.html'))

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function classify(p) {
  if (p.ok) {
    return {
      label: 'OK',
      detail: p.rowCount > 0
        ? 'Request succeeded and returned rows.'
        : 'Request succeeded but returned no rows for the tested date/parameters.',
    }
  }
  const err = String(p.error || '')
  if (/unexpected keyword argument/i.test(err)) {
    return { label: 'Invalid parameters', detail: 'AkShare function signature does not accept one of the supplied parameters.' }
  }
  if (/aborted due to timeout|timeout|timed out/i.test(err)) {
    return { label: 'Timeout', detail: 'The request exceeded the configured probe timeout. For sidecar calls this can include sidecar limiter wait plus upstream time.' }
  }
  if (/ProxyError|RemoteDisconnected|Max retries exceeded|HTTPSConnectionPool/i.test(err)) {
    return { label: 'Network/proxy upstream failure', detail: 'The upstream EastMoney/AkShare HTTP path failed through the current network/proxy.' }
  }
  if (/fetch failed/i.test(err)) {
    return { label: 'Direct fetch failed', detail: 'Node fetch could not complete the direct HTTP request, commonly DNS/proxy/TLS/network path failure.' }
  }
  if (Number(p.status) >= 500) return { label: 'Upstream/server error', detail: 'The local sidecar returned a 5xx error from the upstream call.' }
  if (Number(p.status) >= 400) return { label: 'Bad request/API contract', detail: 'The request was rejected by the local sidecar or upstream API.' }
  return { label: 'Unknown failure', detail: err || 'No failure detail was recorded.' }
}

const ok = probes.filter((p) => p.ok).length
const failed = probes.length - ok
const byCause = new Map()
const groups = [...new Set(probes.map((p) => p.group))]
for (const p of probes) {
  const label = classify(p).label
  byCause.set(label, (byCause.get(label) || 0) + 1)
}

const groupCards = groups.map((group) => {
  const items = probes.filter((p) => p.group === group)
  const okCount = items.filter((p) => p.ok).length
  return `<div class="card"><div class="card-title">${esc(group)}</div><div><b>${okCount}</b> OK / <b>${items.length - okCount}</b> failed</div></div>`
}).join('\n')

const causeRows = [...byCause.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([cause, count]) => `<tr><td>${esc(cause)}</td><td class="num">${count}</td></tr>`)
  .join('\n')

const rows = probes.map((p, i) => {
  const cause = classify(p)
  const statusClass = p.ok ? 'ok' : 'fail'
  const columns = Array.isArray(p.columns) ? p.columns.slice(0, 10).join(', ') : ''
  const schema = p.schema && Object.keys(p.schema).length ? JSON.stringify(p.schema, null, 2) : ''
  const sample = p.sample != null ? JSON.stringify(p.sample, null, 2).slice(0, 2000) : ''
  return `<tr class="${statusClass}">
    <td>${i + 1}</td>
    <td><div class="id">${esc(p.id)}</div><div class="muted">${esc(p.description)}</div></td>
    <td>${esc(p.group)}</td>
    <td>${esc(p.kind)}</td>
    <td><span class="pill ${statusClass}">${p.ok ? 'OK' : 'FAIL'}</span><div class="muted">HTTP ${esc(p.status)}</div></td>
    <td class="num">${esc(p.durationMs)} ms</td>
    <td class="num">${esc(p.rowCount)}</td>
    <td><strong>${esc(cause.label)}</strong><div class="muted">${esc(cause.detail)}</div></td>
    <td><code>${esc(p.error || '')}</code></td>
    <td><code>${esc(p.url || '')}</code></td>
    <td><details><summary>schema/sample</summary><div class="muted">columns: ${esc(columns)}</div><pre>${esc(schema || sample || 'No schema/sample recorded')}</pre></details></td>
  </tr>`
}).join('\n')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FinAgent Workstation Finance API Probe Report</title>
<style>
  :root { color-scheme: dark; --bg:#101318; --panel:#171c23; --line:#29313b; --text:#e8edf2; --muted:#99a6b3; --ok:#31c48d; --fail:#f87171; }
  body { margin:0; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
  header { padding:28px 32px 18px; border-bottom:1px solid var(--line); background:#121720; }
  h1 { margin:0 0 8px; font-size:24px; letter-spacing:0; }
  .meta { color:var(--muted); display:flex; flex-wrap:wrap; gap:14px; }
  main { padding:22px 32px 40px; }
  .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .card-title { color:var(--muted); margin-bottom:6px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); }
  th, td { border-bottom:1px solid var(--line); padding:10px; vertical-align:top; text-align:left; }
  th { position:sticky; top:0; background:#1c232c; z-index:1; font-weight:600; }
  tr.fail { background:rgba(248,113,113,0.04); }
  tr.ok { background:rgba(49,196,141,0.035); }
  .pill { display:inline-block; min-width:46px; text-align:center; border-radius:999px; padding:2px 8px; font-weight:700; font-size:12px; }
  .pill.ok { background:rgba(49,196,141,0.16); color:var(--ok); }
  .pill.fail { background:rgba(248,113,113,0.16); color:var(--fail); }
  .muted { color:var(--muted); font-size:12px; margin-top:3px; }
  .id { font-weight:650; }
  .num { text-align:right; white-space:nowrap; }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; color:#cbd5e1; }
  details { max-width:360px; }
  .section-title { margin:24px 0 10px; font-size:17px; }
</style>
</head>
<body>
<header>
  <h1>FinAgent Workstation Finance API Probe Report</h1>
  <div class="meta">
    <span>Source JSON: ${esc(input)}</span>
    <span>Started: ${esc(report.startedAt)}</span>
    <span>Finished: ${esc(report.finishedAt)}</span>
    <span>Sidecar: ${esc(report.sidecarUrl)}</span>
    <span>Timeout: ${esc(report.timeoutMs)} ms</span>
    <span>Delay: ${esc(report.delayMs)} ms</span>
    <span>Broad probes included: ${esc(report.includeBroad)}</span>
    <span>Broad probes skipped: ${esc(report.broadProbeCountSkipped)}</span>
  </div>
</header>
<main>
  <section class="summary">
    <div class="card"><div class="card-title">Total Requests</div><div><b>${probes.length}</b></div></div>
    <div class="card"><div class="card-title">Succeeded</div><div><b style="color:var(--ok)">${ok}</b></div></div>
    <div class="card"><div class="card-title">Failed</div><div><b style="color:var(--fail)">${failed}</b></div></div>
  </section>
  <div class="summary">${groupCards}</div>
  <h2 class="section-title">Failure Cause Summary</h2>
  <table style="max-width:620px"><thead><tr><th>Cause</th><th>Count</th></tr></thead><tbody>${causeRows}</tbody></table>
  <h2 class="section-title">Request Details</h2>
  <table>
    <thead><tr><th>#</th><th>Request</th><th>Group</th><th>Kind</th><th>Status</th><th>Duration</th><th>Rows</th><th>Cause</th><th>Error</th><th>URL</th><th>Schema</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>`

fs.mkdirSync(output.substring(0, output.lastIndexOf('/')), { recursive: true })
fs.writeFileSync(output, html, 'utf8')
console.log(output)
