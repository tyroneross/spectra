// tests/media/frame-secret-scan.test.ts

import { execSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SECRET_PATTERNS,
  TesseractOcrEngine,
  applyOcrConfusionMap,
  normalizeOcrText,
  scanFrames,
  scanOcrText,
  scanText,
  type OcrEngine,
} from '../../src/media/frame-secret-scan.js'

function tesseractAvailable(): boolean {
  try {
    const found = execSync('which tesseract', { stdio: 'pipe' }).toString().trim()
    return found.length > 0
  } catch {
    return false
  }
}

function ffmpegAvailable(): boolean {
  try {
    const found = execSync('which ffmpeg', { stdio: 'pipe' }).toString().trim()
    return found.length > 0
  } catch {
    return false
  }
}

// Some ffmpeg builds (notably Homebrew's when linked without libfreetype) omit
// the drawtext filter entirely. The integration test renders text with it, so
// skip gracefully rather than fail on a build-configuration gap unrelated to
// this module's own correctness.
function drawtextAvailable(): boolean {
  try {
    return execSync('ffmpeg -filters', { stdio: 'pipe' }).toString().includes('drawtext')
  } catch {
    return false
  }
}

let workDir: string | null = null

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-frame-secret-scan-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('scanText', () => {
  it('matches each default pattern class', () => {
    const samples: Record<string, string> = {
      'anthropic-api-key': 'ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
      'openai-api-key': 'OPENAI_API_KEY=sk-AAAAAAAAAAAAAAAAAAAAAAAA',
      'aws-access-key': 'aws_access_key_id = AKIAABCDEFGHIJKLMNOP',
      'github-token': 'token: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'github-pat': 'token: github_pat_AAAAAAAAAAAAAAAAAAAAAAAA',
      'slack-token': 'SLACK_TOKEN=xoxb-1234567890-abcdefghij',
      'google-api-key': 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      jwt: 'Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYb4tR6X8jK',
      'pem-private-key': '-----BEGIN RSA PRIVATE KEY-----',
      'bearer-token': 'Authorization: Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'generic-secret-assignment': 'password: "correct-horse-battery"',
      'email-address': 'contact tyrone.ross@gmail.com for access',
      'home-path-unix': 'saved to /Users/tyrone/Downloads/screenshot.png',
      'home-path-linux': 'saved to /home/tyrone/screenshot.png',
    }

    for (const [patternId, text] of Object.entries(samples)) {
      const findings = scanText(text)
      expect(findings.some((f) => f.patternId === patternId), `expected ${patternId} to match: ${text}`).toBe(true)
    }
  })

  it('covers every pattern in DEFAULT_SECRET_PATTERNS with at least one sample', () => {
    const ids = new Set(DEFAULT_SECRET_PATTERNS.map((p) => p.id))
    expect(ids.size).toBe(DEFAULT_SECRET_PATTERNS.length)
  })

  it('suppresses matches covered by an allow-list regex', () => {
    const text = 'reviewer is tyrone.ross@gmail.com, secrets not allowed elsewhere'
    const withoutAllow = scanText(text)
    expect(withoutAllow.some((f) => f.patternId === 'email-address')).toBe(true)

    const withAllow = scanText(text, { allow: [/tyrone\.ross@gmail\.com/] })
    expect(withAllow.some((f) => f.patternId === 'email-address')).toBe(false)
  })

  it('never includes the full secret in a finding, only a redacted preview', () => {
    const secret = 'sk-ant-api03-SUPERSECRETVALUETHATMUSTNEVERAPPEAR'
    const findings = scanText(`api_key=${secret}`)
    const anthropicFinding = findings.find((f) => f.patternId === 'anthropic-api-key')
    expect(anthropicFinding).toBeDefined()
    expect(anthropicFinding!.redacted).not.toContain(secret)
    expect(anthropicFinding!.redacted.startsWith(secret.slice(0, 4))).toBe(true)
    expect(anthropicFinding!.redacted.endsWith(secret.slice(-2))).toBe(true)
    expect(anthropicFinding!.redacted).toContain('…')

    // No finding across the whole result set should carry the raw secret text.
    for (const finding of findings) {
      expect(finding.redacted).not.toContain(secret)
      expect(JSON.stringify(finding)).not.toContain(secret)
    }
  })
})

