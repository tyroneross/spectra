import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

const root = fileURLToPath(new URL('../..', import.meta.url))

function read(path: string): string {
  return readFileSync(`${root}/${path}`, 'utf8')
}

function frontmatter(path: string): Record<string, unknown> {
  const match = read(path).match(/^---\n([\s\S]*?)\n---/)
  if (!match) throw new Error(`${path} has no YAML frontmatter`)
  return YAML.parse(match[1]) as Record<string, unknown>
}

describe('shipped marketing content system', () => {
  it('packages the agent and exposes a routed marketing command', () => {
    const pkg = JSON.parse(read('package.json')) as { files: string[] }
    const command = frontmatter('commands/marketing.md')
    const router = read('commands/spectra.md')

    expect(pkg.files).toContain('agents/')
    expect(command).toMatchObject({ name: 'marketing' })
    expect(command.description).toContain('audience-specific')
    expect(router).toContain('/spectra:marketing')
    expect(router).toContain('/spectra:record')
    expect(router).toContain('/spectra:library')
  })

  it('defines three concept routes and fixed selection weights totaling 100', () => {
    const protocol = read('skills/product-marketing/references/creative-loop.md')
    const weightRows = [...protocol.matchAll(
      /\| (Audience fit|Proposition clarity|Proof strength|Differentiation|Emotional relevance|Conversion alignment|Production feasibility) \| (\d+) \|/g,
    )]
    const weights = weightRows.map((match) => Number(match[2]))

    expect(protocol).toContain('`proof-led`')
    expect(protocol).toContain('`problem-led`')
    expect(protocol).toContain('`transformation-led`')
    expect(weights).toHaveLength(7)
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(100)
  })

  it('blocks unsupported claims and terminates the audit-repair loop', () => {
    const protocol = read('skills/product-marketing/references/creative-loop.md')
    const dimensions = [...protocol.matchAll(/^\| (\d+) \| [^|]+ \|/gm)]

    expect(protocol).toContain('`directly_demonstrated`')
    expect(protocol).toContain('`supported_source`')
    expect(protocol).toContain('`customer_evidence`')
    expect(protocol).toContain('`inferred`')
    expect(protocol).toContain('`unsupported`')
    expect(protocol).toContain('no material claim remains `unsupported`')
    expect(dimensions).toHaveLength(15)
    expect(protocol).toContain('score is at least 65/75 and blockers are empty')
    expect(protocol).toMatch(/after two (?:repair passes|repairs)/i)
  })

  it('gives the planner explicit state, permissions, failures, and output', () => {
    const meta = frontmatter('agents/marketing-planner.md')
    const agent = read('agents/marketing-planner.md')

    expect(meta).toMatchObject({
      name: 'marketing-planner',
      model: 'inherit',
      color: 'magenta',
    })
    expect(meta).not.toHaveProperty('tools')
    expect(agent).toContain('permission_tier: T3')
    expect(agent).toContain('# Campaign state')
    expect(agent).toContain('# Operation registry')
    expect(agent).toContain('# Transition procedure')
    expect(agent).toContain('# Failure handling')
    expect(agent).toContain('# Termination contract')
    expect(agent).toContain('BLOCKED_MISSING_EVIDENCE')
    expect(agent).toContain('PRODUCTION_FAILED')
    expect(agent).toContain('"selected_concept"')
    expect(agent).toContain('"produced_media"')
  })

  it('separates Apple requirements from Spectra compatibility policy', () => {
    const skill = read('skills/product-marketing/SKILL.md')
    const channel = read('skills/product-marketing/references/channel-playbooks.md')

    expect(skill).toContain('permits at most 30 fps')
    expect(skill).toContain('compatibility choices; do not mislabel them as Apple requirements')
    expect(channel).toContain('no watchOS app-preview resolution/upload surface')
    expect(channel).toContain('Spectra house export')
  })
})
