import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { normalizeMessages } from '../../src/agent/anthropic-message'
import { Role, assistantMessage, toolMessage, userMessage } from '../../src/agent/message'

describe('anthropic message conversion', () => {
  it('converts recent tool result image paths into Anthropic image blocks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fin-img-'))
    const imagePath = join(dir, 'screen.png')
    writeFileSync(imagePath, Buffer.from('fake-png-bytes'))

    const messages = [
      userMessage('capture the page'),
      assistantMessage('', [{ id: 'tc-img', name: 'WebView', input: { action: 'screenshot', id: 'page' } }]),
      toolMessage('tc-img', `Screenshot captured: ${imagePath}`, false, {
        imagePaths: [imagePath],
        imageMetadata: [{ path: imagePath, mediaType: 'image/png', width: 10, height: 20, sizeBytes: 14 }],
      }),
    ]

    const normalized = normalizeMessages(messages, undefined, { includeToolResultImages: true })
    const toolResult = normalized[2].content.find((block) => block.type === 'tool_result') as any

    expect(Array.isArray(toolResult.content)).toBe(true)
    expect(toolResult.content[0].type).toBe('image')
    expect(toolResult.content[0].source.media_type).toBe('image/png')
    expect(toolResult.content[0].source.data).toBe(Buffer.from('fake-png-bytes').toString('base64'))
    expect(toolResult.content[1]).toEqual({ type: 'text', text: `Screenshot captured: ${imagePath}` })
  })

  it('keeps older tool result images as text-only to control prompt size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fin-img-'))
    const oldPath = join(dir, 'old.png')
    writeFileSync(oldPath, Buffer.from('old-image'))
    const messages = [userMessage('many captures')]

    for (let i = 0; i < 4; i++) {
      const id = `tc-${i}`
      const path = i === 0 ? oldPath : join(dir, `screen-${i}.png`)
      writeFileSync(path, Buffer.from(`image-${i}`))
      messages.push({
        role: Role.Assistant,
        content: '',
        toolUses: [{ id, name: 'Screenshot', input: { html: '<html></html>' } }],
      })
      messages.push(toolMessage(id, `Screenshot ${i}: ${path}`, false, {
        imagePaths: [path],
        imageMetadata: [{ path, mediaType: 'image/png' }],
      }))
    }

    const normalized = normalizeMessages(messages, undefined, { includeToolResultImages: true })
    const firstToolResult = normalized
      .flatMap((msg) => msg.content)
      .find((block) => block.type === 'tool_result' && block.tool_use_id === 'tc-0') as any

    expect(firstToolResult.content).toBe(`Screenshot 0: ${oldPath}`)
  })

  it('does not include tool result image blocks when model vision capability is disabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fin-img-'))
    const imagePath = join(dir, 'screen.png')
    writeFileSync(imagePath, Buffer.from('fake-png-bytes'))

    const messages = [
      userMessage('capture the page'),
      assistantMessage('', [{ id: 'tc-img', name: 'WebView', input: { action: 'screenshot', id: 'page' } }]),
      toolMessage('tc-img', `Screenshot captured: ${imagePath}`, false, {
        imagePaths: [imagePath],
        imageMetadata: [{ path: imagePath, mediaType: 'image/png' }],
      }),
    ]

    const normalized = normalizeMessages(messages, undefined, { includeToolResultImages: false })
    const toolResult = normalized[2].content.find((block) => block.type === 'tool_result') as any

    expect(toolResult.content).toBe(`Screenshot captured: ${imagePath}`)
  })
})
