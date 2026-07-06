#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-~/.finagent/device_backup_20260528_111709/app_flutter/agents}"
DEST="${2:-$HOME/.finagent-workstation}"
FINAGENT_WORKSTATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$FINAGENT_WORKSTATION_DIR/.." && pwd)"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -d "$SRC" ]]; then
  echo "Source agents directory not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DEST"

node - "$SRC" "$DEST" "$REPO_ROOT" "$DRY_RUN" <<'NODE'
const fs = require('fs')
const path = require('path')

const [src, dest, repoRoot, dryRun] = process.argv.slice(2)

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`)
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function sanitizeCwd(cwd) {
  const parts = cwd
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => {
      const sanitized = part
        .normalize('NFC')
        .replace(/[\\/:\0-\x1F\x7F]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
      return sanitized || '_'
    })
  return path.join('by-cwd', ...(parts.length > 0 ? parts : ['root']))
}

function backupFile(file) {
  if (!fs.existsSync(file) || dryRun === '1') return null
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')
  const backup = `${file}.bak_${stamp}`
  fs.copyFileSync(file, backup)
  return backup
}

function toElectronModel(provider, index) {
  const schema = String(provider.schema || 'openai').toLowerCase()
  const model = String(provider.model || '').trim()
  const name = provider.name || model || provider.id || `model-${index + 1}`
  const extras = provider.extras && typeof provider.extras === 'object' ? provider.extras : {}
  const extraHeaders = {}
  for (const [key, value] of Object.entries(extras)) {
    if (key.toLowerCase().startsWith('header:')) {
      extraHeaders[key.slice('header:'.length)] = String(value)
    }
  }
  const out = {
    id: String(provider.id || `mobile-${index + 1}`),
    name,
    provider: schema === 'anthropic' ? 'anthropic' : 'openai',
    baseURL: String(provider.url || ''),
    apiKey: String(provider.key || ''),
    model,
    maxTokens: Number(provider.maxOutputTokens || 8192),
    contextWindow: Number(provider.maxContextLength || 160000),
    compactThreshold: Number(provider.compactThreshold || 0.85),
    isDefault: index === 0,
  }

  if (provider.endpoint) out.endpoint = String(provider.endpoint)
  if (Object.keys(extraHeaders).length > 0) out.extraHeaders = extraHeaders
  if (extras.effort && ['low', 'medium', 'high'].includes(String(extras.effort))) out.effort = String(extras.effort)
  return out
}

const configPath = path.join(dest, 'config.json')
const existing = readJson(configPath, {})

const mobileLlm = readJson(path.join(src, 'llm_config.json'), { providers: [] })
const enabledProviders = Array.isArray(mobileLlm.providers)
  ? mobileLlm.providers.filter((p) => p && p.enabled !== false)
  : []
const models = enabledProviders.length > 0
  ? enabledProviders.map(toElectronModel)
  : (Array.isArray(existing.models) ? existing.models : [])

const mobileApiKeys = readJson(path.join(src, 'api_config.json'), {})
const tdxServersRaw = readJson(path.join(src, 'finance', 'memory', '.tdx_servers.json'), null)
const tdxServers = Array.isArray(tdxServersRaw)
  ? tdxServersRaw
      .filter((s) => s && s.host && s.port)
      .map((s) => ({ host: String(s.host), port: Number(s.port), name: String(s.name || '') }))
  : (Array.isArray(existing.tdxServers) ? existing.tdxServers : [])

const merged = {
  models,
  agentDepthLimit: existing.agentDepthLimit ?? 0,
  toolTimeout: existing.toolTimeout ?? 120000,
  systemPrompt: existing.systemPrompt ?? '',
  workspacePath: existing.workspacePath ?? '',
  autoSaveSession: existing.autoSaveSession ?? true,
  apiKeys: {
    ...(existing.apiKeys || {}),
    ...mobileApiKeys,
  },
  tdxServers,
}

const calendar = readJson(path.join(src, 'trading_calendar.json'), null)
const calendarTargets = []
if (calendar) {
  calendarTargets.push(path.join(dest, 'trading_calendar.json'))
  for (const cwd of [repoRoot, path.join(repoRoot, 'finagent_workstation')]) {
    calendarTargets.push(path.join(dest, 'projects', sanitizeCwd(cwd), 'trading_calendar.json'))
  }
}

console.log(`Source: ${src}`)
console.log(`Destination: ${dest}`)
console.log(`Models to write: ${models.length}`)
console.log(`API key names to write: ${Object.keys(merged.apiKeys).sort().join(', ') || '(none)'}`)
console.log(`TDX servers to write: ${tdxServers.length}`)
console.log(`Trading calendar targets: ${calendarTargets.length}`)

if (dryRun === '1') {
  console.log('DRY_RUN=1, no files written.')
  process.exit(0)
}

const backup = backupFile(configPath)
writeJson(configPath, merged)
for (const target of calendarTargets) writeJson(target, calendar)

if (backup) console.log(`Backed up previous config: ${backup}`)
console.log(`Wrote Electron config: ${configPath}`)
for (const target of calendarTargets) console.log(`Wrote trading calendar: ${target}`)
NODE
