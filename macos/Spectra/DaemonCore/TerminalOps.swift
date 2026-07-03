// macos/Spectra/DaemonCore/TerminalOps.swift
//
// M3.G2 (S5) — recordTerminal / replayTerminal. BOTH ops are driver-agnostic
// (they never touch DriverRegistry/Driver, DriverProtocol.swift): recordTerminal
// drives a REAL pty + child process directly (headless-safe — a pty needs no
// attached display, T-20/T-21); replayTerminal parses a real .cast file from
// disk (no display dependency at all). Mirrors `src/mcp/tools/record.ts`
// (handleRecord/handleReplay) + `src/terminal/{recorder,multi-recorder}.ts`'s
// orchestration. Cast FORMAT (header/event line shape, parse/search/summary)
// lives in CastParser.swift; this file owns process orchestration + the two
// op handlers.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
#if canImport(Darwin)
import Darwin
#endif

func registerTerminalOps(_ registry: HandlerRegistry) {
    registry.register("recordTerminal", capabilities: [.terminalRecord]) { params, _ in
        let dict = terminalParamsDict(params)
        guard let command = dict["command"] as? String, !command.isEmpty else {
            throw DaemonApiError(.badRequest, "command is required", status: 400)
        }
        let outputDir = dict["outputDir"] as? String
        let timeoutMs = terminalNumberValue(dict["timeout"])
        let watchFiles = (dict["watch_files"] as? [Any])?.compactMap { $0 as? String } ?? []

        do {
            let outcome = try PtyTerminalRecorder.record(
                command: command,
                outputDir: outputDir,
                maxDurationMs: timeoutMs,
                watchFiles: watchFiles
            )
            return outcome.json
        } catch let err as DaemonApiError {
            throw err
        } catch {
            // Mirrors recorder.ts's `child.on('error', reject)` / mkdirSync
            // throw path — an uncaught Error in TS bubbles to internal_error/500.
            throw DaemonApiError(.internalError, "recordTerminal failed: \(error.localizedDescription)", status: 500)
        }
    }

    registry.register("replayTerminal", capabilities: [.terminalRead]) { params, _ in
        let dict = terminalParamsDict(params)
        guard let file = dict["file"] as? String, !file.isEmpty else {
            throw DaemonApiError(.badRequest, "file is required", status: 400)
        }
        let search = dict["search"] as? String
        let commandsOnly = dict["commands_only"] as? Bool ?? false

        let cast: CastFile
        do {
            cast = try CastParser.parse(filePath: file)
        } catch let err as CastFormatError {
            // Mirrors parseCast's plain-Error throws (empty file, unreadable
            // file, malformed header JSON) -> internal_error/500, NOT
            // bad_request (src/daemon/errors.ts toDaemonApiError default).
            throw DaemonApiError(.internalError, err.message, status: 500)
        }

        let summary = CastParser.formatSummary(cast)

        // handleReplay's exact branch order: commands_only wins outright if
        // both commands_only and search are present (early return in TS).
        if commandsOnly {
            let commands = CastParser.extractCommands(cast)
            return ["summary": summary, "commands": commands] as [String: Any]
        }

        if let search, !search.isEmpty {
            let matched: [CastEvent]
            do {
                matched = try CastParser.search(cast, pattern: search)
            } catch let err as CastFormatError {
                throw DaemonApiError(.internalError, err.message, status: 500)
            }
            return [
                "summary": summary,
                "events": matched.map { ["time": $0.time, "type": $0.type, "data": $0.data] as [String: Any] },
                "matchCount": matched.count,
            ] as [String: Any]
        }

        // Default: summary + first 50 events (mirrors record.ts handleReplay).
        let events = cast.events.prefix(50).map {
            ["time": $0.time, "type": $0.type, "data": $0.data] as [String: Any]
        }
        return ["summary": summary, "events": Array(events)] as [String: Any]
    }
}

// ─── Param helpers ───────────────────────────────────────────────────────────

