// LaunchAgentManager.swift
//
// Manages Spectra's two-LaunchAgent topology:
//
//   dev.spectra.daemon     — native daemon-core on the primary socket
//   dev.spectra.daemon-ts  — TypeScript backend on a secondary socket
//
// Production plists run only helpers embedded in a stable Spectra.app. An
// explicitly selected development mode preserves the historical
// ~/.spectra/bin paths and node fallback.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

public enum LaunchAgentError: Error, LocalizedError {
    case nodeNotFound
    case daemonScriptNotFound(path: String)
    case daemonCoreNotFound(path: String)
    case unsupportedHelperMode(value: String)
    case productionBundleNotFound(paths: [String])
    case unstableProductionBundle(path: String, supportedPaths: [String])
    case bundleHelpersDirectoryMismatch(path: String, expectedPath: String)
    case unsafeBundleHelpersDirectory(path: String, resolvedPath: String)
    case bundleHelperPathMismatch(key: String, path: String, expectedPath: String)
    case bundledHelperMissing(name: String, path: String)
    case bundledHelperNotExecutable(name: String, path: String)
    case writePlistFailed(String)
    case launchctlFailed(stdout: String, stderr: String, status: Int32)

    public var errorDescription: String? {
        switch self {
        case .nodeNotFound:
            return "Node not found in PATH or standard install locations."
        case .daemonScriptNotFound(let path):
            return "Daemon script missing at \(path). Run scripts/postinstall.sh from the spectra plugin."
        case .daemonCoreNotFound(let path):
            return "Swift daemon-core binary missing at \(path). Run scripts/build-daemon-core.sh to compile it."
        case .unsupportedHelperMode(let value):
            return "Unsupported SPECTRA_HELPER_MODE '\(value)'. Use bundle for an installed app or development for local ~/.spectra/bin helpers."
        case .productionBundleNotFound(let paths):
            return "Spectra.app was not found at a supported persistent location (\(paths.joined(separator: ", "))). Install the app there, or set SPECTRA_HELPER_MODE=development for a local build."
        case .unstableProductionBundle(let path, let supportedPaths):
            return "Refusing to persist LaunchAgents for unstable Spectra.app path \(path). Production supports only \(supportedPaths.joined(separator: " or ")); use SPECTRA_HELPER_MODE=development for transient builds."
        case .bundleHelpersDirectoryMismatch(let path, let expectedPath):
            return "Configured bundle helpers directory \(path) does not match \(expectedPath). Reinstall Spectra.app or correct the bundle environment."
        case .unsafeBundleHelpersDirectory(let path, let resolvedPath):
            return "Refusing to persist LaunchAgents because bundle helpers directory \(path) resolves to \(resolvedPath). Contents/Helpers must be a physical directory inside Spectra.app, not a symbolic link or canonical-path escape."
        case .bundleHelperPathMismatch(let key, let path, let expectedPath):
            return "Production \(key) path \(path) must be the embedded helper at \(expectedPath). Use SPECTRA_HELPER_MODE=development for local helper overrides."
        case .bundledHelperMissing(let name, let path):
            return "Required bundled helper \(name) is missing at \(path). Reinstall a complete Spectra.app; production will not fall back to ~/.spectra/bin."
        case .bundledHelperNotExecutable(let name, let path):
            return "Required bundled helper \(name) is not a regular executable file at \(path). Symbolic links, directories, and other non-regular entries are rejected; reinstall a correctly signed Spectra.app."
        case .writePlistFailed(let reason):
            return "Failed to write LaunchAgent plist: \(reason)"
        case .launchctlFailed(_, let stderr, let status):
            return "launchctl failed (\(status)): \(stderr.prefix(200))"
        }
    }
}

/// Manages the lifecycle of the two-LaunchAgent flip topology
/// (`dev.spectra.daemon` front door + `dev.spectra.daemon-ts` backend).
public struct LaunchAgentManager {
    public static let label = "dev.spectra.daemon"
    public static let plistName = "dev.spectra.daemon.plist"
    public static let tsLabel = "dev.spectra.daemon-ts"
    public static let tsPlistName = "dev.spectra.daemon-ts.plist"

