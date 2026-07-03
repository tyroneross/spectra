// macos/Spectra/DaemonCore/FfmpegProbe.swift
//
// M3.G2 — S4 (media-recording). SHELLED ffmpeg/ffprobe probes ONLY (per
// ND-2/PC-7: the M5 compositing pipeline stays proxied to the TS backend;
// this file does NOT port that pipeline — it only mirrors the two narrow
// probe helpers stopRecording needs, `probeVideo` (src/media/pipeline.ts)
// and the black-frame guard (`parseLuminance` /
// `probeRecordingBlackFrames`, src/daemon/composite-worker.ts +
// src/daemon/core-impl.ts). Real ffmpeg/ffprobe binaries are located via
// `which` at call time and shelled out to via Process — no AVFoundation, no
// in-process decode.
//
// Graceful degradation throughout (matches the TS reference exactly): a
// missing ffmpeg/ffprobe, a malformed probe response, or a non-zero exit
// code is NEVER an error surfaced to the caller — probeVideo returns nil
// (stopRecording's own fallbacks — the native helper's own reported
// dimensions/duration, then a wall-clock duration estimate — take over) and
// the black-frame guard returns `skipped: true` (RecordingOps.swift turns
// that into a warning string, never a failure).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Mirrors src/media/pipeline.ts `VideoProbeResult` (the subset stopRecording
/// consumes as a fallback source for codec/fps/width/height/durationMs).
struct VideoProbeResult {
    var durationMs: Int?
    var width: Int?
    var height: Int?
    var fps: Double?
    var codec: String?
}

/// Mirrors src/contract/core-api.ts `BlackFrameGuard`.
struct BlackFrameProbeResult {
    var sampleCount: Int
    var meanLuma: Double?
    var allBlack: Bool
    var skipped: Bool
}

enum FfmpegProbe {
    /// Default black-frame luminance threshold (COMPOSITE_WORKER_DEFAULTS.blackThreshold,
    /// src/daemon/composite-worker.ts:22) — mean sampled luminance below this is
    /// treated as "all black".
    static let defaultBlackThreshold = 40.0

    private static let lock = NSLock()
    // Triple-state cache: nil (unchecked) vs .some(nil) (checked, not found) vs
    // .some(path) (checked, found) — mirrors src/media/ffmpeg.ts's own
    // `cachedFfmpegPath: string | null | undefined` cache shape exactly.
    private static var cachedFfmpegPath: String??

    /// `which ffmpeg` (cached). Mirrors src/media/ffmpeg.ts detectFfmpeg().
    static func detectFfmpeg() -> String? {
        lock.lock()
        if let cached = cachedFfmpegPath {
            lock.unlock()
            return cached
        }
        lock.unlock()
        let resolved = which("ffmpeg")
        lock.lock()
        cachedFfmpegPath = resolved
        lock.unlock()
        return resolved
    }

    /// `which ffprobe` — resolved independently of ffmpeg's path (both ship
    /// together via Homebrew/manual installs, so a direct `which` is simpler
    /// and just as reliable as deriving one path from the other).
    private static func ffprobePath() -> String? {
        which("ffprobe")
    }

