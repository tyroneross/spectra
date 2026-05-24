// LaunchAgentManager.swift
//
// Installs / loads / unloads the Spectra daemon as a per-user launchd
// LaunchAgent. The agent runs `node ~/.spectra/dist/cli/index.js daemon`
// with KeepAlive=true so it survives crashes and reboots without the
// SwiftUI app needing to spawn it manually each time.
//
// `~/.spectra/dist/cli/index.js` is mirrored from the plugin's dist/ by
// scripts/postinstall.sh, so the path is stable across plugin updates
// (the plugin cache dir is not — plugin updates wipe it).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public enum LaunchAgentError: Error, LocalizedError {
    case nodeNotFound
    case daemonScriptNotFound(path: String)
    case writePlistFailed(String)
    case launchctlFailed(stdout: String, stderr: String, status: Int32)

    public var errorDescription: String? {
        switch self {
        case .nodeNotFound: return "Node not found in PATH or standard install locations."
        case .daemonScriptNotFound(let path):
            return "Daemon script missing at \(path). Run scripts/postinstall.sh from the spectra plugin."
        case .writePlistFailed(let reason): return "Failed to write LaunchAgent plist: \(reason)"
        case .launchctlFailed(_, let stderr, let status):
            return "launchctl failed (\(status)): \(stderr.prefix(200))"
        }
    }
}

/// Manages the lifecycle of the `dev.spectra.daemon` LaunchAgent.
public struct LaunchAgentManager {
    public static let label = "dev.spectra.daemon"
    public static let plistName = "dev.spectra.daemon.plist"

    private let plistURL: URL
    private let daemonScriptPath: String
    private let nodePath: String
    private let logDir: URL

    public init(
        homeURL: URL = URL(fileURLWithPath: NSHomeDirectory()),
        daemonScriptPath: String? = nil,
        nodePath: String? = nil
    ) throws {
        self.plistURL = homeURL
            .appendingPathComponent("Library/LaunchAgents")
            .appendingPathComponent(Self.plistName)
        self.daemonScriptPath = daemonScriptPath ?? homeURL
            .appendingPathComponent(".spectra/dist/cli/index.js").path
        self.nodePath = try (nodePath ?? Self.resolveNodePath())
        self.logDir = homeURL.appendingPathComponent(".spectra/logs")
    }

    // ─── Plist content ───────────────────────────────────────

    public func makePlist() -> String {
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(Self.label)</string>
            <key>ProgramArguments</key>
            <array>
                <string>\(nodePath)</string>
                <string>\(daemonScriptPath)</string>
                <string>daemon</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>EnvironmentVariables</key>
            <dict>
                <key>PATH</key>
                <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
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

    // ─── Install / uninstall ─────────────────────────────────

    public func install() throws {
        try FileManager.default.createDirectory(
            at: plistURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: logDir,
            withIntermediateDirectories: true
        )
        guard FileManager.default.fileExists(atPath: daemonScriptPath) else {
            throw LaunchAgentError.daemonScriptNotFound(path: daemonScriptPath)
        }
        do {
            try makePlist().write(to: plistURL, atomically: true, encoding: .utf8)
        } catch {
            throw LaunchAgentError.writePlistFailed(error.localizedDescription)
        }
    }

    public func bootstrap() throws {
        let uid = String(getuid())
        try runLaunchctl(["bootstrap", "gui/\(uid)", plistURL.path])
    }

    public func bootout() throws {
        let uid = String(getuid())
        // Idempotent — ignore "not loaded" errors.
        _ = try? runLaunchctl(["bootout", "gui/\(uid)/\(Self.label)"])
    }

    public func reinstall() throws {
        try bootout()
        try install()
        try bootstrap()
    }

    public func uninstall() throws {
        try bootout()
        if FileManager.default.fileExists(atPath: plistURL.path) {
            try FileManager.default.removeItem(at: plistURL)
        }
    }

    public func isInstalled() -> Bool {
        FileManager.default.fileExists(atPath: plistURL.path)
    }

    public func isLoaded() -> Bool {
        let uid = String(getuid())
        return (try? runLaunchctl(["print", "gui/\(uid)/\(Self.label)"])) != nil
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
