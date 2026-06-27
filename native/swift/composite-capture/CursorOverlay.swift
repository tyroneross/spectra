import Foundation
import AVFoundation
import CoreVideo
import CoreGraphics
import CoreMedia
import AppKit

// ─────────────────────────────────────────────────────────────────────────────
// P2 — Smoothed cursor compositing.
//
// The SCK per-window capture sets showsCursor=false (the raw OS cursor is jittery
// and only appears over the focused window). Instead we sample the GLOBAL cursor
// position during recording, smooth it with a critically-damped spring, map it
// into the side-by-side composite's pixel space, and render it as a transparent
// ProRes 4444 layer that the ffmpeg stitch overlays in a single final encode.
//
// All coordinates use CoreGraphics global display space (top-left origin, y-down),
// which is the same space SCWindow.frame and CGEvent.location use — so no flips.
// ─────────────────────────────────────────────────────────────────────────────

/// One sampled global cursor position. `t` is seconds since capture start.
struct CursorSample {
    let t: Double
    let x: Double
    let y: Double
}

/// Samples the global cursor position at a fixed high rate on a background thread.
/// Lock-protected so the recording loops can run undisturbed.
final class CursorTracker: @unchecked Sendable {
    private let lock = NSLock()
    private var samples: [CursorSample] = []
    private var running = false
    private var startUptime: UInt64 = 0
    private let sampleHz: Double
    private var thread: Thread?

    init(sampleHz: Double = 120) { self.sampleHz = sampleHz }

    func start() {
        lock.lock()
        running = true
        startUptime = DispatchTime.now().uptimeNanoseconds
        samples.removeAll(keepingCapacity: true)
        lock.unlock()
        let t = Thread { [weak self] in self?.loop() }
        t.stackSize = 1 << 20
        thread = t
        t.start()
    }

    func stop() {
        lock.lock(); running = false; lock.unlock()
    }

    private func loop() {
        let intervalSec = 1.0 / sampleHz
        while true {
            lock.lock(); let go = running; let start = startUptime; lock.unlock()
            if !go { break }
            // top-left origin, y-down — matches SCWindow.frame.
            let loc = CGEvent(source: nil)?.location ?? .zero
            let now = DispatchTime.now().uptimeNanoseconds
            let t = Double(now &- start) / 1_000_000_000.0
            lock.lock()
            samples.append(CursorSample(t: t, x: Double(loc.x), y: Double(loc.y)))
            lock.unlock()
            Thread.sleep(forTimeInterval: intervalSec)
        }
    }

    func collected() -> [CursorSample] {
        lock.lock(); let s = samples; lock.unlock()
        return s
    }
}

/// Geometry of the stitched composite, in output pixels (pre-finishing-downscale).
struct PaneLayout {
    let leftWindowFrame: CGRect   // global CG coords (y-down)
    let rightWindowFrame: CGRect
    let leftPaneW: Int
    let rightPaneW: Int
    let paneH: Int
}

struct MappedCursor { let x: Double; let y: Double; let visible: Bool }

/// Map a global cursor sample into composite output pixels. Because both the SCK
/// capture and the ffmpeg `scale=-2:H` preserve aspect, the screen-point→pane-pixel
/// scale collapses to `H / window.frame.height`.
func mapCursor(_ s: CursorSample, layout: PaneLayout) -> MappedCursor {
    let lf = layout.leftWindowFrame
    if lf.height > 0 {
        let sc = Double(layout.paneH) / Double(lf.height)
        let ox = (s.x - Double(lf.minX)) * sc
        let oy = (s.y - Double(lf.minY)) * sc
        if ox >= 0, ox <= Double(layout.leftPaneW), oy >= 0, oy <= Double(layout.paneH) {
            return MappedCursor(x: ox, y: oy, visible: true)
        }
    }
    let rf = layout.rightWindowFrame
    if rf.height > 0 {
        let sc = Double(layout.paneH) / Double(rf.height)
        let ox = (s.x - Double(rf.minX)) * sc
        let oy = (s.y - Double(rf.minY)) * sc
        if ox >= 0, ox <= Double(layout.rightPaneW), oy >= 0, oy <= Double(layout.paneH) {
            return MappedCursor(x: Double(layout.leftPaneW) + ox, y: oy, visible: true)
        }
    }
    return MappedCursor(x: 0, y: 0, visible: false)
}

/// Critically-damped spring (no overshoot) — the eased "glide" feel.
func smoothDamp(current: Double, target: Double, velocity: inout Double, smoothTime: Double, dt: Double) -> Double {
    let omega = 2.0 / max(0.0001, smoothTime)
    let x = omega * dt
    let expTerm = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x)
    let change = current - target
    let temp = (velocity + omega * change) * dt
    velocity = (velocity - omega * temp) * expTerm
    return target + (change + temp) * expTerm
}

