// src/native/compiler.ts
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const BIN_DIR = join(homedir(), '.spectra', 'bin')
const BINARY_PATH = join(BIN_DIR, 'spectra-native')
const HASH_PATH = join(BIN_DIR, '.source-hash')
const COMPOSITE_BINARY_PATH = join(BIN_DIR, 'spectra-composite-capture')
const COMPOSITE_HASH_PATH = join(BIN_DIR, '.composite-source-hash')
const SCREEN_RECORDING_PREFLIGHT_PATH = join(BIN_DIR, 'spectra-screen-recording-preflight')
const SCREEN_RECORDING_PREFLIGHT_HASH_PATH = join(BIN_DIR, '.screen-recording-preflight-source-hash')
const CURSOR_SAMPLER_BINARY_PATH = join(BIN_DIR, 'spectra-cursor-sampler')
const CURSOR_SAMPLER_HASH_PATH = join(BIN_DIR, '.cursor-sampler-source-hash')
const TEXT_RENDER_BINARY_PATH = join(BIN_DIR, 'spectra-text-render')
const TEXT_RENDER_HASH_PATH = join(BIN_DIR, '.text-render-source-hash')
const DAEMON_LAUNCHER_PATH = join(BIN_DIR, 'spectra-daemon-launcher')
const WINDOW_BOUNDS_BINARY_PATH = join(BIN_DIR, 'spectra-window-bounds')
const TEST_APP_PATH = join(BIN_DIR, 'spectra-test-app')
// GUARDRAIL: default to AD-HOC signing ('-') — no keychain access, no prompt.
// The user's real Apple Development identity is used ONLY when they explicitly
// set SPECTRA_CODESIGN_IDENTITY (release/notarize). Agents never auto-sign with
// the user's Apple identity. SPECTRA_CODESIGN=0 skips signing entirely.
const DEFAULT_CODESIGN_IDENTITY = '-'
const COMPILE_LOCK_STALE_MS = 60_000
const COMPILE_LOCK_WAIT_MS = 30_000

