// macos/Spectra/DaemonCore/LibraryOps.swift
//
// M3.G1 — the `library` discriminated-union op (action: add/find/gallery/get/
// tag/delete/status/export/migrate-from-showcase). Mirrors src/mcp/tools/
// library.ts (handleLibrary) + src/library/query.ts (find/groupBy/stats)
// against DaemonContext.library. Result field names are snake_case to match
// the frozen contract (src/contract/contract.spec.json operations.library).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

func registerLibraryOps(_ registry: HandlerRegistry) {
    registry.register("library", capabilities: [.libraryRead, .libraryWrite]) { params, ctx in
        guard let p = params as? [String: Any] else {
            throw DaemonApiError(.badRequest, "library requires a params object", status: 400)
        }
        guard let action = p["action"] as? String else {
            throw DaemonApiError(.badRequest, "library requires an \"action\" string", status: 400)
        }
        switch action {
        case "add": return try libraryAdd(p, ctx.library)
        case "find": return libraryFind(p, ctx.library)
        case "gallery": return libraryGallery(p, ctx.library)
        case "get": return try libraryGet(p, ctx.library)
        case "tag": return try libraryTag(p, ctx.library)
        case "delete": return try libraryDelete(p, ctx.library)
        case "status": return libraryStatus(ctx.library)
        case "export": return try libraryExport(p, ctx.library)
        case "migrate-from-showcase": return libraryMigrateFromShowcase(p, ctx.library)
        default:
            throw DaemonApiError(.badRequest, "Unknown library action: \(action)", status: 400)
        }
    }
}

// ─── param extraction helpers ─────────────────────────────────────────────

private func pStr(_ p: [String: Any], _ key: String) -> String? { p[key] as? String }
private func pStrArray(_ p: [String: Any], _ key: String) -> [String]? { p[key] as? [String] }
private func pBool(_ p: [String: Any], _ key: String) -> Bool? { p[key] as? Bool }
private func pInt(_ p: [String: Any], _ key: String) -> Int? { jsonInt(p[key]) }

private struct FindOptions {
    var tagsAny: [String]?
    var tagsAll: [String]?
    var feature: String?
    var component: String?
    var platform: String?
    var type: String?
    var since: String?
    var until: String?
    var starred: Bool?
    var text: String?
    var limit: Int?

    var isEmpty: Bool {
        tagsAny == nil && tagsAll == nil && feature == nil && component == nil
            && platform == nil && type == nil && since == nil && until == nil
            && starred == nil && text == nil && limit == nil
    }
}

private func findOptions(from p: [String: Any]) -> FindOptions {
    FindOptions(
        tagsAny: pStrArray(p, "tagsAny"),
        tagsAll: pStrArray(p, "tagsAll"),
        feature: pStr(p, "feature"),
        component: pStr(p, "component"),
        platform: pStr(p, "platform"),
        type: pStr(p, "type"),
        since: pStr(p, "since"),
        until: pStr(p, "until"),
        starred: pBool(p, "starred"),
        text: pStr(p, "text"),
        limit: pInt(p, "limit")
    )
}

// ─── ISO date parsing (mirrors Date.parse used by src/library/query.ts) ────

private func parseISODate(_ s: String) -> Date? {
    let f1 = ISO8601DateFormatter()
    f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f1.date(from: s) { return d }
    let f2 = ISO8601DateFormatter()
    f2.formatOptions = [.withInternetDateTime]
    return f2.date(from: s)
}

// ─── query engine (mirrors src/library/query.ts find/groupBy/stats) ────────

