// RecentsStoreTests.swift
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class RecentsStoreTests: XCTestCase {
    private let suite = "dev.spectra.app.tests.\(UUID().uuidString)"
    private var store: RecentsStore!

    override func setUp() {
        super.setUp()
        store = RecentsStore(suiteName: suite)
        store.clear()
    }

    override func tearDown() {
        store.clear()
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
}