private func terminalParamsDict(_ params: Any?) -> [String: Any] {
    (params as? [String: Any]) ?? [:]
}

private func terminalNumberValue(_ raw: Any?) -> Double? {
    if let n = raw as? NSNumber { return n.doubleValue }
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    return nil
}

// ═══════════════════════════════════════════════════════════════════════════
// PtyTerminalRecorder — real pty + child-process orchestration.
// ═══════════════════════════════════════════════════════════════════════════

/// Drives a real BSD pty (forkpty) + `/bin/sh -c <command>` child, capturing
/// stdout+stderr (merged, matching recorder.ts's own `stdout`+`stderr` ->
/// single 'o'-typed event stream) into an asciinema-cast v2 file, then
/// returns the same result shape `handleRecord` (record.ts) synthesizes from
/// `multiRecord`.
///
/// DETERMINISM (T-20/T-21 + the plan's explicit outputSize/lines carve-out —
/// a flake there is a FINDING, not maskable): the pty's line discipline is
/// put into raw output mode (OPOST off) before exec, so the byte stream this
/// captures is the command's OWN output verbatim — no tty-driver NL->CRNL
/// insertion, which would otherwise make outputSize a function of terminal
/// state rather than of the command's actual output (and would drift from
/// recorder.ts's own plain-pipe capture, which never sees that translation
/// either). ECHO is also off — irrelevant here since nothing writes to the
/// pty's input side, but keeps the pty state minimal/predictable regardless.
enum PtyTerminalRecorder {

    struct Outcome {
        let castFile: String
        let exitCode: Int32
        let duration: Double
        let outputSize: Int
        let lines: Int
        let fileChanges: Int
        let timeline: [[String: Any]]

        var json: [String: Any] {
            [
                "castFile": castFile,
                "exitCode": exitCode,
                "duration": duration,
                "outputSize": outputSize,
                "lines": lines,
                "fileChanges": fileChanges,
                "timeline": timeline,
            ]
        }
    }

    // recorder.ts RecordOptions defaults. Not exposed on the wire
    // (TerminalRecordParams only carries command/outputDir/timeout/
    // watch_files) so these stay fixed, matching the TS default path.
    private static let defaultCols: Int32 = 120
    private static let defaultRows: Int32 = 40
    private static let defaultMaxDurationMs: Double = 300_000
    private static let readChunkSize = 65536
    private static let pollSliceMs: Int32 = 1000
    fileprivate static let reapPollIntervalUs: useconds_t = 10_000 // 10ms
    fileprivate static let reapMaxWaitSeconds: Double = 3.0