private func find(_ all: [CaptureEntry], _ opts: FindOptions) -> [CaptureEntry] {
    var out = all

    if let tagsAny = opts.tagsAny, !tagsAny.isEmpty {
        let wanted = Set(tagsAny.map { $0.lowercased() })
        out = out.filter { entry in (entry.tags ?? []).contains { wanted.contains($0.lowercased()) } }
    }
    if let tagsAll = opts.tagsAll, !tagsAll.isEmpty {
        let required = tagsAll.map { $0.lowercased() }
        out = out.filter { entry in
            let have = Set((entry.tags ?? []).map { $0.lowercased() })
            return required.allSatisfy { have.contains($0) }
        }
    }
    if let feature = opts.feature { out = out.filter { $0.feature == feature } }
    if let component = opts.component { out = out.filter { $0.component == component } }
    if let platform = opts.platform { out = out.filter { $0.platform == platform } }
    if let type = opts.type { out = out.filter { $0.type == type } }
    if opts.starred == true { out = out.filter { $0.starred == true } }

    if let since = opts.since, let t = parseISODate(since) {
        out = out.filter { entry in
            guard let ct = parseISODate(entry.createdAt) else { return true }
            return ct >= t
        }
    }
    if let until = opts.until, let t = parseISODate(until) {
        out = out.filter { entry in
            guard let ct = parseISODate(entry.createdAt) else { return true }
            return ct <= t
        }
    }

    if let text = opts.text {
        let q = text.lowercased()
        out = out.filter { entry in
            let blob = ([entry.title ?? "", entry.feature ?? "", entry.component ?? ""] + (entry.tags ?? []))
                .joined(separator: " ").lowercased()
            return blob.contains(q)
        }
    }

    out.sort { a, b in
        let ta = parseISODate(a.createdAt) ?? .distantPast
        let tb = parseISODate(b.createdAt) ?? .distantPast
        return ta > tb
    }

    if let limit = opts.limit, limit > 0 { out = Array(out.prefix(limit)) }
    return out
}

private func groupBy(_ all: [CaptureEntry], by: String) -> [(key: String, captures: [CaptureEntry])] {
    var groups: [String: [CaptureEntry]] = [:]
    var order: [String] = []
    for c in all {
        let key: String
        switch by {
        case "feature": key = (c.feature?.isEmpty == false) ? c.feature! : "(none)"
        case "component": key = (c.component?.isEmpty == false) ? c.component! : "(none)"
        case "platform": key = c.platform
        case "type": key = c.type
        case "date": key = String(c.createdAt.prefix(10))
        default: key = "(none)"
        }
        if groups[key] == nil { groups[key] = []; order.append(key) }
        groups[key]!.append(c)
    }
    return order.sorted().map { key in (key: key, captures: groups[key] ?? []) }
}

private struct LibraryStats {
    var total = 0
    var byType: [String: Int] = [:]
    var byPlatform: [String: Int] = [:]
    var byFeature: [String: Int] = [:]
    var totalSizeBytes = 0
    var oldest: String?
    var newest: String?
    var starredCount = 0
}

private func computeStats(_ all: [CaptureEntry]) -> LibraryStats {
    var s = LibraryStats()
    s.total = all.count
    for c in all {
        s.byType[c.type, default: 0] += 1
        s.byPlatform[c.platform, default: 0] += 1
        if let feature = c.feature, !feature.isEmpty { s.byFeature[feature, default: 0] += 1 }
        s.totalSizeBytes += c.sizeBytes
        if c.starred == true { s.starredCount += 1 }
    }
    if !all.isEmpty {
        let sorted = all.sorted { a, b in
            let ta = parseISODate(a.createdAt) ?? .distantPast
            let tb = parseISODate(b.createdAt) ?? .distantPast
            return ta < tb
        }
        s.oldest = sorted.first?.createdAt
        s.newest = sorted.last?.createdAt
    }
    return s
}

/// Mirrors src/library/storage.ts summarize(): a one-line "id | type |
/// platform | feature | title" debug string. Opaque to the oracle (typed as
/// bare `string`) — presence, not exact text, is what's checked.
private func summarize(_ e: CaptureEntry) -> String {
    let titlePart: String
    if let t = e.title, !t.isEmpty {
        titlePart = t
    } else if let u = e.url, !u.isEmpty, let base = URL(string: u)?.lastPathComponent, !base.isEmpty {
        titlePart = base
    } else {
        titlePart = "-"
    }
    let featurePart = (e.feature?.isEmpty == false) ? e.feature! : "-"
    return [e.id, e.type, e.platform, featurePart, titlePart].joined(separator: " | ")
}

// ─── actions ─────────────────────────────────────────────────────────────