// Find project root by looking for native/swift/ directory
function findSwiftSource(): string {
  // Walk up from this file's location to find the project root
  let dir = resolve(import.meta.dirname, '..', '..')
  const swiftDir = join(dir, 'native', 'swift')
  if (!existsSync(swiftDir)) {
    throw new Error(`Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function findCompositeSwiftSource(): string {
  const swiftDir = join(findSwiftSource(), 'composite-capture')
  if (!existsSync(swiftDir)) {
    throw new Error(`Composite Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function findScreenRecordingPreflightSource(): string {
  const swiftDir = join(findSwiftSource(), 'screen-recording-preflight')
  if (!existsSync(swiftDir)) {
    throw new Error(`Screen Recording preflight Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function findDaemonLauncherSource(): string {
  const swiftDir = join(findSwiftSource(), 'daemon-launcher')
  if (!existsSync(swiftDir)) {
    throw new Error(`Daemon launcher Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function findCursorSamplerSource(): string {
  const swiftDir = join(findSwiftSource(), 'cursor-sampler')
  if (!existsSync(swiftDir)) {
    throw new Error(`Cursor sampler Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function findTextRenderSource(): string {
  const swiftDir = join(findSwiftSource(), 'text-render')
  if (!existsSync(swiftDir)) {
    throw new Error(`Text render Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function getSwiftFiles(swiftDir: string): string[] {
  return readdirSync(swiftDir)
    .filter(f => f.endsWith('.swift'))
    .map(f => join(swiftDir, f))
    .sort()
}

function computeSourceHash(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

function codesignIdentity(): string | null {
  if (process.env.SPECTRA_CODESIGN === '0') return null
  const identity = process.env.SPECTRA_CODESIGN_IDENTITY ?? DEFAULT_CODESIGN_IDENTITY
  if (identity === 'skip') return null
  return identity
}

function hasExpectedSignature(binaryPath: string): boolean {
  const identity = codesignIdentity()
  if (!identity) return true
  if (!existsSync(binaryPath)) return false

  try {
    const result = spawnSync('codesign', ['-dvv', binaryPath], {
      encoding: 'utf8',
    })
    if (result.status !== 0) return false
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    if (identity === DEFAULT_CODESIGN_IDENTITY) {
      return output.includes('Signature=adhoc')
    }
    return output.includes(`Authority=${identity}`)
      && /TeamIdentifier=(?!not set)/.test(output)
  } catch {
    return false
  }
}

function signNativeBinary(binaryPath: string): void {
  const identity = codesignIdentity()
  if (!identity) return

  try {
    execFileSync('codesign', [
      '--force',
      '--timestamp=none',
      '--options', 'runtime',
      '--sign', identity,
      binaryPath,
    ], { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`codesign failed for ${binaryPath}:\n${msg}`)
  }
}

// ─── Shared native-helper resolution ─────────────────────────────────
//
// Production launchers select `bundle`, where the configured app bundle is
// authoritative and every requested helper must be an executable file.
// Local callers must explicitly select `development` before the historical
// compile-if-stale ~/.spectra/bin behavior is available. Specific helper
// overrides remain the highest-precedence, authoritative seam in either mode.

export const HELPER_MODE_ENV = 'SPECTRA_HELPER_MODE'
export const BUNDLE_HELPERS_DIR_ENV = 'SPECTRA_APP_BUNDLE_HELPERS_DIR'
export const BUNDLE_PATH_ENV = 'SPECTRA_APP_BUNDLE_PATH'
export const NATIVE_HELPER_PATH_ENV = 'SPECTRA_NATIVE_HELPER_PATH'
export const CURSOR_SAMPLER_PATH_ENV = 'SPECTRA_CURSOR_SAMPLER_PATH'
export const WINDOW_BOUNDS_PATH_ENV = 'SPECTRA_WINDOW_BOUNDS_BIN'

export type HelperMode = 'bundle' | 'development'

const DEFAULT_BUNDLE_CANDIDATES = [
  '/Applications/Spectra.app',
  join(homedir(), 'Applications', 'Spectra.app'),
]

function isExecutableFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const attributes = lstatSync(path)
    if (attributes.isSymbolicLink() || !attributes.isFile()) return false
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveHelperMode(): HelperMode | undefined {
  const raw = process.env[HELPER_MODE_ENV]?.trim()
  if (!raw) return undefined
  if (raw === 'bundle' || raw === 'development') return raw
  throw new Error(
    `${HELPER_MODE_ENV} must be "bundle" or "development"; received ${JSON.stringify(raw)}`,
  )
}

interface ConfiguredBundleHelpersDir {
  path: string
  source: string
}

function configuredEnvironmentValue(key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(process.env, key)) return null
  const value = process.env[key]?.trim() ?? ''
  if (!value) throw new Error(`${key} is configured but empty`)
  return value
}

function configuredBundleHelpersDir(): ConfiguredBundleHelpersDir | null {
  const explicitDir = configuredEnvironmentValue(BUNDLE_HELPERS_DIR_ENV)
  if (explicitDir) return { path: explicitDir, source: BUNDLE_HELPERS_DIR_ENV }

  const explicitBundle = configuredEnvironmentValue(BUNDLE_PATH_ENV)
  if (explicitBundle) {
    return {
      path: join(explicitBundle, 'Contents', 'Helpers'),
      source: BUNDLE_PATH_ENV,
    }
  }
  return null
}

function requirePhysicalBundleHelpersDir(path: string, source: string): string {
  const expectedPath = resolve(path)
  try {
    const attributes = lstatSync(path)
    const physicalPath = realpathSync(path)
    if (attributes.isSymbolicLink() || !attributes.isDirectory() || physicalPath !== expectedPath) {
      throw new Error('not a physical directory')
    }
    return expectedPath
  } catch {
    throw new Error(
      `Bundle Helpers directory from ${source} must be a physical, non-symlink directory: ${path}`,
    )
  }
}

/** Locate an available bundle Helpers directory for unset-mode app discovery. */
export function resolveBundleHelpersDir(): string | null {
  const configured = configuredBundleHelpersDir()
  if (configured) {
    return requirePhysicalBundleHelpersDir(configured.path, configured.source)
  }

  for (const bundlePath of DEFAULT_BUNDLE_CANDIDATES) {
    const helpersDir = join(bundlePath, 'Contents', 'Helpers')
    if (!existsSync(helpersDir)) continue
    try {
      return requirePhysicalBundleHelpersDir(helpersDir, 'installed Spectra.app')
    } catch {
      continue
    }
  }
  return null
}

function requireExecutableHelper(path: string, source: string): string {
  if (isExecutableFile(path)) return path
  throw new Error(
    `Spectra helper from ${source} must be a regular, non-symlink executable: ${path}`,
  )
}

function requireBundledExecutableHelper(
  helpersDir: string,
  helperName: string,
  source: string,
): string {
  const physicalHelpersDir = requirePhysicalBundleHelpersDir(helpersDir, source)
  const candidate = resolve(physicalHelpersDir, helperName)
  const relativeCandidate = relative(physicalHelpersDir, candidate)
  if (
    relativeCandidate === '..'
    || relativeCandidate.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(relativeCandidate)
  ) {
    throw new Error(`Spectra helper from ${source} escapes Contents/Helpers: ${candidate}`)
  }
  try {
    if (realpathSync(candidate) !== candidate) {
      throw new Error('helper resolves through a symbolic link')
    }
  } catch {
    throw new Error(
      `Spectra helper from ${source} must remain a physical file inside Contents/Helpers: ${candidate}`,
    )
  }
  return requireExecutableHelper(candidate, source)
}

/**
 * Resolve a bundle-contained helper without enabling a home fallback.
 * Bundle mode requires an explicit bundle/helpers setting. Development
 * returns directly to the caller's home/compile path so one process never
 * mixes bare and bundled helper attribution.
 */
export function resolveBundledHelperPath(helperName: string): string | null {
  const mode = resolveHelperMode()
  if (mode === 'bundle') {
    const configured = configuredBundleHelpersDir()
    if (!configured) {
      throw new Error(
        `${HELPER_MODE_ENV}=bundle requires ${BUNDLE_HELPERS_DIR_ENV} or ${BUNDLE_PATH_ENV}`,
      )
    }
    return requireBundledExecutableHelper(configured.path, helperName, configured.source)
  }

  if (mode === 'development') return null

  // With no explicit mode, a configured bundle is still authoritative. This
  // prevents a malformed production environment from silently reaching home.
  const configured = configuredBundleHelpersDir()
  if (configured) {
    return requireBundledExecutableHelper(configured.path, helperName, configured.source)
  }

  const helpersDir = resolveBundleHelpersDir()
  if (!helpersDir) return null
  return requireBundledExecutableHelper(helpersDir, helperName, 'installed Spectra.app')
}

function resolveHelperPath(
  helperName: string,
  overrideEnv: string | undefined,
): string | null {
  if (overrideEnv) {
    const override = configuredEnvironmentValue(overrideEnv)
    if (override) {
      if (resolveHelperMode() === 'bundle') {
        const configured = configuredBundleHelpersDir()
        if (!configured) {
          throw new Error(
            `${HELPER_MODE_ENV}=bundle requires ${BUNDLE_HELPERS_DIR_ENV} or ${BUNDLE_PATH_ENV}`,
          )
        }
        const expectedOverride = resolve(configured.path, helperName)
        if (resolve(override) !== expectedOverride) {
          throw new Error(
            `${overrideEnv} must resolve to ${expectedOverride} in bundle mode; received ${override}`,
          )
        }
        return requireBundledExecutableHelper(configured.path, helperName, overrideEnv)
      }
      return requireExecutableHelper(override, overrideEnv)
    }
  }

  const bundled = resolveBundledHelperPath(helperName)
  if (bundled) return bundled
  if (resolveHelperMode() === 'development') return null

  throw new Error(
    `No executable bundle helper resolved for ${helperName}; set ${HELPER_MODE_ENV}=development to use ${BIN_DIR}`,
  )
}

export function isStale(): boolean {
  if (!existsSync(BINARY_PATH)) return true
  if (!existsSync(HASH_PATH)) return true
  if (!hasExpectedSignature(BINARY_PATH)) return true

  const swiftDir = findSwiftSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(HASH_PATH, 'utf-8').trim()

  return currentHash !== storedHash
}

export function isCompositeStale(): boolean {
  if (!existsSync(COMPOSITE_BINARY_PATH)) return true
  if (!existsSync(COMPOSITE_HASH_PATH)) return true
  if (!existsSync(SCREEN_RECORDING_PREFLIGHT_PATH)) return true
  if (!existsSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH)) return true
  if (!hasExpectedSignature(COMPOSITE_BINARY_PATH)) return true
  if (!hasExpectedSignature(SCREEN_RECORDING_PREFLIGHT_PATH)) return true

  const swiftDir = findCompositeSwiftSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(COMPOSITE_HASH_PATH, 'utf-8').trim()
  if (currentHash !== storedHash) return true

  const preflightDir = findScreenRecordingPreflightSource()
  const preflightFiles = getSwiftFiles(preflightDir)
  const preflightHash = computeSourceHash(preflightFiles)
  const storedPreflightHash = readFileSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH, 'utf-8').trim()

  return preflightHash !== storedPreflightHash
}

export function isScreenRecordingPreflightStale(): boolean {
  if (!existsSync(SCREEN_RECORDING_PREFLIGHT_PATH)) return true
  if (!existsSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH)) return true
  if (!hasExpectedSignature(SCREEN_RECORDING_PREFLIGHT_PATH)) return true

  const swiftDir = findScreenRecordingPreflightSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH, 'utf-8').trim()

  return currentHash !== storedHash
}

export function isCursorSamplerStale(): boolean {
  if (!existsSync(CURSOR_SAMPLER_BINARY_PATH)) return true
  if (!existsSync(CURSOR_SAMPLER_HASH_PATH)) return true
  if (!hasExpectedSignature(CURSOR_SAMPLER_BINARY_PATH)) return true

  const swiftDir = findCursorSamplerSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(CURSOR_SAMPLER_HASH_PATH, 'utf-8').trim()

  return currentHash !== storedHash
}

export function isTextRenderStale(): boolean {
  if (!existsSync(TEXT_RENDER_BINARY_PATH)) return true
  if (!existsSync(TEXT_RENDER_HASH_PATH)) return true
  if (!hasExpectedSignature(TEXT_RENDER_BINARY_PATH)) return true

  const swiftDir = findTextRenderSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(TEXT_RENDER_HASH_PATH, 'utf-8').trim()

  return currentHash !== storedHash
}

export function compile(): void {
  const swiftDir = findSwiftSource()
  const files = getSwiftFiles(swiftDir)

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true })

  // Check for swiftc
  try {
    execSync('which swiftc', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'swiftc not found. Install Xcode Command Line Tools:\n'
      + '  xcode-select --install'
    )
  }

  const frameworks = [
    '-framework', 'Foundation',
    '-framework', 'ApplicationServices',
    '-framework', 'AppKit',
    '-framework', 'CoreGraphics',
    '-framework', 'Vision',
    '-framework', 'ScreenCaptureKit',
    '-framework', 'AVFoundation',
    '-framework', 'CoreMedia',
    '-framework', 'CoreVideo',
  ]

  const cmd = ['swiftc', ...files, ...frameworks, '-o', BINARY_PATH].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Swift compilation failed:\n${msg}`)
  }
  signNativeBinary(BINARY_PATH)

  // Write source hash
  const hash = computeSourceHash(files)
  writeFileSync(HASH_PATH, hash)
}

export function compileComposite(): void {
  const swiftDir = findCompositeSwiftSource()
  const files = getSwiftFiles(swiftDir)

  mkdirSync(BIN_DIR, { recursive: true })

  try {
    execSync('which swiftc', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'swiftc not found. Install Xcode Command Line Tools:\n'
      + '  xcode-select --install'
    )
  }

  const frameworks = [
    '-framework', 'Foundation',
    '-framework', 'ScreenCaptureKit',
    '-framework', 'AVFoundation',
    '-framework', 'CoreMedia',
    '-framework', 'CoreVideo',
    '-framework', 'CoreGraphics',
    '-framework', 'AppKit',
  ]

  const cmd = ['swiftc', '-parse-as-library', ...files, ...frameworks, '-o', COMPOSITE_BINARY_PATH].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Composite Swift compilation failed:\n${msg}`)
  }
  signNativeBinary(COMPOSITE_BINARY_PATH)

  const hash = computeSourceHash(files)
  writeFileSync(COMPOSITE_HASH_PATH, hash)

  compileScreenRecordingPreflight()
}

export function compileScreenRecordingPreflight(): void {
  const swiftDir = findScreenRecordingPreflightSource()
  const files = getSwiftFiles(swiftDir)

  mkdirSync(BIN_DIR, { recursive: true })

  try {
    execSync('which swiftc', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'swiftc not found. Install Xcode Command Line Tools:\n'
      + '  xcode-select --install'
    )
  }

  const cmd = [
    'swiftc', ...files,
    '-framework', 'Foundation',
    '-framework', 'CoreGraphics',
    '-o', SCREEN_RECORDING_PREFLIGHT_PATH,
  ].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Screen Recording preflight Swift compilation failed:\n${msg}`)
  }

  signNativeBinary(SCREEN_RECORDING_PREFLIGHT_PATH)

  const hash = computeSourceHash(files)
  writeFileSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH, hash)
}

export function compileDaemonLauncher(): string {
  const swiftDir = findDaemonLauncherSource()
  const files = getSwiftFiles(swiftDir)

  mkdirSync(BIN_DIR, { recursive: true })

  const cmd = [
    'swiftc', ...files,
    '-framework', 'Foundation',
    '-o', DAEMON_LAUNCHER_PATH,
  ].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Daemon launcher Swift compilation failed:\n${msg}`)
  }

  signNativeBinary(DAEMON_LAUNCHER_PATH)
  return DAEMON_LAUNCHER_PATH
}

