// LaunchAgentManagerTests.swift
//
// Focused contract tests for Spectra's two persistent LaunchAgents.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import XCTest
@testable import Spectra

final class LaunchAgentManagerTests: XCTestCase {
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

    private var tempHome: URL!
    private var fakeDaemonScript: URL!
    private var fakeDaemonLauncher: URL!
    private var fakeDaemonCore: URL!
    private var fakeNode: URL!

    private var frontPlistURL: URL {
        tempHome.appendingPathComponent("Library/LaunchAgents/\(LaunchAgentManager.plistName)")
    }

    private var backendPlistURL: URL {
        tempHome.appendingPathComponent("Library/LaunchAgents/\(LaunchAgentManager.tsPlistName)")
    }

    override func setUpWithError() throws {
        let temporaryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("spectra-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporaryURL, withIntermediateDirectories: true)
        tempHome = temporaryURL.resolvingSymlinksInPath()

        let distDirectory = tempHome.appendingPathComponent(".spectra/dist/cli")
        try FileManager.default.createDirectory(at: distDirectory, withIntermediateDirectories: true)
        fakeDaemonScript = distDirectory.appendingPathComponent("index.js")
        try "// stub".write(to: fakeDaemonScript, atomically: true, encoding: .utf8)

        let binDirectory = tempHome.appendingPathComponent(".spectra/bin")
        try FileManager.default.createDirectory(at: binDirectory, withIntermediateDirectories: true)
        fakeDaemonLauncher = binDirectory.appendingPathComponent("spectra-daemon-launcher")
        try makeExecutable(at: fakeDaemonLauncher)

        fakeDaemonCore = binDirectory.appendingPathComponent("spectra-daemon-core")
        try makeExecutable(at: fakeDaemonCore)

        fakeNode = tempHome.appendingPathComponent("fake-node")
        try makeExecutable(at: fakeNode)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempHome)
    }

    // MARK: - Fixtures