private func libraryAdd(_ p: [String: Any], _ store: LibraryStore) throws -> [String: Any] {
    guard let sourcePath = pStr(p, "sourcePath") else {
        throw DaemonApiError(.badRequest, "add requires sourcePath", status: 400)
    }
    let id = store.newCaptureId()
    let stored: (path: String, sizeBytes: Int, format: String)
    do {
        stored = try store.storeMedia(id: id, sourcePath: sourcePath)
    } catch {
        throw DaemonApiError(.badRequest, "add failed to store media: \(error.localizedDescription)", status: 400)
    }
    let title = pStr(p, "title") ?? (sourcePath as NSString).lastPathComponent
    var entry = CaptureEntry(
        id: id,
        createdAt: isoNow(),
        type: pStr(p, "type") ?? "screenshot",
        format: stored.format,
        sizeBytes: stored.sizeBytes,
        source: "spectra",
        platform: pStr(p, "platform") ?? "unknown"
    )
    entry.durationMs = pInt(p, "durationMs")
    entry.url = pStr(p, "url")
    entry.viewport = pStr(p, "viewport")
    entry.selector = pStr(p, "selector")
    entry.deviceName = pStr(p, "deviceName")
    entry.title = title
    entry.feature = pStr(p, "feature")
    entry.component = pStr(p, "component")
    entry.tags = pStrArray(p, "tags")
    entry.starred = pBool(p, "starred")
    if let wt = p["walkthrough"] as? [String: Any] {
        entry.walkthroughStepCount = jsonInt(wt["step_count"])
        entry.walkthroughSteps = wt["steps"] as? [String]
    }
    entry.gitBranch = pStr(p, "gitBranch")
    entry.gitCommit = pStr(p, "gitCommit")

    store.addEntry(entry)
    return ["added": entry.id, "path": stored.path, "entry": entry.toJSON()]
}

private func libraryFind(_ p: [String: Any], _ store: LibraryStore) -> [String: Any] {
    let (_, all) = store.loadAll()
    let results = find(all, findOptions(from: p))
    let captures: [[String: Any]] = results.map { c in
        var d: [String: Any] = [
            "id": c.id,
            "type": c.type,
            "platform": c.platform,
            "created_at": c.createdAt,
            "summary": summarize(c),
        ]
        if let v = c.title { d["title"] = v }
        if let v = c.feature { d["feature"] = v }
        if let v = c.component { d["component"] = v }
        if let v = c.tags { d["tags"] = v }
        if let v = c.url { d["url"] = v }
        if let v = c.starred { d["starred"] = v }
        return d
    }
    return ["count": captures.count, "captures": captures]
}

private func libraryGallery(_ p: [String: Any], _ store: LibraryStore) -> [String: Any] {
    let (_, all) = store.loadAll()
    let by = pStr(p, "groupBy") ?? "feature"
    let groups = groupBy(all, by: by)
    let groupsJSON: [[String: Any]] = groups.map { g in
        let captures: [[String: Any]] = g.captures.map { c in
            var d: [String: Any] = [
                "id": c.id,
                "type": c.type,
                "platform": c.platform,
                "created_at": c.createdAt,
            ]
            if let v = c.title { d["title"] = v }
            if let v = c.starred { d["starred"] = v }
            return d
        }
        return ["key": g.key, "count": g.captures.count, "captures": captures]
    }
    return ["total": all.count, "groupedBy": by, "groups": groupsJSON]
}

private func libraryGet(_ p: [String: Any], _ store: LibraryStore) throws -> [String: Any] {
    guard let id = pStr(p, "id") else {
        throw DaemonApiError(.badRequest, "get requires id", status: 400)
    }
    guard let entry = store.getEntry(id: id) else {
        return ["found": false, "id": id]
    }
    return ["found": true, "entry": entry.toJSON()]
}

private func libraryTag(_ p: [String: Any], _ store: LibraryStore) throws -> [String: Any] {
    guard let id = pStr(p, "id") else {
        throw DaemonApiError(.badRequest, "tag requires id", status: 400)
    }
    let updated = store.updateEntry(id: id) { entry in
        if let v = pStrArray(p, "tags") { entry.tags = v }
        if let v = pStr(p, "feature") { entry.feature = v }
        if let v = pStr(p, "component") { entry.component = v }
        if let v = pBool(p, "starred") { entry.starred = v }
        if let v = pStr(p, "title") { entry.title = v }
    }
    guard let updated else { return ["updated": false, "id": id] }
    return ["updated": true, "entry": updated.toJSON()]
}

