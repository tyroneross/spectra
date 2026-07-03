// macos/Spectra/DaemonCore/RecordingOps.swift
//
// M3.G2 — S4 (media-recording), F-14. `startRecording`/`stopRecording`/
// `getRecording` + the single-window recording registry, which is this
// file's concrete `RecordingOwnership` (DriverProtocol.swift §6b) conformer.
// Also owns the ONE frozen `registerCaptureRecordingOps` export (W0 §5) —
// it bundles S4's whole op surface (screenshot + the 3 recording ops) and
// is the ONLY one of the 5 register-hooks with a return value.
//
// ND-2 (no in-process ScreenCaptureKit): startRecording/stopRecording spawn
// the EXISTING `spectra-native` helper binary (native/swift/main.swift,
// compiled+signed to ~/.spectra/bin/spectra-native by src/native/compiler.ts
// `ensureBinary()` — that compile/sign step is NOT ported here, this daemon
// assumes the binary already exists, same as the TS daemon does) as a
// SUBPROCESS, and talks to it over its EXISTING newline-delimited JSON-RPC
// stdio contract (main.swift's `handleStartRecording`/`handleStopRecording`,
// backed by `SingleWindowRecordingStore.shared`) — mirroring
// src/daemon/core-impl.ts's `NativeRecordingProcess` class byte-for-byte:
// method names (`startRecording`/`stopRecording`/`quit`), request shape
// (`{id, method, params}`), response shape (`{id, result}` |
// `{id, error:{code,message}}`), and the SAME THREE TIMEOUTS (15s start /
// 45s stop / 1s quit).
//
// Orchestration parity with core-impl.ts's startRecording/stopRecording:
// macos+appName guard (400 recording_failed), per-session conflict (409),
// window resolution (native CGWindowList enumeration — the same API
// PermissionOps.swift's `listMacWindows` uses; that helper is file-private
// there so this file has its own narrowly-scoped copy of just the
// resolve-one-target logic, not a full listWindows port), cursor-sampler
// spawn + skip-warning semantics, a keep-awake analog (`caffeinate -d -i`,
// ref-counted across concurrent recordings), the black-frame guard +
// probeVideo fallback chain (FfmpegProbe.swift), and the stopRecording
// `Completed | AlreadyStopped` union.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
import CoreGraphics
import AppKit
#if canImport(Darwin)
import Darwin
#endif

// ═══════════════════════════════════════════════════════════════════════════
// §1 — spectra-native subprocess RPC (ports core-impl.ts NativeRecordingProcess)
// ═══════════════════════════════════════════════════════════════════════════

/// Ports src/daemon/core-impl.ts's `NativeRecordingProcess` — spawns the
/// spectra-native binary, writes newline-delimited `{id,method,params}`
/// requests to its stdin, and resolves pending requests by `id` as
/// `{id,result}`/`{id,error}` lines arrive on stdout. Synchronous send() (the
/// HandlerRegistry `Handler` typealias is a synchronous throwing closure, not
/// async) — safe to block the calling thread because SocketServer dispatches
/// connections on a CONCURRENT queue (DriverProtocol.swift §1's own
/// concurrency note): one session's recording RPC blocking its handler thread
/// never blocks another session's request.
final class NativeRecordingRpcProcess: @unchecked Sendable {
    struct RpcError: Error { let message: String }

    private let process = Process()
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private let stderrPipe = Pipe()

    private let lock = NSLock()
    private var nextId = 0
    private var pending: [Int: (semaphore: DispatchSemaphore, box: ResultBox)] = [:]
    private var lineBuffer = Data()
    private var stderrBuffer = Data()
    private var closed = false

    final class ResultBox: @unchecked Sendable {
        var value: Result<[String: Any], RpcError>?
    }

    init(binaryPath: String) throws {
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = []
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.handleStdout(data)
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let self else { return }
            self.lock.lock()
            self.stderrBuffer.append(data)
            self.lock.unlock()
        }
        process.terminationHandler = { [weak self] _ in
            self?.markClosed()
        }

