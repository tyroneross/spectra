// macos/Spectra/DaemonCore/LibraryStore.swift
//
// M3.G1 — persistent capture-library catalog. Backs the `library` op
// (status/find/gallery/export/add/tag/delete/get/migrate-from-showcase).
// Flat file-backed index under <storageRoot>/library/index.json, mirroring
// the TS library schema (src/library/types.ts LibraryIndex = {version,
// captures}), so the file is forward/backward compatible between the two
// daemon implementations. Filesystem-only, no driver, thread-safe via a
// single NSLock guarding read-modify-write of the index file.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

let libraryIndexVersion = 1

/// Mirrors src/library/types.ts CaptureEntry. Field names on the wire (JSON)
/// are snake_case to match the TS library schema exactly.
struct CaptureEntry {
    var id: String
    var createdAt: String
    var type: String
    var format: String
    var sizeBytes: Int
    var source: String
    var platform: String

    var durationMs: Int?
    var url: String?
    var viewport: String?
    var selector: String?
    var deviceName: String?
    var title: String?
    var feature: String?
    var component: String?
    var tags: [String]?
    var starred: Bool?
    var walkthroughStepCount: Int?
    var walkthroughSteps: [String]?
    var gitBranch: String?
    var gitCommit: String?

    func toJSON() -> [String: Any] {
        var d: [String: Any] = [
            "id": id,
            "created_at": createdAt,
            "type": type,
            "format": format,
            "size_bytes": sizeBytes,
            "source": source,
            "platform": platform,
        ]
        if let v = durationMs { d["duration_ms"] = v }
        if let v = url { d["url"] = v }
        if let v = viewport { d["viewport"] = v }
        if let v = selector { d["selector"] = v }
        if let v = deviceName { d["device_name"] = v }
        if let v = title { d["title"] = v }
        if let v = feature { d["feature"] = v }
        if let v = component { d["component"] = v }
        if let v = tags { d["tags"] = v }
        if let v = starred { d["starred"] = v }
        if let stepCount = walkthroughStepCount, let steps = walkthroughSteps {
            d["walkthrough"] = ["step_count": stepCount, "steps": steps] as [String: Any]
        }
        if let v = gitBranch { d["git_branch"] = v }
        if let v = gitCommit { d["git_commit"] = v }
        return d
    }

    static func fromJSON(_ d: [String: Any]) -> CaptureEntry? {
        guard let id = d["id"] as? String,
              let createdAt = d["created_at"] as? String,
              let type = d["type"] as? String,
              let format = d["format"] as? String,
              let source = d["source"] as? String,
              let platform = d["platform"] as? String
        else { return nil }
        var e = CaptureEntry(
            id: id, createdAt: createdAt, type: type, format: format,
            sizeBytes: jsonInt(d["size_bytes"]) ?? 0, source: source, platform: platform
        )
        e.durationMs = jsonInt(d["duration_ms"])
        e.url = d["url"] as? String
        e.viewport = d["viewport"] as? String
        e.selector = d["selector"] as? String
        e.deviceName = d["device_name"] as? String
        e.title = d["title"] as? String
        e.feature = d["feature"] as? String
        e.component = d["component"] as? String
        e.tags = d["tags"] as? [String]
        e.starred = d["starred"] as? Bool
        if let wt = d["walkthrough"] as? [String: Any] {
            e.walkthroughStepCount = jsonInt(wt["step_count"])
            e.walkthroughSteps = wt["steps"] as? [String]
        }
        e.gitBranch = d["git_branch"] as? String
        e.gitCommit = d["git_commit"] as? String
        return e
    }
}

/// Extracts an Int from a JSON-decoded value that may be NSNumber/Int/Double
/// (JSONSerialization bridges numeric JSON to NSNumber on Foundation).
func jsonInt(_ v: Any?) -> Int? {
    if let n = v as? NSNumber { return n.intValue }
    if let i = v as? Int { return i }
    if let d = v as? Double { return Int(d) }
    return nil
}

/// Resolves the daemon storage root: SPECTRA_HOME env, else HOME env, else
/// NSHomeDirectory(), + "/.spectra". Matches the conformance oracle's
/// storage-isolation contract (tests/conformance/lib/daemon-endpoint.ts sets
/// HOME to an isolated tmp dir and SPECTRA_HOME defensively to the same).
func resolveStorageRoot() -> String {
    let env = ProcessInfo.processInfo.environment
    if let spectraHome = env["SPECTRA_HOME"], !spectraHome.isEmpty { return spectraHome }
    let home = env["HOME"] ?? NSHomeDirectory()
    return (home as NSString).appendingPathComponent(".spectra")
}

final class LibraryStore: @unchecked Sendable {
    private let lock = NSLock()
    private let storageRoot: String

    init(storageRoot: String? = nil) {
        self.storageRoot = storageRoot ?? resolveStorageRoot()
    }

