// macos/Spectra/DaemonCore/StoragePath.swift
//
// M3.G1 flip (S3) — storage-path resolution parity with the TS daemon.
// Ports src/core/storage.ts (`findProjectRoot` + `getStoragePath`) verbatim
// so the Swift daemon-core resolves the SAME `.spectra` root the TS daemon
// would, given the same cwd/HOME — under both a repo-nested cwd and a
// launchd cwd of "/". `resolveStorageRoot()` (moved here from
// LibraryStore.swift, call-site-compatible) layers the pre-existing
// SPECTRA_HOME test-isolation override on top, since:
//   1. TS's getStoragePath never reads SPECTRA_HOME (verified — grep of
//      src/**/*.ts finds no reader); the harness at
//      tests/conformance/lib/daemon-endpoint.ts achieves isolation by ALSO
//      setting cwd to the isolated tmp HOME (its own comment: "no code reads
//      [SPECTRA_HOME] today ... it is not what makes this work").
//   2. This repo's Swift side, however, already relies on SPECTRA_HOME as an
//      explicit override in two places that do NOT relocate cwd:
//      SessionStore.swift:597 (sessionDirLocked) and the legacy
//      macos/Spectra/DaemonCore/verify-g1-suite.ts harness (spawns the
//      compiled binary with cwd inherited from the repo root, HOME+
//      SPECTRA_HOME pointed at a temp dir, and NO cwd override) — if the
//      marker walk below ran unconditionally there, it would find the repo's
//      own `.git` at cwd and resolve to the repo's PROTECTED real .spectra/,
//      which is exactly the guardrail this plan forbids. Keeping the
//      override highest-precedence preserves that existing contract without
//      touching verify-g1-suite.ts (S4-owned) while STILL giving production
//      (no SPECTRA_HOME set) byte-for-byte TS parity via the walk.
//
//   M3.G2 S1 fix (Advisor ruling, Item 2 real half, 2026-07-03): the
//   SPECTRA_HOME override must append `.spectra` (see `resolveStorageRoot()`
//   below), matching TS's `getStoragePath()` HOME fallback
//   (`join(homedir(), '.spectra')`) — SPECTRA_HOME is a HOME substitute, not
//   an already-resolved storage root. The prior bare-passthrough dropped the
//   `.spectra` segment, spraying session/library/recording artifacts into
//   `<home>/sessions|library|recordings/...` instead of the protected
//   `<home>/.spectra/...` tree.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Mirrors `PROJECT_MARKERS` in src/core/storage.ts exactly (order does not
/// matter for correctness — any single match stops the walk at that dir —
/// but is kept identical to the source for clarity).
let projectMarkers = [".git", "package.json", ".spectra"]

/// Ports `findProjectRoot(startDir)` from src/core/storage.ts: walks upward
/// from `startDir`, returning the first ancestor (inclusive) containing any
/// of `projectMarkers`, or nil if the filesystem root is reached with no
/// match (mirrors the TS `dirname(dir) === dir` break condition).
func findProjectRoot(startDir: String) -> String? {
    let fm = FileManager.default
    var dir = startDir
    while true {
        for marker in projectMarkers {
            let markerPath = (dir as NSString).appendingPathComponent(marker)
            if fm.fileExists(atPath: markerPath) { return dir }
        }
        let parent = (dir as NSString).deletingLastPathComponent
        if parent == dir || parent.isEmpty { break } // reached filesystem root
        dir = parent
    }
    return nil
}

/// Ports `getStoragePath(cwd?)` from src/core/storage.ts verbatim: resolve
/// the project root by walking up from `cwd` (defaults to the process's
/// actual current directory, matching TS's `cwd ?? process.cwd()`); if a
/// marker is found, `<root>/.spectra`; otherwise fall back to the home
/// directory's `.spectra` (TS's `homedir()`, honoring an overridden `HOME`
/// env var exactly as Node's `os.homedir()` does on POSIX, else
/// `NSHomeDirectory()`).
///
/// Pure TS port — deliberately does NOT consult `SPECTRA_HOME`. See
/// `resolveStorageRoot()` for the daemon-internal override layered on top.
func getStoragePath(cwd: String? = nil) -> String {
    let startDir = cwd ?? FileManager.default.currentDirectoryPath
    if let root = findProjectRoot(startDir: startDir) {
        return (root as NSString).appendingPathComponent(".spectra")
    }
    let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
    return (home as NSString).appendingPathComponent(".spectra")
}

/// Resolves the daemon's storage root (moved here from LibraryStore.swift;
/// call sites unchanged — still a bare top-level `resolveStorageRoot()`).
/// Precedence: `SPECTRA_HOME` env override (existing isolation contract used
/// by SessionStore.swift and the legacy verify-g1-suite.ts harness) — else
/// the TS-parity cwd-marker walk via `getStoragePath()`. Production
/// deployments never set `SPECTRA_HOME`, so production behavior is the exact
/// TS walk (T-05).
///
/// M3.G2 S1 fix (Advisor ruling, Item 2 real half): `SPECTRA_HOME` is a
/// substitute for `HOME`, NOT an already-resolved `.spectra` root — the
/// G1/G2 harnesses set `SPECTRA_HOME` to the SAME raw temp dir as `HOME`
/// (verify-g2-suite.ts's `bootEnvFor`, tests/conformance/lib/
/// daemon-endpoint.ts), mirroring how TS's `getStoragePath()` home-fallback
/// does `join(homedir(), '.spectra')` (src/core/storage.ts:28). Returning
/// `spectraHome` bare (pre-fix) dropped the `.spectra` segment Swift's own
/// `getStoragePath()` walk appends below, diverging from TS's resolved path
/// under identical HOME/SPECTRA_HOME (g2-t21-masks.json discover.detail).
func resolveStorageRoot() -> String {
    let env = ProcessInfo.processInfo.environment
    if let spectraHome = env["SPECTRA_HOME"], !spectraHome.isEmpty {
        return (spectraHome as NSString).appendingPathComponent(".spectra")
    }
    return getStoragePath()
}
