// src/media/frame-secret-scan.ts
//
// Pre-publish privacy/secret scanner for recorded frames. Samples frames from
// a video (or treats a still image as a single frame), OCRs each frame, and
// matches the recognized text against a library of credential/PII patterns.
//
// This is a GATE, not a proof of absence: OCR misses low-contrast or small
// text, and the pattern library only covers known secret shapes. Treat a
// "clean" verdict as "nothing obvious found," not "guaranteed safe."
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { execSync, spawn } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { detectFfmpeg } from './ffmpeg.js';
/**
 * Shells out to the `tesseract` CLI. `--psm 6` (assume a single uniform block
 * of text) is the best default for terminal/browser chrome screenshots.
 */
export class TesseractOcrEngine {
    name = 'tesseract';
    binaryPath = undefined;
    resolveBinary() {
        if (this.binaryPath !== undefined)
            return this.binaryPath;
        try {
            const found = execSync('which tesseract', { stdio: 'pipe' }).toString().trim();
            this.binaryPath = found.length > 0 ? found : null;
        }
        catch {
            this.binaryPath = null;
        }
        if (!this.binaryPath && existsSync('/opt/homebrew/bin/tesseract')) {
            this.binaryPath = '/opt/homebrew/bin/tesseract';
        }
        return this.binaryPath;
    }
    async available() {
        try {
            return this.resolveBinary() !== null;
        }
        catch {
            // available() must never throw — an unresolvable binary is "not available."
            return false;
        }
    }
    async recognize(pngPath) {
        const bin = this.resolveBinary();
        if (!bin)
            throw new Error('tesseract binary not found on PATH');
        return new Promise((resolvePromise, reject) => {
            const proc = spawn(bin, [pngPath, 'stdout', '--psm', '6'], { stdio: 'pipe' });
            const stdoutChunks = [];
            const stderrChunks = [];
            proc.stdout?.on('data', (chunk) => stdoutChunks.push(chunk));
            proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk));
            proc.on('close', (code) => {
                if (code === 0)
                    resolvePromise(Buffer.concat(stdoutChunks).toString('utf-8'));
                else {
                    const stderr = Buffer.concat(stderrChunks).toString().trim();
                    reject(new Error(`tesseract exited with code ${code}${stderr ? '\n' + stderr : ''}`));
                }
            });
            proc.on('error', reject);
        });
    }
}
export const DEFAULT_SECRET_PATTERNS = [
    {
        id: 'anthropic-api-key',
        severity: 'high',
        regex: /sk-ant-[A-Za-z0-9_-]{20,}/,
        description: 'Anthropic API key',
    },
    {
        id: 'openai-api-key',
        severity: 'high',
        regex: /sk-[A-Za-z0-9]{20,}/,
        description: 'OpenAI-style API key',
    },
    {
        id: 'aws-access-key',
        severity: 'high',
        regex: /AKIA[0-9A-Z]{16}/,
        description: 'AWS access key ID',
    },
    {
        id: 'github-token',
        severity: 'high',
        regex: /gh[pousr]_[A-Za-z0-9]{20,}/,
        description: 'GitHub personal/app token',
    },
    {
        id: 'github-pat',
        severity: 'high',
        regex: /github_pat_[A-Za-z0-9_]{20,}/,
        description: 'GitHub fine-grained personal access token',
    },
    {
        id: 'slack-token',
        severity: 'high',
        regex: /xox[abpr]-[A-Za-z0-9-]{10,}/,
        description: 'Slack API token',
    },
    {
        id: 'google-api-key',
        severity: 'high',
        regex: /AIza[0-9A-Za-z_-]{30,}/,
        description: 'Google API key',
    },
    {
        id: 'jwt',
        severity: 'high',
        regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
        description: 'JSON Web Token',
    },
    {
        id: 'pem-private-key',
        severity: 'high',
        regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
        description: 'PEM private key header',
    },
    {
        id: 'bearer-token',
        severity: 'high',
        regex: /Bearer\s+[A-Za-z0-9._-]{20,}/,
        description: 'Bearer authorization header',
    },
    {
        id: 'generic-secret-assignment',
        severity: 'medium',
        regex: /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
        description: 'Generic secret-shaped assignment',
    },
    {
        id: 'email-address',
        severity: 'low',
        regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
        description: 'Email address',
    },
    {
        id: 'home-path-unix',
        severity: 'low',
        regex: /\/Users\/[A-Za-z0-9._-]+/,
        description: 'macOS absolute home directory path',
    },
    {
        id: 'home-path-linux',
        severity: 'low',
        regex: /\/home\/[A-Za-z0-9._-]+/,
        description: 'Linux absolute home directory path',
    },
    {
        id: 'home-path-noslash',
        severity: 'low',
        // OCR frequently drops the leading '/' at the start of a line or word
        // boundary, turning "/Users/tyrone/..." into "Users/tyrone/...". Catch
        // that mangled form too — it's the same privacy leak, just missing a
        // character OCR is prone to dropping.
        regex: /(?:^|[^A-Za-z0-9/])(?:Users|home)\/[A-Za-z0-9._-]{2,}\//,
        description: 'Home directory path with OCR-dropped leading slash',
    },
];
const PATH_PATTERN_IDS = new Set(['home-path-unix', 'home-path-linux', 'home-path-noslash']);
/**
 * First 4 + '…' + last 2 — but only once the match is long enough that head
 * and tail don't overlap and re-expose the whole thing. For match.length <= 8,
 * `slice(0,4)+slice(-2)` covers 6+ of the string's characters (or all of it,
 * for a 6-char email like "a@b.co" → "a@b.…co" — every character present,
 * just with an ellipsis stitched in). Short matches get a harsher cut.
 */
