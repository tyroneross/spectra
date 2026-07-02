// macos/Spectra/DaemonCore/SessionStore.swift
//
// M3.G1 — session state store (STUB — expanded by the session-ops handler group).
// Backs listSessions / getSession / getRun / closeSession / closeAllSessions /
// recordLlmUsage. Thread-safe (the socket server handles connections concurrently).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

final class SessionStore: @unchecked Sendable {
    private let lock = NSLock()
    // Placeholder storage — the session-ops group defines the SessionRecord shape
    // (mirroring src/core/session + core-api.ts SessionDetail) and the ops.
    private var sessions: [String: [String: Any]] = [:]

    func withLock<T>(_ body: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body()
    }
}
