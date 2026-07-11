import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

describe('neutral agent workflow intent boundary', () => {
  it('does not classify workflow behavior by parsing prompt text in agent core', () => {
    const files = [
      'src/agent/agent.ts',
      'src/agent/agent-loop.ts',
      'src/agent/agent-hooks.ts',
      'src/agent/agent-turn-utils.ts',
    ]
      .map((file) => join(process.cwd(), file))
      .filter((file) => existsSync(file))

    const forbidden = [
      /currentPrompt\s*[^;\n]*\.includes\s*\(/,
      /currentPrompt\s*[^;\n]*\.match\s*\(/,
      /turnPrompt\s*[^;\n]*\.includes\s*\(/,
      /turnPrompt\s*[^;\n]*\.match\s*\(/,
      /userMessage\s*[^;\n]*\.includes\s*\(/,
      /prompt\s*[^;\n]*\.includes\s*\(/,
    ]
    const offenders: string[] = []

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (forbidden.some((pattern) => pattern.test(line))) {
          offenders.push(`${file.replace(`${process.cwd()}/`, '')}:${index + 1}: ${line.trim()}`)
        }
      })
    }

    expect(offenders, [
      'Neutral agent code must not infer workflow intent by parsing user prompt text.',
      'Use typed workflow state, explicit tool parameters, StrategySpec, or domain-owned evidence instead.',
      ...offenders,
    ].join('\n')).toEqual([])
  })
})
