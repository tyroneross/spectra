// LaunchAgentManager.swift
//
// M3.G1 flip (ADR-03): manages the TWO-LaunchAgent topology that puts the
// Swift daemon-core front door on the primary socket and keeps the existing
// TS/node daemon alive as its backend on a secondary socket:
//
//   dev.spectra.daemon     — front door. Runs the native
//                            `~/.spectra/bin/spectra-daemon-core` binary
//                            directly. Env: SPECTRA_PROXY_BACKEND_SOCKET
//                            (points at the backend below).
//   dev.spectra.daemon-ts  — backend. Same node invocation this file always
//                            used (signed launcher, falling back to
//                            `node ~/.spectra/dist/cli/index.js daemon`), plus
//                            env SPECTRA_DAEMON_LISTEN_SOCKET so it binds a
//                            SECONDARY socket instead of the primary one.
//
// `~/.spectra/dist/cli/index.js` is mirrored from the plugin's dist/ by
// scripts/postinstall.sh, so the path is stable across plugin updates
// (the plugin cache dir is not — plugin updates wipe it).
//
// GUI compatibility (G2a pin, docs/plans/m3-g1-flip-plan.md): the public
// surface below — init/install/bootstrap/bootout/uninstall/isInstalled/
// isLoaded — keeps its EXACT signatures. Only the semantics changed: every
// call now operates on BOTH agents, atomically from the caller's point of
// view, so `SpectraViewModel.swift` (unowned, untouched) can never produce a
// half-installed topology by construction.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public enum LaunchAgentError: Error, LocalizedError {
    case nodeNotFound
    case daemonScriptNotFound(path: String)
    case daemonCoreNotFound(path: String)
    case writePlistFailed(String)
    case launchctlFailed(stdout: String, stderr: String, status: Int32)

    public var errorDescription: String? {
        switch self {
        case .nodeNotFound: return "Node not found in PATH or standard install locations."
        case .daemonScriptNotFound(let path):
            return "Daemon script missing at \(path). Run scripts/postinstall.sh from the spectra plugin."
        case .daemonCoreNotFound(let path):
            return "Swift daemon-core binary missing at \(path). Run scripts/build-daemon-core.sh to compile it."
        case .writePlistFailed(let reason): return "Failed to write LaunchAgent plist: \(reason)"
        case .launchctlFailed(_, let stderr, let status):
            return "launchctl failed (\(status)): \(stderr.prefix(200))"
        }
    }
}

/// Manages the lifecycle of the two-LaunchAgent flip topology
/// (`dev.spectra.daemon` front door + `dev.spectra.daemon-ts` backend).
public struct LaunchAgentManager {
    /// Front-door label (unchanged — predates the flip, still primary-socket).
    public static let label = "dev.spectra.daemon"
    public static let plistName = "dev.spectra.daemon.plist"
    /// Backend (TS) label — new in the flip (ADR-03).
    public static let tsLabel = "dev.spectra.daemon-ts"
    public static let tsPlistName = "dev.spectra.daemon-ts.plist"

    private let plistURL: URL
    private let tsPlistURL: URL
    private let daemonScriptPath: String
    private let daemonLauncherPath: String
    private let daemonCorePath: String
    private let nodePath: String
    private let logDir: URL
    /// Secondary socket the backend listens on and the front door proxies to.
    private let backendSocketPath: String

    public init(
        homeURL: URL = URL(fileURLWithPath: NSHomeDirectory()),
        daemonScriptPath: String? = nil,
        daemonLauncherPath: String? = nil,
        nodePath: String? = nil
    ) throws {
        let launchAgentsDir = homeURL.appendingPathComponent("Library/LaunchAgents")
        self.plistURL = launchAgentsDir.appendingPathComponent(Self.plistName)
        self.tsPlistURL = launchAgentsDir.appendingPathComponent(Self.tsPlistName)
        self.daemonScriptPath = daemonScriptPath ?? homeURL
            .appendingPathComponent(".spectra/dist/cli/index.js").path
        self.daemonLauncherPath = daemonLauncherPath ?? homeURL
            .appendingPathComponent(".spectra/bin/spectra-daemon-launcher").path
        self.daemonCorePath = homeURL
            .appendingPathComponent(".spectra/bin/spectra-daemon-core").path
        self.nodePath = try (nodePath ?? Self.resolveNodePath())
        self.logDir = homeURL.appendingPathComponent(".spectra/logs")
        self.backendSocketPath = homeURL
            .appendingPathComponent(".spectra/daemon-ts.sock").path
    }

