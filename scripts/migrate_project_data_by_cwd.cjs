#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const os = require('os')

function projectDirForCwd(cwd) {
  const parts = cwd
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(sanitizeProjectPathSegment)
    .filter(Boolean)
  return path.join('by-cwd', ...(parts.length > 0 ? parts : ['root']))
}

function sanitizeProjectPathSegment(segment) {
  const sanitized = segment
    .normalize('NFC')
    .replace(/[\\/:\0-\x1F\x7F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return sanitized || '_'
}

function dashSanitizeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9_.-]/g, '-')
}

function legacyDashSanitizeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function usage() {
  console.log(`Usage:
  node finagent_workstation/scripts/migrate_project_data_by_cwd.cjs [cwd] [--move|--copy] [--link-legacy] [--dry-run]

Defaults:
  cwd: current working directory
  operation: --copy
  global base: ~/.finagent-workstation
`)
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  usage()
  process.exit(0)
}

const explicitCwd = args.find((arg) => !arg.startsWith('--'))
const cwd = path.resolve(explicitCwd || process.cwd())
const dryRun = args.includes('--dry-run')
const move = args.includes('--move')
const linkLegacy = args.includes('--link-legacy')
const globalBase = path.join(os.homedir(), '.finagent-workstation')
const projectsDir = path.join(globalBase, 'projects')
const target = path.join(projectsDir, projectDirForCwd(cwd))
const legacyCandidates = Array.from(new Set([
  dashSanitizeCwd(cwd),
  legacyDashSanitizeCwd(cwd),
]))
  .map((dir) => path.join(projectsDir, dir))
  .filter((p) => p !== target)
const existingLegacy = legacyCandidates.find((p) => fs.existsSync(p))

console.log(`cwd: ${cwd}`)
console.log(`target: ${target}`)
console.log(`legacy candidates:`)
for (const p of legacyCandidates) console.log(`  - ${p}${fs.existsSync(p) ? ' [exists]' : ''}`)

if (!existingLegacy) {
  console.log('No legacy project data directory found. Nothing to migrate.')
  process.exit(0)
}

if (fs.existsSync(target)) {
  console.error(`Target already exists. Refusing to overwrite: ${target}`)
  process.exit(1)
}

if (dryRun) {
  console.log(move ? `Would move ${existingLegacy} -> ${target}` : `Would copy ${existingLegacy} -> ${target}`)
  if (linkLegacy) console.log(`Would symlink legacy path back to ${target}`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(target), { recursive: true })
if (move) {
  fs.renameSync(existingLegacy, target)
} else {
  fs.cpSync(existingLegacy, target, { recursive: true, dereference: false, errorOnExist: true })
}

if (linkLegacy && move) {
  fs.symlinkSync(target, existingLegacy, 'dir')
}

console.log(move ? 'Migration moved successfully.' : 'Migration copied successfully.')
