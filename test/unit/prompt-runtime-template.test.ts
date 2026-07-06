import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PromptBuilder } from '../../src/agent/prompt-builder'

describe('PromptBuilder runtime template substitution', () => {
  it('renders concrete data and work directories in bundled AGENTS.md', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-prompt-base-'))
    const assetsPath = mkdtempSync(join(tmpdir(), 'fin-prompt-assets-'))
    mkdirSync(join(assetsPath, 'bundle', 'chat'), { recursive: true })
    writeFileSync(
      join(assetsPath, 'bundle', 'AGENTS.md'),
      'Data={{DATA_DIR}}\nMemory={{MEMORY_DIR}}\nBundle={{BUNDLE_DIR}}\nSkills={{SKILLS_DIR}}\nWork={{WORK_DIR}}\nRole={{AGENT_ROLE}}',
      'utf-8',
    )
    writeFileSync(join(assetsPath, 'bundle', 'chat', 'AGENTS.md'), 'Role data={{DATA_DIR}}', 'utf-8')

    const prompt = new PromptBuilder(basePath, assetsPath, 'chat').build([])

    expect(prompt).toContain(`Data=${basePath}`)
    expect(prompt).toContain(`Memory=${join(basePath, 'memory')}`)
    expect(prompt).toContain(`Bundle=${join(basePath, 'bundle')}`)
    expect(prompt).toContain(`Skills=${join(assetsPath, 'skills')}`)
    expect(prompt).toContain(`Work=${process.cwd()}`)
    expect(prompt).toContain('Role=chat')
    expect(prompt).toContain(`Role data=${basePath}`)
    expect(prompt).not.toContain('{{DATA_DIR}}')
  })

  it('injects the finance output standard into the system prompt', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-prompt-base-'))
    const assetsPath = mkdtempSync(join(tmpdir(), 'fin-prompt-assets-'))
    mkdirSync(join(assetsPath, 'bundle'), { recursive: true })
    writeFileSync(join(assetsPath, 'bundle', 'AGENTS.md'), 'Base instructions', 'utf-8')

    const prompt = new PromptBuilder(basePath, assetsPath, 'chat').build([])

    expect(prompt).toContain('# Finance Output Standard')
    expect(prompt).toContain('Fact')
    expect(prompt).toContain('Calculation')
    expect(prompt).toContain('Inference')
    expect(prompt).toContain('Recommendation')
    expect(prompt).toContain('Assumption')
    expect(prompt).toContain('Unverified item')
    expect(prompt).toContain('same-runtime readback status')
  })
})
