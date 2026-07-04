export interface SessionPreviewEntry {
  path: string
}

export interface SessionPreviewMessage {
  role: string
  content: string
  toolName?: string
  isError?: boolean
  timestamp?: string
}

export interface SessionPreview {
  title?: string | null
  createdAt?: string | null
  messages?: SessionPreviewMessage[]
  error?: string
}

export interface SessionPreviewPatch<TEntry extends SessionPreviewEntry> {
  selected?: TEntry | null
  preview?: SessionPreview | null
  loadingPreview?: boolean
}

export function createSessionPreviewController<TEntry extends SessionPreviewEntry>(
  loadPreview: (session: TEntry) => Promise<SessionPreview | undefined>,
  apply: (patch: SessionPreviewPatch<TEntry>) => void,
): { select: (session: TEntry) => Promise<{ applied: boolean }> } {
  let latestRequest = 0

  return {
    async select(session: TEntry): Promise<{ applied: boolean }> {
      const requestId = ++latestRequest
      apply({ selected: session, loadingPreview: true })
      try {
        const result = await loadPreview(session)
        if (requestId !== latestRequest) return { applied: false }
        apply({ preview: result ?? null, loadingPreview: false })
        return { applied: true }
      } catch (error) {
        if (requestId !== latestRequest) return { applied: false }
        apply({
          preview: { error: error instanceof Error ? error.message : String(error) },
          loadingPreview: false,
        })
        return { applied: true }
      }
    },
  }
}
