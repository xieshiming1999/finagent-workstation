import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { macroResearchExtract } from '../../src/agent/tools/macro-research-extraction'

const OUT_DIR = process.env.MACRO_RESEARCH_EXTRACT_OUT_DIR ??
  join(homedir(), '.finagent-workstation', 'manual-tests', 'macro-research')
const PROVIDERS = (process.env.MACRO_RESEARCH_EXTRACT_PROVIDERS ??
  'goldman_sachs,jpmorgan,blackrock,pimco,ubs,msci,ftse_russell_lseg,bea,eia,fred,bls,oecd,lme,iea,opec,cme')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

describe('manual macro research content extraction', () => {
  it('extracts allowed providers serially and records blocked/failed providers', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-macro-research-live-'))
    const store = new DataStore(basePath)
    await store.init()
    const report: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      providers: PROVIDERS,
      results: [],
    }

    try {
      for (const provider of PROVIDERS) {
        const started = Date.now()
        try {
          const parsed = JSON.parse(await macroResearchExtract(store, {
            provider,
            limit: 1,
            ...(process.env.MACRO_RESEARCH_EXTRACT_URL_INDEX ? { urlIndex: Number(process.env.MACRO_RESEARCH_EXTRACT_URL_INDEX) } : {}),
          }, basePath))
          const withFallback = await maybeBrowserFallback(store, provider, parsed, basePath)
          ;(report.results as Record<string, unknown>[]).push({
            provider,
            status: withFallback.status,
            extracted: withFallback.extracted,
            failed: withFallback.failed,
            fallback: withFallback.fallback,
            durationMs: Date.now() - started,
            rowFamilies: (withFallback.rows as Array<Record<string, unknown>>).map((row) => row.family),
            rowDetails: (withFallback.rows as Array<Record<string, unknown>>).map((row) => summarizeRow(row)),
            failures: withFallback.failures,
            contentHashes: (withFallback.rows as Array<Record<string, unknown>>)
              .map((row) => (row.macro_values as Record<string, unknown> | undefined)?.contentHash)
              .filter(Boolean),
          })
        } catch (error) {
          ;(report.results as Record<string, unknown>[]).push({
            provider,
            status: 'exception',
            extracted: 0,
            failed: 1,
            durationMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await sleep(Number(process.env.MACRO_RESEARCH_EXTRACT_DELAY_MS ?? 1000))
      }
    } finally {
      closeDb(basePath)
      rmSync(basePath, { recursive: true, force: true })
    }

    report.finishedAt = new Date().toISOString()
    const outFile = writeReport(report)
    console.log(JSON.stringify({ outFile, summary: summarize(report) }, null, 2))

    expect((report.results as unknown[]).length).toBe(PROVIDERS.length)
  }, 15 * 60_000)
})

function writeReport(report: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `macro-research-extraction-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8')
  return file
}

function summarize(report: Record<string, unknown>): Array<Record<string, unknown>> {
  return ((report.results as Array<Record<string, unknown>>) ?? []).map((row) => ({
    provider: row.provider,
    status: row.status,
    extracted: row.extracted,
    failed: row.failed,
    fallback: row.fallback,
    durationMs: row.durationMs,
    contentHashes: row.contentHashes,
    rowDetails: row.rowDetails,
    failures: row.failures,
    error: row.error,
  }))
}

function summarizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const values = row.macro_values as Record<string, unknown> | undefined
  const claims = Array.isArray(values?.keyClaims) ? values.keyClaims as Array<Record<string, unknown>> : []
  return {
    family: row.family,
    title: row.title,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    sourcePublishedAt: row.source_published_at,
    fetchedAt: row.fetched_at,
    status: row.status,
    failureClass: row.failure_class,
    contentHash: values?.contentHash,
    contentType: values?.contentType,
    bodyLength: values?.bodyLength,
    mentionedAssets: values?.mentionedAssets,
    mentionedRegions: values?.mentionedRegions,
    mentionedSectors: values?.mentionedSectors,
    keyClaims: claims.slice(0, 3).map((claim) => ({
      claim: String(claim.claim ?? '').slice(0, 280),
      claimCategory: claim.claimCategory,
      confidence: claim.confidence,
    })),
  }
}

async function maybeBrowserFallback(
  store: DataStore,
  provider: string,
  parsed: Record<string, unknown>,
  basePath: string,
): Promise<Record<string, unknown>> {
  if (parsed.status !== 'failed' || !['oecd', 'lme', 'ubs'].includes(provider)) return parsed
  const html = await fetchWithBrowser(provider)
  if (!html || html.length < 500) return parsed
  const retried = JSON.parse(await macroResearchExtract(store, {
    provider,
    content: html,
    contentType: 'html',
    limit: 1,
  }, basePath))
  return { ...retried, fallback: 'playwright-browser-html' }
}

async function fetchWithBrowser(provider: string): Promise<string | null> {
  const urlByProvider: Record<string, string> = {
    oecd: 'https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html',
    lme: 'https://www.lme.com/market-data/reports-and-data/warehouse-and-stocks-reports',
    ubs: 'https://www.ubs.com/us/en/wealth-management/year-ahead.html',
  }
  const url = urlByProvider[provider]
  if (!url) return null
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!response || response.status() >= 400) return null
    return await page.content()
  } catch {
    return null
  } finally {
    await browser.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