export function compileCursorSampler(): string {
  const swiftDir = findCursorSamplerSource()
  const files = getSwiftFiles(swiftDir)

  mkdirSync(BIN_DIR, { recursive: true })

  const cmd = [
    'swiftc', ...files,
    '-framework', 'Foundation',
    '-framework', 'ApplicationServices',
    '-framework', 'AppKit',
    '-framework', 'CoreGraphics',
    '-o', CURSOR_SAMPLER_BINARY_PATH,
  ].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Cursor sampler Swift compilation failed:\n${msg}`)
  }

  signNativeBinary(CURSOR_SAMPLER_BINARY_PATH)

  const hash = computeSourceHash(files)
  writeFileSync(CURSOR_SAMPLER_HASH_PATH, hash)
  return CURSOR_SAMPLER_BINARY_PATH
}

export function compileTextRender(): void {
  const swiftDir = findTextRenderSource()
  const files = getSwiftFiles(swiftDir)

  mkdirSync(BIN_DIR, { recursive: true })

  try {
    execSync('which swiftc', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'swiftc not found. Install Xcode Command Line Tools:\n'
      + '  xcode-select --install'
    )
  }

  const cmd = [
    'swiftc', ...files,
    '-framework', 'Foundation',
    '-framework', 'CoreGraphics',
    '-framework', 'CoreText',
    '-framework', 'CoreImage',
    '-framework', 'ImageIO',
    '-framework', 'UniformTypeIdentifiers',
    '-o', TEXT_RENDER_BINARY_PATH,
  ].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Text render Swift compilation failed:\n${msg}`)
  }

  signNativeBinary(TEXT_RENDER_BINARY_PATH)

  const hash = computeSourceHash(files)
  writeFileSync(TEXT_RENDER_HASH_PATH, hash)
}

