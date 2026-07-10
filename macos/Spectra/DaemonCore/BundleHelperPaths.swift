// macos/Spectra/DaemonCore/BundleHelperPaths.swift
//
// One Foundation-only path contract for native helpers spawned by the Swift
// daemon-core. Production launchd plists select `bundle` mode and provide an
// explicit app/helpers location; only an explicitly selected `development`
// mode may read helper binaries from HOME/.spectra/bin.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

enum BundleHelperMode: String {
    case bundle
    case development
}

enum OptionalHelperResolution: Equatable {
    case executable(String)
    case unavailableInDevelopment(String)
}

enum BundleHelperPathError: Error, Equatable, LocalizedError, CustomStringConvertible {
    case missingMode(environmentKey: String)
    case unsupportedMode(String)
    case emptyEnvironmentValue(String)
    case missingBundleLocation
    case helperNotExecutable(helperName: String, path: String, source: String)
    case unsafeHelperPath(helperName: String, path: String, source: String, reason: String)

    var errorDescription: String? {
        switch self {
        case .missingMode(let environmentKey):
            return "Native helper mode is not configured. Set \(environmentKey)=bundle for production or \(environmentKey)=development for local builds."
        case .unsupportedMode(let mode):
            return "Unsupported native helper mode '\(mode)'. Expected bundle or development."
        case .emptyEnvironmentValue(let key):
            return "Native helper environment value \(key) is empty."
        case .missingBundleLocation:
            return "Bundle helper mode requires SPECTRA_APP_BUNDLE_HELPERS_DIR or SPECTRA_APP_BUNDLE_PATH."
        case .helperNotExecutable(let helperName, let path, let source):
            return "\(helperName) is missing or not executable at \(path) (resolved from \(source))."
        case .unsafeHelperPath(let helperName, let path, let source, let reason):
            return "\(helperName) resolved to an unsafe path at \(path) from \(source): \(reason). Bundle helpers must be regular, non-symlink executables directly inside the configured Contents/Helpers directory."
        }
    }

    var description: String {
        errorDescription ?? "Native helper path resolution failed."
    }
}

enum BundleHelperPaths {
    static let modeEnvironmentKey = "SPECTRA_HELPER_MODE"
    static let bundleHelpersDirectoryEnvironmentKey = "SPECTRA_APP_BUNDLE_HELPERS_DIR"
    static let appBundlePathEnvironmentKey = "SPECTRA_APP_BUNDLE_PATH"

    /// Resolve and validate one helper executable.
    ///
    /// Precedence is intentionally strict:
    /// 1. A helper-specific override is authoritative, even when invalid.
    /// 2. `bundle` mode requires the configured helpers directory/app bundle
    ///    and never falls through to a home binary.
    /// 3. `development` mode alone may use env-first HOME/.spectra/bin.
    ///
    /// Standalone daemon-core never consults `Bundle.main`; launchd supplies
    /// the production bundle location explicitly.
    static func resolveExecutable(
        helperName: String,
        overrideEnvironmentKey: String? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        defaultHome: String = NSHomeDirectory(),
        fileManager: FileManager = .default
    ) throws -> String {
        let rawMode = normalizedMode(environment: environment)
        if let overrideEnvironmentKey,
           environment.keys.contains(overrideEnvironmentKey) {
            let path = try nonEmptyEnvironmentValue(
                overrideEnvironmentKey,
                environment: environment
            )
            let requiredBundleHelpersDirectory: String?
            if rawMode == BundleHelperMode.bundle.rawValue {
                requiredBundleHelpersDirectory = try configuredBundleHelpersDirectory(
                    environment: environment
                ).path
            } else {
                requiredBundleHelpersDirectory = nil
            }
            return try validatedExecutable(
                helperName: helperName,
                path: path,
                source: overrideEnvironmentKey,
                requiredBundleHelpersDirectory: requiredBundleHelpersDirectory,
                fileManager: fileManager
            )
        }

        guard let rawMode, !rawMode.isEmpty else {
            throw BundleHelperPathError.missingMode(environmentKey: modeEnvironmentKey)
        }
        guard let mode = BundleHelperMode(rawValue: rawMode) else {
            throw BundleHelperPathError.unsupportedMode(rawMode)
        }

        let path: String
        let source: String
        let requiredBundleHelpersDirectory: String?
        switch mode {
        case .bundle:
            let configured = try configuredBundleHelpersDirectory(environment: environment)
            let helpersDirectory = configured.path
            source = configured.source
            requiredBundleHelpersDirectory = helpersDirectory
            path = URL(fileURLWithPath: helpersDirectory, isDirectory: true)
                .appendingPathComponent(helperName, isDirectory: false)
                .path

        case .development:
            let home: String
            if environment.keys.contains("HOME") {
                home = try nonEmptyEnvironmentValue("HOME", environment: environment)
                source = "HOME"
            } else {
                guard !defaultHome.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw BundleHelperPathError.emptyEnvironmentValue("HOME")
                }
                home = defaultHome
                source = "NSHomeDirectory"
            }
            requiredBundleHelpersDirectory = nil
            path = URL(fileURLWithPath: home, isDirectory: true)
                .appendingPathComponent(".spectra", isDirectory: true)
                .appendingPathComponent("bin", isDirectory: true)
                .appendingPathComponent(helperName, isDirectory: false)
                .path
        }