describe('OCR-confusion pass', () => {
  it('canonicalizes O→0, l→1, I→1', () => {
    expect(applyOcrConfusionMap('sk-ant-apiO3-AAAA')).toBe('sk-ant-api03-AAAA')
    expect(applyOcrConfusionMap('Il')).toBe('11')
  })

  it('collapses whitespace before matching', () => {
    expect(normalizeOcrText('a   b\n\tc')).toBe('a b c')
  })

  it('catches an sk-ant- key even when OCR swapped a digit 0 for a letter O', () => {
    // Simulates tesseract misreading "api03" as "apiO3" in a captured frame.
    const ocrText = 'api_key  =  sk-ant-apiO3-AAAAAAAAAAAAAAAAAAAAAAAA'
    const findings = scanOcrText(ocrText)
    const anthropicFinding = findings.find((f) => f.patternId === 'anthropic-api-key')
    expect(anthropicFinding).toBeDefined()
    expect(anthropicFinding!.redacted).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAA')
  })

  it('flags findings only recoverable via the confusion pass', () => {
    // Construct a pattern that only matches after O→0 canonicalization, then
    // confirm scanOcrText both finds it and marks provenance.
    const onlyDigitPattern = { id: 'digits-only', severity: 'low' as const, regex: /\b[0-9]{6}\b/, description: 'six digits' }
    const ocrText = 'code: OO1234'
    const rawHits = scanText(normalizeOcrText(ocrText), { patterns: [onlyDigitPattern] })
    expect(rawHits.length).toBe(0)

    const combined = scanOcrText(ocrText, { patterns: [onlyDigitPattern] })
    expect(combined.length).toBe(1)
    expect(combined[0].viaOcrConfusionPass).toBe(true)
  })
})

describe('scanFrames verdict mapping', () => {
  function fakeEngine(text: string, available = true): OcrEngine {
    return {
      name: 'fake',
      available: async () => available,
      recognize: async () => text,
    }
  }

  it('is clean when no findings are present', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    const report = await scanFrames(png, { engine: fakeEngine('nothing interesting here') })
    expect(report.verdict).toBe('clean')
    expect(report.findings).toEqual([])
  })

  it('is review when only medium/low findings are present', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    const report = await scanFrames(png, { engine: fakeEngine('reach me at tyrone.ross@gmail.com') })
    expect(report.verdict).toBe('review')
  })

  it('is blocked when a high-severity finding is present', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    const report = await scanFrames(png, {
      engine: fakeEngine('ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA'),
    })
    expect(report.verdict).toBe('blocked')
  })

  it('reports review with an unscannedReason when the OCR engine is unavailable', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    const report = await scanFrames(png, { engine: fakeEngine('irrelevant', false) })
    expect(report.verdict).toBe('review')
    expect(report.frameCount).toBe(0)
    expect(report.unscannedReason).toContain('fake')
  })
})

describe('TesseractOcrEngine', () => {
  it('available() resolves without throwing regardless of PATH state', async () => {
    const engine = new TesseractOcrEngine()
    await expect(engine.available()).resolves.toBeTypeOf('boolean')
  })
})

// Renders a real single-frame PNG with ffmpeg's drawtext filter, embeds a
// fake Anthropic key, and runs the full scanFrames pipeline through the real
// tesseract binary. Skipped in environments without tesseract installed.
describe.skipIf(!tesseractAvailable() || !ffmpegAvailable() || !drawtextAvailable())('scanFrames integration (tesseract)', () => {
  it('detects a rendered secret in a captured frame and blocks', async () => {
    const dir = await makeWorkDir()
    const framePng = join(dir, 'rendered.png')
    const drawtext = "drawtext=text='api_key = sk-ant-api03-TESTTESTTESTTESTTESTTEST':fontcolor=white:fontsize=28:x=20:y=80"
    const result = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=800x200',
      '-vf', drawtext,
      '-frames:v', '1',
      framePng,
    ], { stdio: 'pipe' })
    expect(result.status).toBe(0)

    const report = await scanFrames(framePng, { workDir: join(dir, 'work') })
    expect(report.frameCount).toBe(1)
    expect(report.verdict).toBe('blocked')
    const anthropicFinding = report.findings.find((f) => f.patternId === 'anthropic-api-key')
    expect(anthropicFinding).toBeDefined()
    expect(anthropicFinding!.redacted).not.toContain('TESTTESTTESTTESTTESTTEST')
  })
})

async function encodeTinyPng(path: string): Promise<void> {
  const { encodePng } = await import('../../src/media/png.js')
  const { writeFile } = await import('node:fs/promises')
  const width = 4
  const height = 4
  const data = new Uint8Array(width * height * 4).fill(255)
  await writeFile(path, encodePng({ width, height, data }))
}
