// LaunchAgentManagerTests.swift
//
// Unit tests for the LaunchAgentManager plist generation + install/uninstall
// happy paths against a temp directory. Does NOT actually call launchctl
// bootstrap — that requires real privileges and would persist state.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class LaunchAgentManagerTests: XCTestCase {

    private var tempHome: URL!
    private var fakeDaemonScript: URL!
    private var fakeNode: URL!

    override func setUpWithError() throws {
        tempHome = FileManager.default.temporaryDirectory
            .appendingPathComponent("spectra-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)

        // Fake daemon script
        let distDir = tempHome.appendingPathComponent(".spectra/dist/cli")
        try FileManager.default.createDirectory(at: distDir, withIntermediateDirectories: true)
        fakeDaemonScript = distDir.appendingPathComponent("index.js")
        try "// stub".write(to: fakeDaemonScript, atomically: true, encoding: .utf8)

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

    func test_makePlist_includesNodePathAndDaemonScript() throws {
        let mgr = try LaunchAgentManager(
            homeURL: tempHome,
            daemonScriptPath: fakeDaemonScript.path,
            nodePath: fakeNode.path
        )
        let plist = mgr.makePlist()
        XCTAssertTrue(plist.contains(fakeNode.path), "plist must reference node path")
        XCTAssertTrue(plist.contains(fakeDaemonScript.path), "plist must reference daemon script")
        XCTAssertTrue(plist.contains("<key>Label</key>"), "plist must declare Label")
        XCTAssertTrue(plist.contains("dev.spectra.daemon"), "plist must use canonical label")
        // Whitespace-insensitive checks.
        let normalized = plist.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\n", with: "")
        XCTAssertTrue(normalized.contains("<key>KeepAlive</key><true/>"), "KeepAlive must be true")
        XCTAssertTrue(normalized.contains("<key>RunAtLoad</key><true/>"), "RunAtLoad must be true")
    }

    func test_install_writesPlistToLaunchAgentsDirectory() throws {
        let mgr = try LaunchAgentManager(
            homeURL: tempHome,
            daemonScriptPath: fakeDaemonScript.path,
            nodePath: fakeNode.path
        )
        try mgr.install()

        let expectedPath = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon.plist")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: expectedPath.path),
            "plist should be at \(expectedPath.path)"
        )
        XCTAssertTrue(mgr.isInstalled())
    }

    func test_install_refusesWhenDaemonScriptMissing() throws {
        let mgr = try LaunchAgentManager(
            homeURL: tempHome,
            daemonScriptPath: "/nonexistent/path/index.js",
            nodePath: fakeNode.path
        )
        XCTAssertThrowsError(try mgr.install()) { error in
            guard case LaunchAgentError.daemonScriptNotFound = error else {
                return XCTFail("expected daemonScriptNotFound, got \(error)")
            }
        }
    }

    func test_uninstall_removesPlist() throws {
        let mgr = try LaunchAgentManager(
            homeURL: tempHome,
            daemonScriptPath: fakeDaemonScript.path,
            nodePath: fakeNode.path
        )
        try mgr.install()
        try mgr.uninstall()

        let expectedPath = tempHome
            .appendingPathComponent("Library/LaunchAgents/dev.spectra.daemon.plist")
        XCTAssertFalse(FileManager.default.fileExists(atPath: expectedPath.path))
    }

    func test_uninstall_idempotentWhenNotInstalled() throws {
        let mgr = try LaunchAgentManager(
            homeURL: tempHome,
            daemonScriptPath: fakeDaemonScript.path,
            nodePath: fakeNode.path
        )
        XCTAssertNoThrow(try mgr.uninstall())
    }
}