    // ─── Plist content — front door (dev.spectra.daemon) ─────

    /// Front-door plist: runs the native Swift daemon-core binary directly
    /// on the PRIMARY socket, proxying non-native ops to the backend below.
    public func makePlist() -> String {
        let programArguments = makeProgramArguments()
            .map { "                <string>\($0)</string>" }
            .joined(separator: "\n")
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(Self.label)</string>
            <key>ProgramArguments</key>
            <array>
            \(programArguments)
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>EnvironmentVariables</key>
            <dict>
                <key>PATH</key>
                <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
                <key>SPECTRA_PROXY_BACKEND_SOCKET</key>
                <string>\(backendSocketPath)</string>
            </dict>
            <key>StandardOutPath</key>
            <string>\(logDir.appendingPathComponent("daemon.out.log").path)</string>
            <key>StandardErrorPath</key>
            <string>\(logDir.appendingPathComponent("daemon.err.log").path)</string>
            <key>ProcessType</key>
            <string>Background</string>
        </dict>
        </plist>
        """
        return plist
    }

    /// Front door runs the native binary directly — no launcher/node
    /// indirection needed (that indirection now lives only on the TS side).
    public func makeProgramArguments() -> [String] {
        [daemonCorePath]
    }

    // ─── Plist content — backend (dev.spectra.daemon-ts) ─────

    /// Backend plist: the SAME node invocation this file always used
    /// (signed launcher, falling back to `node dist/cli/index.js daemon`),
    /// now bound to a SECONDARY socket via SPECTRA_DAEMON_LISTEN_SOCKET so it
    /// stops competing for the primary socket the front door now owns.
    public func makeTsPlist() -> String {
        let programArguments = makeTsProgramArguments()
            .map { "                <string>\($0)</string>" }
            .joined(separator: "\n")
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(Self.tsLabel)</string>
            <key>ProgramArguments</key>
            <array>
            \(programArguments)
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>EnvironmentVariables</key>
            <dict>
                <key>PATH</key>
                <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
                <key>SPECTRA_DAEMON_LISTEN_SOCKET</key>
                <string>\(backendSocketPath)</string>
            </dict>
            <key>StandardOutPath</key>
            <string>\(logDir.appendingPathComponent("daemon-ts.out.log").path)</string>
            <key>StandardErrorPath</key>
            <string>\(logDir.appendingPathComponent("daemon-ts.err.log").path)</string>
            <key>ProcessType</key>
            <string>Background</string>
        </dict>
        </plist>
        """
        return plist
    }

    public func makeTsProgramArguments() -> [String] {
        if FileManager.default.isExecutableFile(atPath: daemonLauncherPath) {
            return [
                daemonLauncherPath,
                "--node",
                nodePath,
                "--script",
                daemonScriptPath,
            ]
        }
        return [nodePath, daemonScriptPath, "daemon"]
    }

    // ─── Install / uninstall — full topology (G2a pin) ───────
    //
    // Every method below operates on BOTH agents so no caller (including the
    // GUI, which only ever calls this signature-stable surface) can produce
    // a half-installed topology.