export function ensureBinary(): string {
  const resolved = resolveHelperPath('spectra-native', NATIVE_HELPER_PATH_ENV)
  if (resolved) return resolved
  if (isStale()) {
    withCompileLock('native', () => {
      if (isStale()) compile()
    })
  }
  return BINARY_PATH
}

export function ensureCompositeBinary(): string {
  const resolved = resolveHelperPath('spectra-composite-capture', undefined)
  if (resolved) return resolved
  if (isCompositeStale()) {
    withCompileLock('composite', () => {
      if (isCompositeStale()) compileComposite()
    })
  }
  return COMPOSITE_BINARY_PATH
}

export function ensureScreenRecordingPreflightBinary(): string {
  const resolved = resolveHelperPath('spectra-screen-recording-preflight', undefined)
  if (resolved) return resolved
  if (isScreenRecordingPreflightStale()) {
    withCompileLock('screen-recording-preflight', () => {
      if (isScreenRecordingPreflightStale()) compileScreenRecordingPreflight()
    })
  }
  return SCREEN_RECORDING_PREFLIGHT_PATH
}

export function ensureCursorSamplerBinary(): string {
  const resolved = resolveHelperPath('spectra-cursor-sampler', CURSOR_SAMPLER_PATH_ENV)
  if (resolved) return resolved
  if (isCursorSamplerStale()) {
    withCompileLock('cursor-sampler', () => {
      if (isCursorSamplerStale()) compileCursorSampler()
    })
  }
  return CURSOR_SAMPLER_BINARY_PATH
}

