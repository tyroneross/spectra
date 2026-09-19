// tests/media/frame-secret-scan.test.ts

import { execSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')
const FIXTURE_PNG = join(TEST_DIR, 'fixtures', 'secret-frame.png')

function runCli(args: string[]) {
  return spawnSync(process.execPath, [join(REPO_ROOT, 'dist', 'cli', 'index.js'), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
}

function tesseractAvailable(): boolean {
  try {
    const found = execSync('which tesseract', { stdio: 'pipe' }).toString().trim()
    return found.length > 0
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
      'home-path-noslash': 'assertions in Users/tyroneross/dev/git-folder/spectra/tests',
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

  it('resets stateful allow-list regexes before every match', () => {
    const allow = /example@example\.com/g
    expect(scanText('example@example.com example@example.com', { allow: [allow] })).toEqual([])
  })

  it('flags a home path even when OCR dropped the leading slash', () => {
    const text = 'Full npm test had four unrelated existing environment failures in Users/tyroneross/dev/git-folder/spectra/tests/pipeline'
    const findings = scanText(text)
    const finding = findings.find((f) => f.patternId === 'home-path-noslash')
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('low')
    // Only the first path segment survives redaction — the username is never exposed.
    expect(finding!.redacted).toBe('Users…')
    expect(finding!.redacted).not.toContain('tyroneross')
  })

  it('allow-lists the demo user across both slashed and slash-dropped path forms', () => {
    const slashed = 'saved to /Users/tyroneross/Downloads/demo.mp4'
    const slashDropped = 'path was Users/tyroneross/dev/git-folder/spectra'
    const allow = [/tyroneross/]

    expect(scanText(slashed).some((f) => f.patternId === 'home-path-unix')).toBe(true)
    expect(scanText(slashed, { allow }).some((f) => f.patternId === 'home-path-unix')).toBe(false)

    expect(scanText(slashDropped).some((f) => f.patternId === 'home-path-noslash')).toBe(true)
    expect(scanText(slashDropped, { allow }).some((f) => f.patternId === 'home-path-noslash')).toBe(false)
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

  it('never fully exposes a short match — redaction always drops at least one character', () => {
    // Regression for a bug where slice(0,4)+slice(-2) on a match <= 6 chars
    // covered every character in the original string, so the "redacted"
    // preview was the full secret with an ellipsis stitched into the middle.
    const samples: Record<string, string> = {
      'anthropic-api-key': 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
      'openai-api-key': 'sk-AAAAAAAAAAAAAAAAAAAAAAAA',
      'aws-access-key': 'AKIAABCDEFGHIJKLMNOP',
      'github-token': 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'github-pat': 'github_pat_AAAAAAAAAAAAAAAAAAAAAAAA',
      'slack-token': 'xoxb-1234567890-abcdefghij',
      'google-api-key': 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYb4tR6X8jK',
      'pem-private-key': '-----BEGIN RSA PRIVATE KEY-----',
      'bearer-token': 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'generic-secret-assignment': 'password: "correct-horse-battery"',
      'email-address': 'a@b.co', // 6 chars — the exact boundary case that used to leak everything
      'home-path-unix': '/Users/tyrone',
      'home-path-linux': '/home/tyrone',
      'home-path-noslash': ' Users/tyroneross/',
    }

    for (const [patternId, text] of Object.entries(samples)) {
      const pattern = DEFAULT_SECRET_PATTERNS.find((p) => p.id === patternId)!
      const finding = scanText(text, { patterns: [pattern] })[0]
      expect(finding, `expected a finding for ${patternId}`).toBeDefined()
      const exposedChars = finding.redacted.replace(/…/g, '').length
      expect(
        exposedChars,
        `${patternId}: redacted "${finding.redacted}" exposes ${exposedChars}/${finding.length} chars of the match`,
      ).toBeLessThan(finding.length)
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

  it('finds a secret straddling the 4 KB window boundary exactly once', () => {
    // Previously the whole line was truncated at MAX_LINE_LENGTH (4096), so a
    // key crossing that offset was silently dropped. Now long lines scan in
    // overlapping windows: the key must be found (not truncated away) and
    // exactly once (overlapping windows must not double-report it).
    const key = 'sk-ant-api03-' + 'A'.repeat(24) // 37 chars
    const before = 'x'.repeat(4080)
    const after = 'y'.repeat(2000)
    const line = before + key + after // key spans absolute offset 4080-4117, straddling 4096
    const findings = scanOcrText(line).filter((f) => f.patternId === 'anthropic-api-key')
    expect(findings.length).toBe(1)
    expect(findings[0].index).toBe(4080)
  })

  it('normalizes Unicode dashes to ASCII "-" in the first (lossless) pass', () => {
    // Tesseract commonly renders the ASCII hyphens in "sk-ant-api03" as an
    // em-dash: "sk-ant—api03". Confirm the pattern still matches, and that it
    // matches WITHOUT needing the confusion pass (dash normalization is
    // lossless and belongs in the first pass, not gated behind confusion).
    const ocrText = 'sk-ant—api03-' + 'A'.repeat(24)
    const findings = scanOcrText(ocrText)
    const anthropicFinding = findings.find((f) => f.patternId === 'anthropic-api-key')
    expect(anthropicFinding).toBeDefined()
    expect(anthropicFinding!.severity).toBe('high')
    expect(anthropicFinding!.viaOcrConfusionPass).toBeFalsy()
  })

  it('scans a 200 kB single line (no newlines) in well under a second', () => {
    // Regression for O(n^2) backtracking when an entire frame's OCR text is
    // collapsed into one giant line before scanning. Line-splitting + a 4 KB
    // per-line cap should keep this fast regardless of total input size.
    const huge = 'the quick brown fox jumps over the lazy dog. '.repeat(4400) // ~200 kB, no newlines
    const start = Date.now()
    const findings = scanOcrText(huge)
    const elapsedMs = Date.now() - start
    expect(elapsedMs).toBeLessThan(1000)
    expect(findings).toEqual([])
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

  it('does not expose absolute input or temporary frame paths in the report', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'private-frame.png')
    await encodeTinyPng(png)
    const report = await scanFrames(png, { engine: fakeEngine('/Users/private/project') })
    expect(report.input).toBe('private-frame.png')
    expect(report.findings[0].framePath).toBe('private-frame.png')
    expect(JSON.stringify(report)).not.toContain(dir)
  })

  it('rejects overlapping or invalid scan ranges before sampling', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    await expect(scanFrames(png, {
      engine: fakeEngine('clean'),
      rangesMs: [{ startMs: 1000, endMs: 2000 }, { startMs: 1500, endMs: 2500 }],
    })).rejects.toThrow(/overlap/)
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

  it('blocks on a key at offset 5000 of an 8192-char line instead of silently truncating it', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    const key = 'sk-ant-api03-' + 'A'.repeat(24)
    const before = 'x'.repeat(5000)
    const after = 'x'.repeat(8192 - before.length - key.length)
    const line = before + key + after
    expect(line.length).toBe(8192)

    const report = await scanFrames(png, { engine: fakeEngine(line) })
    expect(report.verdict).toBe('blocked')
    expect(report.longLines).toBe(1)
    const anthropicFinding = report.findings.find((f) => f.patternId === 'anthropic-api-key')
    expect(anthropicFinding).toBeDefined()
    expect(anthropicFinding!.index).toBe(5000)
  })

  it('reports longLines: 0 when no line needs windowing', async () => {
    const dir = await makeWorkDir()
    const png = join(dir, 'frame.png')
    await encodeTinyPng(png)
    const report = await scanFrames(png, { engine: fakeEngine('short line, nothing to see') })
    expect(report.longLines).toBe(0)
  })
})

describe('TesseractOcrEngine', () => {
  it('available() resolves without throwing regardless of PATH state', async () => {
    const engine = new TesseractOcrEngine()
    await expect(engine.available()).resolves.toBeTypeOf('boolean')
  })
})

describe('scan-frames CLI argument parsing', () => {
  it('exits 3 with usage when --fps is given with no value', () => {
    const result = runCli(['scan-frames', 'x.mp4', '--fps'])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('Usage')
  })

  it('exits 3 when --fps is non-numeric or non-positive', () => {
    for (const badFps of ['nope', '0', '-1']) {
      const result = runCli(['scan-frames', 'x.mp4', '--fps', badFps])
      expect(result.status, `--fps ${badFps} should exit 3`).toBe(3)
    }
  })

  it('exits 3 for malformed ranges and unknown flags', () => {
    for (const args of [
      ['scan-frames', 'x.mp4', '--range-ms', '12:12'],
      ['scan-frames', 'x.mp4', '--range-ms', 'nope'],
      ['scan-frames', 'x.mp4', '--unknown'],
    ]) {
      const result = runCli(args)
      expect(result.status).toBe(3)
    }
  })
})

// Uses a checked-in fixture PNG (tests/media/fixtures/secret-frame.png,
// rendered once with Python Pillow — see the generation note at the bottom
// of this file) instead of rendering text at test time, so this test has no
// ffmpeg drawtext dependency. Runs the real tesseract binary end to end
// through the actual CLI entrypoint. Skipped when tesseract isn't installed.
describe.skipIf(!tesseractAvailable())('scanFrames integration (tesseract)', () => {
  it('detects the fixture secret via the library and blocks', async () => {
    const dir = await makeWorkDir()
    const report = await scanFrames(FIXTURE_PNG, { workDir: join(dir, 'work') })
    expect(report.frameCount).toBe(1)
    expect(report.verdict).toBe('blocked')
    const anthropicFinding = report.findings.find((f) => f.patternId === 'anthropic-api-key')
    expect(anthropicFinding).toBeDefined()
    expect(anthropicFinding!.redacted).not.toContain('TESTTESTTESTTESTTESTTEST')
  })

  it('detects the fixture secret via the CLI and exits 2 (blocked)', () => {
    const result = runCli(['scan-frames', FIXTURE_PNG, '--json'])
    expect(result.status).toBe(2)
    expect(result.stdout).not.toContain('TESTTESTTESTTESTTESTTEST')
    const report = JSON.parse(result.stdout) as { verdict: string }
    expect(report.verdict).toBe('blocked')
  })
})

// tests/media/fixtures/secret-frame.png was generated once with:
//
//   from PIL import Image, ImageDraw, ImageFont
//   text = 'api_key = sk-ant-api03-TESTTESTTESTTESTTESTTEST  /Users/demo/app'
//   font = ImageFont.truetype('/System/Library/Fonts/Monaco.ttf', 32)
//   img = Image.new('RGB', (1309, 112), color='black')
//   ImageDraw.Draw(img).text((40, 40), text, fill='white', font=font)
//   img.save('tests/media/fixtures/secret-frame.png')
//
// It is a static fixture, not regenerated at test time — no Pillow/ffmpeg
// drawtext dependency for CI.

async function encodeTinyPng(path: string): Promise<void> {
  const { encodePng } = await import('../../src/media/png.js')
  const { writeFile } = await import('node:fs/promises')
  const width = 4
  const height = 4
  const data = new Uint8Array(width * height * 4).fill(255)
  await writeFile(path, encodePng({ width, height, data }))
}
