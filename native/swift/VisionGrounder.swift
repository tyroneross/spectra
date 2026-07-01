// native/swift/VisionGrounder.swift
//
// Native macOS vision fallback for AX-blind apps. Captures only the focused
// target window, runs Apple Vision OCR, and returns text boxes in the same
// global coordinate space used by AX bounds.
//
// SPDX-License-Identifier: Apache-2.0

import Foundation
import ApplicationServices
import AppKit
import CoreGraphics
import ScreenCaptureKit
import Vision

struct VisionGroundingElement: Codable {
    let label: String
    let bounds: [Double]
    let confidence: Double
}

struct VisionGroundingResult: Codable {
    let elements: [VisionGroundingElement]
}

struct VisionAvailabilityResult: Codable {
    let available: Bool
    let reason: String?
}

private func screenCaptureTrusted() -> Bool {
    return CGPreflightScreenCaptureAccess()
}

private func cgDouble(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    if let double = value as? Double { return double }
    if let int = value as? Int { return Double(int) }
    return nil
}

private func windowBounds(from dict: [String: Any]) -> [Double]? {
    guard let bounds = dict[kCGWindowBounds as String] as? [String: Any],
          let x = cgDouble(bounds["X"]),
          let y = cgDouble(bounds["Y"]),
          let width = cgDouble(bounds["Width"]),
          let height = cgDouble(bounds["Height"]) else {
        return nil
    }
    return [x, y, width, height]
}

private func boundsDistance(_ a: [Double], _ b: [Double]) -> Double {
    guard a.count == 4, b.count == 4 else { return Double.greatestFiniteMagnitude }
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) + abs(a[3] - b[3])
}

private func focusedCGWindowId(pid: pid_t, title: String, bounds: [Double]) -> Int {
    let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    var bestId = 0
    var bestScore = Double.greatestFiniteMagnitude

    for entry in list {
        let ownerNumber = entry[kCGWindowOwnerPID as String] as? NSNumber
        guard ownerNumber?.int32Value == pid else { continue }
        let layer = (entry[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        guard layer == 0 else { continue }
        guard let windowId = (entry[kCGWindowNumber as String] as? NSNumber)?.intValue,
              let cgBounds = windowBounds(from: entry),
              cgBounds[2] > 1,
              cgBounds[3] > 1 else { continue }

        let name = (entry[kCGWindowName as String] as? String) ?? ""
        var score = boundsDistance(bounds, cgBounds)
        if !title.isEmpty && name == title { score -= 1000 }
        if score < bestScore {
            bestScore = score
            bestId = windowId
        }
    }

    return bestId
}

private func focusedWindowCaptureInfo(pid: pid_t) -> Result<WindowInfo, AXBridgeError> {
    let app = AXUIElementCreateApplication(pid)

    var roleRef: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &roleRef)
    guard result == .success else {
        if result == .apiDisabled {
            return .failure(AXBridgeError(message: "Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE)."))
        }
        return .failure(AXBridgeError(message: "Cannot access app (PID \(pid)). Error: \(result.rawValue)"))
    }

    guard let window = focusedWindowElement(app: app) else {
        return .failure(AXBridgeError(message: "No focused window for app (PID \(pid))"))
    }

    let base = windowInfo(of: window)
    let windowId = focusedCGWindowId(pid: pid, title: base.title, bounds: base.bounds)
    return .success(WindowInfo(id: windowId, title: base.title, bounds: base.bounds))
}

@available(macOS 14.0, *)
private func selectVisionWindow(
    from windows: [SCWindow],
    pid: pid_t,
    info: WindowInfo
) -> SCWindow? {
    let candidates = windows.filter { window in
        guard window.windowLayer == 0 else { return false }
        guard window.frame.width > 1, window.frame.height > 1 else { return false }
        guard window.owningApplication?.processID == pid else { return false }
        return true
    }

    if info.id > 0, let exact = candidates.first(where: { Int($0.windowID) == info.id }) {
        return exact
    }

    // Single-window apps (the common case) never need bounds-distance ranking —
    // skip it so a multi-monitor coordinate-space mismatch can't mis-rank a
    // choice that was never ambiguous to begin with.
    if candidates.count == 1 { return candidates.first }

    return candidates.sorted { lhs, rhs in
        var lhsScore = boundsDistance(info.bounds, [Double(lhs.frame.origin.x), Double(lhs.frame.origin.y), Double(lhs.frame.width), Double(lhs.frame.height)])
        var rhsScore = boundsDistance(info.bounds, [Double(rhs.frame.origin.x), Double(rhs.frame.origin.y), Double(rhs.frame.width), Double(rhs.frame.height)])
        if !(info.title.isEmpty) && lhs.title == info.title { lhsScore -= 1000 }
        if !(info.title.isEmpty) && rhs.title == info.title { rhsScore -= 1000 }
        return lhsScore < rhsScore
    }.first
}

@available(macOS 14.0, *)
private func captureVisionImage(
    filter: SCContentFilter,
    configuration: SCStreamConfiguration,
    timeoutSeconds: Double
) async -> CGImage? {
    await withCheckedContinuation { continuation in
        let state = VisionImageCaptureState(continuation: continuation)
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, _ in
            state.resume(image)
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(nil)
        }
    }
}

