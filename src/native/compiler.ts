// src/native/compiler.ts
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const BIN_DIR = join(homedir(), '.spectra', 'bin')
const BINARY_PATH = join(BIN_DIR, 'spectra-native')
const HASH_PATH = join(BIN_DIR, '.source-hash')
const TEST_APP_PATH = join(BIN_DIR, 'spectra-test-app')

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

export function isStale(): boolean {
  if (!existsSync(BINARY_PATH)) return true
  if (!existsSync(HASH_PATH)) return true

  const swiftDir = findSwiftSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(HASH_PATH, 'utf-8').trim()

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
  ]

  const cmd = ['swiftc', ...files, ...frameworks, '-o', BINARY_PATH].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Swift compilation failed:\n${msg}`)
  }

  // Write source hash
  const hash = computeSourceHash(files)
  writeFileSync(HASH_PATH, hash)
}

export function ensureBinary(): string {
  if (isStale()) {
    compile()
  }
  return BINARY_PATH
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

export { BINARY_PATH, BIN_DIR, TEST_APP_PATH }
