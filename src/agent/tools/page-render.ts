import { BrowserWindow } from 'electron'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { normalizePath } from '../file-utils'

export class PageRenderTool implements Tool {
  name = 'PageRender'
  description = 'Render a specific page of a PDF as a PNG image for visual analysis.'
  isReadOnly = false
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      pdfPath: { type: 'string', description: 'Path to the PDF file' },
      page: { type: 'number', description: 'Page number (1-indexed)' },
      outputPath: { type: 'string', description: 'Output PNG path (under memory/)' },
      scale: { type: 'number', description: 'Scale factor (default 2.0)' },
    },
    required: ['pdfPath', 'page', 'outputPath'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.pdfPath) return 'pdfPath is required.'
    if (!input.page || Number(input.page) < 1) return 'page is required (1-indexed).'
    if (!input.outputPath) return 'outputPath is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pdfPath = normalizePath(String(input.pdfPath), ctx.basePath)
    const page = Number(input.page)
    const outputPath = normalizePath(String(input.outputPath), ctx.basePath)
    const scale = Number(input.scale ?? 2)

    if (!existsSync(pdfPath)) return toolError(`PDF not found: ${pdfPath}`)

    const width = Math.round(595 * scale)
    const height = Math.round(842 * scale)

    const win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: { offscreen: true },
    })

    try {
      await win.loadURL(`file://${pdfPath}#page=${page}`)
      await new Promise((r) => setTimeout(r, 2000))

      const image = await win.webContents.capturePage()
      const pngBuffer = image.toPNG()

      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, pngBuffer)

      return JSON.stringify({
        ok: true,
        content: `Page ${page} rendered to ${outputPath} (${width}x${height} pixels, ${(pngBuffer.length / 1024).toFixed(1)}KB). If the active default model has vision enabled, the next provider turn receives this image directly for visual analysis.`,
        path: outputPath,
        images: [{
          path: outputPath,
          mediaType: 'image/png',
          width,
          height,
          sizeBytes: pngBuffer.length,
        }],
      })
    } catch (e) {
      return toolError(`Render failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      win.destroy()
    }
  }
}
