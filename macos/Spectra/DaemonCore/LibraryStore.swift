// macos/Spectra/DaemonCore/LibraryStore.swift
//
// M3.G1 — persistent capture-library catalog (STUB — expanded by the library
// handler group). Backs the `library` op (status/find/gallery/export/add/…).
// Flat index.json under <storageRoot>/library, forward-compatible with the TS
// library schema (src/library/*). Filesystem-only, no driver.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

final class LibraryStore: @unchecked Sendable {
    private let lock = NSLock()

    func withLock<T>(_ body: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body()
    }
}