    static func record(
        command: String,
        outputDir: String?,
        maxDurationMs: Double?,
        watchFiles: [String]
    ) throws -> Outcome {
        let castFile = resolveCastFilePath(outputDir: outputDir)
        try FileManager.default.createDirectory(
            atPath: (castFile as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true
        )

        let maxDuration = maxDurationMs ?? defaultMaxDurationMs
        let startDate = Date()
        func elapsed() -> Double { Date().timeIntervalSince(startDate) }

        // multiRecord sets up watchers BEFORE the 'started' timeline event.
        let watcher = TerminalFileWatcher(paths: watchFiles, startDate: startDate)
        watcher.start()

        var timeline: [[String: Any]] = []
        timeline.append(["time": elapsed(), "source": "terminal", "event": "started: \(command)"])

        var castLines: [String] = []
        castLines.append(CastParser.headerLine(
            width: Int(defaultCols),
            height: Int(defaultRows),
            timestampSec: Int(startDate.timeIntervalSince1970),
            env: [
                "SHELL": ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/sh",
                "TERM": ProcessInfo.processInfo.environment["TERM"] ?? "xterm-256color",
            ]
        ))

        var outputSize = 0
        var lines = 0

        let pty = try spawnPty(command: command, cols: defaultCols, rows: defaultRows)
        let deadline = startDate.addingTimeInterval(maxDuration / 1000)
        var killed = false

        readLoop: while true {
            var pfd = pollfd(fd: pty.masterFD, events: Int16(truncatingIfNeeded: Int32(POLLIN)), revents: 0)
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 {
                kill(pty.pid, SIGTERM)
                killed = true
                break readLoop
            }
            let sliceMs = Int32(min(remaining * 1000, Double(pollSliceMs)))
            let rv = poll(&pfd, 1, max(sliceMs, 0))
            if rv < 0 {
                if errno == EINTR { continue }
                break readLoop
            }
            if rv == 0 { continue } // slice elapsed with nothing ready — recheck deadline
            guard Int32(pfd.revents) & POLLIN != 0 else { break readLoop } // POLLHUP/POLLERR, no data

            var buffer = [UInt8](repeating: 0, count: readChunkSize)
            let n = buffer.withUnsafeMutableBytes { ptr -> Int in
                read(pty.masterFD, ptr.baseAddress, ptr.count)
            }
            if n <= 0 { break readLoop } // EOF — child closed its side

            let text = String(decoding: buffer[0..<n], as: UTF8.self)
            castLines.append(CastParser.eventLine(elapsed: elapsed(), wireType: "o", data: text))
            outputSize += text.utf16.count
            lines += 1
        }

        if killed {
            // Mirrors recorder.ts's SIGTERM-then-SIGKILL(2s) escalation.
            usleep(2_000_000)
            kill(pty.pid, SIGKILL)
        }

        let status = reapChild(pty.pid)
        close(pty.masterFD)
        let fileChanges = watcher.stop()

        let exitCode: Int32
        if (status & 0x7f) == 0 {
            exitCode = (status >> 8) & 0xff
        } else {
            exitCode = 128 + (status & 0x7f) // signal-terminated, shell exit-code convention
        }

        let duration = elapsed()
        timeline.append([
            "time": duration,
            "source": "terminal",
            "event": "exited with code \(exitCode) after \(String(format: "%.2f", duration))s",
        ])
        timeline.append(contentsOf: fileChanges.timelineEntries)
        timeline.sort { ($0["time"] as? Double ?? 0) < ($1["time"] as? Double ?? 0) }

        let content = castLines.joined(separator: "\n") + "\n"
        try content.write(toFile: castFile, atomically: true, encoding: .utf8)

        return Outcome(
            castFile: castFile,
            exitCode: exitCode,
            duration: duration,
            outputSize: outputSize,
            lines: lines,
            fileChanges: fileChanges.count,
            timeline: timeline
        )
    }

    /// Mirrors recorder.ts's `getDefaultOutputPath` / multiRecorder's
    /// `${outputDir}/${timestamp}.cast` override. Uses `resolveStorageRoot()`
    /// (StoragePath.swift) rather than the pure `getStoragePath()` port — the
    /// established Swift-daemon convention (SessionStore.swift et al.) for
    /// giving the SPECTRA_HOME test-isolation override highest precedence,
    /// falling back to byte-identical TS-parity behavior in production where
    /// SPECTRA_HOME is never set.
    private static func resolveCastFilePath(outputDir: String?) -> String {
        let timestampMs = Int(Date().timeIntervalSince1970 * 1000)
        if let outputDir, !outputDir.isEmpty {
            return (outputDir as NSString).appendingPathComponent("\(timestampMs).cast")
        }
        let recordingsDir = (resolveStorageRoot() as NSString).appendingPathComponent("recordings")
        return (recordingsDir as NSString).appendingPathComponent("\(timestampMs).cast")
    }
}

/// Reaps `pid`, tolerating the case where some OTHER part of this process
/// wins the race to reap it first. Foundation's `Process`/`NSTask` installs
/// a process-wide SIGCHLD-reaping thread the first time ANY `Process()` is
/// constructed anywhere in this daemon (BridgeClient.swift, FfmpegProbe.swift,
/// HandlerRegistry.swift, RecordingOps.swift all construct one) -- that
/// background reaper calls its own `waitpid(-1, ...)` and can steal the reap
/// of OUR forkpty() child before we get to it, especially across the
/// SIGTERM-then-2s-sleep-then-SIGKILL escalation above. Verified repro
/// (G2 Advisor ruling, "Additional observed" recordTerminal bullet /
/// fix-work-list item 6): a contract-valid but tiny/already-expired `timeout`
/// payload (e.g. `timeout: 1`, a real value the conformance suite's generic
/// number-field fallback synthesizes for recordTerminal's `full`-variant
/// payload) kills the child almost immediately after fork, then the 2s
/// SIGKILL-escalation sleep hands Foundation's reaper thread a wide window
/// to win the race for THAT pid. Once that happens, a plain blocking
/// `waitpid(pid, &status, 0)` for a pid nobody but us should still be
/// waiting on was observed (empirically, via a socket-level repro against
/// the compiled daemon) to hang INDEFINITELY on Darwin instead of promptly
/// failing ECHILD -- there is no TS-side equivalent hazard (Node's
/// child_process owns the only reap path for its own children), so the
/// TS-parity termination guarantee to match here is "never block past a
/// small bounded window," not "wait forever for a status nobody can still
/// deliver." Polls non-blockingly (WNOHANG) instead of a single blocking
/// wait, bounded by `reapMaxWaitSeconds`; ECHILD (already reaped elsewhere)
/// or a bound timeout both degrade to a synthetic zero status -- matching
/// recorder.ts's own `exitCode: code ?? 0` fallback for the signal-killed
/// case, where Node's `code` argument is `null` too.
private func reapChild(_ pid: pid_t) -> Int32 {
    var status: Int32 = 0
    let deadline = Date().addingTimeInterval(PtyTerminalRecorder.reapMaxWaitSeconds)
    while Date() < deadline {
        let r = waitpid(pid, &status, WNOHANG)
        if r == pid { return status }
        if r == -1 { return 0 } // ECHILD -- already reaped elsewhere; treat as gone.
        usleep(PtyTerminalRecorder.reapPollIntervalUs)
    }
    // Bounded wait exhausted with the child still unreaped by us -- give up
    // rather than hang the caller past its own request timeout; the SIGKILL
    // above guarantees the process dies, just not necessarily reaped by us.
    return 0
}

// ─── pty + child-process spawn ───────────────────────────────────────────────

private struct SpawnedPty {
    let masterFD: Int32
    let pid: pid_t
}

/// `forkpty` + raw-mode the slave + `execve` — all argv/envp C strings are
/// allocated in THIS (parent) process before forking; the child, between
/// fork and exec, only calls `tcgetattr`/`tcsetattr`/`execve`/`_exit` (no
/// allocation), the standard discipline for doing real work in a
/// multi-threaded process's post-fork child (SocketServer's connection queue
/// is `.concurrent` — see DriverProtocol.swift's concurrency note; a fork
/// with any malloc-touching code in the child risks deadlocking on a lock
/// another thread held at fork time).
private func spawnPty(command: String, cols: Int32, rows: Int32) throws -> SpawnedPty {
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup("/bin/sh"), strdup("-c"), strdup(command), nil]
    let envp = buildEnvp(cols: cols, rows: rows)
    defer {
        for ptr in argv where ptr != nil { free(ptr) }
        for ptr in envp where ptr != nil { free(ptr) }
    }

