// src/native/compiler.ts
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const BIN_DIR = join(homedir(), '.spectra', 'bin');
const BINARY_PATH = join(BIN_DIR, 'spectra-native');
const HASH_PATH = join(BIN_DIR, '.source-hash');
const COMPOSITE_BINARY_PATH = join(BIN_DIR, 'spectra-composite-capture');
const COMPOSITE_HASH_PATH = join(BIN_DIR, '.composite-source-hash');
const SCREEN_RECORDING_PREFLIGHT_PATH = join(BIN_DIR, 'spectra-screen-recording-preflight');
const SCREEN_RECORDING_PREFLIGHT_HASH_PATH = join(BIN_DIR, '.screen-recording-preflight-source-hash');
const DAEMON_LAUNCHER_PATH = join(BIN_DIR, 'spectra-daemon-launcher');
const TEST_APP_PATH = join(BIN_DIR, 'spectra-test-app');
const DEFAULT_CODESIGN_IDENTITY = 'Apple Development: tyrone.ross@icloud.com (7AK2KDLAVP)';
// Find project root by looking for native/swift/ directory
function findSwiftSource() {
    // Walk up from this file's location to find the project root
    let dir = resolve(import.meta.dirname, '..', '..');
    const swiftDir = join(dir, 'native', 'swift');
    if (!existsSync(swiftDir)) {
        throw new Error(`Swift source not found at ${swiftDir}`);
    }
    return swiftDir;
}
function findCompositeSwiftSource() {
    const swiftDir = join(findSwiftSource(), 'composite-capture');
    if (!existsSync(swiftDir)) {
        throw new Error(`Composite Swift source not found at ${swiftDir}`);
    }
    return swiftDir;
}
function findScreenRecordingPreflightSource() {
    const swiftDir = join(findSwiftSource(), 'screen-recording-preflight');
    if (!existsSync(swiftDir)) {
        throw new Error(`Screen Recording preflight Swift source not found at ${swiftDir}`);
    }
    return swiftDir;
}
function findDaemonLauncherSource() {
    const swiftDir = join(findSwiftSource(), 'daemon-launcher');
    if (!existsSync(swiftDir)) {
        throw new Error(`Daemon launcher Swift source not found at ${swiftDir}`);
    }
    return swiftDir;
}
function getSwiftFiles(swiftDir) {
    return readdirSync(swiftDir)
        .filter(f => f.endsWith('.swift'))
        .map(f => join(swiftDir, f))
        .sort();
}
function computeSourceHash(files) {
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(readFileSync(file));
    }
    return hash.digest('hex');
}
function codesignIdentity() {
    if (process.env.SPECTRA_CODESIGN === '0')
        return null;
    const identity = process.env.SPECTRA_CODESIGN_IDENTITY ?? DEFAULT_CODESIGN_IDENTITY;
    if (identity === 'skip')
        return null;
    return identity;
}
function hasExpectedSignature(binaryPath) {
    const identity = codesignIdentity();
    if (!identity)
        return true;
    if (!existsSync(binaryPath))
        return false;
    try {
        const result = spawnSync('codesign', ['-dvv', binaryPath], {
            encoding: 'utf8',
        });
        if (result.status !== 0)
            return false;
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        return output.includes(`Authority=${identity}`)
            && /TeamIdentifier=(?!not set)/.test(output);
    }
    catch {
        return false;
    }
}
function signNativeBinary(binaryPath) {
    const identity = codesignIdentity();
    if (!identity)
        return;
    try {
        execFileSync('codesign', [
            '--force',
            '--timestamp=none',
            '--options', 'runtime',
            '--sign', identity,
            binaryPath,
        ], { stdio: 'pipe' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.stderr?.toString() ?? err.message : String(err);
        throw new Error(`codesign failed for ${binaryPath}:\n${msg}`);
    }
}
export function isStale() {
    if (!existsSync(BINARY_PATH))
        return true;
    if (!existsSync(HASH_PATH))
        return true;
    if (!hasExpectedSignature(BINARY_PATH))
        return true;
    const swiftDir = findSwiftSource();
    const files = getSwiftFiles(swiftDir);
    const currentHash = computeSourceHash(files);
    const storedHash = readFileSync(HASH_PATH, 'utf-8').trim();
    return currentHash !== storedHash;
}
export function isCompositeStale() {
    if (!existsSync(COMPOSITE_BINARY_PATH))
        return true;
    if (!existsSync(COMPOSITE_HASH_PATH))
        return true;
    if (!existsSync(SCREEN_RECORDING_PREFLIGHT_PATH))
        return true;
    if (!existsSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH))
        return true;
    if (!hasExpectedSignature(COMPOSITE_BINARY_PATH))
        return true;
    if (!hasExpectedSignature(SCREEN_RECORDING_PREFLIGHT_PATH))
        return true;
    const swiftDir = findCompositeSwiftSource();
    const files = getSwiftFiles(swiftDir);
    const currentHash = computeSourceHash(files);
    const storedHash = readFileSync(COMPOSITE_HASH_PATH, 'utf-8').trim();
    if (currentHash !== storedHash)
        return true;
    const preflightDir = findScreenRecordingPreflightSource();
    const preflightFiles = getSwiftFiles(preflightDir);
    const preflightHash = computeSourceHash(preflightFiles);
    const storedPreflightHash = readFileSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH, 'utf-8').trim();
    return preflightHash !== storedPreflightHash;
}
export function isScreenRecordingPreflightStale() {
    if (!existsSync(SCREEN_RECORDING_PREFLIGHT_PATH))
        return true;
    if (!existsSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH))
        return true;
    if (!hasExpectedSignature(SCREEN_RECORDING_PREFLIGHT_PATH))
        return true;
    const swiftDir = findScreenRecordingPreflightSource();
    const files = getSwiftFiles(swiftDir);
    const currentHash = computeSourceHash(files);
    const storedHash = readFileSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH, 'utf-8').trim();
    return currentHash !== storedHash;
}
export function compile() {
    const swiftDir = findSwiftSource();
    const files = getSwiftFiles(swiftDir);
    // Ensure bin directory exists
    mkdirSync(BIN_DIR, { recursive: true });
    // Check for swiftc
    try {
        execSync('which swiftc', { stdio: 'pipe' });
    }
    catch {
        throw new Error('swiftc not found. Install Xcode Command Line Tools:\n'
            + '  xcode-select --install');
    }
    const frameworks = [
        '-framework', 'Foundation',
        '-framework', 'ApplicationServices',
        '-framework', 'AppKit',
        '-framework', 'CoreGraphics',
    ];
    const cmd = ['swiftc', ...files, ...frameworks, '-o', BINARY_PATH].join(' ');
    try {
        execSync(cmd, { stdio: 'pipe' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.stderr?.toString() ?? err.message : String(err);
        throw new Error(`Swift compilation failed:\n${msg}`);
    }
    signNativeBinary(BINARY_PATH);
    // Write source hash
    const hash = computeSourceHash(files);
    writeFileSync(HASH_PATH, hash);
}
export function compileComposite() {
    const swiftDir = findCompositeSwiftSource();
    const files = getSwiftFiles(swiftDir);
    mkdirSync(BIN_DIR, { recursive: true });
    try {
        execSync('which swiftc', { stdio: 'pipe' });
    }
    catch {
        throw new Error('swiftc not found. Install Xcode Command Line Tools:\n'
            + '  xcode-select --install');
    }
    const frameworks = [
        '-framework', 'Foundation',
        '-framework', 'ScreenCaptureKit',
        '-framework', 'AVFoundation',
        '-framework', 'CoreMedia',
        '-framework', 'CoreVideo',
        '-framework', 'CoreGraphics',
        '-framework', 'AppKit',
    ];
    const cmd = ['swiftc', '-parse-as-library', ...files, ...frameworks, '-o', COMPOSITE_BINARY_PATH].join(' ');
    try {
        execSync(cmd, { stdio: 'pipe' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.stderr?.toString() ?? err.message : String(err);
        throw new Error(`Composite Swift compilation failed:\n${msg}`);
    }
    signNativeBinary(COMPOSITE_BINARY_PATH);
    const hash = computeSourceHash(files);
    writeFileSync(COMPOSITE_HASH_PATH, hash);
    compileScreenRecordingPreflight();
}
export function compileScreenRecordingPreflight() {
    const swiftDir = findScreenRecordingPreflightSource();
    const files = getSwiftFiles(swiftDir);
    mkdirSync(BIN_DIR, { recursive: true });
    try {
        execSync('which swiftc', { stdio: 'pipe' });
    }
    catch {
        throw new Error('swiftc not found. Install Xcode Command Line Tools:\n'
            + '  xcode-select --install');
    }
    const cmd = [
        'swiftc', ...files,
        '-framework', 'Foundation',
        '-framework', 'CoreGraphics',
        '-o', SCREEN_RECORDING_PREFLIGHT_PATH,
    ].join(' ');
    try {
        execSync(cmd, { stdio: 'pipe' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.stderr?.toString() ?? err.message : String(err);
        throw new Error(`Screen Recording preflight Swift compilation failed:\n${msg}`);
    }
    signNativeBinary(SCREEN_RECORDING_PREFLIGHT_PATH);
    const hash = computeSourceHash(files);
    writeFileSync(SCREEN_RECORDING_PREFLIGHT_HASH_PATH, hash);
}
export function compileDaemonLauncher() {
    const swiftDir = findDaemonLauncherSource();
    const files = getSwiftFiles(swiftDir);
    mkdirSync(BIN_DIR, { recursive: true });
    const cmd = [
        'swiftc', ...files,
        '-framework', 'Foundation',
        '-o', DAEMON_LAUNCHER_PATH,
    ].join(' ');
    try {
        execSync(cmd, { stdio: 'pipe' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.stderr?.toString() ?? err.message : String(err);
        throw new Error(`Daemon launcher Swift compilation failed:\n${msg}`);
    }
    signNativeBinary(DAEMON_LAUNCHER_PATH);
    return DAEMON_LAUNCHER_PATH;
}
export function ensureBinary() {
    if (isStale()) {
        compile();
    }
    return BINARY_PATH;
}
export function ensureCompositeBinary() {
    if (isCompositeStale()) {
        compileComposite();
    }
    return COMPOSITE_BINARY_PATH;
}
export function ensureScreenRecordingPreflightBinary() {
    if (isScreenRecordingPreflightStale()) {
        compileScreenRecordingPreflight();
    }
    return SCREEN_RECORDING_PREFLIGHT_PATH;
}
export function compileTestApp() {
    const swiftDir = findSwiftSource();
    const testAppDir = join(swiftDir, 'TestApp');
    if (!existsSync(testAppDir)) {
        throw new Error(`Test app source not found at ${testAppDir}`);
    }
    mkdirSync(BIN_DIR, { recursive: true });
    const files = readdirSync(testAppDir)
        .filter(f => f.endsWith('.swift'))
        .map(f => join(testAppDir, f));
    const cmd = [
        'swiftc', ...files,
        '-framework', 'SwiftUI',
        '-framework', 'AppKit',
        '-o', TEST_APP_PATH,
    ].join(' ');
    execSync(cmd, { stdio: 'pipe' });
    return TEST_APP_PATH;
}
export { BINARY_PATH, BIN_DIR, COMPOSITE_BINARY_PATH, DAEMON_LAUNCHER_PATH, SCREEN_RECORDING_PREFLIGHT_PATH, TEST_APP_PATH, };
//# sourceMappingURL=compiler.js.map