// macos/Spectra/DaemonCore/CaptureOps.swift
//
// M3.G2 — S4 (media-recording), F-13. `screenshot` handler: modes
// full/element/region/auto, mirroring src/mcp/tools/capture.ts
// handleCapture's `type: 'screenshot'` branch + src/media/capture.ts's
// screenshot() helper + src/media/presets.ts's preset-default resolution.
//
// Driver-agnostic by construction (PC-4): every mode calls
// `ctx.driverRegistry.get(sessionId)` and works identically against
// FakeDriver (S1) or NativeDriver (S2) — the frozen `Driver.screenshot()`
// contract (DriverProtocol.swift) guarantees "decodable, non-empty PNG
// bytes, or throws" for BOTH conformers, which is exactly what makes this
// file headless-safe: FakeDriver's fixed-PNG stub decodes/dimensions-checks
// the same way a real NativeDriver capture would (the pre-ruled
// `generated-image-content` V-B class — decode + dimensions, not bytes).
//
// SCOPE NOTE (flagged for orchestrator review, not hidden): TS's
// element/region/auto modes score+frame via src/intelligence/{importance,
// framing}.ts, which is S3's port (Intelligence.swift/AnalyzeOps.swift —
// S4 does not own those files and they do not exist yet at G2 build time,
// so this file cannot link against them without reopening a file-ownership
// boundary the W0 freeze did not grant). This handler instead does a
// SELF-CONTAINED, Driver.snapshot()-only approximation:
//   - element: crop to the named element's frozen `DriverBounds` (exact
//     parity with TS — capture.ts's element branch is ALSO just a bounds
//     crop, no scoring involved).
//   - region: best-effort match against snapshot element role/label text
//     (TS's real findRegions() groups elements into semantic regions via
//     importance scoring — not available here) — never fails hard; falls
//     through to a full-frame result with the region string as its label.
//   - auto: full-frame passthrough (TS's real auto-framing needs the same
//     importance/framing port). Graceful degradation over a hard failure,
//     per the plan's stated design bias.
// TODO(iteration N, post-S3-merge): once Intelligence.swift/AnalyzeOps.swift
// land, swap region/auto over to the real scoreElements/findRegions/frame
// pipeline for true parity; element mode needs no change.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
import CoreGraphics
import ImageIO

// ─── Capture presets (mirrors src/media/presets.ts CAPTURE_PRESETS, the
//     `screenshot` half only — `recording` half is RecordingOps.swift's) ────

private struct ScreenshotPresetDefaults {
    var mode: String
    var aspectRatio: String?
    var clean: Bool
    var quality: String?
}

private let capturePresetScreenshotDefaults: [String: ScreenshotPresetDefaults] = [
    "docs": ScreenshotPresetDefaults(mode: "auto", aspectRatio: "16:9", clean: true, quality: "lossless"),
    "demo": ScreenshotPresetDefaults(mode: "full", aspectRatio: "16:9", clean: true, quality: "high"),
    "social": ScreenshotPresetDefaults(mode: "auto", aspectRatio: "9:16", clean: true, quality: "high"),
    "app-store": ScreenshotPresetDefaults(mode: "full", aspectRatio: "16:9", clean: true, quality: "high"),
]

/// All 4 CAPTURE_PRESETS entries are `productionReady: true` today (src/media/
/// presets.ts) — kept as its own lookup (not folded into the bool literal
/// above) so a future non-production preset only needs a one-line edit here.
private let capturePresetProductionReady: Set<String> = ["docs", "demo", "social", "app-store"]

private struct ResolvedScreenshotOptions {
    var preset: String?
    var productionReady: Bool?
    var mode: String
    var aspectRatio: String?
    var clean: Bool
    var quality: String?
}

/// Mirrors src/media/presets.ts resolveScreenshotCaptureOptions().
private func resolveScreenshotCaptureOptions(_ dict: [String: Any]) -> ResolvedScreenshotOptions {
    let preset = dict["preset"] as? String
    let defaults = preset.flatMap { capturePresetScreenshotDefaults[$0] }
    return ResolvedScreenshotOptions(
        preset: preset,
        productionReady: preset.map { capturePresetProductionReady.contains($0) },
        mode: (dict["mode"] as? String) ?? defaults?.mode ?? "full",
        aspectRatio: (dict["aspectRatio"] as? String) ?? defaults?.aspectRatio,
        clean: (dict["clean"] as? Bool) ?? defaults?.clean ?? true,
        quality: (dict["quality"] as? String) ?? defaults?.quality
    )
}