    private func makeExecutable(at url: URL) throws {
        try "#!/bin/sh\nexit 0\n".write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: url.path
        )
    }

    @discardableResult
    private func makeBundle(
        at bundleURL: URL? = nil,
        missingHelpers: Set<String> = [],
        nonExecutableHelpers: Set<String> = []
    ) throws -> URL {
        let bundleURL = bundleURL ?? tempHome
            .appendingPathComponent("Applications/Spectra.app", isDirectory: true)
        let helpersURL = bundleURL.appendingPathComponent("Contents/Helpers", isDirectory: true)
        try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)
        for helperName in Self.bundledHelperNames where !missingHelpers.contains(helperName) {
            let helperURL = helpersURL.appendingPathComponent(helperName)
            try "#!/bin/sh\nexit 0\n".write(to: helperURL, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.posixPermissions: nonExecutableHelpers.contains(helperName) ? 0o644 : 0o755],
                ofItemAtPath: helperURL.path
            )
        }
        return bundleURL
    }

    private func makeDevelopmentManager(
        daemonScriptPath: String? = nil,
        daemonLauncherPath: String? = nil,
        environmentOverrides: [String: String] = [:],
        launchctlExecutableURL: URL = URL(fileURLWithPath: "/usr/bin/true")
    ) throws -> LaunchAgentManager {
        var environment = ["SPECTRA_HELPER_MODE": "development"]
        environmentOverrides.forEach { environment[$0.key] = $0.value }
        return try LaunchAgentManager(
            testingHomeURL: tempHome,
            daemonScriptPath: daemonScriptPath ?? fakeDaemonScript.path,
            daemonLauncherPath: daemonLauncherPath ?? fakeDaemonLauncher.path,
            nodePath: fakeNode.path,
            environment: environment,
            productionBundleCandidates: [],
            allowedProductionBundleURLs: [],
            launchctlExecutableURL: launchctlExecutableURL
        )
    }

    private func makeBundleManager(
        bundleCandidates: [URL],
        allowedBundleURLs: [URL]? = nil,
        environmentOverrides: [String: String] = [:],
        launchctlExecutableURL: URL = URL(fileURLWithPath: "/usr/bin/true")
    ) throws -> LaunchAgentManager {
        var environment = ["SPECTRA_HELPER_MODE": "bundle"]
        environmentOverrides.forEach { environment[$0.key] = $0.value }
        return try LaunchAgentManager(
            testingHomeURL: tempHome,
            daemonScriptPath: fakeDaemonScript.path,
            daemonLauncherPath: nil,
            nodePath: fakeNode.path,
            environment: environment,
            productionBundleCandidates: bundleCandidates,
            allowedProductionBundleURLs: allowedBundleURLs ?? bundleCandidates,
            launchctlExecutableURL: launchctlExecutableURL
        )
    }

    private func parsedPlist(_ source: String) throws -> [String: Any] {
        let value = try PropertyListSerialization.propertyList(
            from: Data(source.utf8),
            options: [],
            format: nil
        )
        return try XCTUnwrap(value as? [String: Any])
    }

    private func environment(from plist: [String: Any]) throws -> [String: String] {
        try XCTUnwrap(plist["EnvironmentVariables"] as? [String: String])
    }

    private func assertNeitherPlistExists(
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertFalse(FileManager.default.fileExists(atPath: frontPlistURL.path), file: file, line: line)
        XCTAssertFalse(FileManager.default.fileExists(atPath: backendPlistURL.path), file: file, line: line)
    }

    private func makeLaunchctlStub(_ body: String) throws -> URL {
        let stubURL = tempHome.appendingPathComponent("launchctl-stub-\(UUID().uuidString)")
        try "#!/bin/sh\n\(body)\n".write(to: stubURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: stubURL.path
        )
        return stubURL
    }

    // MARK: - Production bundle resolution and plist contract

    func test_bundleMode_prefersFirstAvailableStableCandidate() throws {
        let firstBundle = try makeBundle(
            at: tempHome.appendingPathComponent("system/Applications/Spectra.app")
        )
        let secondBundle = try makeBundle(
            at: tempHome.appendingPathComponent("user/Applications/Spectra.app")
        )

        let manager = try makeBundleManager(bundleCandidates: [firstBundle, secondBundle])
        let firstHelpers = firstBundle.appendingPathComponent("Contents/Helpers")

        XCTAssertEqual(
            manager.makeProgramArguments(),
            [firstHelpers.appendingPathComponent("spectra-daemon-core").path]
        )
        XCTAssertEqual(
            manager.makeTsProgramArguments(),
            [
                firstHelpers.appendingPathComponent("spectra-daemon-launcher").path,
                "--node",
                fakeNode.path,
                "--script",
                fakeDaemonScript.path,
            ]
        )
    }

    func test_bundleMode_configuredStableBundleOverridesCandidateOrder() throws {
        let firstBundle = try makeBundle(
            at: tempHome.appendingPathComponent("system/Applications/Spectra.app")
        )
        let configuredBundle = try makeBundle(
            at: tempHome.appendingPathComponent("user/Applications/Spectra.app")
        )

        let manager = try makeBundleManager(
            bundleCandidates: [firstBundle, configuredBundle],
            environmentOverrides: ["SPECTRA_APP_BUNDLE_PATH": configuredBundle.path]
        )

        XCTAssertEqual(
            manager.makeProgramArguments(),
            [configuredBundle.appendingPathComponent("Contents/Helpers/spectra-daemon-core").path]
        )
    }

    func test_bundlePlists_emitExactProgramsEnvironmentAssociationLabelsAndSockets() throws {
        let bundleURL = try makeBundle()
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])
        let helpersURL = bundleURL.appendingPathComponent("Contents/Helpers")
        let backendSocket = tempHome.appendingPathComponent(".spectra/daemon-ts.sock").path

        let front = try parsedPlist(manager.makePlist())
        let backend = try parsedPlist(manager.makeTsPlist())
        let frontEnvironment = try environment(from: front)
        let backendEnvironment = try environment(from: backend)

        XCTAssertEqual(front["Label"] as? String, LaunchAgentManager.label)
        XCTAssertEqual(backend["Label"] as? String, LaunchAgentManager.tsLabel)
        XCTAssertEqual(front["AssociatedBundleIdentifiers"] as? [String], ["dev.spectra.app"])
        XCTAssertEqual(backend["AssociatedBundleIdentifiers"] as? [String], ["dev.spectra.app"])
        XCTAssertEqual(
            front["ProgramArguments"] as? [String],
            [helpersURL.appendingPathComponent("spectra-daemon-core").path]
        )
        XCTAssertEqual(
            backend["ProgramArguments"] as? [String],
            [
                helpersURL.appendingPathComponent("spectra-daemon-launcher").path,
                "--node",
                fakeNode.path,
                "--script",
                fakeDaemonScript.path,
            ]
        )

        for helperEnvironment in [frontEnvironment, backendEnvironment] {
            XCTAssertEqual(helperEnvironment["SPECTRA_HELPER_MODE"], "bundle")
            XCTAssertEqual(helperEnvironment["SPECTRA_APP_BUNDLE_PATH"], bundleURL.path)
            XCTAssertEqual(helperEnvironment["SPECTRA_APP_BUNDLE_HELPERS_DIR"], helpersURL.path)
            XCTAssertEqual(
                helperEnvironment["SPECTRA_NATIVE_HELPER_PATH"],
                helpersURL.appendingPathComponent("spectra-native").path
            )
            XCTAssertEqual(
                helperEnvironment["SPECTRA_CURSOR_SAMPLER_PATH"],
                helpersURL.appendingPathComponent("spectra-cursor-sampler").path
            )
            XCTAssertEqual(
                helperEnvironment["SPECTRA_WINDOW_BOUNDS_BIN"],
                helpersURL.appendingPathComponent("spectra-window-bounds").path
            )
        }
        XCTAssertEqual(frontEnvironment["SPECTRA_PROXY_BACKEND_SOCKET"], backendSocket)
        XCTAssertNil(frontEnvironment["SPECTRA_DAEMON_LISTEN_SOCKET"])
        XCTAssertEqual(backendEnvironment["SPECTRA_DAEMON_LISTEN_SOCKET"], backendSocket)
        XCTAssertNil(backendEnvironment["SPECTRA_PROXY_BACKEND_SOCKET"])
        XCTAssertEqual(front["RunAtLoad"] as? Bool, true)
        XCTAssertEqual(front["KeepAlive"] as? Bool, true)
        XCTAssertEqual(backend["RunAtLoad"] as? Bool, true)
        XCTAssertEqual(backend["KeepAlive"] as? Bool, true)
    }

    // MARK: - Explicit development behavior

    func test_developmentMode_preservesHomePathsAndHelperEnvironment() throws {
        let manager = try makeDevelopmentManager()
        let front = try parsedPlist(manager.makePlist())
        let backend = try parsedPlist(manager.makeTsPlist())
        let frontEnvironment = try environment(from: front)
        let backendEnvironment = try environment(from: backend)
        let binURL = tempHome.appendingPathComponent(".spectra/bin")

        XCTAssertEqual(front["ProgramArguments"] as? [String], [fakeDaemonCore.path])
        XCTAssertEqual(
            backend["ProgramArguments"] as? [String],
            [
                fakeDaemonLauncher.path,
                "--node",
                fakeNode.path,
                "--script",
                fakeDaemonScript.path,
            ]
        )
        for helperEnvironment in [frontEnvironment, backendEnvironment] {
            XCTAssertEqual(helperEnvironment["SPECTRA_HELPER_MODE"], "development")
            XCTAssertNil(helperEnvironment["SPECTRA_APP_BUNDLE_PATH"])
            XCTAssertNil(helperEnvironment["SPECTRA_APP_BUNDLE_HELPERS_DIR"])
            XCTAssertEqual(
                helperEnvironment["SPECTRA_NATIVE_HELPER_PATH"],
                binURL.appendingPathComponent("spectra-native").path
            )
            XCTAssertEqual(
                helperEnvironment["SPECTRA_CURSOR_SAMPLER_PATH"],
                binURL.appendingPathComponent("spectra-cursor-sampler").path
            )
            XCTAssertEqual(
                helperEnvironment["SPECTRA_WINDOW_BOUNDS_BIN"],
                binURL.appendingPathComponent("spectra-window-bounds").path
            )
        }
    }

    func test_developmentMode_fallsBackToNodeWhenLauncherMissing() throws {
        let missingLauncher = tempHome.appendingPathComponent("missing-launcher")
        let manager = try makeDevelopmentManager(daemonLauncherPath: missingLauncher.path)

        XCTAssertEqual(
            manager.makeTsProgramArguments(),
            [fakeNode.path, fakeDaemonScript.path, "daemon"]
        )
    }

    func test_developmentMode_installWritesBothPlists() throws {
        let manager = try makeDevelopmentManager()
        try manager.install()

        XCTAssertTrue(FileManager.default.fileExists(atPath: frontPlistURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: backendPlistURL.path))
        XCTAssertTrue(manager.isInstalled())
    }

    // MARK: - Fail-closed production preflight

    func test_bundleMode_missingDaemonCoreWritesNeitherPlist() throws {
        let bundleURL = try makeBundle(missingHelpers: ["spectra-daemon-core"])
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.bundledHelperMissing(let name, let path) = error else {
                return XCTFail("expected bundledHelperMissing, got \(error)")
            }
            XCTAssertEqual(name, "spectra-daemon-core")
            XCTAssertEqual(
                path,
                bundleURL.appendingPathComponent("Contents/Helpers/spectra-daemon-core").path
            )
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_nonExecutableLauncherWritesNeitherPlist() throws {
        let bundleURL = try makeBundle(nonExecutableHelpers: ["spectra-daemon-launcher"])
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.bundledHelperNotExecutable(let name, let path) = error else {
                return XCTFail("expected bundledHelperNotExecutable, got \(error)")
            }
            XCTAssertEqual(name, "spectra-daemon-launcher")
            XCTAssertEqual(
                path,
                bundleURL.appendingPathComponent("Contents/Helpers/spectra-daemon-launcher").path
            )
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_executableSymlinkOutsideBundleWritesNeitherPlist() throws {
        let helperName = "spectra-text-render"
        let bundleURL = try makeBundle(missingHelpers: [helperName])
        let bundledHelperURL = bundleURL
            .appendingPathComponent("Contents/Helpers")
            .appendingPathComponent(helperName)
        let outsideHelperURL = tempHome.appendingPathComponent("outside-(helperName)")
        try makeExecutable(at: outsideHelperURL)
        try FileManager.default.createSymbolicLink(
            at: bundledHelperURL,
            withDestinationURL: outsideHelperURL
        )
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: bundledHelperURL.path))
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.bundledHelperNotExecutable(let name, let path) = error else {
                return XCTFail("expected bundledHelperNotExecutable, got \(error)")
            }
            XCTAssertEqual(name, helperName)
            XCTAssertEqual(path, bundledHelperURL.path)
            XCTAssertTrue(error.localizedDescription.contains("Symbolic links"))
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_symlinkedHelpersDirectoryOutsideBundleWritesNeitherPlist() throws {
        let stableBundleURL = tempHome
            .appendingPathComponent("Applications/Spectra.app", isDirectory: true)
        let stableContentsURL = stableBundleURL
            .appendingPathComponent("Contents", isDirectory: true)
        try FileManager.default.createDirectory(
            at: stableContentsURL,
            withIntermediateDirectories: true
        )

        let outsideBundleURL = try makeBundle(
            at: tempHome.appendingPathComponent("outside/Spectra.app", isDirectory: true)
        )
        let outsideHelpersURL = outsideBundleURL
            .appendingPathComponent("Contents/Helpers", isDirectory: true)
        let symlinkedHelpersURL = stableContentsURL
            .appendingPathComponent("Helpers", isDirectory: true)
        try FileManager.default.createSymbolicLink(
            at: symlinkedHelpersURL,
            withDestinationURL: outsideHelpersURL
        )

        XCTAssertEqual(
            stableBundleURL.resolvingSymlinksInPath().standardizedFileURL.path,
            stableBundleURL.standardizedFileURL.path,
            "the allowlisted Spectra.app root must be a physical directory"
        )
        XCTAssertEqual(
            symlinkedHelpersURL.resolvingSymlinksInPath().standardizedFileURL.path,
            outsideHelpersURL.standardizedFileURL.path,
            "the fixture must escape through the Contents/Helpers symlink"
        )

        let manager = try makeBundleManager(
            bundleCandidates: [stableBundleURL],
            allowedBundleURLs: [stableBundleURL]
        )

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.unsafeBundleHelpersDirectory(
                let path,
                let resolvedPath
            ) = error else {
                return XCTFail("expected unsafeBundleHelpersDirectory, got \(error)")
            }
            XCTAssertEqual(path, symlinkedHelpersURL.path)
            XCTAssertEqual(resolvedPath, outsideHelpersURL.path)
            XCTAssertTrue(error.localizedDescription.contains("canonical-path escape"))
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_executableDirectoryHelperWritesNeitherPlist() throws {
        let helperName = "spectra-text-render"
        let bundleURL = try makeBundle(missingHelpers: [helperName])
        let bundledHelperURL = bundleURL
            .appendingPathComponent("Contents/Helpers")
            .appendingPathComponent(helperName)
        try FileManager.default.createDirectory(
            at: bundledHelperURL,
            withIntermediateDirectories: false
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: bundledHelperURL.path
        )
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: bundledHelperURL.path))
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.bundledHelperNotExecutable(let name, let path) = error else {
                return XCTFail("expected bundledHelperNotExecutable, got \(error)")
            }
            XCTAssertEqual(name, helperName)
            XCTAssertEqual(path, bundledHelperURL.path)
            XCTAssertTrue(error.localizedDescription.contains("regular executable file"))
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_missingNonAgentHelperWritesNeitherPlist() throws {
        let bundleURL = try makeBundle(missingHelpers: ["spectra-cursor-sampler"])
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.bundledHelperMissing(let name, _) = error else {
                return XCTFail("expected bundledHelperMissing, got \(error)")
            }
            XCTAssertEqual(name, "spectra-cursor-sampler")
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_missingStableBundleWritesNeitherPlist() throws {
        let missingBundle = tempHome.appendingPathComponent("Applications/Spectra.app")
        let manager = try makeBundleManager(
            bundleCandidates: [missingBundle],
            environmentOverrides: ["SPECTRA_APP_BUNDLE_PATH": missingBundle.path]
        )

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.productionBundleNotFound = error else {
                return XCTFail("expected productionBundleNotFound, got \(error)")
            }
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_movedBundleWritesNeitherPlist() throws {
        let bundleURL = try makeBundle()
        let manager = try makeBundleManager(bundleCandidates: [bundleURL])
        try FileManager.default.removeItem(at: bundleURL)

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.productionBundleNotFound = error else {
                return XCTFail("expected productionBundleNotFound, got \(error)")
            }
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_rejectsUnstableConfiguredPathBeforeAnyWrite() throws {
        let stableBundle = tempHome.appendingPathComponent("Applications/Spectra.app")
        let unstableBundle = try makeBundle(
            at: tempHome.appendingPathComponent("DerivedData/Build/Products/Release/Spectra.app")
        )

        XCTAssertThrowsError(
            try makeBundleManager(
                bundleCandidates: [stableBundle],
                allowedBundleURLs: [stableBundle],
                environmentOverrides: ["SPECTRA_APP_BUNDLE_PATH": unstableBundle.path]
            )
        ) { error in
            guard case LaunchAgentError.unstableProductionBundle(let path, _) = error else {
                return XCTFail("expected unstableProductionBundle, got \(error)")
            }
            XCTAssertEqual(path, unstableBundle.path)
            XCTAssertTrue(error.localizedDescription.contains("SPECTRA_HELPER_MODE=development"))
        }
        assertNeitherPlistExists()
    }

    func test_bundleMode_rejectsHomeHelperOverrideBeforeAnyWrite() throws {
        let bundleURL = try makeBundle()
        let homeNativeHelper = tempHome.appendingPathComponent(".spectra/bin/spectra-native")

        XCTAssertThrowsError(
            try makeBundleManager(
                bundleCandidates: [bundleURL],
                environmentOverrides: ["SPECTRA_NATIVE_HELPER_PATH": homeNativeHelper.path]
            )
        ) { error in
            guard case LaunchAgentError.bundleHelperPathMismatch(let key, let path, let expected) = error else {
                return XCTFail("expected bundleHelperPathMismatch, got \(error)")
            }
            XCTAssertEqual(key, "SPECTRA_NATIVE_HELPER_PATH")
            XCTAssertEqual(path, homeNativeHelper.path)
            XCTAssertEqual(
                expected,
                bundleURL.appendingPathComponent("Contents/Helpers/spectra-native").path
            )
        }
        assertNeitherPlistExists()
    }

    func test_developmentMode_missingCoreWritesNeitherPlist() throws {
        try FileManager.default.removeItem(at: fakeDaemonCore)
        let manager = try makeDevelopmentManager()

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.daemonCoreNotFound(let path) = error else {
                return XCTFail("expected daemonCoreNotFound, got \(error)")
            }
            XCTAssertEqual(path, self.fakeDaemonCore.path)
        }
        assertNeitherPlistExists()
    }

    func test_install_missingDaemonScriptWritesNeitherPlist() throws {
        let manager = try makeDevelopmentManager(daemonScriptPath: "/missing/index.js")

        XCTAssertThrowsError(try manager.install()) { error in
            guard case LaunchAgentError.daemonScriptNotFound = error else {
                return XCTFail("expected daemonScriptNotFound, got \(error)")
            }
        }
        assertNeitherPlistExists()
    }

    // MARK: - Topology lifecycle invariants

    func test_bootstrapStartsBackendBeforeFrontDoor() throws {
        let logURL = tempHome.appendingPathComponent("launchctl.log")
        let stubURL = try makeLaunchctlStub("printf '%s\\n' \"$*\" >> '\(logURL.path)'")
        let manager = try makeDevelopmentManager(launchctlExecutableURL: stubURL)

        try manager.install()
        try manager.bootstrap()

        let lines = try String(contentsOf: logURL, encoding: .utf8)
            .split(separator: "\n")
            .map(String.init)
        let domain = "gui/\(getuid())"
        XCTAssertEqual(
            lines,
            [
                "bootstrap \(domain) \(backendPlistURL.path)",
                "bootstrap \(domain) \(frontPlistURL.path)",
            ]
        )
    }

    func test_isInstalledRequiresBothPlists() throws {
        let manager = try makeDevelopmentManager()
        XCTAssertFalse(manager.isInstalled())

        try manager.install()
        XCTAssertTrue(manager.isInstalled())

        try FileManager.default.removeItem(at: backendPlistURL)
        XCTAssertFalse(manager.isInstalled())

        try "stub".write(to: backendPlistURL, atomically: true, encoding: .utf8)
        try FileManager.default.removeItem(at: frontPlistURL)
        XCTAssertFalse(manager.isInstalled())
    }

    func test_isLoadedRequiresBothLabels() throws {
        let backendTarget = "gui/\(getuid())/\(LaunchAgentManager.tsLabel)"
        let stubURL = try makeLaunchctlStub(
            "if [ \"$2\" = '\(backendTarget)' ]; then exit 1; fi\nexit 0"
        )
        let manager = try makeDevelopmentManager(launchctlExecutableURL: stubURL)

        XCTAssertFalse(manager.isLoaded())
    }

    func test_isLoadedTrueWhenBothLabelsLoad() throws {
        let stubURL = try makeLaunchctlStub("exit 0")
        let manager = try makeDevelopmentManager(launchctlExecutableURL: stubURL)

        XCTAssertTrue(manager.isLoaded())
    }

    func test_uninstallRemovesBothPlists() throws {
        let manager = try makeDevelopmentManager()
        try manager.install()
        try manager.uninstall()

        assertNeitherPlistExists()
    }

    func test_uninstallIsIdempotent() throws {
        let manager = try makeDevelopmentManager()
        XCTAssertNoThrow(try manager.uninstall())
    }
}