        do {
            try process.run()
        } catch {
            throw RpcError(message: "failed to spawn spectra-native: \(error)")
        }
    }

    var pid: Int32 { process.processIdentifier }

    /// Low-level RPC call. Throws `RpcError` on timeout, process-death, or an
    /// `{error}` response — NEVER returns a partial/nil result silently.
    func send(method: String, params: [String: Any], timeoutMs: Int) throws -> [String: Any] {
        lock.lock()
        if closed {
            lock.unlock()
            throw RpcError(message: "spectra-native recording process is closed")
        }
        nextId += 1
        let id = nextId
        let semaphore = DispatchSemaphore(value: 0)
        let box = ResultBox()
        pending[id] = (semaphore, box)
        lock.unlock()

        let payload: [String: Any] = ["id": id, "method": method, "params": params]
        guard let encoded = try? JSONSerialization.data(withJSONObject: payload) else {
            lock.lock(); pending.removeValue(forKey: id); lock.unlock()
            throw RpcError(message: "failed to encode request for '\(method)'")
        }
        var line = encoded
        line.append(0x0A)
        stdinPipe.fileHandleForWriting.write(line)

        let waitResult = semaphore.wait(timeout: .now() + .milliseconds(timeoutMs))

        lock.lock()
        pending.removeValue(forKey: id)
        let detail = stderrDetailLocked()
        lock.unlock()

        if waitResult == .timedOut {
            throw RpcError(message: "Native recording request '\(method)' timed out after \(timeoutMs)ms\(detail)")
        }
        switch box.value {
        case .some(.success(let result)):
            return result
        case .some(.failure(let err)):
            throw err
        case .none:
            throw RpcError(message: "Native recording request '\(method)' produced no result\(detail)")
        }
    }

    /// `stopRecording` + best-effort `quit` in one call — mirrors
    /// NativeRecordingProcess.stop() (core-impl.ts:1307-1314), which
    /// internally awaits its own `quit()` after a successful stop RPC.
    func stopAndQuit(recordingId: String, sessionId: String) throws -> [String: Any] {
        let result = try send(
            method: "stopRecording",
            params: ["recordingId": recordingId, "sessionId": sessionId],
            timeoutMs: 45_000
        )
        quit()
        return result
    }

    /// Best-effort `quit` RPC (1s timeout) + wait for the child to exit.
    /// NEVER throws — mirrors core-impl.ts's private quit(), which swallows
    /// the send('quit', ...) rejection with `.catch(() => {})`.
    func quit() {
        if closed { return }
        _ = try? send(method: "quit", params: [:], timeoutMs: 1_000)
        _ = waitForExit(timeoutMs: 2_000)
    }

    /// Full teardown: best-effort quit, then SIGTERM, then SIGKILL if still
    /// alive. NEVER throws — mirrors core-impl.ts's abort().
    func abort() {
        if closed { return }
        quit()
        if !closed {
            process.terminate()
            if !waitForExit(timeoutMs: 2_000) {
                #if canImport(Darwin)
                kill(process.processIdentifier, SIGKILL)
                #else
                process.terminate()
                #endif
            }
        }
    }

    @discardableResult
    private func waitForExit(timeoutMs: Int) -> Bool {
        let deadline = DispatchTime.now() + .milliseconds(timeoutMs)
        while process.isRunning, DispatchTime.now() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        return !process.isRunning
    }

    private func markClosed() {
        lock.lock()
        closed = true
        let toReject = pending
        pending.removeAll()
        lock.unlock()
        for (_, entry) in toReject {
            entry.box.value = .failure(RpcError(message: "spectra-native recording process exited"))
            entry.semaphore.signal()
        }
    }

    private func handleStdout(_ chunk: Data) {
        lock.lock()
        lineBuffer.append(chunk)
        var lines: [Data] = []
        while let range = lineBuffer.range(of: Data([0x0A])) {
            lines.append(lineBuffer.subdata(in: lineBuffer.startIndex..<range.lowerBound))
            lineBuffer.removeSubrange(lineBuffer.startIndex..<range.upperBound)
        }
        lock.unlock()

        for lineData in lines {
            guard !lineData.isEmpty,
                  let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  let id = obj["id"] as? Int
            else { continue }

            lock.lock()
            let entry = pending.removeValue(forKey: id)
            lock.unlock()
            guard let entry else { continue }

            if let errorObj = obj["error"] as? [String: Any] {
                let code = errorObj["code"]
                let message = (errorObj["message"] as? String) ?? "Native recording error \(String(describing: code ?? ""))"
                entry.box.value = .failure(RpcError(message: message))
            } else {
                entry.box.value = .success((obj["result"] as? [String: Any]) ?? [:])
            }
            entry.semaphore.signal()
        }
    }

    private func stderrDetailLocked() -> String {
        guard !stderrBuffer.isEmpty, let text = String(data: stderrBuffer, encoding: .utf8) else { return "" }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "" : "\n\(trimmed)"
    }
}

private struct RecordingOpError: Error { let message: String }

private func errorMessage(_ error: Error) -> String {
    if let e = error as? DaemonApiError { return e.message }
    if let e = error as? NativeRecordingRpcProcess.RpcError { return e.message }
    if let e = error as? RecordingOpError { return e.message }
    return String(describing: error)
}

/// `~/.spectra/bin/spectra-native` — the SAME binary path/build the TS daemon
/// resolves via `ensureBinary()` (src/native/compiler.ts). This Swift daemon
/// does not compile/sign it (that remains a TS-side build-tooling concern,
/// out of scope for this G2 wave); if it isn't there yet, startRecording
/// fails with a clear, actionable message rather than trying to build it.
private func resolveNativeBinaryPath() throws -> String {
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".spectra/bin/spectra-native")
    guard FileManager.default.fileExists(atPath: path) else {
        throw RecordingOpError(message: "spectra-native helper binary not found at \(path) — run the TS Spectra daemon/MCP server once (or `npm run build:native`) to compile + sign it; the Swift daemon-core spawns this EXISTING binary rather than re-implementing ScreenCaptureKit in-process (ND-2)")
    }
    return path
}