        return try validatedExecutable(
            helperName: helperName,
            path: path,
            source: source,
            requiredBundleHelpersDirectory: requiredBundleHelpersDirectory,
            fileManager: fileManager
        )
    }

    /// Resolve an optional helper without weakening production. Only explicit
    /// development mode may convert a resolver error into a warning result;
    /// every other mode rethrows the original error.
    static func resolveOptionalExecutable(
        helperName: String,
        overrideEnvironmentKey: String? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        defaultHome: String = NSHomeDirectory(),
        fileManager: FileManager = .default
    ) throws -> OptionalHelperResolution {
        do {
            return .executable(
                try resolveExecutable(
                    helperName: helperName,
                    overrideEnvironmentKey: overrideEnvironmentKey,
                    environment: environment,
                    defaultHome: defaultHome,
                    fileManager: fileManager
                )
            )
        } catch {
            guard allowsOptionalHelperResolutionFailure(environment: environment) else {
                throw error
            }
            return .unavailableInDevelopment(String(describing: error))
        }
    }

    /// Optional helper failures are non-fatal only in an explicitly selected
    /// development session. Bundle, missing, and invalid modes fail closed.
    static func allowsOptionalHelperResolutionFailure(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        normalizedMode(environment: environment) == BundleHelperMode.development.rawValue
    }

    private static func normalizedMode(environment: [String: String]) -> String? {
        environment[modeEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private static func configuredBundleHelpersDirectory(
        environment: [String: String]
    ) throws -> (path: String, source: String) {
        if environment.keys.contains(bundleHelpersDirectoryEnvironmentKey) {
            return (
                try nonEmptyEnvironmentValue(
                    bundleHelpersDirectoryEnvironmentKey,
                    environment: environment
                ),
                bundleHelpersDirectoryEnvironmentKey
            )
        }
        if environment.keys.contains(appBundlePathEnvironmentKey) {
            let appBundlePath = try nonEmptyEnvironmentValue(
                appBundlePathEnvironmentKey,
                environment: environment
            )
            return (
                URL(fileURLWithPath: appBundlePath, isDirectory: true)
                    .appendingPathComponent("Contents", isDirectory: true)
                    .appendingPathComponent("Helpers", isDirectory: true)
                    .path,
                appBundlePathEnvironmentKey
            )
        }
        throw BundleHelperPathError.missingBundleLocation
    }

    private static func nonEmptyEnvironmentValue(
        _ key: String,
        environment: [String: String]
    ) throws -> String {
        guard let value = environment[key],
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BundleHelperPathError.emptyEnvironmentValue(key)
        }
        return value
    }

    private static func validatedExecutable(
        helperName: String,
        path: String,
        source: String,
        requiredBundleHelpersDirectory: String? = nil,
        fileManager: FileManager
    ) throws -> String {
        let attributes = try? fileManager.attributesOfItem(atPath: path)
        let fileType = attributes?[.type] as? FileAttributeType
        if fileType == .typeSymbolicLink {
            throw BundleHelperPathError.unsafeHelperPath(
                helperName: helperName,
                path: path,
                source: source,
                reason: "symbolic links are not allowed"
            )
        }
        guard fileType == .typeRegular,
              fileManager.isExecutableFile(atPath: path) else {
            throw BundleHelperPathError.helperNotExecutable(
                helperName: helperName,
                path: path,
                source: source
            )
        }
        if let requiredBundleHelpersDirectory {
            try validateBundleContainment(
                helperName: helperName,
                path: path,
                source: source,
                helpersDirectory: requiredBundleHelpersDirectory
            )
        }
        return path
    }

    private static func validateBundleContainment(
        helperName: String,
        path: String,
        source: String,
        helpersDirectory: String
    ) throws {
        let helpersURL = URL(fileURLWithPath: helpersDirectory, isDirectory: true)
            .standardizedFileURL
        let helperURL = URL(fileURLWithPath: path, isDirectory: false)
            .standardizedFileURL
        let expectedHelperURL = helpersURL
            .appendingPathComponent(helperName, isDirectory: false)
            .standardizedFileURL

        guard expectedHelperURL.deletingLastPathComponent().path == helpersURL.path,
              helperURL.path == expectedHelperURL.path else {
            throw BundleHelperPathError.unsafeHelperPath(
                helperName: helperName,
                path: path,
                source: source,
                reason: "the configured path escapes \(helpersURL.path)"
            )
        }

        let canonicalHelpersURL = helpersURL.resolvingSymlinksInPath().standardizedFileURL
        let canonicalHelperURL = helperURL.resolvingSymlinksInPath().standardizedFileURL
        guard canonicalHelpersURL.path == helpersURL.path,
              canonicalHelperURL.path == helperURL.path,
              canonicalHelperURL.deletingLastPathComponent().path == canonicalHelpersURL.path else {
            throw BundleHelperPathError.unsafeHelperPath(
                helperName: helperName,
                path: path,
                source: source,
                reason: "the canonical path escapes or traverses a symlink outside \(helpersURL.path)"
            )
        }
    }
}
