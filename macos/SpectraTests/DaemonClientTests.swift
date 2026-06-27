// DaemonClientTests.swift
//
// Unit tests for the contract-era DaemonClient (apiVersion 2, unix socket).
// These cover the pure, daemon-independent surface: the tool→operation map
// (Swift mirror of src/mcp/forward.ts), actionable error formatting, and the
// VersionInfo/HealthInfo decode shapes. The end-to-end wire round-trip is
// exercised headlessly on the TS side (tests/helpers/mock-daemon.ts); the Swift
// live-socket path is verified at P3 integration against the running daemon.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import XCTest
@testable import Spectra

final class DaemonClientTests: XCTestCase {

    // ─── Tool → operation mapping ────────────────────────────

    func test_mapTool_oneToOne() throws {
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_connect", arguments: ["target": "http://x"]).0, "createSession")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_snapshot", arguments: ["sessionId": "s"]).0, "snapshot")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_act", arguments: ["sessionId": "s"]).0, "act")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_step", arguments: ["sessionId": "s"]).0, "step")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_llm_step", arguments: ["sessionId": "s"]).0, "llmStep")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_library", arguments: ["action": "status"]).0, "library")
    }

    func test_mapTool_captureDispatch() throws {
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_capture", arguments: ["type": "screenshot"]).0, "screenshot")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_capture", arguments: ["type": "start_recording"]).0, "startRecording")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_capture", arguments: ["type": "stop_recording"]).0, "stopRecording")
    }

    func test_mapTool_sessionDispatch() throws {
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_session", arguments: ["action": "list"]).0, "listSessions")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_session", arguments: ["action": "close"]).0, "closeSession")
        XCTAssertEqual(try DaemonClient.mapTool(name: "spectra_session", arguments: ["action": "close_all"]).0, "closeAllSessions")
    }

    func test_mapTool_unknownThrows() {
        XCTAssertThrowsError(try DaemonClient.mapTool(name: "spectra_bogus", arguments: [:]))
        XCTAssertThrowsError(try DaemonClient.mapTool(name: "spectra_capture", arguments: ["type": "nope"]))
        XCTAssertThrowsError(try DaemonClient.mapTool(name: "spectra_session", arguments: ["action": "nope"]))
    }

    // ─── Error formatting ────────────────────────────────────

    func test_daemonDown_isActionable() {
        let err = DaemonError.daemonDown(hint: "Start the app.")
        XCTAssertTrue(err.errorDescription?.contains("Start the app.") ?? false)
        XCTAssertTrue(err.errorDescription?.contains("not reachable") ?? false)
    }

    func test_apiError_includesCodeAndHint() {
        let err = DaemonError.apiError(code: "not_found", message: "Session x not found", hint: "List sessions.")
        XCTAssertEqual(err.errorDescription, "Session x not found [not_found] — List sessions.")
    }

    func test_versionSkew_message() {
        let err = DaemonError.versionSkew(apiVersion: 3, expected: 2)
        XCTAssertTrue(err.errorDescription?.contains("apiVersion 3") ?? false)
        XCTAssertTrue(err.errorDescription?.contains("expectation 2") ?? false)
    }

    func test_expectedApiVersion_isTwo() {
        XCTAssertEqual(DaemonClient.expectedApiVersion, 2)
    }

    // ─── Decode shapes ───────────────────────────────────────

    func test_versionInfo_decodes() throws {
        let json = #"{"apiVersion":2,"daemonVersion":"0.3.2"}"#.data(using: .utf8)!
        let info = try JSONDecoder().decode(VersionInfo.self, from: json)
        XCTAssertEqual(info.apiVersion, 2)
        XCTAssertEqual(info.daemonVersion, "0.3.2")
    }

    func test_healthInfo_decodes() throws {
        let json = #"{"ok":true,"apiVersion":2,"daemonVersion":"0.3.2","pid":123,"aquaSession":true,"windowServer":{"connected":true}}"#.data(using: .utf8)!
        let info = try JSONDecoder().decode(HealthInfo.self, from: json)
        XCTAssertTrue(info.ok)
        XCTAssertEqual(info.apiVersion, 2)
        XCTAssertTrue(info.windowServer.connected)
    }
}
