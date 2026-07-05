#!/usr/bin/env node
const { mkdtempSync, writeFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawn } = require('child_process')

const repoRoot = resolve(__dirname, '..')
const electronBin = require('electron')
const preloadPath = resolve(repoRoot, process.argv[2] || 'src/preload/webview-preload.cjs')
const tmp = mkdtempSync(join(tmpdir(), 'finagent-workstation-webview-preload-'))

const guestHtml = join(tmp, 'guest.html')
const hostHtml = join(tmp, 'host.html')
const mainJs = join(tmp, 'main.cjs')

writeFileSync(guestHtml, `<!doctype html>
<html>
<head><meta charset="utf-8"><title>guest</title></head>
<body>guest</body>
</html>
`)

writeFileSync(hostHtml, `<!doctype html>
<html>
<head><meta charset="utf-8"><title>host</title></head>
<body>
<webview id="wv" src="${fileUrl(guestHtml)}" preload="${preloadPath}" style="width:400px;height:300px"></webview>
<script>
const { ipcRenderer } = require('electron')
const wv = document.getElementById('wv')
const events = []
function send(result) {
  ipcRenderer.send('result', result)
}
wv.addEventListener('console-message', (event) => {
  events.push({
    event: 'console-message',
    level: event.level,
    message: String(event.message || ''),
    sourceId: event.sourceId,
    line: event.line,
  })
})
wv.addEventListener('did-fail-load', (event) => {
  events.push({
    event: 'did-fail-load',
    errorCode: event.errorCode,
    errorDescription: event.errorDescription,
    validatedURL: event.validatedURL,
  })
})
wv.addEventListener('did-finish-load', async () => {
  try {
    const bridge = await wv.executeJavaScript('typeof Bridge')
    const sendToAgent = await wv.executeJavaScript('typeof Bridge !== "undefined" && typeof Bridge.sendToAgent')
    send({ ok: bridge === 'object' && sendToAgent === 'function', bridge, sendToAgent, events })
  } catch (error) {
    send({ ok: false, error: String(error), events })
  }
})
setTimeout(() => send({ ok: false, error: 'timeout', events }), 8000)
</script>
</body>
</html>
`)

writeFileSync(mainJs, `const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
app.commandLine.appendSwitch('disable-gpu')
app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  })
  ipcMain.once('result', (_, result) => {
    console.log(JSON.stringify(result))
    app.exit(result && result.ok ? 0 : 1)
  })
  win.loadFile(${JSON.stringify(hostHtml)})
})
`)

const child = spawn(electronBin, [mainJs], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })
child.on('exit', (code) => {
  rmSync(tmp, { recursive: true, force: true })
  if (stdout.trim()) process.stdout.write(stdout)
  if (stderr.trim()) process.stderr.write(stderr)
  process.exit(code ?? 1)
})

function fileUrl(path) {
  return `file://${path}`
}
