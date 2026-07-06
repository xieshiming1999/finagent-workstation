import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { maybeWriteSkillGovernanceRecord, validateSkillImprovementContent } from '../../src/agent/skill-improvement'

describe('skill improvement governance', () => {
  it('does not write governance for no-change results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fin-skill-governance-'))
    const memorySkillPath = join(dir, 'memory', 'skills', 'stock', 'skill.md')
    mkdirSync(join(dir, 'memory', 'skills', 'stock'), { recursive: true })
    writeFileSync(memorySkillPath, '---\nname: stock\n---\n', 'utf-8')

    const wrote = maybeWriteSkillGovernanceRecord({
      skillName: 'stock',
      sourceSkillPath: '/bundle/skills/stock/skill.md',
      memorySkillPath,
      resultSummary: 'NO_CHANGES_NEEDED',
      now: Date.UTC(2026, 5, 15),
    })

    expect(wrote).toBe(false)
    expect(existsSync(join(dir, 'memory', 'skills', 'stock', 'governance.json'))).toBe(false)
  })

  it('writes provenance, finance guardrails, and rollback path for changed skills', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fin-skill-governance-'))
    const memorySkillPath = join(dir, 'memory', 'skills', 'stock', 'skill.md')
    mkdirSync(join(dir, 'memory', 'skills', 'stock'), { recursive: true })
    writeFileSync(memorySkillPath, '---\nname: stock\n---\n', 'utf-8')

    const wrote = maybeWriteSkillGovernanceRecord({
      skillName: 'stock',
      sourceSkillPath: '/bundle/skills/stock/skill.md',
      memorySkillPath,
      resultSummary: 'Added local-first quote readback before provider fetch.',
      now: Date.UTC(2026, 5, 15),
    })
    const record = JSON.parse(readFileSync(join(dir, 'memory', 'skills', 'stock', 'governance.json'), 'utf-8'))

    expect(wrote).toBe(true)
    expect(record).toMatchObject({
      version: 1,
      lifecycle: 'procedural',
      skillName: 'stock',
      sourceSkillPath: '/bundle/skills/stock/skill.md',
      memorySkillPath,
      promotion: {
        source: 'skill_improvement',
        evidenceRequired: true,
        stableWorkflowOnly: true,
      },
      financeFreshness: {
        marketObservationPolicy: 'verification-step-only',
        requiresSourceAndAsOf: true,
        forbidsCurrentAdviceClaims: true,
      },
      rollback: {
        deleteMemoryOverride: memorySkillPath,
        sourceOfTruth: '/bundle/skills/stock/skill.md',
      },
    })
    expect(record.guardrails.join('\n')).toContain('market observations')
  })

  it('rejects finance skill improvements that encode current advice as permanent procedure', () => {
    expect(validateSkillImprovementContent({
      skillName: 'stock-picking',
      content: '---\nname: stock-picking\n---\nBuy now when this skill loads because the current price is low.',
    })).toContain('verification steps')

    expect(validateSkillImprovementContent({
      skillName: 'stock-picking',
      content: '---\nname: stock-picking\n---\nBefore ranking candidates, verify latest price, source, as-of time, and provider freshness.',
    })).toBeNull()
  })
})
