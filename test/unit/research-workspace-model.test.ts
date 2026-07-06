import { describe, expect, it } from 'vitest'
import {
  buildResearchWorkspaceSummary,
  citationUrl,
  evidencePreview,
  primaryHypothesis,
  type ResearchWorkspaceArtifact,
} from '../../src/renderer/components/research-workspace-model'

describe('research workspace model', () => {
  it('summarizes artifacts, citations, drafts, and unverified items', () => {
    const rows: ResearchWorkspaceArtifact[] = [{
      id: 'research:1',
      title: 'news: 600519',
      path: '/tmp/research.json',
      source: 'EastMoney',
      updatedAt: '2026-06-17T01:00:00.000Z',
      metadata: { action: 'news', citations: 1 },
      payload: {
        hypotheses: ['Moutai demand may be stabilizing'],
        evidence: [{ title: 'Broker note', content: 'Channel inventory improved', url: 'https://example.test/a' }],
        citations: [{ title: 'Broker note', url: 'https://example.test/a', source: 'EastMoney' }],
        unverifiedItems: ['Need verify northbound flow'],
        draft: 'Draft paragraph',
      },
    }]

    expect(buildResearchWorkspaceSummary(rows)).toMatchObject({
      artifacts: 1,
      citations: 1,
      unverified: 1,
      drafts: 1,
      latestAt: '2026-06-17T01:00:00.000Z',
    })
    expect(primaryHypothesis(rows[0])).toBe('Moutai demand may be stabilizing')
    expect(evidencePreview(rows[0])).toBe('Broker note')
    expect(citationUrl(rows[0])).toBe('https://example.test/a')
  })
})