/// Parses "16:9"/"4:3" into a numeric w/h ratio. Mirrors capture.ts
/// parseAspectRatio() — kept for metadata fidelity even though this port's
/// simplified auto/region path doesn't yet apply it to the actual crop (see
/// the scope note above).
private func parseAspectRatio(_ value: String) -> Double? {
    let parts = value.split(separator: ":")
    guard parts.count == 2, let w = Double(parts[0]), let h = Double(parts[1]), h != 0, w.isFinite, h.isFinite else {
        return nil
    }
    return w / h
}

// ─── PNG decode/crop/encode via CoreGraphics/ImageIO — headless-safe: no
//     GUI session, no ScreenCaptureKit, no AppKit dependency required for
//     any of these three operations. ───────────────────────────────────────

enum CaptureImageOps {
    static func decodePNG(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    static func encodePNG(_ image: CGImage) -> Data? {
        let output = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(output, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return output as Data
    }

    /// Crops to `[x, y, width, height]`, clamped to the source image's actual
    /// bounds (a stale/out-of-range element bounds value must degrade to a
    /// safe crop, never a crash — mirrors the plan's structural-floor note in
    /// DriverProtocol.swift: bounds correctness is a V-B FINDING, not a
    /// daemon-crash condition).
    static func crop(_ image: CGImage, bounds: DriverBounds) -> CGImage? {
        let imgW = Double(image.width)
        let imgH = Double(image.height)
        guard imgW > 0, imgH > 0 else { return nil }
        let x = min(max(bounds.x, 0), imgW - 1)
        let y = min(max(bounds.y, 0), imgH - 1)
        let width = min(max(bounds.width, 1), imgW - x)
        let height = min(max(bounds.height, 1), imgH - y)
        let rect = CGRect(x: x, y: y, width: width, height: height)
        return image.cropping(to: rect)
    }
}

// ─── op registration ───────────────────────────────────────────────────────

/// Registers ONLY the `screenshot` op. Bundled into the single frozen
/// `registerCaptureRecordingOps` hook (W0 §5) by RecordingOps.swift — that
/// file owns the exported free function (a free function can only be
/// defined once); this one stays an internal helper it calls.
func registerScreenshotOp(_ registry: HandlerRegistry) {
    registry.register("screenshot", capabilities: [.mediaCapture]) { params, ctx in
        try handleScreenshot(params, ctx)
    }
}

private func handleScreenshot(_ params: Any?, _ ctx: DaemonContext) throws -> Any {
    let dict = params as? [String: Any] ?? [:]
    guard let sessionId = dict["sessionId"] as? String, !sessionId.isEmpty else {
        throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
    }
    // Mirrors capture.ts:73 `const driver = ctx.drivers.get(...); if (!driver)
    // throw ...` — a DriverRegistry miss for a session that DOES exist in
    // SessionStore is a ROUTING fact the Router resolves before dispatch
    // (DriverProtocol.swift §2); reaching here with a miss means the session
    // itself doesn't exist (or was never native), so not_found is correct.
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }

    let opts = resolveScreenshotCaptureOptions(dict)
    let elementId = dict["elementId"] as? String
    let region = dict["region"] as? String
    let aspectRatioValue = opts.aspectRatio.flatMap(parseAspectRatio)
    _ = aspectRatioValue // reserved for the real intelligence-framing port (see scope note)

    // `clean` is CDP-only (src/media/clean.ts targets a CDP connection) —
    // native/fake sessions have no such connection, so cleanApplied is always
    // false here, NEVER an error (matches the plan's explicit F-13 rule).
    let cleanApplied = false

    let sessionDir = ctx.sessions.sessionDir(sessionId)
    try FileManager.default.createDirectory(atPath: sessionDir, withIntermediateDirectories: true)

    func writeArtifactAndBuild(path: String, filename: String, buffer: Data, mode: String, crop: [Double]?, label: String?) throws -> [String: Any] {
        try buffer.write(to: URL(fileURLWithPath: path))

        var metadata: [String: Any] = ["mode": mode]
        if let crop { metadata["crop"] = crop }
        if let preset = opts.preset { metadata["preset"] = preset }
        if let aspectRatio = opts.aspectRatio { metadata["aspectRatio"] = aspectRatio }
        if let quality = opts.quality { metadata["quality"] = quality }
        if let productionReady = opts.productionReady { metadata["productionReady"] = productionReady }

        var artifact = SpectraCaptureRunArtifact(
            id: "artifact-\(UUID().uuidString.prefix(8))",
            type: "screenshot",
            path: filename,
            createdAt: JSON.nowMillis()
        )
        artifact.format = "png"
        artifact.label = label ?? "Full screen"
        artifact.metadata = metadata
        try ctx.sessions.addArtifact(sessionId: sessionId, artifact: artifact)

        var result: [String: Any] = ["path": path, "format": "png", "cleanApplied": cleanApplied]
        if let preset = opts.preset { result["preset"] = preset }
        if let crop { result["crop"] = crop }
        if let label, mode != "full" { result["label"] = label }
        return result
    }

    // Full-frame path — mirrors capture.ts:100 condition exactly: explicit
    // mode=='full', OR no elementId/region given and mode isn't 'auto'.
    if opts.mode == "full" || (elementId == nil && region == nil && opts.mode != "auto") {
        let raw: Data
        do {
            raw = try driver.screenshot()
        } catch {
            throw DaemonApiError(.internalError, "screenshot failed: \(error)", status: 500)
        }
        // Decode + re-encode even on the full-frame path (no crop is applied)
        // — a deliberate integrity check, not TS parity: it proves the bytes
        // are a genuinely decodable PNG (headless-safe via CoreGraphics/
        // ImageIO) before they're persisted as an artifact, and it's exactly
        // what the pre-ruled generated-image-content V-B class checks
        // (decodability + dimensions, never exact bytes — so FakeDriver's
        // fixed 1x1 fixture and a NativeDriver real capture both pass).
        guard let image = CaptureImageOps.decodePNG(raw), let encoded = CaptureImageOps.encodePNG(image) else {
            throw DaemonApiError(.internalError, "Captured screenshot bytes did not decode as PNG", status: 500)
        }
        let filename = "capture-\(JSON.nowMillis()).png"
        let path = (sessionDir as NSString).appendingPathComponent(filename)
        return try writeArtifactAndBuild(path: path, filename: filename, buffer: encoded, mode: opts.mode, crop: nil, label: nil)
    }

    // Element/region/auto: needs a snapshot (frozen Driver.snapshot()) plus
    // the raw frame to crop from.
    let snapshot: DriverSnapshot
    do {
        snapshot = try driver.snapshot()
    } catch {
        throw DaemonApiError(.internalError, "snapshot failed: \(error)", status: 500)
    }
    let raw: Data
    do {
        raw = try driver.screenshot()
    } catch {
        throw DaemonApiError(.internalError, "screenshot failed: \(error)", status: 500)
    }

    var cropBounds: DriverBounds?
    var label = "Auto"

    if opts.mode == "element" {
        guard let elementId else {
            throw DaemonApiError(.badRequest, "elementId is required for mode=element", status: 400)
        }
        guard let element = snapshot.elements.first(where: { $0.id == elementId }) else {
            // Soft-error branch (ScreenshotSoftError, `ok:true` wire envelope,
            // NOT a thrown error) — mirrors capture.ts:134 exactly.
            return ["error": "Element \(elementId) not found in snapshot"] as [String: Any]
        }
        cropBounds = element.bounds
        label = element.label.isEmpty ? element.role : element.label
    } else if opts.mode == "region" {
        let regionLabel = region ?? "region"
        label = regionLabel
        let needle = regionLabel.lowercased()
        if let match = snapshot.elements.first(where: {
            $0.role.lowercased().contains(needle) || $0.label.lowercased().contains(needle)
        }) {
            cropBounds = match.bounds
        }
        // No match: falls through to a full-frame result labeled with the
        // requested region string — graceful degradation, not a hard failure
        // (see scope note: real semantic region-finding is S3's port).
    }
    // auto (or an unmatched region): cropBounds stays nil -> full-frame below.

    var outData = raw
    var cropArray: [Double]?
    if let bounds = cropBounds {
        guard let image = CaptureImageOps.decodePNG(raw) else {
            throw DaemonApiError(.internalError, "Failed to decode screenshot for cropping", status: 500)
        }
        guard let cropped = CaptureImageOps.crop(image, bounds: bounds), let encoded = CaptureImageOps.encodePNG(cropped) else {
            throw DaemonApiError(.internalError, "Failed to crop/encode screenshot", status: 500)
        }
        outData = encoded
        cropArray = bounds.asArray
    } else {
        guard let image = CaptureImageOps.decodePNG(raw), let encoded = CaptureImageOps.encodePNG(image) else {
            throw DaemonApiError(.internalError, "Captured screenshot bytes did not decode as PNG", status: 500)
        }
        outData = encoded
    }

    let filename = "capture-\(JSON.nowMillis()).png"
    let path = (sessionDir as NSString).appendingPathComponent(filename)
    return try writeArtifactAndBuild(path: path, filename: filename, buffer: outData, mode: opts.mode, crop: cropArray, label: label)
}