export function ensureTextRenderBinary(): string {
  const resolved = resolveHelperPath('spectra-text-render', undefined)
  if (resolved) return resolved
  if (isTextRenderStale()) {
    withCompileLock('text-render', () => {
      if (isTextRenderStale()) compileTextRender()
    })
  }
  return TEXT_RENDER_BINARY_PATH
}

/** Window bounds has a build-script-owned development binary, not an on-demand compiler. */
export function ensureWindowBoundsBinary(): string {
  return resolveHelperPath('spectra-window-bounds', WINDOW_BOUNDS_PATH_ENV)
    ?? WINDOW_BOUNDS_BINARY_PATH
}

function withCompileLock(name: string, fn: () => void): void {
  mkdirSync(BIN_DIR, { recursive: true })
  const lockPath = join(BIN_DIR, `.${name}.compile.lock`)
  const deadline = Date.now() + COMPILE_LOCK_WAIT_MS

  while (true) {
    let fd: number | undefined
    try {
      fd = openSync(lockPath, 'wx')
      try {
        fn()
      } finally {
        if (fd !== undefined) closeSync(fd)
        rmSync(lockPath, { force: true })
      }
      return
    } catch (error) {
      if (fd !== undefined) {
        try { closeSync(fd) } catch {}
      }
      if (!isExistingLockError(error)) throw error
      removeStaleCompileLock(lockPath)
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${name} compile lock: ${lockPath}`)
      }
      sleepSync(100)
    }
  }
}

function isExistingLockError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'EEXIST'
}

function removeStaleCompileLock(lockPath: string): void {
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs
    if (ageMs > COMPILE_LOCK_STALE_MS) rmSync(lockPath, { force: true })
  } catch {
    // Missing lock means the other compiler finished between open attempts.
  }
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, ms)
}

export function compileTestApp(): string {
  const swiftDir = findSwiftSource()
  const testAppDir = join(swiftDir, 'TestApp')

  if (!existsSync(testAppDir)) {
    throw new Error(`Test app source not found at ${testAppDir}`)
  }

  mkdirSync(BIN_DIR, { recursive: true })

  const files = readdirSync(testAppDir)
    .filter(f => f.endsWith('.swift'))
    .map(f => join(testAppDir, f))

  const cmd = [
    'swiftc', ...files,
    '-framework', 'SwiftUI',
    '-framework', 'AppKit',
    '-o', TEST_APP_PATH,
  ].join(' ')

  execSync(cmd, { stdio: 'pipe' })
  return TEST_APP_PATH
}

export {
  BINARY_PATH,
  BIN_DIR,
  COMPOSITE_BINARY_PATH,
  CURSOR_SAMPLER_BINARY_PATH,
  DAEMON_LAUNCHER_PATH,
  SCREEN_RECORDING_PREFLIGHT_PATH,
  TEST_APP_PATH,
  TEXT_RENDER_BINARY_PATH,
  WINDOW_BOUNDS_BINARY_PATH,
}