final class VisionImageCaptureState: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false
    private let continuation: CheckedContinuation<CGImage?, Never>

    init(continuation: CheckedContinuation<CGImage?, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: CGImage?) {
        lock.lock()
        if didResume {
            lock.unlock()
            return
        }
        didResume = true
        lock.unlock()
        continuation.resume(returning: value)
    }
}

private func captureFocusedWindowImage(pid: pid_t, info: WindowInfo) async -> Result<CGImage, AXBridgeError> {
    guard #available(macOS 14.0, *) else {
        return .failure(AXBridgeError(message: "Vision fallback screenshot requires macOS 14 or newer"))
    }

    do {
        let content = try await singleWindowShareableContent(timeoutSeconds: 5)
        guard let window = selectVisionWindow(from: content.windows, pid: pid, info: info) else {
            return .failure(AXBridgeError(message: "No ScreenCaptureKit window matched focused window for PID \(pid)"))
        }
        let scale = singleWindowDisplayScale(for: window, displays: content.displays)
        let configuration = SCStreamConfiguration()
        configuration.width = max(2, Int(ceil(window.frame.width * scale)))
        configuration.height = max(2, Int(ceil(window.frame.height * scale)))
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.scalesToFit = true
        configuration.showsCursor = false
        configuration.queueDepth = 3
        configuration.preservesAspectRatio = true
        configuration.ignoreShadowsSingleWindow = true
        configuration.shouldBeOpaque = true

        let filter = SCContentFilter(desktopIndependentWindow: window)
        guard let image = await captureVisionImage(filter: filter, configuration: configuration, timeoutSeconds: 5) else {
            return .failure(AXBridgeError(message: "Focused-window ScreenCaptureKit screenshot failed"))
        }
        return .success(image)
    } catch {
        return .failure(AXBridgeError(message: "Focused-window ScreenCaptureKit screenshot failed: \(error.localizedDescription)"))
    }
}

func visionGrounderAvailable(pid: pid_t) -> VisionAvailabilityResult {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): false] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else {
        return VisionAvailabilityResult(available: false, reason: "Accessibility permission not granted")
    }
    guard screenCaptureTrusted() else {
        return VisionAvailabilityResult(available: false, reason: "Screen Recording permission not granted")
    }
    switch focusedWindowCaptureInfo(pid: pid) {
    case .success:
        return VisionAvailabilityResult(available: true, reason: nil)
    case .failure(let error):
        return VisionAvailabilityResult(available: false, reason: error.message)
    }
}

func groundFocusedWindowWithVision(pid: pid_t) async -> Result<VisionGroundingResult, AXBridgeError> {
    guard screenCaptureTrusted() else {
        return .failure(AXBridgeError(message: "Screen Recording permission not granted. Grant it in System Settings → Privacy & Security → Screen & System Audio Recording."))
    }

    let info: WindowInfo
    switch focusedWindowCaptureInfo(pid: pid) {
    case .success(let resolved):
        info = resolved
    case .failure(let error):
        return .failure(error)
    }

    let image: CGImage
    switch await captureFocusedWindowImage(pid: pid, info: info) {
    case .success(let captured):
        image = captured
    case .failure(let error):
        return .failure(error)
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.01

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return .failure(AXBridgeError(message: "Vision OCR failed: \(error.localizedDescription)"))
    }

    let winX = info.bounds[0]
    let winY = info.bounds[1]
    let winW = max(info.bounds[2], 1)
    let winH = max(info.bounds[3], 1)

    let elements = (request.results ?? []).compactMap { observation -> VisionGroundingElement? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let label = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return nil }

        let box = observation.boundingBox
        let x = winX + Double(box.minX) * winW
        let y = winY + Double(1.0 - box.maxY) * winH
        let width = Double(box.width) * winW
        let height = Double(box.height) * winH
        guard width > 0, height > 0 else { return nil }

        return VisionGroundingElement(
            label: label,
            bounds: [x, y, width, height],
            confidence: Double(candidate.confidence)
        )
    }.sorted { a, b in
        if abs(a.bounds[1] - b.bounds[1]) > 2 { return a.bounds[1] < b.bounds[1] }
        return a.bounds[0] < b.bounds[0]
    }

    return .success(VisionGroundingResult(elements: elements))
}