    var libraryDir: String { (storageRoot as NSString).appendingPathComponent("library") }
    var mediaDir: String { (libraryDir as NSString).appendingPathComponent("media") }
    var indexPath: String { (libraryDir as NSString).appendingPathComponent("index.json") }

    func mediaDir(for id: String) -> String { (mediaDir as NSString).appendingPathComponent(id) }
    func mediaPath(for entry: CaptureEntry) -> String {
        (mediaDir(for: entry.id) as NSString).appendingPathComponent("original.\(entry.format)")
    }

    func withLock<T>(_ body: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body()
    }

    /// Ensures library/ and library/media/ exist and index.json is seeded
    /// with an empty catalog if absent (a missing index.json IS a valid
    /// empty catalog, matching the TS ensureLibraryDirs contract).
    private func ensureDirs() {
        try? FileManager.default.createDirectory(atPath: mediaDir, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: indexPath) {
            let empty: [String: Any] = ["version": libraryIndexVersion, "captures": []]
            if let data = try? JSONSerialization.data(withJSONObject: empty) {
                try? data.write(to: URL(fileURLWithPath: indexPath))
            }
        }
    }

    /// Loads (version, captures) from disk. Missing/unparsable index.json is
    /// treated as an empty catalog — never throws.
    private func loadLocked() -> (version: Int, captures: [CaptureEntry]) {
        ensureDirs()
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: indexPath)),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return (libraryIndexVersion, []) }
        let version = jsonInt(obj["version"]) ?? libraryIndexVersion
        let rawCaptures = obj["captures"] as? [[String: Any]] ?? []
        let captures = rawCaptures.compactMap { CaptureEntry.fromJSON($0) }
        return (version, captures)
    }

    private func saveLocked(version: Int, captures: [CaptureEntry]) {
        ensureDirs()
        let obj: [String: Any] = [
            "version": version,
            "captures": captures.map { $0.toJSON() },
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) else { return }
        let tmpPath = indexPath + ".tmp"
        do {
            try data.write(to: URL(fileURLWithPath: tmpPath))
            _ = try FileManager.default.replaceItemAt(
                URL(fileURLWithPath: indexPath), withItemAt: URL(fileURLWithPath: tmpPath)
            )
        } catch {
            try? data.write(to: URL(fileURLWithPath: indexPath))
        }
    }

    // ─── public catalog operations (each is a single locked read-modify-write) ──

    func loadAll() -> (version: Int, captures: [CaptureEntry]) {
        withLock { loadLocked() }
    }

    func addEntry(_ entry: CaptureEntry) {
        withLock {
            var (version, captures) = loadLocked()
            captures.append(entry)
            saveLocked(version: version, captures: captures)
        }
    }

    func updateEntry(id: String, patch: (inout CaptureEntry) -> Void) -> CaptureEntry? {
        withLock {
            var (version, captures) = loadLocked()
            guard let i = captures.firstIndex(where: { $0.id == id }) else { return nil }
            var updated = captures[i]
            patch(&updated)
            updated.id = captures[i].id
            captures[i] = updated
            saveLocked(version: version, captures: captures)
            return updated
        }
    }

    @discardableResult
    func removeEntry(id: String) -> CaptureEntry? {
        withLock {
            var (version, captures) = loadLocked()
            guard let i = captures.firstIndex(where: { $0.id == id }) else { return nil }
            let removed = captures.remove(at: i)
            saveLocked(version: version, captures: captures)
            try? FileManager.default.removeItem(atPath: mediaDir(for: id))
            return removed
        }
    }

    func getEntry(id: String) -> CaptureEntry? {
        withLock { loadLocked().captures.first(where: { $0.id == id }) }
    }

    func newCaptureId() -> String {
        var bytes = [UInt8](repeating: 0, count: 6)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        return "cap_" + hex
    }

    /// Copies sourcePath into media/<id>/original.<ext>. Returns the stored
    /// path, byte size, and inferred format (extension, defaulting to "bin").
    func storeMedia(id: String, sourcePath: String) throws -> (path: String, sizeBytes: Int, format: String) {
        let destDir = mediaDir(for: id)
        try FileManager.default.createDirectory(atPath: destDir, withIntermediateDirectories: true)
        let ext = (sourcePath as NSString).pathExtension
        let format = ext.isEmpty ? "bin" : ext
        let dest = (destDir as NSString).appendingPathComponent("original.\(ext.isEmpty ? "bin" : ext)")
        if FileManager.default.fileExists(atPath: dest) {
            try? FileManager.default.removeItem(atPath: dest)
        }
        try FileManager.default.copyItem(atPath: sourcePath, toPath: dest)
        let attrs = try FileManager.default.attributesOfItem(atPath: dest)
        let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
        return (dest, size, format)
    }
}
