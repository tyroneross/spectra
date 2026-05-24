// Recents.swift
//
// UserDefaults-backed recents (max 5 entries). Each entry is a recent repo
// or target the user picked. Sorted by lastUsed (newest first).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public struct RecentRepo: Codable, Equatable, Identifiable, Sendable {
    public let path: String
    public let displayName: String
    public let lastUsed: Date

    public var id: String { path }

    public init(path: String, displayName: String, lastUsed: Date = Date()) {
        self.path = path
        self.displayName = displayName
        self.lastUsed = lastUsed
    }
}

public final class RecentsStore {
    public static let shared = RecentsStore(suiteName: "dev.spectra.app")

    private static let key = "recents.v1"
    private static let maxEntries = 5

    private let defaults: UserDefaults

    public init(suiteName: String) {
        // Use the app's own defaults; suiteName is conventional for menubar apps.
        if let s = UserDefaults(suiteName: suiteName) {
            self.defaults = s
        } else {
            self.defaults = .standard
        }
    }

    public func list() -> [RecentRepo] {
        guard let data = defaults.data(forKey: Self.key) else { return [] }
        let decoded = (try? JSONDecoder().decode([RecentRepo].self, from: data)) ?? []
        return decoded.sorted(by: { $0.lastUsed > $1.lastUsed })
    }

    public func remember(path: String, displayName: String? = nil) {
        var all = list()
        all.removeAll { $0.path == path }
        let entry = RecentRepo(
            path: path,
            displayName: displayName ?? (URL(fileURLWithPath: path).lastPathComponent),
            lastUsed: Date()
        )
        all.insert(entry, at: 0)
        if all.count > Self.maxEntries {
            all = Array(all.prefix(Self.maxEntries))
        }
        persist(all)
    }

    public func clear() {
        defaults.removeObject(forKey: Self.key)
    }

    private func persist(_ entries: [RecentRepo]) {
        if let data = try? JSONEncoder().encode(entries) {
            defaults.set(data, forKey: Self.key)
        }
    }
}
