import { writeFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

export class ImageCropTool implements Tool {
  name = 'ImageCrop'
  description = 'Crop a rectangular region from an image file.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      inputPath: { type: 'string', description: 'Path to the source image' },
      outputPath: { type: 'string', description: 'Path for the cropped output' },
      x: { type: 'number', description: 'Left coordinate (pixels)' },
      y: { type: 'number', description: 'Top coordinate (pixels)' },
      width: { type: 'number', description: 'Crop width (pixels)' },
      height: { type: 'number', description: 'Crop height (pixels)' },
    },
    required: ['inputPath', 'outputPath', 'x', 'y', 'width', 'height'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.inputPath) return 'inputPath is required. Provide the path to the image to crop.'
    if (!input.outputPath) return 'outputPath is required. Provide the output file path.'
    if (input.x === undefined || input.y === undefined) return 'x and y (top-left corner) are required in pixels.'
    if (!input.width || !input.height) return 'width and height are required in pixels.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const inputPath = String(input.inputPath)
    if (!existsSync(inputPath)) return toolError(`file not found: ${inputPath}`)

    const { nativeImage } = require('electron')
    const imageBuffer = await readFile(inputPath)
    const image = nativeImage.createFromBuffer(imageBuffer)
    const size = image.getSize()

    const x = Number(input.x)
    const y = Number(input.y)
    const w = Number(input.width)
    const h = Number(input.height)

    if (x < 0 || y < 0 || x + w > size.width || y + h > size.height) {
      return toolError(`crop region (${x},${y},${w},${h}) exceeds image bounds (${size.width}x${size.height}). Coordinates are in pixels, origin (0,0) is top-left.`)
    }

    const cropped = image.crop({ x, y, width: w, height: h })
    const outputPath = String(input.outputPath)
    const png = cropped.toPNG()
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, png)

    return JSON.stringify({
      ok: true,
      content: `Cropped ${w}x${h} region from (${x},${y}) of ${size.width}x${size.height} image. Saved to ${outputPath} (${(png.length / 1024).toFixed(1)}KB).`,
      path: outputPath,
      images: [{
        path: outputPath,
        mediaType: 'image/png',
        width: w,
        height: h,
        sizeBytes: png.length,
      }],
    })
  }
}

export class ImageExtractTool implements Tool {
  name = 'ImageExtract'
  description = 'Read an image file and return its metadata (dimensions, size). For text extraction from images, use the LLM vision capability.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the image file' },
    },
    required: ['path'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.path) return 'path is required. Provide the path to the image file.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const path = String(input.path)
    if (!existsSync(path)) return toolError(`file not found: ${path}`)

    const { nativeImage } = require('electron')
    const buffer = await readFile(path)
    const image = nativeImage.createFromBuffer(buffer)
    const size = image.getSize()

    return `Image: ${path}\nDimensions: ${size.width}x${size.height} pixels\nSize: ${(buffer.length / 1024).toFixed(1)}KB\nFormat: ${path.endsWith('.png') ? 'PNG' : path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'JPEG' : 'unknown'}`
  }
}
