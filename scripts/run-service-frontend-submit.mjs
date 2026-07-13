#!/usr/bin/env node
import { chromium } from '@playwright/test'

const args = parseArgs(process.argv.slice(2))
const endpoint = required(args.endpoint, '--endpoint is required')
const prompt = required(args.prompt, '--prompt is required')
const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap((context) => context.pages())
const page = pages.find((candidate) => candidate.url().startsWith('http')) ?? pages[0]
if (!page) throw new Error('No workstation renderer page is available over CDP')
const available = await page.evaluate(() => typeof window.agent?.send === 'function')
if (!available) throw new Error('The workstation renderer does not expose window.agent.send')
await page.evaluate((value) => window.agent.send(value), prompt)
process.stdout.write(`${JSON.stringify({ accepted: true, entry: 'frontend-ipc', page: page.url() })}\n`)
process.exit(0)

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    result[key.slice(2)] = argv[++index]
  }
  return result
}

function required(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value
}