    private static let appBundleIdentifier = "dev.spectra.app"
    private static let bundledHelperNames = [
        "spectra-daemon-core",
        "spectra-daemon-launcher",
        "spectra-native",
        "spectra-composite-capture",
        "spectra-screen-recording-preflight",
        "spectra-cursor-sampler",
        "spectra-window-bounds",
        "spectra-text-render",
    ]

    private enum HelperMode: String {
        case bundle
        case development
    }

    private let plistURL: URL
    private let tsPlistURL: URL
    private let daemonScriptPath: String
    private let daemonLauncherPath: String
    private let daemonCorePath: String
    private let nodePath: String
    private let logDir: URL
    private let backendSocketPath: String
    private let helperMode: HelperMode
    private let appBundleURL: URL?
    private let helpersDirectoryURL: URL?
    private let nativeHelperPath: String
    private let cursorSamplerPath: String
    private let windowBoundsPath: String
    private let supportedProductionBundlePaths: Set<String>
    private let launchctlExecutableURL: URL

    /// Public lifecycle initializer. Its signature is intentionally unchanged.
    public init(
        homeURL: URL = URL(fileURLWithPath: NSHomeDirectory()),
        daemonScriptPath: String? = nil,
        daemonLauncherPath: String? = nil,
        nodePath: String? = nil
    ) throws {
        // `homeURL` remains injectable for the existing plist/socket surface,
        // but it must never expand production's stable-app allowlist.
        let candidates = Self.stableProductionBundleURLs(
            homeURL: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        )
        try self.init(
            testingHomeURL: homeURL,
            daemonScriptPath: daemonScriptPath,
            daemonLauncherPath: daemonLauncherPath,
            nodePath: nodePath,
            environment: ProcessInfo.processInfo.environment,
            productionBundleCandidates: candidates,
            allowedProductionBundleURLs: candidates,
            launchctlExecutableURL: URL(fileURLWithPath: "/bin/launchctl")
        )
    }

