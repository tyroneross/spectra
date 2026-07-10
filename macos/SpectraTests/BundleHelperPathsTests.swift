// BundleHelperPathsTests.swift
//
// Contract tests for daemon-core helper resolution. R3 owns target membership;
// this file deliberately tests the Foundation-only resolver without importing
// the standalone DaemonCore executable into the Spectra app target.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
import XCTest

final class BundleHelperPathsTests: XCTestCase {
    private var tempDirectory: URL!

    override func setUpWithError() throws {
        let rawDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("spectra-bundle-helper-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: rawDirectory,
            withIntermediateDirectories: true
        )
        tempDirectory = rawDirectory.resolvingSymlinksInPath()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempDirectory)
    }

    func test_specificNativeOverrideWinsWithoutMode() throws {
        let override = try makeExecutable(at: tempDirectory.appendingPathComponent("override-native"))

        let resolved = try BundleHelperPaths.resolveExecutable(
            helperName: "spectra-native",
            overrideEnvironmentKey: "SPECTRA_NATIVE_HELPER_PATH",
            environment: ["SPECTRA_NATIVE_HELPER_PATH": override.path],
            defaultHome: tempDirectory.path
        )

        XCTAssertEqual(resolved, override.path)
    }

    func test_invalidSpecificOverrideNeverFallsThrough() throws {
        let helpers = tempDirectory.appendingPathComponent("Helpers", isDirectory: true)
        let bundled = try makeExecutable(at: helpers.appendingPathComponent("spectra-native"))
        let missingOverride = tempDirectory.appendingPathComponent("missing-override")

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                overrideEnvironmentKey: "SPECTRA_NATIVE_HELPER_PATH",
                environment: [
                    "SPECTRA_NATIVE_HELPER_PATH": missingOverride.path,
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            self.assertNotExecutable(error, expectedPath: missingOverride.path)
        }
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: bundled.path))
    }

    func test_bundleModeUsesConfiguredHelpersDirectory() throws {
        let helpers = tempDirectory.appendingPathComponent("Helpers", isDirectory: true)
        let expected = try makeExecutable(at: helpers.appendingPathComponent("spectra-native"))

        let resolved = try BundleHelperPaths.resolveExecutable(
            helperName: "spectra-native",
            environment: [
                "SPECTRA_HELPER_MODE": "bundle",
                "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
            ],
            defaultHome: tempDirectory.path
        )

        XCTAssertEqual(resolved, expected.path)
    }

    func test_bundleModeUsesAppBundleContentsHelpers() throws {
        let app = tempDirectory.appendingPathComponent("Spectra.app", isDirectory: true)
        let expected = try makeExecutable(
            at: app.appendingPathComponent("Contents/Helpers/spectra-native")
        )

        let resolved = try BundleHelperPaths.resolveExecutable(
            helperName: "spectra-native",
            environment: [
                "SPECTRA_HELPER_MODE": "bundle",
                "SPECTRA_APP_BUNDLE_PATH": app.path,
            ],
            defaultHome: tempDirectory.path
        )

        XCTAssertEqual(resolved, expected.path)
    }

    func test_bundleModeMissingHelperNeverFallsThroughToDevelopmentHome() throws {
        let helpers = tempDirectory.appendingPathComponent("empty-helpers", isDirectory: true)
        try FileManager.default.createDirectory(at: helpers, withIntermediateDirectories: true)
        let home = tempDirectory.appendingPathComponent("home", isDirectory: true)
        _ = try makeExecutable(at: developmentHelper(named: "spectra-native", home: home))
        let expectedBundlePath = helpers.appendingPathComponent("spectra-native").path

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        ) { error in
            self.assertNotExecutable(error, expectedPath: expectedBundlePath)
        }
    }

    func test_bundleModeNonExecutableHelperNeverFallsThrough() throws {
        let helpers = tempDirectory.appendingPathComponent("non-executable-helpers", isDirectory: true)
        let nonExecutable = try makeFile(
            at: helpers.appendingPathComponent("spectra-native"),
            permissions: 0o644
        )
        let home = tempDirectory.appendingPathComponent("home", isDirectory: true)
        _ = try makeExecutable(at: developmentHelper(named: "spectra-native", home: home))

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        ) { error in
            self.assertNotExecutable(error, expectedPath: nonExecutable.path)
        }
    }

    func test_bundleModeRejectsDirectoryAtHelperPath() throws {
        let helpers = tempDirectory.appendingPathComponent("directory-helper", isDirectory: true)
        let helperDirectory = helpers.appendingPathComponent("spectra-native", isDirectory: true)
        try FileManager.default.createDirectory(
            at: helperDirectory,
            withIntermediateDirectories: true
        )

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            self.assertNotExecutable(error, expectedPath: helperDirectory.path)
        }
    }

    func test_bundleModeRejectsExecutableHelperSymlinkOutsideContentsHelpers() throws {
        let helpers = tempDirectory.appendingPathComponent("Contents/Helpers", isDirectory: true)
        try FileManager.default.createDirectory(at: helpers, withIntermediateDirectories: true)
        let outside = try makeExecutable(
            at: tempDirectory.appendingPathComponent("outside/spectra-native")
        )
        let symlink = helpers.appendingPathComponent("spectra-native")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: outside)
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: symlink.path))

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            self.assertUnsafePath(error, expectedPath: symlink.path)
        }
    }

    func test_bundleModeRejectsSpecificOverrideOutsideContentsHelpers() throws {
        let helpers = tempDirectory.appendingPathComponent("Contents/Helpers", isDirectory: true)
        _ = try makeExecutable(at: helpers.appendingPathComponent("spectra-native"))
        let outside = try makeExecutable(
            at: tempDirectory.appendingPathComponent("outside/override-native")
        )

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                overrideEnvironmentKey: "SPECTRA_NATIVE_HELPER_PATH",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                    "SPECTRA_NATIVE_HELPER_PATH": outside.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            self.assertUnsafePath(error, expectedPath: outside.path)
        }
    }

    func test_bundleModeRejectsSymlinkedContentsHelpersDirectory() throws {
        let app = tempDirectory.appendingPathComponent("Spectra.app", isDirectory: true)
        let contents = app.appendingPathComponent("Contents", isDirectory: true)
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        let outsideHelpers = tempDirectory.appendingPathComponent("outside-helpers", isDirectory: true)
        _ = try makeExecutable(
            at: outsideHelpers.appendingPathComponent("spectra-native")
        )
        let symlinkedHelpers = contents.appendingPathComponent("Helpers", isDirectory: true)
        try FileManager.default.createSymbolicLink(
            at: symlinkedHelpers,
            withDestinationURL: outsideHelpers
        )

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_PATH": app.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            self.assertUnsafePath(
                error,
                expectedPath: symlinkedHelpers.appendingPathComponent("spectra-native").path
            )
        }
    }

    func test_developmentModeUsesEnvironmentHome() throws {
        let home = tempDirectory.appendingPathComponent("development-home", isDirectory: true)
        let expected = try makeExecutable(
            at: developmentHelper(named: "spectra-native", home: home)
        )

        let resolved = try BundleHelperPaths.resolveExecutable(
            helperName: "spectra-native",
            environment: [
                "SPECTRA_HELPER_MODE": "development",
                "HOME": home.path,
            ],
            defaultHome: tempDirectory.appendingPathComponent("wrong-home").path
        )

        XCTAssertEqual(resolved, expected.path)
    }

    func test_developmentModeRejectsExecutableHelperSymlink() throws {
        let home = tempDirectory.appendingPathComponent("development-home", isDirectory: true)
        let outside = try makeExecutable(
            at: tempDirectory.appendingPathComponent("outside/development-native")
        )
        let symlink = developmentHelper(named: "spectra-native", home: home)
        try FileManager.default.createDirectory(
            at: symlink.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: outside)

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "development",
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        ) { error in
            self.assertUnsafePath(error, expectedPath: symlink.path)
        }
    }

    func test_bundleModeDoesNotAllowOptionalHelperResolutionFailure() {
        XCTAssertFalse(
            BundleHelperPaths.allowsOptionalHelperResolutionFailure(
                environment: ["SPECTRA_HELPER_MODE": "bundle"]
            )
        )
        XCTAssertFalse(BundleHelperPaths.allowsOptionalHelperResolutionFailure(environment: [:]))
        XCTAssertFalse(
            BundleHelperPaths.allowsOptionalHelperResolutionFailure(
                environment: ["SPECTRA_HELPER_MODE": "unsupported"]
            )
        )
    }

    func test_developmentModeAllowsOptionalHelperResolutionWarning() {
        XCTAssertTrue(
            BundleHelperPaths.allowsOptionalHelperResolutionFailure(
                environment: ["SPECTRA_HELPER_MODE": "development"]
            )
        )
    }

    func test_bundleModeOptionalCursorResolutionFailsClosed() throws {
        let helpers = tempDirectory.appendingPathComponent("Contents/Helpers", isDirectory: true)
        try FileManager.default.createDirectory(at: helpers, withIntermediateDirectories: true)
        let expectedPath = helpers.appendingPathComponent("spectra-cursor-sampler").path

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveOptionalExecutable(
                helperName: "spectra-cursor-sampler",
                overrideEnvironmentKey: "SPECTRA_CURSOR_SAMPLER_PATH",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": helpers.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            self.assertNotExecutable(error, expectedPath: expectedPath)
        }
    }

    func test_developmentModeOptionalCursorResolutionReturnsWarning() throws {
        let home = tempDirectory.appendingPathComponent("development-home", isDirectory: true)
        let expectedPath = developmentHelper(
            named: "spectra-cursor-sampler",
            home: home
        ).path

        let resolution = try BundleHelperPaths.resolveOptionalExecutable(
            helperName: "spectra-cursor-sampler",
            overrideEnvironmentKey: "SPECTRA_CURSOR_SAMPLER_PATH",
            environment: [
                "SPECTRA_HELPER_MODE": "development",
                "HOME": home.path,
            ],
            defaultHome: home.path
        )

        guard case .unavailableInDevelopment(let warning) = resolution else {
            return XCTFail("Expected unavailableInDevelopment, got \(resolution)")
        }
        XCTAssertTrue(warning.contains(expectedPath))
    }

    func test_developmentModeOptionalCursorResolutionReturnsExecutable() throws {
        let home = tempDirectory.appendingPathComponent("development-home", isDirectory: true)
        let expected = try makeExecutable(
            at: developmentHelper(named: "spectra-cursor-sampler", home: home)
        )

        let resolution = try BundleHelperPaths.resolveOptionalExecutable(
            helperName: "spectra-cursor-sampler",
            overrideEnvironmentKey: "SPECTRA_CURSOR_SAMPLER_PATH",
            environment: [
                "SPECTRA_HELPER_MODE": "development",
                "HOME": home.path,
            ],
            defaultHome: home.path
        )

        XCTAssertEqual(resolution, .executable(expected.path))
    }

    func test_cursorSpecificOverrideIsAuthoritative() throws {
        let override = try makeExecutable(at: tempDirectory.appendingPathComponent("override-cursor"))

        let resolved = try BundleHelperPaths.resolveExecutable(
            helperName: "spectra-cursor-sampler",
            overrideEnvironmentKey: "SPECTRA_CURSOR_SAMPLER_PATH",
            environment: ["SPECTRA_CURSOR_SAMPLER_PATH": override.path],
            defaultHome: tempDirectory.path
        )

        XCTAssertEqual(resolved, override.path)
    }

    func test_missingModeDoesNotImplicitlyUseHome() throws {
        let home = tempDirectory.appendingPathComponent("implicit-home", isDirectory: true)
        _ = try makeExecutable(at: developmentHelper(named: "spectra-native", home: home))

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: ["HOME": home.path],
                defaultHome: home.path
            )
        ) { error in
            XCTAssertEqual(
                error as? BundleHelperPathError,
                .missingMode(environmentKey: "SPECTRA_HELPER_MODE")
            )
        }
    }

    func test_movedBundlePathFailsClosed() throws {
        let movedApp = tempDirectory.appendingPathComponent("Moved-Spectra.app", isDirectory: true)

        XCTAssertThrowsError(
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_PATH": movedApp.path,
                ],
                defaultHome: tempDirectory.path
            )
        ) { error in
            let expected = movedApp.appendingPathComponent("Contents/Helpers/spectra-native").path
            self.assertNotExecutable(error, expectedPath: expected)
        }
    }

    private func developmentHelper(named name: String, home: URL) -> URL {
        home.appendingPathComponent(".spectra/bin/\(name)")
    }

    @discardableResult
    private func makeExecutable(at url: URL) throws -> URL {
        try makeFile(at: url, permissions: 0o755)
    }

    @discardableResult
    private func makeFile(at url: URL, permissions: Int) throws -> URL {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: url)
        try FileManager.default.setAttributes(
            [.posixPermissions: permissions],
            ofItemAtPath: url.path
        )
        return url
    }

    private func assertNotExecutable(
        _ error: Error,
        expectedPath: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let pathError = error as? BundleHelperPathError,
              case .helperNotExecutable(_, let path, _) = pathError else {
            return XCTFail("Expected helperNotExecutable, got \(error)", file: file, line: line)
        }
        XCTAssertEqual(path, expectedPath, file: file, line: line)
    }

    private func assertUnsafePath(
        _ error: Error,
        expectedPath: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let pathError = error as? BundleHelperPathError,
              case .unsafeHelperPath(_, let path, _, _) = pathError else {
            return XCTFail("Expected unsafeHelperPath, got \(error)", file: file, line: line)
        }
        XCTAssertEqual(path, expectedPath, file: file, line: line)
    }
}
