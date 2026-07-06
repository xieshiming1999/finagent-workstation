import { describe, expect, it } from 'vitest'
import { createSessionPreviewController, type SessionPreviewPatch } from '../../src/renderer/components/session-preview-controller'

interface Entry {
  path: string
  title: string
}

describe('session preview controller', () => {
  it('keeps the latest selected session preview when older preview resolves later', async () => {
    const first = deferred({ title: 'old preview', messages: [] })
    const second = deferred({ title: 'latest preview', messages: [] })
    const patches: Array<SessionPreviewPatch<Entry>> = []
    const controller = createSessionPreviewController<Entry>(
      (session) => session.path === 'first' ? first.promise : second.promise,
      (patch) => patches.push(patch),
    )

    const firstResult = controller.select({ path: 'first', title: 'first' })
    const secondResult = controller.select({ path: 'second', title: 'second' })
    second.resolve()
    first.resolve()

    await expect(secondResult).resolves.toEqual({ applied: true })
    await expect(firstResult).resolves.toEqual({ applied: false })
    expect(patches).toContainEqual({ selected: { path: 'first', title: 'first' }, loadingPreview: true })
    expect(patches).toContainEqual({ selected: { path: 'second', title: 'second' }, loadingPreview: true })
    expect(patches.at(-1)).toEqual({ preview: { title: 'latest preview', messages: [] }, loadingPreview: false })
    expect(patches.some((patch) => patch.preview?.title === 'old preview')).toBe(false)
  })

  it('does not let stale preview errors replace the latest preview', async () => {
    const first = deferred({ title: 'unused', messages: [] })
    const second = deferred({ title: 'selected preview', messages: [] })
    const patches: Array<SessionPreviewPatch<Entry>> = []
    const controller = createSessionPreviewController<Entry>(
      (session) => session.path === 'first' ? first.promise : second.promise,
      (patch) => patches.push(patch),
    )

    const firstResult = controller.select({ path: 'first', title: 'first' })
    const secondResult = controller.select({ path: 'second', title: 'second' })
    first.reject(new Error('stale read failed'))
    second.resolve()

    await expect(firstResult).resolves.toEqual({ applied: false })
    await expect(secondResult).resolves.toEqual({ applied: true })
    expect(patches.at(-1)).toEqual({ preview: { title: 'selected preview', messages: [] }, loadingPreview: false })
    expect(patches.some((patch) => patch.preview?.error === 'stale read failed')).toBe(false)
  })
})

function deferred<T>(value: T): {
  promise: Promise<T>
  resolve: () => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve: () => resolve(value),
    reject,
  }
}