private func cursorSamplerBinaryPath() -> String {
    (NSHomeDirectory() as NSString).appendingPathComponent(".spectra/bin/spectra-cursor-sampler")
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — Keep-awake analog (ports src/daemon/keep-awake.ts DaemonKeepAwakeController)
// ═══════════════════════════════════════════════════════════════════════════

/// Ref-counted `caffeinate -d -i` — engaged while >=1 recording is active,
/// released the instant the last one stops. A spawn failure is best-effort
/// (matches the TS reference): the recording proceeds without keep-awake
/// rather than failing outright — losing keep-awake is a quality regression,
/// not a correctness one.
final class KeepAwakeController: @unchecked Sendable {
    private let lock = NSLock()
    private var active: Set<String> = []
    private var process: Process?

    func recordingStarted(_ recordingId: String) {
        lock.lock()
        let wasIdle = active.isEmpty
        active.insert(recordingId)
        lock.unlock()
        if wasIdle { ensureEngaged() }
    }

    func recordingStopped(_ recordingId: String) {
        lock.lock()
        active.remove(recordingId)
        let isIdle = active.isEmpty
        lock.unlock()
        if isIdle { release() }
    }

    private func ensureEngaged() {
        lock.lock()
        guard process == nil else { lock.unlock(); return }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate")
        proc.arguments = ["-d", "-i"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
            process = proc
        } catch {
            // Best-effort — see type doc.
        }
        lock.unlock()
    }

    private func release() {
        lock.lock()
        let proc = process
        process = nil
        lock.unlock()
        proc?.terminate()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — Cursor sampler (ports core-impl.ts startCursorSampler/stopCursorSampler)
// ═══════════════════════════════════════════════════════════════════════════

/// Ports the REAL `spectra-cursor-sampler` CLI contract verified from
/// core-impl.ts:957-968 (`--duration <maxDurationSeconds> --fps <fps> --out
/// <path>`), not a fabricated one. If the binary is missing, startRecording
/// sets `cursorSamplerSkippedWarning` and never spawns — the recording itself
/// still succeeds (matches CURSOR_SAMPLER_SILENT_FAILURE_WARNING's own
/// framing: a missing/failed sampler is a warning, never a recording_failed).
final class CursorSamplerHandle: @unchecked Sendable {
    private let process: Process
    let outPath: String

    private init(process: Process, outPath: String) {
        self.process = process
        self.outPath = outPath
    }

    static func spawn(binaryPath: String, maxDurationSeconds: Int, fps: Int, outPath: String) throws -> CursorSamplerHandle {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: binaryPath)
        proc.arguments = ["--duration", String(maxDurationSeconds), "--fps", String(fps), "--out", outPath]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
        } catch {
            throw RecordingOpError(message: "failed to spawn spectra-cursor-sampler: \(error)")
        }
        return CursorSamplerHandle(process: proc, outPath: outPath)
    }

    /// SIGTERM, wait up to 2s, SIGKILL if still alive — mirrors
    /// core-impl.ts stopCursorSampler's timeout shape. Never throws.
    func stop() {
        guard process.isRunning else { return }
        process.terminate()
        let deadline = DispatchTime.now() + .milliseconds(2_000)
        while process.isRunning, DispatchTime.now() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            #if canImport(Darwin)
            kill(process.processIdentifier, SIGKILL)
            #else
            process.terminate()
            #endif
        }
    }

    var telemetryPathIfPresent: String? {
        FileManager.default.fileExists(atPath: outPath) ? outPath : nil
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — Window target resolution (ports core-impl.ts resolveRecordingTarget)
// ═══════════════════════════════════════════════════════════════════════════

private struct RecordingTarget {
    var appName: String
    var title: String
    var windowId: Int
}

/// Resolves ONE on-screen, layer-0, >=100x100px window for `appName`
/// (matched against owner name OR bundle identifier, case-insensitive), then
/// disambiguates by `titleHint` (the session name) when multiple windows of
/// the same app are open, else prefers a titled window, then a lower window
/// layer, then the largest area — mirrors core-impl.ts:1046-1076 exactly.
///
/// Uses the same native `CGWindowListCopyWindowInfo` API
/// PermissionOps.swift's `listMacWindows` does; that helper is file-private
/// there (G1 ownership boundary), so this is a narrowly-scoped copy of just
/// the single-target resolution, not a duplicate listWindows op.
private func resolveRecordingTarget(appName: String, titleHint: String) throws -> RecordingTarget {
    let needle = appName.lowercased()
    guard let list = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] else {
        throw DaemonApiError(.recordingFailed, "No on-screen ScreenCaptureKit window found for app \(appName)", status: 404)
    }

    struct Candidate {
        var windowId: Int
        var appName: String
        var title: String
        var layer: Int
        var width: Int
        var height: Int
    }

    var candidates: [Candidate] = list.compactMap { info -> Candidate? in
        guard let windowId = info[kCGWindowNumber as String] as? Int,
              let ownerName = info[kCGWindowOwnerName as String] as? String,
              let pid = info[kCGWindowOwnerPID as String] as? Int,
              let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
        else { return nil }

        let title = info[kCGWindowName as String] as? String ?? ""
        let onScreen = (info[kCGWindowIsOnscreen as String] as? Bool) ?? true
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let width = Int(bounds.size.width)
        let height = Int(bounds.size.height)
        guard onScreen, layer == 0, width >= 100, height >= 100 else { return nil }

        let appLower = ownerName.lowercased()
        let bundleLower = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier?.lowercased() ?? ""
        guard appLower.contains(needle) || bundleLower.contains(needle) else { return nil }

        return Candidate(windowId: windowId, appName: ownerName, title: title, layer: layer, width: width, height: height)
    }

    guard !candidates.isEmpty else {
        throw DaemonApiError(.recordingFailed, "No on-screen ScreenCaptureKit window found for app \(appName)", status: 404)
    }

    let trimmedHint = titleHint.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedHint.isEmpty {
        let hintNeedle = trimmedHint.lowercased()
        let titled = candidates.filter { $0.title.lowercased().contains(hintNeedle) }
        if !titled.isEmpty { candidates = titled }
    }

    candidates.sort { lhs, rhs in
        let leftTitled = !lhs.title.isEmpty
        let rightTitled = !rhs.title.isEmpty
        if leftTitled != rightTitled { return leftTitled }
        if lhs.layer != rhs.layer { return lhs.layer < rhs.layer }
        return (lhs.width * lhs.height) > (rhs.width * rhs.height)
    }

    let best = candidates[0]
    return RecordingTarget(appName: best.appName, title: best.title, windowId: best.windowId)
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — Active-recording registry (this file's `RecordingOwnership` conformer)
// ═══════════════════════════════════════════════════════════════════════════

private struct ActiveRecording {
    var recordingId: String
    var sessionId: String
    var target: RecordingTarget
    var startedAt: Int
    var outPath: String
    var preset: String?
    var fps: Int
    var codec: String
    var bitrate: String
    var rpc: NativeRecordingRpcProcess
    var cursorSampler: CursorSamplerHandle?
    var cursorSamplerSkippedWarning: String?
}

/// Fixed, well-known id for the conformance-seed recording (M3.G2 fix-work-
/// list item 5 / ADR-06 widening — docs/plans/m3-g2-vb-advisor-ruling.md
/// "Additional observed"/getRecording D1 guard). Frozen with the S7 harness
/// implementer: any consumer (conformance.test.ts's fixture context under
/// SPECTRA_CONFORMANCE_SEED, the G2 V-B comparator) that wants a
/// deterministic Swift-side recording to read points `getRecording` at this
/// EXACT string.
let conformanceSeedRecordingId = "conformance-seed-recording"

/// The seeded fixture's backing data (NOT an `ActiveRecording` — see
/// `RecordingRegistry.ensureConformanceSeed` doc comment for why it
/// deliberately does not reuse that type / go through a real
/// `NativeRecordingRpcProcess`).
private struct SeededRecording {
    var recordingId: String
    var sessionId: String
    var startedAt: Int
    var outPath: String
}

/// Single-writer, single-window recording registry. This IS the frozen
/// `RecordingOwnership` conformer (DriverProtocol.swift §6b) —
/// `registerCaptureRecordingOps` returns this instance so S6 can wire it to
/// `ctx.recordingOwnership` at boot. `ownsRecording` covers active
/// single-window recordings only: the M5 composite pipeline (a SEPARATE
/// registry, TS-side) stays proxied per ND-2/PC-7 and is out of scope for
/// this G2 wave — a composite recordingId correctly reports `false` here,
/// which routes `getRecording` for it to the TS backend instead.
final class RecordingRegistry: @unchecked Sendable, RecordingOwnership {
    private let lock = NSLock()
    private var byId: [String: ActiveRecording] = [:]
    private var bySession: [String: String] = [:]
    private var conformanceSeeded = false
    private var seededRecording: SeededRecording?

    /// Test-seed hook (M3.G2 fix-work-list item 5 — see
    /// `conformanceSeedRecordingId` doc comment): when
    /// `SPECTRA_CONFORMANCE_SEED=1`, lazily seeds ONE known recording
    /// (`conformance-seed-recording`, associated with `SessionStore`'s own
    /// `conformanceSeedSessionId`) so `getRecording`'s success (ok:true) path
    /// is reachable without a live `startRecording` call — mirrors
    /// `SessionStore.ensureConformanceSeed`'s lazy/idempotent/safe-on-every-
    /// call shape exactly (same guard-flag-then-seed-once pattern).
    ///
    /// Deliberately does NOT go through `add()`/spawn a real
    /// `NativeRecordingRpcProcess`: this is a pure read-fixture for
    /// `getRecording`, never a live in-flight recording that `stopRecording`
    /// could legitimately target, so it is kept in a separate `seededRecording`
    /// slot rather than forcing `ActiveRecording.rpc` to become optional
    /// (which would weaken every real call site's non-optional access to a
    /// live recording's RPC channel).
    func ensureConformanceSeed(enabled: Bool) {
        guard enabled else { return }
        lock.lock(); defer { lock.unlock() }
        guard !conformanceSeeded else { return }
        conformanceSeeded = true
        let sessionDir = (NSHomeDirectory() as NSString).appendingPathComponent(".spectra/sessions/\(conformanceSeedSessionId)")
        seededRecording = SeededRecording(
            recordingId: conformanceSeedRecordingId,
            sessionId: conformanceSeedSessionId,
            startedAt: JSON.nowMillis(),
            outPath: (sessionDir as NSString).appendingPathComponent("\(conformanceSeedRecordingId).mp4")
        )
    }

    /// `getRecording`'s read path — checks the LIVE registry first (a real
    /// in-flight recording always wins on an id collision, which cannot
    /// actually happen since `conformanceSeedRecordingId` is a fixed literal
    /// distinct from `startRecording`'s generated `recording-<uuid8>` ids),
    /// then falls back to the seeded fixture. Returns the exact TS-parity
    /// `RecordingStatus` result shape (core-api.ts `RecordingStatus` /
    /// core-impl.ts:588-597) for either source — both a live and a seeded
    /// recording are, by construction, always "still recording" (this
    /// registry only ever holds recordings mid-flight; a stopped/removed one
    /// is gone).
    func snapshot(_ recordingId: String) -> [String: Any]? {
        lock.lock()
        let live = byId[recordingId]
        let seed = seededRecording
        lock.unlock()

        if let live {
            return [
                "recordingId": live.recordingId,
                "kind": "single-window",
                "state": "recording",
                "sessionId": live.sessionId,
                "startedAt": live.startedAt,
                "updatedAt": JSON.nowMillis(),
                "outPath": live.outPath,
            ]
        }
        if let seed, seed.recordingId == recordingId {
            return [
                "recordingId": seed.recordingId,
                "kind": "single-window",
                "state": "recording",
                "sessionId": seed.sessionId,
                "startedAt": seed.startedAt,
                "updatedAt": JSON.nowMillis(),
                "outPath": seed.outPath,
            ]
        }
        return nil
    }

    fileprivate func add(_ recording: ActiveRecording) throws {
        lock.lock(); defer { lock.unlock() }
        guard byId[recording.recordingId] == nil else {
            throw DaemonApiError(.internalError, "Duplicate recordingId \(recording.recordingId)", status: 500)
        }
        guard bySession[recording.sessionId] == nil else {
            throw DaemonApiError(.conflict, "Session \(recording.sessionId) already has an active recording.", status: 409)
        }
        byId[recording.recordingId] = recording
        bySession[recording.sessionId] = recording.recordingId
    }

    fileprivate func forSession(_ sessionId: String) -> ActiveRecording? {
        lock.lock(); defer { lock.unlock() }
        guard let id = bySession[sessionId] else { return nil }
        return byId[id]
    }

    fileprivate func get(_ recordingId: String) -> ActiveRecording? {
        lock.lock(); defer { lock.unlock() }
        return byId[recordingId]
    }

    @discardableResult
    fileprivate func remove(_ recordingId: String) -> ActiveRecording? {
        lock.lock(); defer { lock.unlock() }
        guard let recording = byId.removeValue(forKey: recordingId) else { return nil }
        if bySession[recording.sessionId] == recordingId {
            bySession.removeValue(forKey: recording.sessionId)
        }
        return recording
    }

    /// Frozen `RecordingOwnership` requirement (DriverProtocol.swift §6b) —
    /// pure presence check, no side effects, safe on every `getRecording`
    /// dispatch (S6's Router calls this to decide native-vs-tunnel). Also
    /// reports `true` for the seeded fixture id even before
    /// `ensureConformanceSeed` has run once (the id is a fixed literal, known
    /// statically) so a `getRecording` for it always routes native, never
    /// tunnels, regardless of dispatch order.
    func ownsRecording(_ recordingId: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if byId[recordingId] != nil { return true }
        if recordingId == conformanceSeedRecordingId { return true }
        return false
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 — op handlers
// ═══════════════════════════════════════════════════════════════════════════

private func paramsDict(_ params: Any?) -> [String: Any] { (params as? [String: Any]) ?? [:] }

private func requireSessionId(_ params: [String: Any]) throws -> String {
    guard let sessionId = params["sessionId"] as? String, !sessionId.isEmpty else {
        throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
    }
    return sessionId
}

private func handleStartRecording(_ params: Any?, _ ctx: DaemonContext, recordings: RecordingRegistry, keepAwake: KeepAwakeController) throws -> Any {
    let dict = paramsDict(params)
    let sessionId = try requireSessionId(dict)

    guard let session = ctx.sessions.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }
    guard session.platform == "macos", let appName = session.target.appName, !appName.isEmpty else {
        throw DaemonApiError(.recordingFailed, "startRecording currently requires a macOS session with an app target.", status: 400)
    }
    // Early conflict check (avoids a wasted spawn+abort); RecordingRegistry.add
    // below is the ATOMIC guard of record for the actual race.
    if recordings.forSession(sessionId) != nil {
        throw DaemonApiError(.conflict, "Session \(sessionId) already has an active recording.", status: 409)
    }

    let target = try resolveRecordingTarget(appName: appName, titleHint: session.name)

    let recordingId = "recording-\(UUID().uuidString.prefix(8))"
    let sessionDir = ctx.sessions.sessionDir(sessionId)
    try FileManager.default.createDirectory(atPath: sessionDir, withIntermediateDirectories: true)
    let outPath = (sessionDir as NSString).appendingPathComponent("\(recordingId).mp4")
    let startedAt = JSON.nowMillis()
    let fps = (dict["fps"] as? Int) ?? 60
    let codec = (dict["codec"] as? String) ?? "h264"
    let bitrate = (dict["bitrate"] as? String) ?? "8M"
    let captureAudio = (dict["captureAudio"] as? Bool) ?? false
    let maxDurationSeconds = 300
    let preset = dict["preset"] as? String

    keepAwake.recordingStarted(recordingId)

    let rpc: NativeRecordingRpcProcess
    let startResult: [String: Any]
    do {
        rpc = try NativeRecordingRpcProcess(binaryPath: try resolveNativeBinaryPath())
        startResult = try rpc.send(method: "startRecording", params: [
            "recordingId": recordingId,
            "sessionId": sessionId,
            "app": appName,
            "title": session.name,
            "outPath": outPath,
            "fps": fps,
            "codec": codec,
            "bitrate": bitrate,
            "captureAudio": captureAudio,
            "maxDuration": maxDurationSeconds,
        ], timeoutMs: 15_000)
    } catch {
        keepAwake.recordingStopped(recordingId)
        // TS folds an operator hint ("Verify the target window is
        // visible/on-screen and Screen Recording permission is granted...")
        // into the same DaemonApiError message; Swift's DaemonApiError has no
        // separate hint field (WireProtocol.swift keeps {code,message}), so
        // it's folded into the message text here too, not dropped.
        throw DaemonApiError(
            .recordingFailed,
            "startRecording failed: \(errorMessage(error)) (verify the target window is visible/on-screen and Screen Recording permission is granted to the signed Spectra daemon helper)",
            status: 500
        )
    }

    var cursorSampler: CursorSamplerHandle?
    var cursorSamplerSkippedWarning: String?
    if (dict["captureCursor"] as? Bool) == true {
        let binaryPath = cursorSamplerBinaryPath()
        if !FileManager.default.fileExists(atPath: binaryPath) {
            cursorSamplerSkippedWarning = "cursor telemetry requested but the sampler produced no output (is spectra-cursor-sampler built? run npm run build:cursor-sampler)"
        } else {
            let cursorOutPath = (sessionDir as NSString).appendingPathComponent("\(recordingId).cursor.json")
            do {
                cursorSampler = try CursorSamplerHandle.spawn(binaryPath: binaryPath, maxDurationSeconds: maxDurationSeconds, fps: fps, outPath: cursorOutPath)
            } catch {
                rpc.abort()
                keepAwake.recordingStopped(recordingId)
                throw DaemonApiError(.recordingFailed, "startRecording cursor sampler failed: \(errorMessage(error))", status: 500)
            }
        }
    }

    let width = startResult["width"] as? Int
    let height = startResult["height"] as? Int

    let recording = ActiveRecording(
        recordingId: recordingId, sessionId: sessionId, target: target, startedAt: startedAt,
        outPath: outPath, preset: preset, fps: fps, codec: codec, bitrate: bitrate,
        rpc: rpc, cursorSampler: cursorSampler, cursorSamplerSkippedWarning: cursorSamplerSkippedWarning
    )
    do {
        try recordings.add(recording)
    } catch {
        rpc.abort()
        cursorSampler?.stop()
        keepAwake.recordingStopped(recordingId)
        throw error
    }

    let source = target.title.isEmpty ? target.appName : "\(target.appName): \(target.title)"
    var status = SpectraCaptureRunRecording()
    status.state = "recording"
    status.recordingId = recordingId
    status.preset = preset
    status.startedAt = startedAt
    status.rawPath = outPath
    status.fps = fps
    status.codec = codec
    status.bitrate = bitrate
    status.width = width
    status.height = height
    status.source = source
    status.sourceVerified = true
    _ = try ctx.sessions.setRecordingStatus(sessionId: sessionId, recording: status)

    var result: [String: Any] = ["recordingId": recordingId, "startedAt": startedAt, "fps": fps, "codec": codec, "bitrate": bitrate]
    if let preset { result["preset"] = preset }
    return result
}

private func handleStopRecording(_ params: Any?, _ ctx: DaemonContext, recordings: RecordingRegistry, keepAwake: KeepAwakeController) throws -> Any {
    let dict = paramsDict(params)
    let sessionId = try requireSessionId(dict)
    let preset = dict["preset"] as? String

    guard ctx.sessions.get(sessionId) != nil else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }

    guard let active = recordings.forSession(sessionId) else {
        // StopRecordingAlreadyStopped — a RETURNED soft result, never thrown
        // (mirrors core-impl.ts:453-460 exactly; the oracle's discriminated
        // union bites hardest here — `{}` must never pass either branch).
        var result: [String: Any] = ["alreadyStopped": true, "error": "No active recording for session \(sessionId)"]
        if let preset { result["preset"] = preset }
        return result
    }
    recordings.remove(active.recordingId)

    let stopped: [String: Any]
    do {
        var encodingStatus = SpectraCaptureRunRecording()
        encodingStatus.state = "encoding"
        encodingStatus.recordingId = active.recordingId
        encodingStatus.preset = active.preset
        encodingStatus.startedAt = active.startedAt
        encodingStatus.rawPath = active.outPath
        encodingStatus.fps = active.fps
        encodingStatus.codec = active.codec
        encodingStatus.bitrate = active.bitrate
        _ = try ctx.sessions.setRecordingStatus(sessionId: sessionId, recording: encodingStatus)

        stopped = try active.rpc.stopAndQuit(recordingId: active.recordingId, sessionId: sessionId)
        active.cursorSampler?.stop()
    } catch {
        active.cursorSampler?.stop()
        keepAwake.recordingStopped(active.recordingId)
        active.rpc.abort()
        var failedStatus = SpectraCaptureRunRecording()
        failedStatus.state = "failed"
        failedStatus.recordingId = active.recordingId
        failedStatus.preset = active.preset
        failedStatus.startedAt = active.startedAt
        failedStatus.stoppedAt = JSON.nowMillis()
        failedStatus.rawPath = active.outPath
        failedStatus.error = errorMessage(error)
        // Best-effort — mirrors core-impl.ts:481-489's own `.catch(() => {})`
        // on this exact write.
        _ = try? ctx.sessions.setRecordingStatus(sessionId: sessionId, recording: failedStatus)
        throw DaemonApiError(.recordingFailed, "stopRecording failed: \(errorMessage(error))", status: 500)
    }

    keepAwake.recordingStopped(active.recordingId)
    let stoppedAt = JSON.nowMillis()
    let path = (stopped["path"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? active.outPath

    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    let fileSizeBytes = (attrs?[.size] as? NSNumber)?.intValue

    let probed = FfmpegProbe.probeVideo(path)
    let blackFrame = FfmpegProbe.probeBlackFrames(path)
    var warnings: [String] = []
    if blackFrame.allBlack {
        let luma = blackFrame.meanLuma.map { String(format: "%.1f", $0) } ?? "?"
        warnings.append("Output appears all-black (mean luminance \(luma) < \(Int(FfmpegProbe.defaultBlackThreshold)) across \(blackFrame.sampleCount) sampled frames).")
    } else if blackFrame.skipped {
        warnings.append("Black-frame guard skipped; ffmpeg was unavailable or no luminance samples were produced.")
    }

    let durationMs = (stopped["durationMs"] as? Int) ?? probed?.durationMs ?? max(0, stoppedAt - active.startedAt)
    let sizeBytes = (stopped["sizeBytes"] as? Int) ?? fileSizeBytes
    let codecOut = (stopped["codec"] as? String) ?? probed?.codec ?? active.codec
    let probedFps: Int? = probed?.fps.map { Int($0.rounded()) }
    let fpsOut = (stopped["fps"] as? Int) ?? probedFps ?? active.fps
    let widthOut = (stopped["width"] as? Int) ?? probed?.width
    let heightOut = (stopped["height"] as? Int) ?? probed?.height
    let droppedFrames = stopped["droppedFrames"] as? Int
    let formatOut = (stopped["format"] as? String) ?? "mp4"

    let cursorTelemetryPath = active.cursorSampler?.telemetryPathIfPresent
    if let skipWarning = active.cursorSamplerSkippedWarning {
        warnings.append(skipWarning)
    } else if active.cursorSampler != nil, cursorTelemetryPath == nil {
        warnings.append("cursor telemetry requested but the sampler produced no output (is spectra-cursor-sampler built? run npm run build:cursor-sampler)")
    }

    let source = active.target.title.isEmpty ? active.target.appName : "\(active.target.appName): \(active.target.title)"
    var savedStatus = SpectraCaptureRunRecording()
    savedStatus.state = "saved"
    savedStatus.recordingId = active.recordingId
    savedStatus.preset = active.preset
    savedStatus.startedAt = active.startedAt
    savedStatus.stoppedAt = stoppedAt
    savedStatus.rawPath = active.outPath
    savedStatus.path = path
    savedStatus.durationMs = durationMs
    savedStatus.sizeBytes = sizeBytes
    savedStatus.codec = codecOut
    savedStatus.fps = fpsOut
    savedStatus.width = widthOut
    savedStatus.height = heightOut
    savedStatus.bitrate = active.bitrate
    savedStatus.droppedFrames = droppedFrames
    savedStatus.source = source
    savedStatus.sourceVerified = true
    if let cursorTelemetryPath { savedStatus.cursorTelemetryPath = cursorTelemetryPath }
    // Unguarded (propagates like core-impl.ts:521's own un-caught call) —
    // SocketServer's dispatch site auto-wraps any escaping error as
    // internal_error/500 (verified: SocketServer.swift's `catch { writeError(
    // ..., .internalError, ...) }` fallback), so this can't crash the daemon.
    _ = try ctx.sessions.setRecordingStatus(sessionId: sessionId, recording: savedStatus)

    var metadata: [String: Any] = [
        "recordingId": active.recordingId,
        "appName": active.target.appName,
        "title": active.target.title,
        "blackFrameAllBlack": blackFrame.allBlack,
        "blackFrameSampleCount": blackFrame.sampleCount,
        "warnings": warnings,
    ]
    if let meanLuma = blackFrame.meanLuma { metadata["blackFrameMeanLuma"] = meanLuma }
    if let cursorTelemetryPath { metadata["cursorTelemetryPath"] = cursorTelemetryPath }

    var artifact = SpectraCaptureRunArtifact(id: "artifact-\(UUID().uuidString.prefix(8))", type: "video", path: path, createdAt: stoppedAt)
    artifact.format = formatOut
    artifact.label = "Window recording"
    artifact.sizeBytes = sizeBytes
    artifact.metadata = metadata
    _ = try ctx.sessions.addArtifact(sessionId: sessionId, artifact: artifact)

    var result: [String: Any] = [
        "alreadyStopped": false,
        "recordingId": active.recordingId,
        "path": path,
        "format": formatOut,
        "durationMs": durationMs,
        "codec": codecOut,
        "fps": fpsOut,
    ]
    if let preset = active.preset { result["preset"] = preset }
    if let sizeBytes { result["sizeBytes"] = sizeBytes }
    if let widthOut { result["width"] = widthOut }
    if let heightOut { result["height"] = heightOut }
    if let droppedFrames { result["droppedFrames"] = droppedFrames }
    return result
}

private func handleGetRecording(_ params: Any?, ctx: DaemonContext, recordings: RecordingRegistry) throws -> Any {
    let dict = paramsDict(params)
    guard let recordingId = dict["recordingId"] as? String, !recordingId.isEmpty else {
        throw DaemonApiError(.badRequest, "recordingId is required", status: 400)
    }
    // Test-seed hook (fix-work-list item 5): safe/idempotent on every call,
    // same pattern SessionOps.swift's getSession/getRun/listSessions use for
    // `ctx.sessions.ensureConformanceSeed` — no-ops instantly when
    // SPECTRA_CONFORMANCE_SEED is unset.
    recordings.ensureConformanceSeed(enabled: ctx.conformanceSeedEnabled)
    // Composite-recording hit path (RecordCompositeParams / M5 pipeline) is
    // out of scope for this G2 wave (ND-2/PC-7: the compositing pipeline
    // stays proxied to the TS daemon) — a composite id is simply absent from
    // this registry and correctly 404s here. The Router (S6) is responsible
    // for not even routing composite ids to this native handler in the first
    // place: `RecordingOwnership.ownsRecording` (this file) reports `false`
    // for them, which is the frozen signal it uses to tunnel instead.
    guard let recording = recordings.snapshot(recordingId) else {
        throw DaemonApiError(.notFound, "Recording \(recordingId) not found", status: 404)
    }
    return ["recording": recording]
}

// ═══════════════════════════════════════════════════════════════════════════
// §7 — the frozen registration hook (DriverProtocol.swift §5)
// ═══════════════════════════════════════════════════════════════════════════

/// S4's bundled register-hook — screenshot (CaptureOps.swift) + startRecording
/// / stopRecording / getRecording (this file). ASYMMETRIC: the ONLY one of
/// the 5 W0 register-hooks with a return value — it does NOT self-install
/// into `DaemonContext` (this file has no business knowing that class's field
/// names); S6's main.swift does `context.recordingOwnership =
/// registerCaptureRecordingOps(registry)` BEFORE `server.start(...)`, per the
/// frozen installation path documented in DriverProtocol.swift §6b.
func registerCaptureRecordingOps(_ registry: HandlerRegistry) -> RecordingOwnership {
    registerScreenshotOp(registry)

    let recordings = RecordingRegistry()
    let keepAwake = KeepAwakeController()

    registry.register("startRecording", capabilities: [.mediaRecord]) { params, ctx in
        try handleStartRecording(params, ctx, recordings: recordings, keepAwake: keepAwake)
    }
    registry.register("stopRecording", capabilities: [.mediaRecord]) { params, ctx in
        try handleStopRecording(params, ctx, recordings: recordings, keepAwake: keepAwake)
    }
    // Capability per src/contract/wire.ts:101 (`getRecording: ['sessions:read']`)
    // — a read of recording status, not a media:record write.
    registry.register("getRecording", capabilities: [.sessionsRead]) { params, ctx in
        try handleGetRecording(params, ctx: ctx, recordings: recordings)
    }

    return recordings
}
