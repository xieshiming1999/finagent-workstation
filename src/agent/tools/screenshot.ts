import { BrowserWindow } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

export class ScreenshotTool implements Tool {
  name = 'Screenshot'
  description = 'Render HTML to a PNG image using an off-screen browser window. Supports ECharts, CSS animations, and any web content. Returns the saved file path.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'HTML content to render' },
      url: { type: 'string', description: 'URL to screenshot (alternative to html)' },
      width: { type: 'number', description: 'Viewport width (default: 1200)' },
      height: { type: 'number', description: 'Viewport height (default: 800)' },
      waitMs: { type: 'number', description: 'Wait time after load for rendering (default: 1000ms, increase for charts)' },
      outputPath: { type: 'string', description: 'Output file path (default: auto-generated in basePath/screenshots/)' },
    },
  }


  validateInput(input: Record<string, unknown>): string | null {
    if (!input.html && !input.url) return 'Either html or url is required. Provide HTML content to render or a URL to screenshot.'
    return null
  }

    async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const html = input.html ? String(input.html) : undefined
    const url = input.url ? String(input.url) : undefined
    if (!html && !url) return toolError('Either html or url is required')

    const width = Number(input.width ?? 1200)
    const height = Number(input.height ?? 800)
    const waitMs = Number(input.waitMs ?? 1000)

    const screenshotsDir = join(ctx.basePath, 'screenshots')
    await mkdir(screenshotsDir, { recursive: true })
    const outputPath = input.outputPath
      ? String(input.outputPath)
      : join(screenshotsDir, `screenshot-${Date.now()}.png`)

    await mkdir(dirname(outputPath), { recursive: true })

    const win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: { offscreen: true },
    })

    try {
      if (html) {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      } else {
        await win.loadURL(url!)
      }

      await new Promise((r) => setTimeout(r, waitMs))

      const image = await win.webContents.capturePage()
      const pngBuffer = image.toPNG()
      await writeFile(outputPath, pngBuffer)

      return JSON.stringify({
        ok: true,
        content: `Screenshot saved: ${outputPath} (${width}x${height}, ${(pngBuffer.length / 1024).toFixed(1)}KB).`,
        path: outputPath,
        images: [{
          path: outputPath,
          mediaType: 'image/png',
          width,
          height,
          sizeBytes: pngBuffer.length,
        }],
      })
    } finally {
      win.destroy()
    }
  }
}