    private static func which(_ binary: String) -> String? {
        guard let output = runCapture("/usr/bin/which", [binary]) else { return nil }
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Mirrors src/media/pipeline.ts probeVideo(): `ffprobe -show_entries
    /// stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration:format=duration
    /// -of json <path>`. nil on ANY failure (missing ffprobe, non-zero exit,
    /// malformed JSON) — never throws.
    static func probeVideo(_ path: String) -> VideoProbeResult? {
        guard let ffprobe = ffprobePath() else { return nil }
        let args = [
            "-v", "error",
            "-show_entries",
            "stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration:format=duration",
            "-of", "json",
            path,
        ]
        guard let output = runCapture(ffprobe, args), !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let data = output.data(using: .utf8),
              let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        let streams = top["streams"] as? [[String: Any]]
        let stream = streams?.first
        let format = top["format"] as? [String: Any]

        let durationSeconds = numberFromAny(stream?["duration"]) ?? numberFromAny(format?["duration"])
        let fps = parseFps(stream?["avg_frame_rate"] as? String) ?? parseFps(stream?["r_frame_rate"] as? String)

        return VideoProbeResult(
            durationMs: durationSeconds.map { Int(($0 * 1000).rounded()) },
            width: intFromAny(stream?["width"]),
            height: intFromAny(stream?["height"]),
            fps: fps,
            codec: stream?["codec_name"] as? String
        )
    }

    /// Mirrors core-impl.ts probeRecordingBlackFrames(): samples luminance via
    /// `ffmpeg -i <path> -vf fps=2,signalstats,metadata=print:file=- -an -f null -`
    /// and parses `lavfi.signalstats.YAVG=NN.NN` lines out of the combined
    /// stdout+stderr text (ffmpeg's own -metadata print target is stdout, but
    /// filtergraph diagnostics land on stderr for some builds — merge both,
    /// same as the TS reference's `${stdout}\n${stderr}` concatenation).
    static func probeBlackFrames(_ path: String, blackThreshold: Double = defaultBlackThreshold) -> BlackFrameProbeResult {
        guard let ffmpeg = detectFfmpeg() else {
            return BlackFrameProbeResult(sampleCount: 0, meanLuma: nil, allBlack: false, skipped: true)
        }
        let args = ["-nostats", "-i", path, "-vf", "fps=2,signalstats,metadata=print:file=-", "-an", "-f", "null", "-"]
        guard let output = runCapture(ffmpeg, args, mergeStderr: true, allowNonZeroExit: true) else {
            return BlackFrameProbeResult(sampleCount: 0, meanLuma: nil, allBlack: false, skipped: true)
        }
        return parseLuminance(output, blackThreshold: blackThreshold)
    }

    /// Mirrors src/daemon/composite-worker.ts parseLuminance() exactly (same
    /// regex, same mean/threshold math) — a pure function, unit-testable
    /// headless with no ffmpeg invocation at all.
    static func parseLuminance(_ output: String, blackThreshold: Double = defaultBlackThreshold) -> BlackFrameProbeResult {
        var values: [Double] = []
        guard let pattern = try? NSRegularExpression(pattern: "lavfi\\.signalstats\\.YAVG=([0-9]+(?:\\.[0-9]+)?)") else {
            return BlackFrameProbeResult(sampleCount: 0, meanLuma: nil, allBlack: false, skipped: true)
        }
        let ns = output as NSString
        pattern.enumerateMatches(in: output, range: NSRange(location: 0, length: ns.length)) { match, _, _ in
            guard let match, match.numberOfRanges > 1 else { return }
            let raw = ns.substring(with: match.range(at: 1))
            if let value = Double(raw), value.isFinite { values.append(value) }
        }
        guard !values.isEmpty else {
            return BlackFrameProbeResult(sampleCount: 0, meanLuma: nil, allBlack: false, skipped: true)
        }
        let mean = values.reduce(0, +) / Double(values.count)
        return BlackFrameProbeResult(sampleCount: values.count, meanLuma: mean, allBlack: mean < blackThreshold, skipped: false)
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    private static func numberFromAny(_ value: Any?) -> Double? {
        if let s = value as? String { return Double(s) }
        if let n = value as? NSNumber { return n.doubleValue }
        return nil
    }

    private static func intFromAny(_ value: Any?) -> Int? {
        if let n = value as? NSNumber { return n.intValue }
        if let i = value as? Int { return i }
        return nil
    }

    /// Parses ffprobe's `avg_frame_rate`/`r_frame_rate` rational strings
    /// ("30000/1001", "60/1", or occasionally a bare number).
    private static func parseFps(_ raw: String?) -> Double? {
        guard let raw, !raw.isEmpty else { return nil }
        let parts = raw.split(separator: "/")
        if parts.count == 2, let num = Double(parts[0]), let den = Double(parts[1]), den != 0 {
            return num / den
        }
        return Double(raw)
    }

    /// Runs `executable args...`, returns combined/stdout text or nil on
    /// spawn failure. `allowNonZeroExit` (black-frame probe) accepts partial
    /// output even when ffmpeg's own exit code is non-zero (its `-f null -`
    /// smoke-decode intentionally tolerates minor stream issues that would
    /// otherwise discard usable luminance samples); probeVideo (ffprobe)
    /// keeps the stricter zero-exit requirement.
    private static func runCapture(_ executable: String, _ args: [String], mergeStderr: Bool = false, allowNonZeroExit: Bool = false) -> String? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = args
        let outPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = mergeStderr ? outPipe : Pipe()
        do {
            try proc.run()
        } catch {
            return nil
        }
        // Read before waitUntilExit — avoids a pipe-buffer deadlock on
        // moderate-sized ffprobe/ffmpeg output (readDataToEndOfFile blocks
        // until the pipe's write end closes, which happens at process exit).
        let data = outPipe.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()
        guard allowNonZeroExit || proc.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
