// macos/Spectra/DaemonCore/Intelligence.swift
//
// M3.G2 (S3, step-intelligence-engine) — deterministic heuristics consumed by
// observe/analyze/discover. Ports, in one file (this W0 slice's fixed 6-file
// ownership boundary has no room for a separate file per TS source):
//   - src/intelligence/importance.ts   (scoreElements, findRegions)
//   - src/intelligence/spatial.ts      (edgeDistance, regionLabel,
//                                        boundingBox, clusterElements)
//   - src/intelligence/states.ts       (detectState, createStateTriggers)
//   - src/intelligence/framing.ts      (frame — PNG crop for discover)
//   - src/intelligence/navigation.ts   (crawl — the BFS discover walks)
//   - src/intelligence/change.ts       (detectChange — crawl's dedup gate)
//
// Every function here is a pure function of a DriverSnapshot/[DriverElement]
// (+ a Driver for `crawl`, which only ever calls .snapshot()/.act()/
// .screenshot() — never a CDP-only escape hatch). No LLM anywhere.
//
// PNG note (frame/detectChange): TS's src/media/png.ts is a minimal hand-
// rolled PNG codec that only supports colorType 2 (RGB) and 6 (RGBA), 8-bit
// depth — it THROWS on anything else (notably colorType 4, grayscale+alpha,
// which is exactly what tests/conformance/lib/fakes.ts's 1x1 FAKE_PNG_BASE64
// is). That throw is why `discover`'s golden-corpus fixture always reports
// `captures: 1` (the framed variant never gets written) even though the
// FakeDriver snapshot has 2 scorable elements. This file reproduces that
// EXACT gating check (parsePngIHDR: bitDepth==8 && colorType in {2,6}, else
// throw) so the `captures` count stays byte-parity-correct against the
// conformance oracle, then delegates the actual decode/crop/encode to
// CoreGraphics/ImageIO for anything that passes the gate — the resulting
// PNG BYTES are not required to match TS's custom encoder byte-for-byte
// (pre-ruled elsewhere in the plan for S4's screenshot ops; the same
// graceful-degradation logic applies here).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// ─── Shared regex helpers (file-scoped copy) ────────────────────────────────

private func regexTest(_ pattern: String, _ text: String, caseInsensitive: Bool = true) -> Bool {
    var opts: String.CompareOptions = [.regularExpression]
    if caseInsensitive { opts.insert(.caseInsensitive) }
    return text.range(of: pattern, options: opts) != nil
}