    var masterFD: Int32 = -1
    var winSize = winsize(ws_row: UInt16(rows), ws_col: UInt16(cols), ws_xpixel: 0, ws_ypixel: 0)
    let pid = withUnsafeMutablePointer(to: &masterFD) { masterPtr -> pid_t in
        withUnsafeMutablePointer(to: &winSize) { winPtr -> pid_t in
            forkpty(masterPtr, nil, nil, winPtr)
        }
    }

    if pid < 0 {
        throw DaemonApiError(.internalError, "forkpty failed: \(String(cString: strerror(errno)))", status: 500)
    }

    if pid == 0 {
        var term = termios()
        if tcgetattr(STDIN_FILENO, &term) == 0 {
            term.c_lflag &= ~tcflag_t(ECHO)
            term.c_oflag &= ~tcflag_t(OPOST)
            tcsetattr(STDIN_FILENO, TCSANOW, &term)
        }
        execve("/bin/sh", argv, envp)
        _exit(127) // execve only returns on failure
    }

    return SpawnedPty(masterFD: masterFD, pid: pid)
}

/// Builds a full envp (current environment + COLUMNS/LINES, mirrors
/// recorder.ts's `env: { ...process.env, ..., COLUMNS: String(cols), LINES:
/// String(rows) }`) as parent-allocated C strings, so the child does zero
/// allocation between fork and exec.
private func buildEnvp(cols: Int32, rows: Int32) -> [UnsafeMutablePointer<CChar>?] {
    var vars: [String: String] = [:]
    var i = 0
    while let entry = environ[i] {
        let line = String(cString: entry)
        if let eq = line.firstIndex(of: "=") {
            vars[String(line[line.startIndex..<eq])] = String(line[line.index(after: eq)...])
        }
        i += 1
    }
    vars["COLUMNS"] = String(cols)
    vars["LINES"] = String(rows)

    var envp: [UnsafeMutablePointer<CChar>?] = vars.map { strdup("\($0.key)=\($0.value)") }
    envp.append(nil)
    return envp
}