/// Linear interpolation of the raw sample track at an arbitrary time.
func rawCursorAt(_ t: Double, _ samples: [CursorSample]) -> (Double, Double)? {
    guard let first = samples.first, let last = samples.last else { return nil }
    if t <= first.t { return (first.x, first.y) }
    if t >= last.t { return (last.x, last.y) }
    var lo = 0, hi = samples.count - 1
    while hi - lo > 1 {
        let mid = (lo + hi) / 2
        if samples[mid].t < t { lo = mid } else { hi = mid }
    }
    let a = samples[lo], b = samples[hi]
    let f = (t - a.t) / max(1e-6, b.t - a.t)
    return (a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
}

/// Draw a classic macOS-style arrow pointer with the hotspot (tip) at (px, py)
/// in y-DOWN output pixels. The CGContext is y-UP, so we flip via canvasH.
func drawCursorSprite(in ctx: CGContext, px: Double, py: Double, canvasH: Int, scale: Double) {
    // Arrow polygon in local y-down points, tip at origin, pointing down-right.
    let pts: [(Double, Double)] = [
        (0, 0), (0, 19.2), (4.6, 14.4), (7.8, 21.0),
        (10.2, 19.9), (7.1, 13.3), (12.6, 13.3)
    ]
    let cgTipY = Double(canvasH) - py
    func dev(_ p: (Double, Double)) -> CGPoint {
        CGPoint(x: px + p.0 * scale, y: cgTipY - p.1 * scale)
    }
    let path = CGMutablePath()
    path.move(to: dev(pts[0]))
    for p in pts.dropFirst() { path.addLine(to: dev(p)) }
    path.closeSubpath()

    // soft drop shadow for depth
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -1.5 * scale), blur: 3.0 * scale,
                  color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.45))
    ctx.addPath(path)
    ctx.setFillColor(CGColor(red: 0.06, green: 0.06, blue: 0.06, alpha: 1.0))
    ctx.fillPath()
    ctx.restoreGState()

    // white outline
    ctx.addPath(path)
    ctx.setLineJoin(.round)
    ctx.setLineWidth(1.6 * scale)
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.95))
    ctx.strokePath()
}

/// Render the smoothed cursor as a transparent ProRes 4444 .mov at the composite's
/// native pixel size. Returns true if a usable layer was written (cursor visible in
/// at least one frame). The ffmpeg stitch overlays this losslessly.
@discardableResult
func renderCursorLayer(
    track: [CursorSample],
    layout: PaneLayout,
    fps: Int,
    duration: Double,
    smoothTime: Double,
    output: URL
) throws -> Bool {
    guard track.count >= 2 else { return false }
    let W = layout.leftPaneW + layout.rightPaneW
    let H = layout.paneH
    guard W > 0, H > 0 else { return false }
    let targetFrames = max(1, Int((duration * Double(fps)).rounded()))
    let dt = 1.0 / Double(fps)

    try? FileManager.default.removeItem(at: output)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mov)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.proRes4444,
        AVVideoWidthKey: W,
        AVVideoHeightKey: H
    ])
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { return false }
    writer.add(input)

    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
            kCVPixelBufferWidthKey as String: W,
            kCVPixelBufferHeightKey as String: H,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ]
    )

    guard writer.startWriting() else { return false }
    writer.startSession(atSourceTime: .zero)

    let timeScale = CMTimeScale(max(600, fps * 1000))
    let ticksPerFrame = CMTimeValue(timeScale / CMTimeScale(fps))
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    let spriteScale = max(0.85, Double(H) / 900.0)

    var curX = 0.0, curY = 0.0, velX = 0.0, velY = 0.0
    var initialized = false
    var anyVisible = false

    for frameIndex in 0..<targetFrames {
        let t = Double(frameIndex) * dt
        guard let (rx, ry) = rawCursorAt(t, track) else { continue }
        if !initialized { curX = rx; curY = ry; initialized = true }
        curX = smoothDamp(current: curX, target: rx, velocity: &velX, smoothTime: smoothTime, dt: dt)
        curY = smoothDamp(current: curY, target: ry, velocity: &velY, smoothTime: smoothTime, dt: dt)
        let mapped = mapCursor(CursorSample(t: t, x: curX, y: curY), layout: layout)

        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }

        var pb: CVPixelBuffer?
        if let pool = adaptor.pixelBufferPool {
            CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pb)
        }
        if pb == nil {
            CVPixelBufferCreate(kCFAllocatorDefault, W, H, kCVPixelFormatType_32BGRA,
                [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pb)
        }
        guard let buffer = pb else { continue }

        CVPixelBufferLockBaseAddress(buffer, [])
        if let base = CVPixelBufferGetBaseAddress(buffer),
           let ctx = CGContext(data: base, width: W, height: H, bitsPerComponent: 8,
                               bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                               space: colorSpace, bitmapInfo: bitmapInfo) {
            ctx.clear(CGRect(x: 0, y: 0, width: W, height: H)) // transparent
            if mapped.visible {
                anyVisible = true
                drawCursorSprite(in: ctx, px: mapped.x, py: mapped.y, canvasH: H, scale: spriteScale)
            }
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])

        let pts = CMTime(value: CMTimeValue(frameIndex) * ticksPerFrame, timescale: timeScale)
        adaptor.append(buffer, withPresentationTime: pts)
    }

    input.markAsFinished()
    let sem = DispatchSemaphore(value: 0)
    writer.finishWriting { sem.signal() }
    sem.wait()
    return writer.status == .completed && anyVisible
}
