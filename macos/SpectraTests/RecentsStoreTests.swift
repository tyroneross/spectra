// RecentsStoreTests.swift
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class RecentsStoreTests: XCTestCase {
    private let suite = "dev.spectra.app.tests.\(UUID().uuidString)"
    private var store: RecentsStore!
    private var tempRoot: URL!

    override func setUp() {
        super.setUp()
        store = RecentsStore(suiteName: suite)
        store.clear()
        tempRoot = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("SpectraRecentsStoreTests-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
    }

    override func tearDown() {
        store.clear()
        if let tempRoot {
            try? FileManager.default.removeItem(at: tempRoot)
        }
        super.tearDown()
    }

    func test_emptyByDefault() {
        XCTAssertEqual(store.list().count, 0)
    }

    func test_rememberAddsAtTop() {
        store.remember(path: "/tmp/a")
        store.remember(path: "/tmp/b")
        let all = store.list()
        XCTAssertEqual(all.count, 2)
        XCTAssertEqual(all.first?.path, "/tmp/b")
        XCTAssertEqual(all.last?.path, "/tmp/a")
    }

    func test_rememberDedupesByPath() {
        store.remember(path: "/tmp/a")
        store.remember(path: "/tmp/b")
        store.remember(path: "/tmp/a")
        let all = store.list()
        XCTAssertEqual(all.count, 2)
        XCTAssertEqual(all.first?.path, "/tmp/a")
    }

    func test_capsAtFiveEntries() {
        for i in 1...10 {
            store.remember(path: "/tmp/path-\(i)")
        }
        XCTAssertEqual(store.list().count, 5)
        XCTAssertEqual(store.list().first?.path, "/tmp/path-10")
    }

    func test_recordedVideosScansSessionMoviesNewestFirst() throws {
        let older = Date(timeIntervalSince1970: 100)
        let newer = Date(timeIntervalSince1970: 200)
        _ = try writeRecording(sessionId: "sess-old", fileName: "old.mp4", bytes: [1, 2], modifiedAt: older)
        _ = try writeRecording(sessionId: "sess-new", fileName: "new.mov", bytes: [1, 2, 3], modifiedAt: newer, nestedDirectory: "exports")
        _ = try writeRecording(sessionId: "sess-new", fileName: "still.png", bytes: [4], modifiedAt: newer)

        let videos = RecordedVideoStore.list(repoPath: tempRoot.path)

        XCTAssertEqual(videos.map(\.fileName), ["new.mov", "old.mp4"])
        XCTAssertEqual(videos.first?.sessionId, "sess-new")
        XCTAssertEqual(videos.first?.sizeBytes, 3)
    }

    func test_recordedVideosRespectsLimitAndIgnoresUnsupportedExtensions() throws {
        for index in 0..<3 {
            _ = try writeRecording(
                sessionId: "sess-\(index)",
                fileName: "video-\(index).MP4",
                bytes: [UInt8(index)],
                modifiedAt: Date(timeIntervalSince1970: TimeInterval(100 + index))
            )
        }
        _ = try writeRecording(sessionId: "sess-ignored", fileName: "notes.txt", bytes: [9], modifiedAt: Date(timeIntervalSince1970: 300))

        let videos = RecordedVideoStore.list(repoPath: tempRoot.path, limit: 2)

        XCTAssertEqual(videos.map(\.fileName), ["video-2.MP4", "video-1.MP4"])
    }

    private func writeRecording(
        sessionId: String,
        fileName: String,
        bytes: [UInt8],
        modifiedAt: Date,
        nestedDirectory: String? = nil
    ) throws -> URL {
        var directory = tempRoot
            .appendingPathComponent(".spectra", isDirectory: true)
            .appendingPathComponent("sessions", isDirectory: true)
            .appendingPathComponent(sessionId, isDirectory: true)
        if let nestedDirectory {
            directory = directory.appendingPathComponent(nestedDirectory, isDirectory: true)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(fileName)
        try Data(bytes).write(to: url)
        try FileManager.default.setAttributes([.modificationDate: modifiedAt], ofItemAtPath: url.path)
        return url
    }
}