function redact(match) {
    if (match.length <= 3)
        return '…';
    if (match.length <= 8)
        return `${match.slice(0, 2)}…`;
    return `${match.slice(0, 4)}…${match.slice(-2)}`;
}
/**
 * Path findings get a stricter redaction than the generic first-4/last-2
 * scheme: keep only the first path segment (e.g. `/Users` or `Users` for the
 * slash-dropped form) plus '…'. The generic scheme would still leak most of
 * the username via its trailing 2 characters; a home path's sensitive part
 * IS the username, so drop it entirely.
 */
function redactPath(match) {
    const trimmed = match.replace(/^[^A-Za-z0-9/]+/, '');
    const firstSegment = trimmed.match(/^\/?[A-Za-z]+/)?.[0] ?? trimmed.slice(0, 5);
    return `${firstSegment}…`;
}
/** Returns a fresh global-flagged RegExp so callers never share `lastIndex` state. */
function toGlobalRegex(pattern) {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    return new RegExp(pattern.source, flags);
}
export function scanText(text, opts = {}) {
    const patterns = opts.patterns ?? DEFAULT_SECRET_PATTERNS;
    const allow = opts.allow ?? [];
    const findings = [];
    for (const pattern of patterns) {
        const re = toGlobalRegex(pattern.regex);
        for (const m of text.matchAll(re)) {
            const matched = m[0];
            if (allow.some((a) => a.test(matched)))
                continue;
            findings.push({
                patternId: pattern.id,
                severity: pattern.severity,
                description: pattern.description,
                redacted: PATH_PATTERN_IDS.has(pattern.id) ? redactPath(matched) : redact(matched),
                index: m.index ?? -1,
                length: matched.length,
            });
        }
    }
    return findings;
}
// ─── OCR-confusion normalization ──────────────────────────────
//
// OCR frequently confuses visually similar glyphs (capital O vs digit 0,
// lowercase l vs digit 1, capital I vs digit 1, '@' vs digit 0). Collapsing
// whitespace and then re-running the scan with those glyphs canonicalized
// raises recall on secrets OCR mangled — at the cost of false positives
// elsewhere in the text (ordinary words containing O/l/I get corrupted too).
// For a pre-publish gate, a false positive costs a human a second look; a
// false negative ships a real secret. Trade recall for precision here.
//
// Unicode dash normalization (hyphen/en-dash/em-dash/minus-sign → ASCII '-')
// is lossless — none of these glyphs mean anything else in this context — so
// it runs in the FIRST pass too, not just the confusion pass. Tesseract
// commonly renders the ASCII hyphen in "sk-ant-api03" as an em-dash
// ("sk-ant—api03"), which would otherwise make every hyphen-bearing pattern
// (anthropic/openai/aws/github/slack keys) miss entirely.
const UNICODE_DASH_RE = /[‐-―−]/g;
const OCR_CONFUSION_MAP = { O: '0', l: '1', I: '1', '@': '0' };
export function normalizeOcrText(text) {
    return text.replace(UNICODE_DASH_RE, '-').replace(/\s+/g, ' ').trim();
}
export function applyOcrConfusionMap(text) {
    return text.replace(/[OlI@]/g, (ch) => OCR_CONFUSION_MAP[ch] ?? ch);
}
// Bounds regex work per scan unit. Real OCR output line-wraps naturally
// (typical terminal/browser-chrome lines run well under 200 chars); collapsing
// an entire frame's text into one line before scanning removes that natural
// bound and lets several patterns' greedy-quantifier-then-required-literal
// shape (e.g. home-path-noslash's `[...]{2,}/`) backtrack over the whole
// blob on non-matching runs, making a single big frame scan quadratic in
// frame size. Splitting on newlines and capping each line restores the bound.
// Trade-off: content past the cap on a single pathological unbroken line is
// not scanned — acceptable for a pre-publish gate, not for a forensic one.
const MAX_LINE_LENGTH = 4096;
function splitIntoScannableLines(text) {
    const lines = [];
    let offset = 0;
    for (const rawLine of text.split('\n')) {
        const normalized = normalizeOcrText(rawLine).slice(0, MAX_LINE_LENGTH);
        lines.push({ text: normalized, offset });
        // +1 approximates the separator consumed between original lines. `index`
        // is used for de-duplication and display, not for slicing back into the
        // raw OCR text, so an approximate running offset is sufficient.
        offset += normalized.length + 1;
    }
    return lines;
}
/**
 * Runs `scanText` twice per line — once on the normalized line, once on the
 * OCR-confusion-mapped variant — and merges the results. Because the
 * confusion map is a 1:1 character substitution, offsets line up between the
 * two passes, so a hit found in both passes is de-duplicated by
 * (patternId, index); a hit found only after confusion-mapping is kept and
 * flagged `viaOcrConfusionPass`.
 */