    /// Deterministic internal seam for XCTest. Production callers always use
    /// the public initializer and its two fixed Applications candidates.
    init(
        testingHomeURL homeURL: URL,
        daemonScriptPath: String?,
        daemonLauncherPath: String?,
        nodePath: String?,
        environment: [String: String],
        productionBundleCandidates: [URL],
        allowedProductionBundleURLs: [URL],
        launchctlExecutableURL: URL
    ) throws {
        let launchAgentsDir = homeURL.appendingPathComponent("Library/LaunchAgents")
        self.plistURL = launchAgentsDir.appendingPathComponent(Self.plistName)
        self.tsPlistURL = launchAgentsDir.appendingPathComponent(Self.tsPlistName)
        self.daemonScriptPath = daemonScriptPath ?? homeURL
            .appendingPathComponent(".spectra/dist/cli/index.js").path
        self.nodePath = try (nodePath ?? Self.resolveNodePath())
        self.logDir = homeURL.appendingPathComponent(".spectra/logs")
        self.backendSocketPath = homeURL
            .appendingPathComponent(".spectra/daemon-ts.sock").path
        self.launchctlExecutableURL = launchctlExecutableURL
        self.supportedProductionBundlePaths = Set(
            allowedProductionBundleURLs.map { Self.standardizedPath($0) }
        )

        let rawMode = environment["SPECTRA_HELPER_MODE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let modeValue = (rawMode?.isEmpty == false) ? rawMode! : HelperMode.bundle.rawValue
        guard let helperMode = HelperMode(rawValue: modeValue) else {
            throw LaunchAgentError.unsupportedHelperMode(value: modeValue)
        }
        self.helperMode = helperMode

        switch helperMode {
        case .bundle:
            let bundleURL = try Self.selectProductionBundleURL(
                environment: environment,
                candidates: productionBundleCandidates,
                supportedPaths: supportedProductionBundlePaths
            )
            let helpersURL = bundleURL
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent("Helpers", isDirectory: true)
            self.appBundleURL = bundleURL
            self.helpersDirectoryURL = helpersURL
            self.daemonCorePath = helpersURL
                .appendingPathComponent("spectra-daemon-core").path
            self.daemonLauncherPath = helpersURL
                .appendingPathComponent("spectra-daemon-launcher").path
            self.nativeHelperPath = helpersURL
                .appendingPathComponent("spectra-native").path
            self.cursorSamplerPath = helpersURL
                .appendingPathComponent("spectra-cursor-sampler").path
            self.windowBoundsPath = helpersURL
                .appendingPathComponent("spectra-window-bounds").path
            try Self.validateProductionHelperPath(
                key: "daemonLauncherPath",
                configuredPath: daemonLauncherPath,
                expectedPath: self.daemonLauncherPath
            )
            try Self.validateProductionHelperPath(
                key: "SPECTRA_NATIVE_HELPER_PATH",
                configuredPath: environment["SPECTRA_NATIVE_HELPER_PATH"],
                expectedPath: self.nativeHelperPath
            )
            try Self.validateProductionHelperPath(
                key: "SPECTRA_CURSOR_SAMPLER_PATH",
                configuredPath: environment["SPECTRA_CURSOR_SAMPLER_PATH"],
                expectedPath: self.cursorSamplerPath
            )
            try Self.validateProductionHelperPath(
                key: "SPECTRA_WINDOW_BOUNDS_BIN",
                configuredPath: environment["SPECTRA_WINDOW_BOUNDS_BIN"],
                expectedPath: self.windowBoundsPath
            )

        case .development:
            let developmentBinURL = homeURL.appendingPathComponent(".spectra/bin")
            self.appBundleURL = nil
            self.helpersDirectoryURL = nil
            self.daemonCorePath = developmentBinURL
                .appendingPathComponent("spectra-daemon-core").path
            self.daemonLauncherPath = daemonLauncherPath ?? developmentBinURL
                .appendingPathComponent("spectra-daemon-launcher").path
            self.nativeHelperPath = environment["SPECTRA_NATIVE_HELPER_PATH"] ?? developmentBinURL
                .appendingPathComponent("spectra-native").path
            self.cursorSamplerPath = environment["SPECTRA_CURSOR_SAMPLER_PATH"] ?? developmentBinURL
                .appendingPathComponent("spectra-cursor-sampler").path
            self.windowBoundsPath = environment["SPECTRA_WINDOW_BOUNDS_BIN"] ?? developmentBinURL
                .appendingPathComponent("spectra-window-bounds").path
        }
    }

    // MARK: - Plist content

    public func makePlist() -> String {
        makePlist(
            label: Self.label,
            programArguments: makeProgramArguments(),
            socketEnvironmentKey: "SPECTRA_PROXY_BACKEND_SOCKET",
            stdoutName: "daemon.out.log",
            stderrName: "daemon.err.log"
        )
    }

    public func makeProgramArguments() -> [String] {
        [daemonCorePath]
    }

    public func makeTsPlist() -> String {
        makePlist(
            label: Self.tsLabel,
            programArguments: makeTsProgramArguments(),
            socketEnvironmentKey: "SPECTRA_DAEMON_LISTEN_SOCKET",
            stdoutName: "daemon-ts.out.log",
            stderrName: "daemon-ts.err.log"
        )
    }

    public func makeTsProgramArguments() -> [String] {
        if helperMode == .bundle || FileManager.default.isExecutableFile(atPath: daemonLauncherPath) {
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

    private func makePlist(
        label: String,
        programArguments: [String],
        socketEnvironmentKey: String,
        stdoutName: String,
        stderrName: String
    ) -> String {
        let argumentXML = programArguments
            .map { "                <string>\(Self.xmlEscaped($0))</string>" }
            .joined(separator: "\n")
        let environmentXML = environmentEntries(socketEnvironmentKey: socketEnvironmentKey)
            .map {
                "                <key>\(Self.xmlEscaped($0.key))</key>\n" +
                    "                <string>\(Self.xmlEscaped($0.value))</string>"
            }
            .joined(separator: "\n")

        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(Self.xmlEscaped(label))</string>
            <key>AssociatedBundleIdentifiers</key>
            <array>
                <string>\(Self.appBundleIdentifier)</string>
            </array>
            <key>ProgramArguments</key>
            <array>
        \(argumentXML)
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>EnvironmentVariables</key>
            <dict>
        \(environmentXML)
            </dict>
            <key>StandardOutPath</key>
            <string>\(Self.xmlEscaped(logDir.appendingPathComponent(stdoutName).path))</string>
            <key>StandardErrorPath</key>
            <string>\(Self.xmlEscaped(logDir.appendingPathComponent(stderrName).path))</string>
            <key>ProcessType</key>
            <string>Background</string>
        </dict>
        </plist>
        """
    }

    private func environmentEntries(socketEnvironmentKey: String) -> [(key: String, value: String)] {
        var entries: [(key: String, value: String)] = [
            ("PATH", "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"),
            (socketEnvironmentKey, backendSocketPath),
            ("SPECTRA_HELPER_MODE", helperMode.rawValue),
        ]
        if let appBundleURL, let helpersDirectoryURL {
            entries.append(("SPECTRA_APP_BUNDLE_PATH", appBundleURL.path))
            entries.append(("SPECTRA_APP_BUNDLE_HELPERS_DIR", helpersDirectoryURL.path))
        }
        entries.append(("SPECTRA_NATIVE_HELPER_PATH", nativeHelperPath))
        entries.append(("SPECTRA_CURSOR_SAMPLER_PATH", cursorSamplerPath))
        entries.append(("SPECTRA_WINDOW_BOUNDS_BIN", windowBoundsPath))
        return entries
    }

    // MARK: - Lifecycle

    /// Preflights the complete production helper inventory before writing
    /// either plist, preventing a half-valid persistent launchd topology.
    public func install() throws {
        try validateInstallPrerequisites()
        try FileManager.default.createDirectory(
            at: plistURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: logDir,
            withIntermediateDirectories: true
        )
        do {
            try makePlist().write(to: plistURL, atomically: true, encoding: .utf8)
            try makeTsPlist().write(to: tsPlistURL, atomically: true, encoding: .utf8)
        } catch let error as LaunchAgentError {
            throw error
        } catch {
            throw LaunchAgentError.writePlistFailed(error.localizedDescription)
        }
    }

    /// Backend first so the front door has a proxy target immediately.
    public func bootstrap() throws {
        let uid = String(getuid())
        try runLaunchctl(["bootstrap", "gui/\(uid)", tsPlistURL.path])
        try runLaunchctl(["bootstrap", "gui/\(uid)", plistURL.path])
    }

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

    public func uninstall() throws {
        try bootout()
        if FileManager.default.fileExists(atPath: plistURL.path) {
            try FileManager.default.removeItem(at: plistURL)
        }
        if FileManager.default.fileExists(atPath: tsPlistURL.path) {
            try FileManager.default.removeItem(at: tsPlistURL)
        }
    }

    /// True only when both plists are present.
    public func isInstalled() -> Bool {
        FileManager.default.fileExists(atPath: plistURL.path) &&
            FileManager.default.fileExists(atPath: tsPlistURL.path)
    }

    /// True only when both agents are loaded.
    public func isLoaded() -> Bool {
        let uid = String(getuid())
        let frontLoaded = (try? runLaunchctl(["print", "gui/\(uid)/\(Self.label)"])) != nil
        let backendLoaded = (try? runLaunchctl(["print", "gui/\(uid)/\(Self.tsLabel)"])) != nil
        return frontLoaded && backendLoaded
    }

    // MARK: - Validation and resolution

    private func validateInstallPrerequisites() throws {
        switch helperMode {
        case .bundle:
            guard let appBundleURL, let helpersDirectoryURL else {
                throw LaunchAgentError.productionBundleNotFound(
                    paths: supportedProductionBundlePaths.sorted()
                )
            }
            try Self.validateStableProductionBundleURL(
                appBundleURL,
                supportedPaths: supportedProductionBundlePaths
            )
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: appBundleURL.path, isDirectory: &isDirectory),
                  isDirectory.boolValue else {
                throw LaunchAgentError.productionBundleNotFound(
                    paths: supportedProductionBundlePaths.sorted()
                )
            }
            try Self.validateProductionHelpersDirectory(
                helpersDirectoryURL,
                appBundleURL: appBundleURL
            )
            for helperName in Self.bundledHelperNames {
                let helperPath = helpersDirectoryURL.appendingPathComponent(helperName).path
                guard FileManager.default.fileExists(atPath: helperPath) else {
                    throw LaunchAgentError.bundledHelperMissing(name: helperName, path: helperPath)
                }
                let attributes = try? FileManager.default.attributesOfItem(atPath: helperPath)
                let fileType = attributes?[.type] as? FileAttributeType
                guard fileType == .typeRegular,
                      FileManager.default.isExecutableFile(atPath: helperPath) else {
                    throw LaunchAgentError.bundledHelperNotExecutable(name: helperName, path: helperPath)
                }
            }

        case .development:
            guard FileManager.default.isExecutableFile(atPath: daemonCorePath) else {
                throw LaunchAgentError.daemonCoreNotFound(path: daemonCorePath)
            }
        }

        guard FileManager.default.fileExists(atPath: daemonScriptPath) else {
            throw LaunchAgentError.daemonScriptNotFound(path: daemonScriptPath)
        }
    }

    private static func stableProductionBundleURLs(homeURL: URL) -> [URL] {
        [
            URL(fileURLWithPath: "/Applications/Spectra.app", isDirectory: true),
            homeURL.appendingPathComponent("Applications/Spectra.app", isDirectory: true),
        ]
    }

    private static func selectProductionBundleURL(
        environment: [String: String],
        candidates: [URL],
        supportedPaths: Set<String>
    ) throws -> URL {
        let configuredBundle = try nonEmptyEnvironmentPath(
            key: "SPECTRA_APP_BUNDLE_PATH",
            environment: environment
        )
        let configuredHelpers = try nonEmptyEnvironmentPath(
            key: "SPECTRA_APP_BUNDLE_HELPERS_DIR",
            environment: environment
        )

        var selectedURL: URL?
        if let configuredBundle {
            selectedURL = URL(fileURLWithPath: configuredBundle, isDirectory: true)
        }
        if let configuredHelpers {
            let helpersURL = URL(fileURLWithPath: configuredHelpers, isDirectory: true)
                .standardizedFileURL
            let suffix = "/Contents/Helpers"
            guard helpersURL.path.hasSuffix(suffix) else {
                let expected = selectedURL.map {
                    $0.appendingPathComponent("Contents/Helpers", isDirectory: true).path
                } ?? "<stable Spectra.app>/Contents/Helpers"
                throw LaunchAgentError.bundleHelpersDirectoryMismatch(
                    path: helpersURL.path,
                    expectedPath: expected
                )
            }
            let derivedBundlePath = String(helpersURL.path.dropLast(suffix.count))
            let derivedBundleURL = URL(fileURLWithPath: derivedBundlePath, isDirectory: true)
            if let selectedURL {
                let expectedHelpers = selectedURL
                    .appendingPathComponent("Contents/Helpers", isDirectory: true)
                    .standardizedFileURL.path
                guard helpersURL.path == expectedHelpers else {
                    throw LaunchAgentError.bundleHelpersDirectoryMismatch(
                        path: helpersURL.path,
                        expectedPath: expectedHelpers
                    )
                }
            } else {
                selectedURL = derivedBundleURL
            }
        }

        if selectedURL == nil {
            selectedURL = candidates.first { candidate in
                var isDirectory: ObjCBool = false
                let helpersPath = candidate.appendingPathComponent("Contents/Helpers").path
                return FileManager.default.fileExists(atPath: helpersPath, isDirectory: &isDirectory) &&
                    isDirectory.boolValue
            }
        }
        if selectedURL == nil {
            selectedURL = candidates.first { candidate in
                var isDirectory: ObjCBool = false
                return FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) &&
                    isDirectory.boolValue
            }
        }
        guard let selectedURL else {
            throw LaunchAgentError.productionBundleNotFound(paths: supportedPaths.sorted())
        }
        let standardizedURL = selectedURL.standardizedFileURL
        try validateStableProductionBundleURL(
            standardizedURL,
            supportedPaths: supportedPaths
        )
        return standardizedURL
    }

    private static func nonEmptyEnvironmentPath(
        key: String,
        environment: [String: String]
    ) throws -> String? {
        guard let rawValue = environment[key] else { return nil }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.hasPrefix("/") else {
            throw LaunchAgentError.unstableProductionBundle(
                path: rawValue,
                supportedPaths: ["/Applications/Spectra.app", "$HOME/Applications/Spectra.app"]
            )
        }
        return value
    }

    private static func validateProductionHelperPath(
        key: String,
        configuredPath: String?,
        expectedPath: String
    ) throws {
        guard let configuredPath else { return }
        let standardizedConfiguredPath = URL(fileURLWithPath: configuredPath)
            .standardizedFileURL.path
        let standardizedExpectedPath = URL(fileURLWithPath: expectedPath)
            .standardizedFileURL.path
        guard !configuredPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              configuredPath.hasPrefix("/"),
              standardizedConfiguredPath == standardizedExpectedPath else {
            throw LaunchAgentError.bundleHelperPathMismatch(
                key: key,
                path: configuredPath,
                expectedPath: expectedPath
            )
        }
    }

    private static func validateStableProductionBundleURL(
        _ bundleURL: URL,
        supportedPaths: Set<String>
    ) throws {
        let path = standardizedPath(bundleURL)
        guard supportedPaths.contains(path) else {
            throw LaunchAgentError.unstableProductionBundle(
                path: path,
                supportedPaths: supportedPaths.sorted()
            )
        }
        if FileManager.default.fileExists(atPath: path) {
            let resolvedPath = URL(fileURLWithPath: path, isDirectory: true)
                .resolvingSymlinksInPath().standardizedFileURL.path
            guard resolvedPath == path else {
                throw LaunchAgentError.unstableProductionBundle(
                    path: path,
                    supportedPaths: supportedPaths.sorted()
                )
            }
        }
    }

    private static func validateProductionHelpersDirectory(
        _ helpersDirectoryURL: URL,
        appBundleURL: URL
    ) throws {
        let standardizedBundleURL = appBundleURL.standardizedFileURL
        let expectedHelpersURL = standardizedBundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true)
            .standardizedFileURL
        let standardizedHelpersURL = helpersDirectoryURL.standardizedFileURL
        guard standardizedHelpersURL.path == expectedHelpersURL.path else {
            throw LaunchAgentError.bundleHelpersDirectoryMismatch(
                path: standardizedHelpersURL.path,
                expectedPath: expectedHelpersURL.path
            )
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: standardizedHelpersURL.path,
            isDirectory: &isDirectory
        ), isDirectory.boolValue else {
            // The helper inventory below preserves the existing, specific
            // bundledHelperMissing error when Contents/Helpers is absent.
            return
        }

        let resolvedBundleURL = standardizedBundleURL
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let resolvedHelpersURL = standardizedHelpersURL
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard resolvedBundleURL.path == standardizedBundleURL.path,
              resolvedHelpersURL.path == standardizedHelpersURL.path,
              resolvedHelpersURL.deletingLastPathComponent().path ==
                resolvedBundleURL.appendingPathComponent("Contents", isDirectory: true).path else {
            throw LaunchAgentError.unsafeBundleHelpersDirectory(
                path: standardizedHelpersURL.path,
                resolvedPath: resolvedHelpersURL.path
            )
        }
    }

    private static func standardizedPath(_ url: URL) -> String {
        url.standardizedFileURL.path
    }

    private static func xmlEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    @discardableResult
    private func runLaunchctl(_ args: [String]) throws -> String {
        let task = Process()
        task.executableURL = launchctlExecutableURL
        task.arguments = args

        let stdout = Pipe()
        let stderr = Pipe()
        task.standardOutput = stdout
        task.standardError = stderr

        try task.run()
        task.waitUntilExit()
        let outStr = String(
            data: stdout.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        let errStr = String(
            data: stderr.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""

        guard task.terminationStatus == 0 else {
            throw LaunchAgentError.launchctlFailed(
                stdout: outStr,
                stderr: errStr,
                status: task.terminationStatus
            )
        }
        return outStr
    }

    static func resolveNodePath() throws -> String {
        let candidates = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }

        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        task.standardOutput = pipe
        try task.run()
        task.waitUntilExit()
        let raw = String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, FileManager.default.isExecutableFile(atPath: trimmed) {
            return trimmed
        }
        throw LaunchAgentError.nodeNotFound
    }
}
