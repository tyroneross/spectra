// LaunchAgentManagerTests.swift
//
// Unit tests for the two-LaunchAgent flip topology (ADR-03): plist generation
// for BOTH `dev.spectra.daemon` (front door, Swift daemon-core) and
// `dev.spectra.daemon-ts` (backend, node) + install/uninstall happy paths
// against a temp directory. Does NOT actually call launchctl bootstrap — that
// requires real privileges and would persist state (T-08/T-09 exercise the
// real launchd calls live, at gate E).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class LaunchAgentManagerTests: XCTestCase {

    private var tempHome: URL!
    private var fakeDaemonScript: URL!
    private var fakeDaemonLauncher: URL!
    private var fakeDaemonCore: URL!
    private var fakeNode: URL!

    override func setUpWithError() throws {
        tempHome = FileManager.default.temporaryDirectory
            .appendingPathComponent("spectra-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)

        // Fake TS daemon script (dist/cli/index.js)
        let distDir = tempHome.appendingPathComponent(".spectra/dist/cli")
        try FileManager.default.createDirectory(at: distDir, withIntermediateDirectories: true)
        fakeDaemonScript = distDir.appendingPathComponent("index.js")
        try "// stub".write(to: fakeDaemonScript, atomically: true, encoding: .utf8)

        // Fake signed TS daemon launcher
        let binDir = tempHome.appendingPathComponent(".spectra/bin")
        try FileManager.default.createDirectory(at: binDir, withIntermediateDirectories: true)
        fakeDaemonLauncher = binDir.appendingPathComponent("spectra-daemon-launcher")
        try "#!/bin/sh\necho launcher".write(to: fakeDaemonLauncher, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: fakeDaemonLauncher.path
        )

        // Fake Swift daemon-core binary (front door) — LaunchAgentManager
        // always resolves this at $HOME/.spectra/bin/spectra-daemon-core,
        // so create it at that exact fixed path under tempHome.
        fakeDaemonCore = binDir.appendingPathComponent("spectra-daemon-core")
        try "#!/bin/sh\necho core".write(to: fakeDaemonCore, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: fakeDaemonCore.path
        )

        // Fake node binary
        fakeNode = tempHome.appendingPathComponent("fake-node")
        try "#!/bin/sh\necho ok".write(to: fakeNode, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: fakeNode.path
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempHome)
    }

    private func makeManager(
        daemonScriptPath: String? = nil,
        daemonLauncherPath: String? = nil,
        nodePath: String? = nil
    ) throws -> LaunchAgentManager {
        try LaunchAgentManager(
            homeURL: tempHome,
            daemonScriptPath: daemonScriptPath ?? fakeDaemonScript.path,
            daemonLauncherPath: daemonLauncherPath ?? fakeDaemonLauncher.path,
            nodePath: nodePath ?? fakeNode.path
        )
    }

    /// Removes the fake daemon-core binary this suite creates by default —
    /// used by the missing-binary test.
    private func removeFakeDaemonCore() throws {
        try FileManager.default.removeItem(at: fakeDaemonCore)
    }

    // ─── Front-door plist (dev.spectra.daemon) ───────────────

    func test_makePlist_pointsAtSwiftDaemonCore() throws {
        let mgr = try makeManager()
        let plist = mgr.makePlist()
        XCTAssertTrue(plist.contains(fakeDaemonCore.path), "front-door plist must run the Swift daemon-core binary")
        XCTAssertTrue(plist.contains("<key>Label</key>"), "plist must declare Label")
        XCTAssertTrue(plist.contains("dev.spectra.daemon</string>"), "plist must use canonical front-door label")
        XCTAssertFalse(plist.contains("dev.spectra.daemon-ts"), "front-door plist must not reference the backend label")
        XCTAssertTrue(plist.contains("SPECTRA_PROXY_BACKEND_SOCKET"), "front-door plist must set the proxy backend socket env")
        XCTAssertTrue(plist.contains("daemon-ts.sock"), "front-door plist must point the proxy at the secondary socket")
        // Whitespace-insensitive checks.
        let normalized = plist.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\n", with: "")
        XCTAssertTrue(normalized.contains("<key>KeepAlive</key><true/>"), "KeepAlive must be true")
        XCTAssertTrue(normalized.contains("<key>RunAtLoad</key><true/>"), "RunAtLoad must be true")
    }

    func test_makeProgramArguments_isDaemonCoreBinaryOnly() throws {
        let mgr = try makeManager()
        XCTAssertEqual(mgr.makeProgramArguments(), [fakeDaemonCore.path])
    }

    // ─── Backend plist (dev.spectra.daemon-ts) ───────────────

    func test_makeTsPlist_prefersSignedDaemonLauncher() throws {
        let mgr = try makeManager()
        let plist = mgr.makeTsPlist()
        XCTAssertTrue(plist.contains(fakeDaemonLauncher.path), "backend plist must reference daemon launcher when present")
        XCTAssertTrue(plist.contains(fakeNode.path), "backend plist must reference node path")
        XCTAssertTrue(plist.contains(fakeDaemonScript.path), "backend plist must reference daemon script")
        XCTAssertTrue(plist.contains("dev.spectra.daemon-ts</string>"), "plist must use canonical backend label")
        XCTAssertTrue(plist.contains("SPECTRA_DAEMON_LISTEN_SOCKET"), "backend plist must set the listen-socket override env")
        XCTAssertTrue(plist.contains("daemon-ts.sock"), "backend plist must bind the SECONDARY socket, not the primary")
        let normalized = plist.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\n", with: "")
        XCTAssertTrue(normalized.contains("<key>KeepAlive</key><true/>"), "KeepAlive must be true")
        XCTAssertTrue(normalized.contains("<key>RunAtLoad</key><true/>"), "RunAtLoad must be true")
    }

    func test_makeTsPlist_fallsBackToNodeWhenDaemonLauncherMissing() throws {
        let mgr = try makeManager(daemonLauncherPath: tempHome.appendingPathComponent("missing-launcher").path)
        let args = mgr.makeTsProgramArguments()
        XCTAssertEqual(args, [fakeNode.path, fakeDaemonScript.path, "daemon"])
    }

    // ─── install() — both-plists, missing-binary failures ────

    func test_install_writesBothPlistsToLaunchAgentsDirectory() throws {
        let mgr = try makeManager()
        try mgr.install()

        let expectedFrontDoor = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon.plist")
        let expectedBackend = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon-ts.plist")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: expectedFrontDoor.path),
            "front-door plist should be at \(expectedFrontDoor.path)"
        )
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: expectedBackend.path),
            "backend plist should be at \(expectedBackend.path)"
        )
        XCTAssertTrue(mgr.isInstalled())
    }

    func test_install_refusesWhenDaemonScriptMissing() throws {
        let mgr = try makeManager(daemonScriptPath: "/nonexistent/path/index.js")
        XCTAssertThrowsError(try mgr.install()) { error in
            guard case LaunchAgentError.daemonScriptNotFound = error else {
                return XCTFail("expected daemonScriptNotFound, got \(error)")
            }
        }
    }

    /// G2a pin: install() must fail with an ACTIONABLE error (naming the
    /// missing path + the build script) when the Swift daemon-core binary
    /// is absent — the GUI never runs scripts/build-daemon-core.sh itself.
    func test_install_refusesWhenDaemonCoreMissing() throws {
        try removeFakeDaemonCore()
        let mgr = try makeManager()
        XCTAssertThrowsError(try mgr.install()) { error in
            guard case LaunchAgentError.daemonCoreNotFound(let path) = error else {
                return XCTFail("expected daemonCoreNotFound, got \(error)")
            }
            XCTAssertEqual(path, fakeDaemonCore.path)
            let message = LaunchAgentError.daemonCoreNotFound(path: path).errorDescription ?? ""
            XCTAssertTrue(message.contains(path), "error must name the missing path")
            XCTAssertTrue(message.contains("build-daemon-core.sh"), "error must name the actionable fix")
        }
        XCTAssertFalse(mgr.isInstalled(), "neither plist should be written when the pre-flight check fails")
    }

    func test_install_writesNeitherPlistWhenDaemonCoreMissing() throws {
        try removeFakeDaemonCore()
        let mgr = try makeManager()
        _ = try? mgr.install()

        let expectedFrontDoor = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon.plist")
        let expectedBackend = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon-ts.plist")
        XCTAssertFalse(FileManager.default.fileExists(atPath: expectedFrontDoor.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: expectedBackend.path))
    }

    // ─── isInstalled() — true only when BOTH are present ─────

    func test_isInstalled_falseWhenOnlyFrontDoorPlistPresent() throws {
        let mgr = try makeManager()
        try mgr.install()
        let backendPlist = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon-ts.plist")
        try FileManager.default.removeItem(at: backendPlist)
        XCTAssertFalse(mgr.isInstalled(), "a lone front-door plist is a half-installed topology")
    }

    func test_isInstalled_falseWhenOnlyBackendPlistPresent() throws {
        let mgr = try makeManager()
        try mgr.install()
        let frontDoorPlist = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon.plist")
        try FileManager.default.removeItem(at: frontDoorPlist)
        XCTAssertFalse(mgr.isInstalled(), "a lone backend plist is a half-installed topology")
    }

    func test_isInstalled_falseWhenNeitherPresent() throws {
        let mgr = try makeManager()
        XCTAssertFalse(mgr.isInstalled())
    }

    // ─── uninstall() — removes BOTH plists ───────────────────

    func test_uninstall_removesBothPlists() throws {
        let mgr = try makeManager()
        try mgr.install()
        try mgr.uninstall()

        let expectedFrontDoor = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon.plist")
        let expectedBackend = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon-ts.plist")
        XCTAssertFalse(FileManager.default.fileExists(atPath: expectedFrontDoor.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: expectedBackend.path))
    }

    func test_uninstall_idempotentWhenNotInstalled() throws {
        let mgr = try makeManager()
        XCTAssertNoThrow(try mgr.uninstall())
    }
}
