import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { ArtifactRegistry } from '../artifact-registry'

export class ReportDownloadTool implements Tool {
  name = 'ReportDownload'
  description = 'Download a financial report PDF from a direct URL. Auto-search by code is not implemented.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Direct URL to the PDF report' },
      code: { type: 'string', description: 'Stock code (for auto-search)' },
      year: { type: 'string', description: 'Report year (e.g., 2024)' },
      type: { type: 'string', description: 'Report type: annual, semi, q1, q3' },
      outputPath: { type: 'string', description: 'Output file path (default: auto)' },
    },
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.url && !input.code) return 'Either url (direct PDF link) or code (stock code for auto-search) is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const url = input.url ? String(input.url) : null

    if (!url) {
      return toolError('direct URL required for now. Example: ReportDownload(url: "https://...pdf")')
    }

    const reportsDir = join(ctx.basePath, 'reports')
    await mkdir(reportsDir, { recursive: true })

    const filename = input.outputPath ? String(input.outputPath) : join(reportsDir, `report-${Date.now()}.pdf`)
    await mkdir(dirname(filename), { recursive: true })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: controller.signal,
      })
      if (!res.ok) return toolError(`HTTP ${res.status} downloading ${url}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      await writeFile(filename, buffer)
      new ArtifactRegistry(ctx.basePath).register({
        kind: 'report',
        path: filename,
        title: String(input.type ?? 'Financial report PDF'),
        source: 'ReportDownload',
        id: `report:${filename}`,
        ownerTask: input.code ? String(input.code) : 'report-download',
        verificationStatus: 'verified',
        freshness: {
          fetchedAt: new Date().toISOString(),
          status: 'fresh',
        },
        provenance: {
          source: 'ReportDownload',
          url,
          httpStatus: res.status,
        },
        metadata: {
          url,
          code: input.code ?? null,
          year: input.year ?? null,
          reportType: input.type ?? null,
          sizeBytes: buffer.length,
          outputPath: filename,
        },
      })
      return `Downloaded ${(buffer.length / 1024).toFixed(0)}KB to ${filename}. Use PageRender for visual page inspection, or ReportParse to get explicit text-extraction guidance.`
    } catch (err) {
      return toolError(`download failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class ReportParseTool implements Tool {
  name = 'ReportParse'
  description = 'Check a PDF path and return text-extraction guidance. Full PDF text extraction requires an external parser such as pdftotext, pdf-parse, or pdfjs-dist.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the PDF file' },
      pages: { type: 'string', description: 'Page range (e.g., "1-5", default: all)' },
    },
    required: ['path'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.path) return 'path is required. Provide the path to the PDF file.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const path = String(input.path)
    if (!existsSync(path)) return toolError(`file not found: ${path}`)
    return `PDF parsing requires pdf-parse or pdfjs-dist. File exists at ${path} (use Bash: "pdftotext ${path} -" for text extraction, or PageRender for image rendering).`
  }
}