private func libraryDelete(_ p: [String: Any], _ store: LibraryStore) throws -> [String: Any] {
    guard let id = pStr(p, "id") else {
        throw DaemonApiError(.badRequest, "delete requires id", status: 400)
    }
    guard let removed = store.removeEntry(id: id) else {
        return ["removed": false, "id": id]
    }
    return ["removed": true, "id": removed.id]
}

private func libraryStatus(_ store: LibraryStore) -> [String: Any] {
    let (version, all) = store.loadAll()
    let s = computeStats(all)
    var result: [String: Any] = [
        "library_version": version,
        "total": s.total,
        "by_type": s.byType,
        "by_platform": s.byPlatform,
        "by_feature": s.byFeature,
        "total_size_bytes": s.totalSizeBytes,
        "starred_count": s.starredCount,
        "total_size_mb": (Double(s.totalSizeBytes) / 1024.0 / 1024.0 * 100).rounded() / 100,
    ]
    if let oldest = s.oldest { result["oldest"] = oldest }
    if let newest = s.newest { result["newest"] = newest }
    return result
}

private func libraryExport(_ p: [String: Any], _ store: LibraryStore) throws -> [String: Any] {
    guard let outDir = pStr(p, "outDir") else {
        throw DaemonApiError(.badRequest, "export requires outDir", status: 400)
    }
    let (_, all) = store.loadAll()
    let opts = findOptions(from: p)
    let selected = opts.isEmpty ? all : find(all, opts)

    try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    let flatten = pBool(p, "flatten") ?? false
    var filesCopied = 0
    for c in selected {
        let src = store.mediaPath(for: c)
        let destDir = flatten ? outDir : (outDir as NSString).appendingPathComponent(c.id)
        try? FileManager.default.createDirectory(atPath: destDir, withIntermediateDirectories: true)
        let destName = flatten ? "\(c.id).\(c.format)" : "original.\(c.format)"
        let dest = (destDir as NSString).appendingPathComponent(destName)
        if FileManager.default.fileExists(atPath: dest) { try? FileManager.default.removeItem(atPath: dest) }
        if (try? FileManager.default.copyItem(atPath: src, toPath: dest)) != nil {
            filesCopied += 1
        }
    }

    var result: [String: Any] = ["exported": selected.count, "outDir": outDir, "filesCopied": filesCopied]
    let wantsManifest = pBool(p, "manifest") ?? true
    if wantsManifest {
        let manifestPath = (outDir as NSString).appendingPathComponent("manifest.md")
        let manifest = renderManifest(selected, flatten: flatten)
        try? manifest.write(toFile: manifestPath, atomically: true, encoding: .utf8)
        result["manifestPath"] = manifestPath
    }
    return result
}

private func renderManifest(_ captures: [CaptureEntry], flatten: Bool) -> String {
    var lines: [String] = ["# Spectra Library Export", ""]
    lines.append("Exported \(captures.count) capture\(captures.count == 1 ? "" : "s") from the spectra library.")
    lines.append("")
    for c in captures {
        let rel = flatten ? "\(c.id).\(c.format)" : "\(c.id)/original.\(c.format)"
        lines.append("## \(c.title ?? c.id)")
        lines.append("")
        lines.append("- **File**: `\(rel)`")
        lines.append("- **Type**: \(c.type) (\(c.format))")
        lines.append("- **Platform**: \(c.platform)")
        if let feature = c.feature { lines.append("- **Feature**: \(feature)") }
        if let component = c.component { lines.append("- **Component**: \(component)") }
        if let tags = c.tags, !tags.isEmpty { lines.append("- **Tags**: \(tags.joined(separator: ", "))") }
        if let url = c.url { lines.append("- **URL**: \(url)") }
        lines.append("- **Captured**: \(c.createdAt)")
        lines.append("")
    }
    return lines.joined(separator: "\n") + "\n"
}