    /// Writes BOTH plists. Fails with an actionable error naming the exact
    /// missing path when either binary the topology depends on is absent —
    /// the Swift daemon-core (front door) or the TS dist entry (backend).
    /// The GUI never runs scripts/build-daemon-core.sh itself, so this is
    /// the only place that failure becomes visible to it.
    public func install() throws {
        try FileManager.default.createDirectory(
            at: plistURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: logDir,
            withIntermediateDirectories: true
        )
        guard FileManager.default.isExecutableFile(atPath: daemonCorePath) else {
            throw LaunchAgentError.daemonCoreNotFound(path: daemonCorePath)
        }
        guard FileManager.default.fileExists(atPath: daemonScriptPath) else {
            throw LaunchAgentError.daemonScriptNotFound(path: daemonScriptPath)
        }
        do {
            try makePlist().write(to: plistURL, atomically: true, encoding: .utf8)
            try makeTsPlist().write(to: tsPlistURL, atomically: true, encoding: .utf8)
        } catch let error as LaunchAgentError {
            throw error
        } catch {
            throw LaunchAgentError.writePlistFailed(error.localizedDescription)
        }
    }

    /// Bootstraps BOTH agents. Backend first (so the front door's proxy has
    /// a target to reach as soon as it comes up) then the front door; either
    /// launchctl call throwing propagates to the caller — ADR-01 documents
    /// the resulting boot-order gap as benign (proxied ops answer
    /// `daemon_unhealthy` until the backend socket appears, KeepAlive closes
    /// the gap).
    public func bootstrap() throws {
        let uid = String(getuid())
        try runLaunchctl(["bootstrap", "gui/\(uid)", tsPlistURL.path])
        try runLaunchctl(["bootstrap", "gui/\(uid)", plistURL.path])
    }

    /// Boots out BOTH agents. Idempotent — ignores "not loaded" errors for
    /// each, independently, so a partial prior state never blocks teardown.
    public func bootout() throws {
        let uid = String(getuid())
        _ = try? runLaunchctl(["bootout", "gui/\(uid)/\(Self.label)"])
        _ = try? runLaunchctl(["bootout", "gui/\(uid)/\(Self.tsLabel)"])
    }

    public func reinstall() throws {
        try bootout()
        try install()
        try bootstrap()
    }

    /// Boots out and removes BOTH plists.
    public func uninstall() throws {
        try bootout()
        if FileManager.default.fileExists(atPath: plistURL.path) {
            try FileManager.default.removeItem(at: plistURL)
        }
        if FileManager.default.fileExists(atPath: tsPlistURL.path) {
            try FileManager.default.removeItem(at: tsPlistURL)
        }
    }

    /// True only when BOTH plists are present — a lone front-door or lone
    /// backend plist is a half-installed topology, not "installed".
    public func isInstalled() -> Bool {
        FileManager.default.fileExists(atPath: plistURL.path) &&
            FileManager.default.fileExists(atPath: tsPlistURL.path)
    }

    /// True only when BOTH agents are loaded in launchd.
    public func isLoaded() -> Bool {
        let uid = String(getuid())
        let frontLoaded = (try? runLaunchctl(["print", "gui/\(uid)/\(Self.label)"])) != nil
        let backendLoaded = (try? runLaunchctl(["print", "gui/\(uid)/\(Self.tsLabel)"])) != nil
        return frontLoaded && backendLoaded
    }

    // ─── Helpers ─────────────────────────────────────────────

    @discardableResult
    private func runLaunchctl(_ args: [String]) throws -> String {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        task.arguments = args

        let stdout = Pipe()
        let stderr = Pipe()
        task.standardOutput = stdout
        task.standardError = stderr

        try task.run()
        task.waitUntilExit()
        let outStr = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let errStr = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

        guard task.terminationStatus == 0 else {
            throw LaunchAgentError.launchctlFailed(stdout: outStr, stderr: errStr, status: task.terminationStatus)
        }
        return outStr
    }

    static func resolveNodePath() throws -> String {
        let candidates = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ]
        for c in candidates {
            if FileManager.default.isExecutableFile(atPath: c) {
                return c
            }
        }
        // Last resort: ask `which node` via /bin/sh -lc to pick up PATH from
        // login shell.
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        task.standardOutput = pipe
        try task.run()
        task.waitUntilExit()
        let raw = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, FileManager.default.isExecutableFile(atPath: trimmed) {
            return trimmed
        }
        throw LaunchAgentError.nodeNotFound
    }
}