// ─── Optional file-change watching (watch_files param) ──────────────────────

/// Best-effort file/directory change watcher used only when the caller
/// passes `watch_files`. Mirrors multi-recorder.ts's intent (a change ->
/// FileChange entry + a matching TimelineEvent) via kqueue
/// (`DispatchSource.makeFileSystemObjectSource`) rather than Node's
/// `fs.watch` — exact added-vs-modified classification parity with Node's
/// rename-vs-change distinction is NOT attempted (graceful degradation: this
/// param is optional and secondary to the fixed recordTerminal command path
/// V-A/V-B actually exercise). A watch that fails to open is logged and
/// skipped, never thrown (mirrors multi-recorder.ts's try/catch +
/// `console.warn` around each watcher).
final class TerminalFileWatcher {
    struct Result {
        let count: Int
        let timelineEntries: [[String: Any]]
    }

    private let paths: [String]
    private let startDate: Date
    private var sources: [DispatchSourceFileSystemObject] = []
    private var fileDescriptors: [Int32] = []
    private let lock = NSLock()
    private var changes: [[String: Any]] = []
    private var entries: [[String: Any]] = []

    init(paths: [String], startDate: Date) {
        self.paths = paths
        self.startDate = startDate
    }

    func start() {
        guard !paths.isEmpty else { return }
        for path in paths {
            let fd = open(path, O_EVTONLY)
            guard fd >= 0 else {
                FileHandle.standardError.write(Data(
                    "[terminal-watcher] could not watch \(path): \(String(cString: strerror(errno)))\n".utf8
                ))
                continue
            }
            let source = DispatchSource.makeFileSystemObjectSource(
                fileDescriptor: fd,
                eventMask: [.write, .rename, .delete, .extend, .attrib],
                queue: DispatchQueue(label: "spectra.terminal.watch")
            )
            source.setEventHandler { [weak self] in
                guard let self else { return }
                let flags = source.data
                let changeType = flags.contains(.rename) || flags.contains(.delete) ? "added" : "modified"
                let time = Date().timeIntervalSince(self.startDate)
                let change: [String: Any] = ["path": path, "type": changeType, "timestamp": JSON.nowMillis()]
                let entry: [String: Any] = ["time": time, "source": "file", "event": "\(changeType): \(path)"]
                self.lock.lock()
                self.changes.append(change)
                self.entries.append(entry)
                self.lock.unlock()
            }
            source.setCancelHandler { close(fd) }
            source.resume()
            sources.append(source)
            fileDescriptors.append(fd)
        }
    }

    @discardableResult
    func stop() -> Result {
        for source in sources { source.cancel() }
        sources.removeAll()
        lock.lock()
        defer { lock.unlock() }
        return Result(count: changes.count, timelineEntries: entries)
    }
}