/// Mirrors src/library/migrate.ts migrateFromShowcase: non-destructive import
/// of a legacy `.showcase/index.json` catalog. Best-effort — a missing or
/// unparsable showcase index returns a zeroed, still-shape-conformant report.
private func libraryMigrateFromShowcase(_ p: [String: Any], _ store: LibraryStore) -> [String: Any] {
    let showcasePath = pStr(p, "showcasePath")
        ?? (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent(".showcase")
    var found = 0, imported = 0, skipped = 0, mediaCopied = 0, mediaMissing = 0
    var issues: [String] = []

    let showcaseIndexPath = (showcasePath as NSString).appendingPathComponent("index.json")
    guard let data = FileManager.default.contents(atPath: showcaseIndexPath) else {
        issues.append("Showcase index.json not found at \(showcaseIndexPath)")
        return [
            "sourcePath": showcasePath, "found": 0, "imported": 0, "skipped": 0,
            "mediaCopied": 0, "mediaMissing": 0, "issues": issues,
        ]
    }
    guard let raw = try? JSONSerialization.jsonObject(with: data) else {
        issues.append("Failed to parse showcase index.json")
        return [
            "sourcePath": showcasePath, "found": 0, "imported": 0, "skipped": 0,
            "mediaCopied": 0, "mediaMissing": 0, "issues": issues,
        ]
    }
    let rawCaptures: [[String: Any]]
    if let arr = raw as? [[String: Any]] {
        rawCaptures = arr
    } else if let obj = raw as? [String: Any], let arr = obj["captures"] as? [[String: Any]] {
        rawCaptures = arr
    } else {
        rawCaptures = []
    }
    found = rawCaptures.count

    let (_, existing) = store.loadAll()
    var existingIds = Set(existing.map { $0.id })
    let showcaseMediaRoot = (showcasePath as NSString).appendingPathComponent("media")

    for raw in rawCaptures {
        guard let id = raw["id"] as? String else {
            skipped += 1
            issues.append("Entry without id skipped")
            continue
        }
        if existingIds.contains(id) { skipped += 1; continue }

        var entry = CaptureEntry(
            id: id,
            createdAt: (raw["created_at"] as? String) ?? isoNow(),
            type: (raw["type"] as? String) ?? "screenshot",
            format: (raw["format"] as? String) ?? "png",
            sizeBytes: jsonInt(raw["size_bytes"]) ?? 0,
            source: "migrated-from-showcase (\((raw["source"] as? String) ?? "unknown"))",
            platform: normalizePlatform(raw["platform"])
        )
        entry.durationMs = jsonInt(raw["duration_ms"])
        entry.url = raw["url"] as? String
        entry.viewport = raw["viewport"] as? String
        entry.selector = raw["selector"] as? String
        entry.deviceName = raw["device_name"] as? String
        entry.title = raw["title"] as? String
        entry.feature = raw["feature"] as? String
        entry.component = raw["component"] as? String
        entry.tags = raw["tags"] as? [String]
        entry.starred = raw["starred"] as? Bool
        if let wt = raw["walkthrough"] as? [String: Any] {
            entry.walkthroughStepCount = jsonInt(wt["step_count"])
            entry.walkthroughSteps = wt["steps"] as? [String]
        }
        entry.gitBranch = raw["git_branch"] as? String
        entry.gitCommit = raw["git_commit"] as? String

        let srcDir = (showcaseMediaRoot as NSString).appendingPathComponent(id)
        let destDir = store.mediaDir(for: id)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: srcDir, isDirectory: &isDir), isDir.boolValue {
            do {
                try FileManager.default.createDirectory(atPath: destDir, withIntermediateDirectories: true)
                let items = try FileManager.default.contentsOfDirectory(atPath: srcDir)
                for item in items {
                    let s = (srcDir as NSString).appendingPathComponent(item)
                    let d = (destDir as NSString).appendingPathComponent(item)
                    if FileManager.default.fileExists(atPath: d) { try? FileManager.default.removeItem(atPath: d) }
                    try FileManager.default.copyItem(atPath: s, toPath: d)
                }
                mediaCopied += 1
            } catch {
                issues.append("Failed to copy media for \(id): \(error.localizedDescription)")
            }
        } else {
            mediaMissing += 1
            issues.append("Media directory missing for \(id) (source: \(srcDir))")
        }

        store.addEntry(entry)
        imported += 1
        existingIds.insert(id)
    }

    return [
        "sourcePath": showcasePath, "found": found, "imported": imported, "skipped": skipped,
        "mediaCopied": mediaCopied, "mediaMissing": mediaMissing, "issues": issues,
    ]
}

private func normalizePlatform(_ v: Any?) -> String {
    let s = (v as? String)?.lowercased() ?? "unknown"
    let known = ["web", "macos", "ios", "watchos", "terminal", "unknown"]
    return known.contains(s) ? s : "unknown"
}

private func isoNow() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}