export function scanOcrText(rawOcrText, opts = {}) {
    const lines = splitIntoScannableLines(rawOcrText);
    const primary = [];
    const seen = new Set();
    for (const line of lines) {
        for (const finding of scanText(line.text, opts)) {
            const adjusted = { ...finding, index: finding.index + line.offset };
            primary.push(adjusted);
            seen.add(`${adjusted.patternId}:${adjusted.index}`);
        }
    }
    const secondary = [];
    for (const line of lines) {
        const confusedLine = applyOcrConfusionMap(line.text);
        for (const finding of scanText(confusedLine, opts)) {
            const adjusted = { ...finding, index: finding.index + line.offset, viaOcrConfusionPass: true };
            if (!seen.has(`${adjusted.patternId}:${adjusted.index}`))
                secondary.push(adjusted);
        }
    }
    return [...primary, ...secondary];
}
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
function isImageFile(input) {
    return IMAGE_EXTENSIONS.has(extname(input).toLowerCase());
}
export class FrameScanInputError extends Error {
    code = 'INPUT_NOT_FOUND';
}
export class FfmpegUnavailableError extends Error {
    code = 'FFMPEG_UNAVAILABLE';
}
async function runFfmpeg(ffmpegPath, args) {
    return new Promise((resolvePromise, reject) => {
        const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });
        const stderrChunks = [];
        proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk));
        proc.on('close', (code) => {
            if (code === 0)
                resolvePromise();
            else {
                const stderr = Buffer.concat(stderrChunks).toString().trim();
                reject(new Error(`ffmpeg exited with code ${code}${stderr ? '\n' + stderr : ''}`));
            }
        });
        proc.on('error', reject);
    });
}
/**
 * Samples frames from a video at `fps`, scaled to 1920px wide (height auto,
 * even-rounded). If `input` is a still image, returns it as a single frame
 * at tMs=0 without invoking ffmpeg.
 */
export async function sampleFrames(input, opts) {
    const fps = opts.fps ?? 1;
    if (isImageFile(input)) {
        return [{ path: input, index: 0, tMs: 0 }];
    }
    const ffmpegPath = detectFfmpeg();
    if (!ffmpegPath) {
        throw new FfmpegUnavailableError('ffmpeg not found on PATH; required to sample video frames');
    }
    await mkdir(opts.outDir, { recursive: true });
    const pattern = join(opts.outDir, 'frame-%04d.png');
    const args = [
        '-y',
        '-i', input,
        '-vf', `fps=${fps},scale=1920:-2`,
        ...(opts.maxFrames ? ['-frames:v', String(opts.maxFrames)] : []),
        pattern,
    ];
    await runFfmpeg(ffmpegPath, args);
    const files = (await readdir(opts.outDir))
        .filter((f) => f.startsWith('frame-') && f.endsWith('.png'))
        .sort();
    return files.map((f, index) => ({
        path: join(opts.outDir, f),
        index,
        tMs: Math.round((index / fps) * 1000),
    }));
}
function computeVerdict(findings) {
    if (findings.some((f) => f.severity === 'high'))
        return 'blocked';
    if (findings.some((f) => f.severity === 'medium' || f.severity === 'low'))
        return 'review';
    return 'clean';
}
export async function scanFrames(input, opts = {}) {
    const fps = opts.fps ?? 1;
    const sampledAt = new Date().toISOString();
    try {
        await stat(input);
    }
    catch {
        throw new FrameScanInputError(`input not found: ${input}`);
    }
    const engine = opts.engine ?? new TesseractOcrEngine();
    const workDir = opts.workDir ?? join(process.cwd(), '.spectra', 'tmp', 'frame-secret-scan');
    const isAvailable = await engine.available();
    if (!isAvailable) {
        return {
            input,
            sampledAt,
            engine: engine.name,
            fps,
            frameCount: 0,
            findings: [],
            verdict: 'review',
            unscannedReason: `${engine.name} not available on PATH`,
        };
    }
    const frames = await sampleFrames(input, { fps, outDir: workDir });
    const findings = [];
    for (const frame of frames) {
        const text = await engine.recognize(frame.path);
        const hits = scanOcrText(text, { patterns: opts.patterns, allow: opts.allow });
        for (const hit of hits) {
            findings.push({ ...hit, frameIndex: frame.index, tMs: frame.tMs, framePath: frame.path });
        }
    }
    return {
        input,
        sampledAt,
        engine: engine.name,
        fps,
        frameCount: frames.length,
        findings,
        verdict: computeVerdict(findings),
    };
}
//# sourceMappingURL=frame-secret-scan.js.map