private func replaceAllRegex(_ pattern: String, _ replacement: String, _ text: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - importance.ts (scoreElements, findRegions)
// ═══════════════════════════════════════════════════════════════════════════

struct Viewport {
    var width: Double
    var height: Double
    var devicePixelRatio: Double
}

struct ScoreFactor { var name: String; var weight: Double; var value: Double; var reason: String }
struct ImportanceScore { var elementId: String; var score: Double; var factors: [ScoreFactor] }
struct RegionOfInterest { var bounds: DriverBounds; var score: Double; var elements: [String]; var label: String }

private let roleScores: [String: Double] = [
    "heading": 1.0, "button": 0.9, "link": 0.8, "image": 0.8, "textbox": 0.7,
    "tab": 0.7, "menuitem": 0.6, "text": 0.4, "group": 0.1, "separator": 0.0,
]
private let roleScoreUnknown = 0.3

private let wRole = 0.30, wPosition = 0.20, wInteract = 0.15, wLabel = 0.15, wDensity = 0.10, wVisual = 0.10

private func clampUnit(_ v: Double, _ lo: Double = 0.0, _ hi: Double = 1.0) -> Double {
    max(lo, min(hi, v))
}

private func elementCenter(_ el: DriverElement) -> (Double, Double) {
    (el.bounds.x + el.bounds.width / 2, el.bounds.y + el.bounds.height / 2)
}

private func scoreRoleFactor(_ el: DriverElement) -> ScoreFactor {
    let value = roleScores[el.role] ?? roleScoreUnknown
    return ScoreFactor(name: "role", weight: wRole, value: value, reason: "role \"\(el.role)\" maps to \(value)")
}

private func scorePositionFactor(_ el: DriverElement, _ viewport: Viewport) -> ScoreFactor {
    let x = el.bounds.x, y = el.bounds.y
    let vw = viewport.width * viewport.devicePixelRatio
    let vh = viewport.height * viewport.devicePixelRatio
    let normY = clampUnit(y / vh)
    let normX = clampUnit(x / vw)
    var value = 1.0 - (normY * 0.7 + normX * 0.3)
    if y < viewport.height { value = clampUnit(value + 0.2) }
    value = clampUnit(value)
    return ScoreFactor(name: "position", weight: wPosition, value: value, reason: "position")
}

private func scoreInteractivityFactor(_ el: DriverElement) -> ScoreFactor {
    let value: Double = el.actions.isEmpty ? 0.0 : 1.0
    return ScoreFactor(name: "interactivity", weight: wInteract, value: value, reason: "interactivity")
}

private func scoreLabelQualityFactor(_ el: DriverElement) -> ScoreFactor {
    let len = el.label.count
    let value: Double
    if len == 0 { value = 0.0 }
    else if len == 1 { value = 0.2 }
    else if len <= 20 { value = 1.0 }
    else if len <= 50 { value = 1.0 }
    else { value = 0.5 }
    return ScoreFactor(name: "label_quality", weight: wLabel, value: value, reason: "label_quality")
}

private func scoreContentDensityFactor(_ el: DriverElement, _ all: [DriverElement]) -> ScoreFactor {
    let (cx, cy) = elementCenter(el)
    var count = 0
    for other in all {
        if other.id == el.id { continue }
        let (ox, oy) = elementCenter(other)
        let d = ((cx - ox) * (cx - ox) + (cy - oy) * (cy - oy)).squareRoot()
        if d <= 50 { count += 1 }
    }
    let value = clampUnit(Double(count) / 10)
    return ScoreFactor(name: "content_density", weight: wDensity, value: value, reason: "content_density")
}

private func scoreVisualProminenceFactor(_ el: DriverElement, _ viewport: Viewport) -> ScoreFactor {
    let w = el.bounds.width, h = el.bounds.height
    let viewportArea = viewport.width * viewport.height * viewport.devicePixelRatio * viewport.devicePixelRatio
    let area = w * h
    let normalized = viewportArea > 0 ? area / viewportArea : 0
    let value = clampUnit(normalized * 5)
    return ScoreFactor(name: "visual_prominence", weight: wVisual, value: value, reason: "visual_prominence")
}

/// Mirrors importance.ts `scoreElements`. NOTE: TS's `ScoreFactor.reason`
/// strings are purely internal debugging metadata — they are never
/// serialized into AnalyzeResult (analyze.ts only reads `.score`), so this
/// port does not reproduce their exact text (the byte-parity gate is the
/// numeric `score`/`bounds`/`elementCount` fields only).
func scoreElements(_ elements: [DriverElement], _ viewport: Viewport) -> [ImportanceScore] {
    if elements.isEmpty { return [] }

    var scores: [ImportanceScore] = elements.map { el in
        let factors = [
            scoreRoleFactor(el),
            scorePositionFactor(el, viewport),
            scoreInteractivityFactor(el),
            scoreLabelQualityFactor(el),
            scoreContentDensityFactor(el, elements),
            scoreVisualProminenceFactor(el, viewport),
        ]
        let score = clampUnit(factors.reduce(0.0) { $0 + $1.weight * $1.value })
        return ImportanceScore(elementId: el.id, score: score, factors: factors)
    }

    scores.sort { $0.score > $1.score }
    return scores
}

/// Mirrors importance.ts `findRegions` (union-find clustering of high-scoring
/// elements). Iterates in `scores`' pre-sorted (already score-descending)
/// order rather than through a Swift `Set`, to preserve the same insertion
/// order JS's `new Set(...)` (and `Map`) would produce — matters for stable
/// tie-break ordering of same-score regions.
func findRegions(_ scores: [ImportanceScore], _ elements: [DriverElement]) -> [RegionOfInterest] {
    let elemMap = Dictionary(uniqueKeysWithValues: elements.map { ($0.id, $0) })

    var seenHigh = Set<String>()
    var highEls: [DriverElement] = []
    for s in scores where s.score >= 0.4 {
        guard seenHigh.insert(s.elementId).inserted, let el = elemMap[s.elementId] else { continue }
        highEls.append(el)
    }
    if highEls.isEmpty { return [] }

    var parent: [String: String] = [:]
    for el in highEls { parent[el.id] = el.id }

    func find(_ id: String) -> String {
        var root = id
        while parent[root] != root { root = parent[root]! }
        var cur = id
        while cur != root { let next = parent[cur]!; parent[cur] = root; cur = next }
        return root
    }
    func union(_ a: String, _ b: String) { parent[find(a)] = find(b) }

    for i in 0..<highEls.count {
        for j in (i + 1)..<highEls.count {
            if edgeDistance(highEls[i], highEls[j]) <= 30 {
                union(highEls[i].id, highEls[j].id)
            }
        }
    }

    var groupOrder: [String] = []
    var groups: [String: [String]] = [:]
    for el in highEls {
        let root = find(el.id)
        if groups[root] == nil { groupOrder.append(root) }
        groups[root, default: []].append(el.id)
    }

    let scoreMap = Dictionary(uniqueKeysWithValues: scores.map { ($0.elementId, $0.score) })

    var regions: [RegionOfInterest] = []
    for root in groupOrder {
        let memberIds = groups[root]!
        let members = memberIds.compactMap { elemMap[$0] }
        let bb = boundingBox(members)
        let avgScore = memberIds.reduce(0.0) { $0 + (scoreMap[$1] ?? 0) } / Double(memberIds.count)
        regions.append(RegionOfInterest(bounds: bb, score: avgScore, elements: memberIds, label: regionLabel(members)))
    }

    return regions.sorted { $0.score > $1.score }
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - spatial.ts (edgeDistance, regionLabel, boundingBox, clusterElements)
// ═══════════════════════════════════════════════════════════════════════════

func edgeDistance(_ a: DriverElement, _ b: DriverElement) -> Double {
    let dx = max(0, max(a.bounds.x, b.bounds.x) - min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width))
    let dy = max(0, max(a.bounds.y, b.bounds.y) - min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height))
    return (dx * dx + dy * dy).squareRoot()
}

func regionLabel(_ members: [DriverElement]) -> String {
    let roles = Set(members.map { $0.role })
    if roles.contains("link") || roles.contains("menuitem") { return "Navigation" }
    if roles.contains("textbox") { return "Form" }
    if roles.contains("image") { return "Media" }
    if roles.contains("button") { return "Actions" }
    if roles.contains("heading") || roles.contains("text") { return "Content" }
    return "Section"
}

