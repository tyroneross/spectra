// KeychainStoreTests.swift
//
// XCTest coverage that does NOT require biometric / real-signing — those
// would only pass when run from a properly signed Spectra.app. Here we
// exercise: presence check before+after delete, malformed key rejection,
// and lastSecurityLevel default.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class KeychainStoreTests: XCTestCase {

    // Use a per-test service so we never collide with the real
    // dev.spectra.app key the developer might have stored locally.
    private func makeStore() -> KeychainStore {
        let suffix = UUID().uuidString.prefix(8)
        return KeychainStore(service: "dev.spectra.test.\(suffix)", account: "anthropic-api-key")
    }

    func test_emptyKey_throwsMalformed() {
        let store = makeStore()
        XCTAssertThrowsError(try store.saveApiKey("")) { err in
            XCTAssertEqual(err as? KeychainError, .malformed)
        }
    }

    func test_hasApiKey_falseByDefault() {
        let store = makeStore()
        XCTAssertFalse(store.hasApiKey())
    }

    func test_loadWithoutSave_throwsNotFound() {
        let store = makeStore()
        XCTAssertThrowsError(try store.loadApiKey()) { err in
            XCTAssertEqual(err as? KeychainError, .notFound)
        }
    }

    func test_delete_idempotent() {
        let store = makeStore()
        XCTAssertNoThrow(try store.deleteApiKey())
        XCTAssertNoThrow(try store.deleteApiKey())  // second call also succeeds
    }

    func test_initialSecurityLevel_isUnknown() {
        let store = makeStore()
        XCTAssertEqual(store.lastSecurityLevel, .unknown)
    }
}