func boundingBox(_ els: [DriverElement]) -> DriverBounds {
    var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
    for el in els {
        minX = min(minX, el.bounds.x)
        minY = min(minY, el.bounds.y)
        maxX = max(maxX, el.bounds.x + el.bounds.width)
        maxY = max(maxY, el.bounds.y + el.bounds.height)
    }
    return DriverBounds(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
}

func clusterElements(_ elements: [DriverElement], _ threshold: Double) -> [(members: [DriverElement], bounds: DriverBounds)] {
    if elements.isEmpty { return [] }

    var parent: [String: String] = [:]
    for el in elements { parent[el.id] = el.id }

    func find(_ id: String) -> String {
        var root = id
        while parent[root] != root { root = parent[root]! }
        var cur = id
        while cur != root { let next = parent[cur]!; parent[cur] = root; cur = next }
        return root
    }
    func union(_ a: String, _ b: String) { parent[find(a)] = find(b) }

    for i in 0..<elements.count {
        for j in (i + 1)..<elements.count {
            if edgeDistance(elements[i], elements[j]) <= threshold {
                union(elements[i].id, elements[j].id)
            }
        }
    }

    var order: [String] = []
    var groups: [String: [DriverElement]] = [:]
    for el in elements {
        let root = find(el.id)
        if groups[root] == nil { order.append(root) }
        groups[root, default: []].append(el)
    }

    return order.map { root in (members: groups[root]!, bounds: boundingBox(groups[root]!)) }
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - states.ts (detectState, createStateTriggers)
// ═══════════════════════════════════════════════════════════════════════════

enum UIState: String { case loading, empty, error, populated, focused, unknown }

struct StateDetection { var state: UIState; var confidence: Double; var indicators: [String] }

private let structuralRolesState: Set<String> = ["group", "generic", "none", "presentation", "separator"]
private let interactiveRolesState: Set<String> = [
    "button", "textbox", "link", "tab", "combobox", "listbox", "checkbox", "radio",
    "menuitem", "option", "searchbox", "spinbutton", "slider",
]

private struct ScoreAccum { var score: Double = 0; var ids: [String] = [] }

private func dedupePreservingOrder(_ ids: [String]) -> [String] {
    var seen = Set<String>()
    var out: [String] = []
    for id in ids where seen.insert(id).inserted { out.append(id) }
    return out
}

/// Mirrors states.ts `detectState` line-for-line.
func detectState(_ snapshot: DriverSnapshot) -> StateDetection {
    let elements = snapshot.elements
    let nonStruct = elements.filter { !structuralRolesState.contains($0.role) }

    var loading = ScoreAccum(), error = ScoreAccum(), empty = ScoreAccum(), populated = ScoreAccum()
    var focusedInteractiveId: String?
    var explicitEmpty = false

    for el in elements {
        let role = el.role.lowercased()
        let label = "\(el.label) \(el.value ?? "")".trimmingCharacters(in: .whitespaces)

        if role == "progressbar" { loading.score += 3; loading.ids.append(el.id) }
        if role.contains("busy") { loading.score += 2; loading.ids.append(el.id) }
        if regexTest("loading|spinner|please wait", label) { loading.score += 2; loading.ids.append(el.id) }
        if regexTest("fetching|retrieving", label) { loading.score += 1; loading.ids.append(el.id) }

        if role == "alert" { error.score += 3; error.ids.append(el.id) }
        if regexTest("error|failed|failure|exception", label) { error.score += 3; error.ids.append(el.id) }
        if regexTest("something went wrong|try again|oops", label) { error.score += 2; error.ids.append(el.id) }
        if role == "status" && regexTest("error|fail", label) { error.score += 2; error.ids.append(el.id) }

        if regexTest("no items|no results|nothing here|empty|no data|nothing to show|add your first", label) {
            empty.score += 3; empty.ids.append(el.id); explicitEmpty = true
        }
        if regexTest("start by|create your first|set up your first", label) {
            empty.score += 2; empty.ids.append(el.id); explicitEmpty = true
        }

        if el.focused && interactiveRolesState.contains(role) {
            focusedInteractiveId = el.id
        }
    }

    if !explicitEmpty && nonStruct.count > 0 && nonStruct.count < 5 {
        let interactiveCount = nonStruct.filter { interactiveRolesState.contains($0.role.lowercased()) }.count
        let hasTextualContent = nonStruct.contains { e in
            regexTest("heading|paragraph|text|listitem|article|image|img", e.role)
                && !e.label.trimmingCharacters(in: .whitespaces).isEmpty
        }
        if interactiveCount == 0 || !hasTextualContent {
            empty.score += 1
            empty.ids.append(contentsOf: nonStruct.prefix(1).map { $0.id })
        }
    }

    if nonStruct.count > 10 {
        populated.score += 2
        populated.ids.append(contentsOf: nonStruct.prefix(3).map { $0.id })
    }

    let distinctRoles = Set(nonStruct.map { $0.role })
    if distinctRoles.count >= 3 {
        populated.score += 1
        var seen = Set<String>()
        for el in nonStruct {
            if !seen.contains(el.role) {
                seen.insert(el.role)
                populated.ids.append(el.id)
                if seen.count >= 3 { break }
            }
        }
    }

    let hasHeading = elements.contains { regexTest("heading", $0.role) }
    let hasContent = elements.contains { regexTest("paragraph|text|listitem|article", $0.role) }
    if hasHeading && hasContent {
        populated.score += 1
        if let heading = elements.first(where: { regexTest("heading", $0.role) }) { populated.ids.append(heading.id) }
        if let content = elements.first(where: { regexTest("paragraph|text|listitem|article", $0.role) }) {
            populated.ids.append(content.id)
        }
    }

    let hasLoadingOrErrorOrEmpty = loading.score > 0 || error.score > 0 || empty.score > 0
    if !hasLoadingOrErrorOrEmpty && !nonStruct.isEmpty {
        populated.score += 1
    }

    let scoresList: [(state: UIState, accum: ScoreAccum)] = [
        (.loading, loading), (.error, error), (.empty, empty), (.populated, populated),
    ]
    let sorted = scoresList.sorted { $0.accum.score > $1.accum.score }
    let winner = sorted[0]
    let runnerUp = sorted[1]

    if winner.accum.score == 0 {
        return StateDetection(state: .unknown, confidence: 0, indicators: [])
    }

    if let focusedInteractiveId, winner.state == .populated {
        let confidence = winner.accum.score / (winner.accum.score + runnerUp.accum.score + 1)
        return StateDetection(
            state: .focused, confidence: confidence,
            indicators: dedupePreservingOrder(winner.accum.ids + [focusedInteractiveId])
        )
    }

    let confidence = winner.accum.score / (winner.accum.score + runnerUp.accum.score + 1)
    return StateDetection(state: winner.state, confidence: confidence, indicators: dedupePreservingOrder(winner.accum.ids))
}

/// Mirrors states.ts `createStateTriggers`: real triggers are CDP-only
/// (`Runtime.evaluate` over a web connection). No G2 conformer (FakeDriver,
/// NativeDriver) ever exposes a CDP connection, so this always returns []
/// — identical to TS's own behavior for `platform !== 'web'` / `conn ===
/// null`, which is EVERY G2 case. discover's `captureStates` flag is
/// therefore always a no-op for macOS/fake sessions, matching upstream.
func createStateTriggers() -> [() -> Void] { [] }

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - PNG IHDR gate (see file header) + CoreGraphics crop/encode
// ═══════════════════════════════════════════════════════════════════════════

enum PngGateError: Error {
    case invalidSignature
    case missingIHDR
    case unsupportedBitDepth(UInt8)
    case unsupportedColorType(UInt8)
    case decodeFailed
    case cropFailed
    case encodeFailed
}

private struct PngIHDRInfo { var width: Int; var height: Int; var bitDepth: UInt8; var colorType: UInt8 }

/// Reproduces src/media/png.ts `decodePng`'s validation gate EXACTLY (8-bit
/// depth; colorType 2=RGB or 6=RGBA only — anything else throws, including
/// colorType 4/grayscale+alpha, which is what fakes.ts's FAKE_PNG_BASE64 is).
/// This is what makes `discover`'s `captures` count byte-parity-correct
/// against the conformance fixture (see file header).
private func parsePngIHDR(_ data: Data) throws -> PngIHDRInfo {
    let sig: [UInt8] = [137, 80, 78, 71, 13, 10, 26, 10]
    let bytes = [UInt8](data)
    guard bytes.count >= 8, Array(bytes.prefix(8)) == sig else { throw PngGateError.invalidSignature }

    var offset = 8
    while offset + 8 <= bytes.count {
        let length = (Int(bytes[offset]) << 24) | (Int(bytes[offset + 1]) << 16)
            | (Int(bytes[offset + 2]) << 8) | Int(bytes[offset + 3])
        offset += 4
        guard offset + 4 <= bytes.count else { break }
        let type = String(bytes: bytes[offset..<offset + 4], encoding: .ascii) ?? ""
        offset += 4

        if type == "IHDR" {
            guard offset + 13 <= bytes.count else { throw PngGateError.missingIHDR }
            let w = (Int(bytes[offset]) << 24) | (Int(bytes[offset + 1]) << 16)
                | (Int(bytes[offset + 2]) << 8) | Int(bytes[offset + 3])
            let h = (Int(bytes[offset + 4]) << 24) | (Int(bytes[offset + 5]) << 16)
                | (Int(bytes[offset + 6]) << 8) | Int(bytes[offset + 7])
            let bitDepth = bytes[offset + 8]
            let colorType = bytes[offset + 9]
            if bitDepth != 8 { throw PngGateError.unsupportedBitDepth(bitDepth) }
            if colorType != 2 && colorType != 6 { throw PngGateError.unsupportedColorType(colorType) }
            return PngIHDRInfo(width: w, height: h, bitDepth: bitDepth, colorType: colorType)
        }
        if type == "IEND" { break }
        offset += length + 4 // skip chunk data + CRC
    }
    throw PngGateError.missingIHDR
}

private func cropPngViaCoreGraphics(_ data: Data, x: Double, y: Double, w: Double, h: Double) throws -> Data {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw PngGateError.decodeFailed
    }
    let rect = CGRect(x: x, y: y, width: max(1, w), height: max(1, h))
    guard let cropped = cgImage.cropping(to: rect) else { throw PngGateError.cropFailed }

    let mutableData = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(mutableData, UTType.png.identifier as CFString, 1, nil) else {
        throw PngGateError.encodeFailed
    }
    CGImageDestinationAddImage(dest, cropped, nil)
    guard CGImageDestinationFinalize(dest) else { throw PngGateError.encodeFailed }
    return mutableData as Data
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - framing.ts (frame)
// ═══════════════════════════════════════════════════════════════════════════

struct FrameOptions {
    var target: String? // "element" | "region" | "viewport" | "fullpage" | nil (auto)
    var elementId: String?
    var regionIndex: Int?
    var aspectRatio: Double?
    var padding: Double?

    init(
        target: String? = nil, elementId: String? = nil, regionIndex: Int? = nil,
        aspectRatio: Double? = nil, padding: Double? = nil
    ) {
        self.target = target
        self.elementId = elementId
        self.regionIndex = regionIndex
        self.aspectRatio = aspectRatio
        self.padding = padding
    }
}

struct FrameResult { var crop: DriverBounds; var buffer: Data; var label: String }

private func clampRect(
    _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ imgW: Double, _ imgH: Double
) -> (Double, Double, Double, Double) {
    let x0 = max(0, min(x, imgW))
    let y0 = max(0, min(y, imgH))
    let x1 = max(x0, min(x + w, imgW))
    let y1 = max(y0, min(y + h, imgH))
    return (x0, y0, x1 - x0, y1 - y0)
}

private func applyPadding(
    _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ padding: Double, _ imgW: Double, _ imgH: Double
) -> (Double, Double, Double, Double) {
    clampRect(x - padding, y - padding, w + padding * 2, h + padding * 2, imgW, imgH)
}

private func applyAspectRatio(
    _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ targetRatio: Double, _ imgW: Double, _ imgH: Double
) -> (Double, Double, Double, Double) {
    let currentRatio = w / h
    var nx = x, ny = y, nw = w, nh = h

    if currentRatio < targetRatio {
        nw = h * targetRatio
        nx = x + (w - nw) / 2
    } else if currentRatio > targetRatio {
        nh = w / targetRatio
        ny = y + (h - nh) / 2
    }

    let rnx = nx.rounded(), rny = ny.rounded(), rnw = nw.rounded(), rnh = nh.rounded()
    let cx0 = max(0, min(rnx, imgW))
    let cy0 = max(0, min(rny, imgH))
    let cx1 = max(cx0, min(rnx + rnw, imgW))
    let cy1 = max(cy0, min(rny + rnh, imgH))

    var fw = cx1 - cx0
    var fh = cy1 - cy0

    if fh > 0 && fw > 0 {
        let clampedRatio = fw / fh
        if abs(clampedRatio - targetRatio) > 0.01 {
            if clampedRatio > targetRatio {
                fw = (fh * targetRatio).rounded()
            } else {
                fh = (fw / targetRatio).rounded()
            }
        }
    }

    return (cx0, cy0, fw, fh)
}

/// Mirrors framing.ts `frame`. Throws `PngGateError` when the screenshot's
/// PNG color type/bit depth isn't one TS's decoder supports — callers
/// (DiscoverOps.swift) must catch-and-skip, exactly like discover.ts's own
/// try/catch around this call.
func frame(
    screenshot: Data,
    scores: [ImportanceScore],
    elements: [DriverElement],
    options: FrameOptions = FrameOptions()
) throws -> FrameResult {
    let ihdr = try parsePngIHDR(screenshot)
    let imgW = Double(ihdr.width), imgH = Double(ihdr.height)

    let padding = options.padding ?? 16
    let elemMap = Dictionary(uniqueKeysWithValues: elements.map { ($0.id, $0) })

    var cropX = 0.0, cropY = 0.0, cropW = imgW, cropH = imgH
    var labelElements = elements

    switch options.target {
    case "viewport", "fullpage":
        cropX = 0; cropY = 0; cropW = imgW; cropH = imgH
        labelElements = elements

    case "element":
        if let id = options.elementId, let el = elemMap[id] {
            (cropX, cropY, cropW, cropH) = applyPadding(el.bounds.x, el.bounds.y, el.bounds.width, el.bounds.height, padding, imgW, imgH)
            labelElements = [el]
        }

    case "region":
        let regions = findRegions(scores, elements)
        var region: RegionOfInterest?
        if let idx = options.regionIndex, regions.indices.contains(idx) {
            region = regions[idx]
        } else {
            region = regions.first
        }
        if let region {
            (cropX, cropY, cropW, cropH) = applyPadding(region.bounds.x, region.bounds.y, region.bounds.width, region.bounds.height, padding, imgW, imgH)
            labelElements = region.elements.compactMap { elemMap[$0] }
        }

    default:
        // Auto: elements scoring >= 0.5, else top 25% by score, else full frame.
        var qualifying = scores.filter { $0.score >= 0.5 }.compactMap { elemMap[$0.elementId] }
        if qualifying.isEmpty {
            let sorted = scores.sorted { $0.score > $1.score }
            let top25Count = max(1, Int((Double(sorted.count) * 0.25).rounded(.up)))
            qualifying = sorted.prefix(top25Count).compactMap { elemMap[$0.elementId] }
        }
        if qualifying.isEmpty {
            cropX = 0; cropY = 0; cropW = imgW; cropH = imgH
            labelElements = elements
        } else {
            let bb = boundingBox(qualifying)
            (cropX, cropY, cropW, cropH) = applyPadding(bb.x, bb.y, bb.width, bb.height, padding, imgW, imgH)
            labelElements = qualifying
        }
    }

    if let ar = options.aspectRatio, ar > 0 {
        (cropX, cropY, cropW, cropH) = applyAspectRatio(cropX, cropY, cropW, cropH, ar, imgW, imgH)
    }

    cropW = max(1, cropW)
    cropH = max(1, cropH)

    let cropped = try cropPngViaCoreGraphics(screenshot, x: cropX, y: cropY, w: cropW, h: cropH)

    return FrameResult(
        crop: DriverBounds(x: cropX, y: cropY, width: cropW, height: cropH),
        buffer: cropped,
        label: regionLabel(labelElements)
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - navigation.ts (crawl, fingerprint, screenId, hasSensitiveContent,
//         rankNavigationCandidates, discoverByScroll)
// ═══════════════════════════════════════════════════════════════════════════

struct ScreenNode {
    var id: String
    var url: String?
    var appName: String?
    var screenshot: Data
    var importance: Double
    var visited: Bool
    var sensitiveContent: Bool?
}

struct NavigationEdgeAction { var elementId: String; var type: DriverActionType; var label: String }
struct NavigationEdge { var from: String; var to: String; var action: NavigationEdgeAction }

/// Mirrors navigation.ts's TS `Map<string, ScreenNode>` (insertion-ordered) —
/// `nodes` gives O(1) lookup, `nodeOrder` preserves the order DiscoverOps.swift
/// must iterate in to match `for (const [id, node] of graph.nodes)`.
struct NavigationGraph {
    var nodes: [String: ScreenNode] = [:]
    var nodeOrder: [String] = []
    var edges: [NavigationEdge] = []
    var root: String
    var snapshotCache: [String: (snapshot: DriverSnapshot, screenshot: Data)] = [:]
}

struct CrawlOptions {
    var maxDepth = 3
    var maxScreens = 50
    var scrollDiscover = true
    var captureEach = true
    var changeThreshold = 0.15
    var allowExternal = false
    var allowFormSubmit = false
}

private let sensitivePatterns = "password|secret|token|api.?key|credit.?card|ssn|social.?security"
private let structuralRolesNav: Set<String> = ["group", "generic", "none", "presentation", "separator"]
private let navigableRoles: Set<String> = ["link", "button", "tab", "menuitem", "checkbox", "radio", "switch", "combobox", "option"]
private let defaultViewport = Viewport(width: 1280, height: 800, devicePixelRatio: 1)

/// A wrapping FNV-1a-style hash — used ONLY as an internal dedup fingerprint
/// (never serialized into any of the 6 ops' wire JSON result fields), so
/// exact bit-parity with TS's own `(hash * prime) >>> 0` (which itself
/// silently loses precision above 2^53 in JS's float multiply — a known TS
/// quirk) is not required. This is a clean 32-bit wrapping multiply.
private func simpleHash(_ str: String) -> String {
    var hash: UInt32 = 0x811c9dc5
    for unit in str.utf16 {
        hash ^= UInt32(unit)
        hash = hash &* 0x0100_0193
    }
    return String(hash, radix: 36)
}

private func bucket(_ value: Double) -> Int { Int((value / 48).rounded()) }

private func normalizeLabelNav(_ label: String) -> String {
    var s = label.lowercased().trimmingCharacters(in: .whitespaces)
    s = replaceAllRegex("\\s+", " ", s)
    s = replaceAllRegex("[a-f0-9]{8}-[a-f0-9-]{27,}", "{uuid}", s)
    s = replaceAllRegex("\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b", "{time}", s)
    s = replaceAllRegex("\\b\\d{4,}\\b", "{number}", s)
    return s
}

private func stableElementToken(_ el: DriverElement) -> String? {
    let role = normalizeRole(el.role)
    let label = normalizeLabelNav(el.label)
    let value = normalizeLabelNav(el.value ?? "")
    if label.isEmpty && value.isEmpty && structuralRolesNav.contains(role) { return nil }

    let w = el.bounds.width, h = el.bounds.height
    let boundsStr = (w > 0 && h > 0)
        ? "\(bucket(el.bounds.x)):\(bucket(el.bounds.y)):\(bucket(w)):\(bucket(h))"
        : ""
    return "\(role):\(label):\(value):\(boundsStr)"
}

func fingerprint(_ snapshot: DriverSnapshot) -> String {
    let pairs = snapshot.elements.compactMap(stableElementToken).sorted()
    return simpleHash(pairs.joined(separator: "|"))
}

private func screenId(_ snapshot: DriverSnapshot) -> String {
    let fp = fingerprint(snapshot)
    if let url = snapshot.url, !url.isEmpty { return "\(url):\(fp)" }
    if let appName = snapshot.appName, !appName.isEmpty { return "\(appName):\(fp)" }
    return fp
}

func hasSensitiveContent(_ snapshot: DriverSnapshot) -> Bool {
    snapshot.elements.contains { el in
        (el.role == "textbox" || el.role == "input") && regexTest(sensitivePatterns, el.label)
    }
}

private func isExternalUrl(_ label: String, _ currentUrl: String?) -> Bool {
    guard label.hasPrefix("http://") || label.hasPrefix("https://") else { return false }
    guard let currentUrl, !currentUrl.isEmpty else { return true }
    guard let current = URL(string: currentUrl), let target = URL(string: label),
          let currentHost = current.host, let targetHost = target.host else { return false }
    return currentHost != targetHost
}

private func averageImportance(_ snapshot: DriverSnapshot) -> Double {
    if snapshot.elements.isEmpty { return 0 }
    let scores = scoreElements(snapshot.elements, defaultViewport)
    if scores.isEmpty { return 0 }
    return scores.reduce(0.0) { $0 + $1.score } / Double(scores.count)
}

private func navigationScore(_ element: DriverElement, _ scoreById: [String: Double]) -> Double {
    let role = normalizeRole(element.role)
    let x = element.bounds.x, y = element.bounds.y, w = element.bounds.width, h = element.bounds.height
    let importance = scoreById[element.id] ?? 0
    let roleBonus: Double = role == "tab" ? 0.35 : (role == "link" || role == "menuitem") ? 0.3 : role == "button" ? 0.2 : 0.1
    let navZoneBonus: Double = (y <= 160 || x <= 240) ? 0.15 : 0
    let sizePenalty: Double = (w * h > 300_000) ? 0.1 : 0
    return importance + roleBonus + navZoneBonus - sizePenalty
}

/// Mirrors navigation.ts `rankNavigationCandidates`.
private func rankNavigationCandidates(_ elements: [DriverElement], _ snapshot: DriverSnapshot) -> [DriverElement] {
    let scoreById = Dictionary(uniqueKeysWithValues: scoreElements(snapshot.elements, defaultViewport).map { ($0.elementId, $0.score) })
    let originalIndex = Dictionary(uniqueKeysWithValues: snapshot.elements.enumerated().map { ($0.element.id, $0.offset) })

    return elements.sorted { a, b in
        let sa = navigationScore(a, scoreById)
        let sb = navigationScore(b, scoreById)
        if sa != sb { return sa > sb }
        return (originalIndex[a.id] ?? 0) < (originalIndex[b.id] ?? 0)
    }
}

/// Mirrors navigation.ts `discoverByScroll`. Return value is discarded by
/// `crawl` (matches the TS caller, which only uses this for its
/// side-effecting scroll actions + the re-fetched post-scroll snapshot).
@discardableResult
func discoverByScroll(driver: Driver, maxScrolls: Int = 20) -> [ScreenNode] {
    var discovered: [ScreenNode] = []
    guard var currentSnapshot = try? driver.snapshot() else { return [] }
    var prevElementCount = currentSnapshot.elements.count
    var prevFp = fingerprint(currentSnapshot)
    var noNewCount = 0

    for _ in 0..<maxScrolls {
        let scrollTarget = currentSnapshot.elements.first { $0.actions.contains("scroll") }
            ?? currentSnapshot.elements.first { !$0.actions.isEmpty }
        guard let scrollTarget else { break }

        do {
            _ = try driver.act(elementId: scrollTarget.id, action: .scroll, value: "500")
        } catch {
            break
        }

        guard let newSnapshot = try? driver.snapshot() else { break }
        let newFp = fingerprint(newSnapshot)
        if newFp == prevFp { break }

        let newCount = newSnapshot.elements.count
        if newCount <= prevElementCount {
            noNewCount += 1
            if noNewCount >= 3 { break }
        } else {
            noNewCount = 0
            let screenshot = (try? driver.screenshot()) ?? Data()
            let sensitive = hasSensitiveContent(newSnapshot)
            discovered.append(ScreenNode(
                id: screenId(newSnapshot), url: newSnapshot.url, appName: newSnapshot.appName,
                screenshot: sensitive ? Data() : screenshot,
                importance: averageImportance(newSnapshot), visited: false,
                sensitiveContent: sensitive ? true : nil
            ))
        }

        prevElementCount = newCount
        prevFp = newFp
        currentSnapshot = newSnapshot
    }

    return discovered
}

/// Mirrors navigation.ts `crawl`. Entirely driver-only (snapshot/act/
/// screenshot + the documented `navigate` no-op) — never touches a CDP
/// connection, matches DriverProtocol.swift's frozen surface exactly. A
/// `snapshot()`/`screenshot()` failure at the ROOT degrades to an empty
/// graph rather than throwing (graceful degradation — mirrors the plan's
/// fail-open default; TS's crawl has no equivalent root-level guard, but an
/// unreachable driver at the very first call is exactly the kind of
/// infra-level failure DriverProtocol.swift documents as `throws`-worthy,
/// and a `discover` on a dead session should degrade to "0 screens found",
/// not 500 the whole request).
func crawl(driver: Driver, options: CrawlOptions = CrawlOptions()) -> NavigationGraph {
    guard let rootSnapshot = try? driver.snapshot(), let rootScreenshot = try? driver.screenshot() else {
        return NavigationGraph(root: "")
    }

    let rootId = screenId(rootSnapshot)
    let rootSensitive = hasSensitiveContent(rootSnapshot)

    var graph = NavigationGraph(root: rootId)
    graph.nodes[rootId] = ScreenNode(
        id: rootId, url: rootSnapshot.url, appName: rootSnapshot.appName,
        screenshot: rootSensitive ? Data() : rootScreenshot,
        importance: averageImportance(rootSnapshot), visited: false,
        sensitiveContent: rootSensitive ? true : nil
    )
    graph.nodeOrder.append(rootId)

    var fingerprintToNode: [String: String] = [fingerprint(rootSnapshot): rootId]
    var snapshotCache: [String: (snapshot: DriverSnapshot, screenshot: Data)] = [rootId: (rootSnapshot, rootScreenshot)]

    var queue: [(nodeId: String, depth: Int)] = [(rootId, 0)]

    while !queue.isEmpty && graph.nodes.count < options.maxScreens {
        let item = queue.removeFirst()
        guard var node = graph.nodes[item.nodeId] else { continue }
        if node.visited { continue }
        node.visited = true
        graph.nodes[item.nodeId] = node

        guard let cached = snapshotCache[item.nodeId] else { continue }
        let currentSnapshot = cached.snapshot
        let currentScreenshot = cached.screenshot
        let currentUrl = currentSnapshot.url

        // `driver.navigate(url:)` is a documented no-op for every G2
        // conformer (DriverProtocol.swift's frozen extension default) —
        // called here purely for parity with crawl()'s own re-navigate step;
        // has no observable effect against FakeDriver/NativeDriver.
        if let currentUrl, !currentUrl.isEmpty {
            try? driver.navigate(url: currentUrl)
        }

        var scrollSnapshot = currentSnapshot
        if options.scrollDiscover {
            discoverByScroll(driver: driver)
            scrollSnapshot = (try? driver.snapshot()) ?? currentSnapshot
        }

        var actionByElementId: [String: ActionSelection] = [:]
        let navigableElements = scrollSnapshot.elements.filter { el -> Bool in
            let role = normalizeRole(el.role)
            guard navigableRoles.contains(role) else { return false }
            guard isElementVisible(el) else { return false }
            if role == "link" && !options.allowExternal, isExternalUrl(el.label, currentUrl) { return false }
            if regexTest(sensitivePatterns, el.label) { return false }
            guard let selected = selectActionForElement(
                el, options: ActionSelectionOptions(purpose: .navigation, allowFormSubmit: options.allowFormSubmit)
            ) else { return false }
            actionByElementId[el.id] = selected
            return true
        }

        let candidates = Array(rankNavigationCandidates(navigableElements, scrollSnapshot).prefix(20))

        for el in candidates {
            if graph.nodes.count >= options.maxScreens { break }
            let selected = actionByElementId[el.id] ?? selectActionForElement(
                el, options: ActionSelectionOptions(purpose: .navigation, allowFormSubmit: options.allowFormSubmit)
            )
            guard let selected else { continue }

            let actResult: DriverActResult
            do {
                actResult = try driver.act(elementId: el.id, action: selected.action, value: selected.value)
            } catch {
                continue
            }
            if !actResult.success { continue }

            let newSnapshot = actResult.snapshot
            let newScreenshot = (try? driver.screenshot()) ?? Data()
            let newFp = fingerprint(newSnapshot)
            let newId = screenId(newSnapshot)

            if let existingId = fingerprintToNode[newFp] {
                let edgeExists = graph.edges.contains {
                    $0.from == item.nodeId && $0.to == existingId && $0.action.elementId == el.id
                }
                if !edgeExists {
                    graph.edges.append(NavigationEdge(
                        from: item.nodeId, to: existingId,
                        action: NavigationEdgeAction(elementId: el.id, type: selected.action, label: el.label)
                    ))
                }
                continue // backtrack is a no-op (see navigate() note above)
            }

            let change = detectChange(before: currentScreenshot, after: newScreenshot, beforeSnap: currentSnapshot, afterSnap: newSnapshot, threshold: options.changeThreshold)
            if change.score < options.changeThreshold {
                continue
            }

            let newSensitive = hasSensitiveContent(newSnapshot)
            graph.nodes[newId] = ScreenNode(
                id: newId, url: newSnapshot.url, appName: newSnapshot.appName,
                screenshot: newSensitive ? Data() : newScreenshot,
                importance: averageImportance(newSnapshot), visited: false,
                sensitiveContent: newSensitive ? true : nil
            )
            graph.nodeOrder.append(newId)
            fingerprintToNode[newFp] = newId
            snapshotCache[newId] = (newSnapshot, newScreenshot)

            graph.edges.append(NavigationEdge(
                from: item.nodeId, to: newId,
                action: NavigationEdgeAction(elementId: el.id, type: selected.action, label: el.label)
            ))

            if item.depth + 1 < options.maxDepth {
                queue.append((newId, item.depth + 1))
            }
        }
    }

    graph.snapshotCache = snapshotCache
    return graph
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - change.ts (detectChange, diffSnapshots, perceptualHash, hashDistance)
// ═══════════════════════════════════════════════════════════════════════════

struct ChangeDetail { var kind: String; var elementId: String?; var description: String }
struct ChangeResult { var changed: Bool; var score: Double; var type: String; var details: [ChangeDetail] }

private func elementKeyChange(_ el: DriverElement) -> String { "\(el.role):\(el.label)" }

/// Mirrors change.ts `diffSnapshots`. Iteration order over `beforeMap`/
/// `afterMap` is undefined here (Swift Dictionary vs. JS Map) — harmless,
/// since only the AGGREGATE `score`/`type` are consumed by `crawl`'s
/// threshold check; `details`' order is never read by any of the 6 ops.
func diffSnapshots(before: DriverSnapshot, after: DriverSnapshot) -> ChangeResult {
    var beforeMap: [String: DriverElement] = [:]
    for el in before.elements { beforeMap[elementKeyChange(el)] = el }
    var afterMap: [String: DriverElement] = [:]
    for el in after.elements { afterMap[elementKeyChange(el)] = el }

    var details: [ChangeDetail] = []
    var addedCount = 0, removedCount = 0, changedCount = 0

    for (key, el) in afterMap where beforeMap[key] == nil {
        addedCount += 1
        details.append(ChangeDetail(kind: "added", elementId: el.id, description: "Element added: \(key)"))
    }
    for (key, el) in beforeMap where afterMap[key] == nil {
        removedCount += 1
        details.append(ChangeDetail(kind: "removed", elementId: el.id, description: "Element removed: \(key)"))
    }
    for (key, afterEl) in afterMap {
        guard let beforeEl = beforeMap[key] else { continue }
        let boundsDiff = abs(afterEl.bounds.x - beforeEl.bounds.x) > 5
            || abs(afterEl.bounds.y - beforeEl.bounds.y) > 5
            || abs(afterEl.bounds.width - beforeEl.bounds.width) > 5
            || abs(afterEl.bounds.height - beforeEl.bounds.height) > 5
        if boundsDiff {
            details.append(ChangeDetail(kind: "moved", elementId: afterEl.id, description: "Element moved: \(key)"))
            changedCount += 1
        } else if afterEl.value != beforeEl.value || afterEl.enabled != beforeEl.enabled || afterEl.focused != beforeEl.focused {
            changedCount += 1
            details.append(ChangeDetail(kind: "changed", elementId: afterEl.id, description: "Element changed: \(key)"))
        }
    }

    let total = addedCount + removedCount + changedCount
    let denominator = Double(max(before.elements.count, after.elements.count, 1))
    let score = Double(total) / denominator

    let type: String
    if score == 0 { type = "none" }
    else if score < 0.1 { type = "minor" }
    else if score < 0.5 { type = "significant" }
    else { type = "navigation" }

    return ChangeResult(changed: score > 0, score: score, type: type, details: details)
}

/// Approximates change.ts's `perceptualHash` (9x8 nearest-resize -> grayscale
/// -> row-difference hash) via CoreGraphics instead of hand-rolled resize/
/// grayscale loops. NOT exercised by the FakeDriver conformance path at all
/// (FakeDriver's static element tree always dedups by fingerprint before
/// `detectChange` is ever reached — see crawl() above), so this is
/// unreachable in the byte-parity gate; ⚠️ untested against a real NativeDriver
/// screenshot in this pass. Falls back to snapshot-only diffing if the PNG
/// can't be decoded, matching this file's graceful-degradation policy.
private func perceptualHash(_ pngData: Data) throws -> UInt64 {
    guard let source = CGImageSourceCreateWithData(pngData as CFData, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw PngGateError.decodeFailed
    }
    let w = 9, h = 8
    guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else {
        throw PngGateError.decodeFailed
    }
    ctx.interpolationQuality = .none
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let data = ctx.data else { throw PngGateError.decodeFailed }
    let pixels = data.bindMemory(to: UInt8.self, capacity: w * h)

    var hash: UInt64 = 0
    for y in 0..<8 {
        for x in 0..<8 {
            let bit: UInt64 = pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0
            hash = (hash << 1) | bit
        }
    }
    return hash
}

private func hashDistance(_ a: UInt64, _ b: UInt64) -> Int { (a ^ b).nonzeroBitCount }

/// Mirrors change.ts `detectChange`.
func detectChange(
    before beforeBuffer: Data, after afterBuffer: Data,
    beforeSnap: DriverSnapshot, afterSnap: DriverSnapshot,
    threshold: Double = 0.05
) -> ChangeResult {
    guard let beforeHash = try? perceptualHash(beforeBuffer), let afterHash = try? perceptualHash(afterBuffer) else {
        // Undecodable PNG can't gate on pixel diff — fall back to the
        // snapshot-only diff so a real structural change is never silently
        // dropped just because a screenshot couldn't be decoded.
        return diffSnapshots(before: beforeSnap, after: afterSnap)
    }
    if hashDistance(beforeHash, afterHash) < 5 {
        return ChangeResult(changed: false, score: 0, type: "none", details: [])
    }
    var result = diffSnapshots(before: beforeSnap, after: afterSnap)
    if result.score < threshold {
        result.changed = false
    }
    return result
}
