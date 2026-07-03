// macos/Spectra/DaemonCore/CastParser.swift
//
// M3.G2 (S5) — the asciinema-cast v2 format, read + write. Mirrors
// `src/terminal/parser.ts` (parseCast/searchCast/extractCommands/
// formatCastSummary) exactly, plus the writer half of `src/terminal/
// recorder.ts` (the header line + `[elapsed, type, data]` event-line shape
// `writeEvent` emits). TerminalOps.swift is the only caller: it uses the
// writer helpers while driving a real pty (recordTerminal) and the parser
// helpers against a real file on disk (replayTerminal). Format only — no
// process/Driver concerns live here.
//
// replayTerminal's result is BYTE-COMPARED against the TS oracle (rev 3.3
// exclusion: `summary` is not a maskable field), so `formatSummary` below
// must reproduce `formatCastSummary` character-for-character, including its
// JS-string-length semantics (`.length` counts UTF-16 code units, not Swift
// grapheme clusters) and `Date.toISOString()`'s exact `sss` millisecond
// formatting.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Mirrors `src/terminal/parser.ts` CastHeader.
struct CastHeader {
    var version: Int
    var width: Int
    var height: Int
    var timestamp: Int
    var env: [String: String]
}

/// Mirrors `src/terminal/parser.ts` CastEvent. `type` is the NORMALIZED
/// "output" | "input" string (parseCast's `rawType === 'i' ? 'input' :
/// 'output'`) — never the raw on-disk "o"/"i" wire code.
struct CastEvent {
    var time: Double
    var type: String
    var data: String
}

/// Mirrors `src/terminal/parser.ts` CastFile.
struct CastFile {
    var header: CastHeader
    var events: [CastEvent]
    var duration: Double
}

/// A cast-format failure that has NO TS-side `DaemonApiError` counterpart —
/// `parseCast` in the TS source throws a plain `Error` for every failure mode
/// here (empty file, unreadable file, malformed header JSON), which bubbles
/// through the daemon's generic `toDaemonApiError` catch-all as
/// `internal_error`/500 (src/daemon/errors.ts:82-89), NOT `bad_request`.
/// TerminalOps.swift's replayTerminal handler maps this 1:1 to
/// `DaemonApiError(.internalError, ..., status: 500)` to match.
struct CastFormatError: Error {
    let message: String
}

enum CastParser {

    // ─── Writer half (mirrors recorder.ts's header + writeEvent shapes) ────

    /// The asciicast v2 header line recorder.ts writes first:
    /// `{version, width, height, timestamp, env}` + "\n". `timestampSec` is
    /// whole-second UNIX time (`Math.floor(Date.now() / 1000)` in TS).
    static func headerLine(width: Int, height: Int, timestampSec: Int, env: [String: String]) -> String {
        let header: [String: Any] = [
            "version": 2,
            "width": width,
            "height": height,
            "timestamp": timestampSec,
            "env": env,
        ]
        return jsonLine(header)
    }

    /// One event line: `[elapsed, wireType, data]` where `wireType` is the
    /// raw on-disk code ("o" output | "i" input) — recorder.ts's
    /// `writeEvent`'s exact tuple shape, JSON-encoded.
    static func eventLine(elapsed: Double, wireType: String, data: String) -> String {
        jsonLine([elapsed, wireType, data] as [Any])
    }

    private static func jsonLine(_ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed]) else {
            return "{}"
        }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    // ─── Reader half (mirrors parser.ts EXACTLY) ────────────────────────────

    /// Mirrors `parseCast(filePath)`: split on "\n", drop blank lines, first
    /// non-blank line is the header (unprotected `JSON.parse` — a malformed
    /// header is an UNCAUGHT throw in TS, see `CastFormatError` doc above),
    /// every subsequent line is a best-effort `[time, rawType, data]` tuple —
    /// a malformed event line is skipped with a stderr warning, never fails
    /// the whole parse (mirrors TS's per-line try/catch + `console.warn`).
    static func parse(filePath: String) throws -> CastFile {
        let raw: String
        do {
            raw = try String(contentsOfFile: filePath, encoding: .utf8)
        } catch {
            // Mirrors `readFile(filePath, 'utf8')` rejecting (ENOENT etc.) —
            // an uncaught Error in TS, internal_error/500 at the daemon layer.
            throw CastFormatError(message: "Failed to read cast file \(filePath): \(error.localizedDescription)")
        }

        let lines = raw
            .components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

        guard !lines.isEmpty else {
            throw CastFormatError(message: "Cast file is empty: \(filePath)")
        }

        let header = try parseHeader(lines[0])

        var events: [CastEvent] = []
        for i in 1..<lines.count {
            let line = lines[i].trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            guard
                let lineData = line.data(using: .utf8),
                let raw = try? JSONSerialization.jsonObject(with: lineData, options: [.fragmentsAllowed]),
                let tuple = raw as? [Any],
                tuple.count == 3,
                let time = numberValue(tuple[0]),
                let rawType = tuple[1] as? String,
                let dataStr = tuple[2] as? String
            else {
                FileHandle.standardError.write(Data(
                    "[parser] skipping malformed line \(i + 1): \(String(line.prefix(80)))\n".utf8
                ))
                continue
            }
            events.append(CastEvent(time: time, type: rawType == "i" ? "input" : "output", data: dataStr))
        }

        let duration = events.last?.time ?? 0
        return CastFile(header: header, events: events, duration: duration)
    }

    /// `JSON.parse(lines[0]) as CastHeader` — unprotected in TS (see doc
    /// comment above); a malformed header line throws here too.
    private static func parseHeader(_ line: String) throws -> CastHeader {
        guard
            let lineData = line.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: lineData, options: [.fragmentsAllowed]),
            let obj = raw as? [String: Any]
        else {
            throw CastFormatError(message: "Cast file header is not valid JSON")
        }
        let version = numberValue(obj["version"]).map(Int.init) ?? 0
        let width = numberValue(obj["width"]).map(Int.init) ?? 0
        let height = numberValue(obj["height"]).map(Int.init) ?? 0
        let timestamp = numberValue(obj["timestamp"]).map(Int.init) ?? 0
        let env = (obj["env"] as? [String: String]) ?? [:]
        return CastHeader(version: version, width: width, height: height, timestamp: timestamp, env: env)
    }

    /// Mirrors `searchCast`: `new RegExp(pattern)` — an invalid pattern
    /// throws (uncaught -> internal_error/500 in TS); filters events whose
    /// `data` matches.
    static func search(_ cast: CastFile, pattern: String) throws -> [CastEvent] {
        let regex: NSRegularExpression
        do {
            regex = try NSRegularExpression(pattern: pattern)
        } catch {
            throw CastFormatError(message: "Invalid search pattern \"\(pattern)\": \(error.localizedDescription)")
        }
        return cast.events.filter { event in
            let range = NSRange(event.data.startIndex..<event.data.endIndex, in: event.data)
            return regex.firstMatch(in: event.data, options: [], range: range) != nil
        }
    }

    /// Mirrors `extractCommands`: input events only, trailing CRLF/LF
    /// stripped then whitespace-trimmed, empties dropped.
    static func extractCommands(_ cast: CastFile) -> [String] {
        cast.events
            .filter { $0.type == "input" }
            .map { stripTrailingNewline($0.data).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func stripTrailingNewline(_ s: String) -> String {
        // Mirrors `.replace(/\r?\n$/, '')` — strip AT MOST one trailing
        // "\r\n" or "\n", not repeated occurrences.
        if s.hasSuffix("\r\n") { return String(s.dropLast(2)) }
        if s.hasSuffix("\n") { return String(s.dropLast(1)) }
        return s
    }

    /// Mirrors `formatCastSummary` BYTE-FOR-BYTE — replayTerminal's
    /// `summary` field is the one thing V-B compares literally (rev 3.3).
    static func formatSummary(_ cast: CastFile) -> String {
        let outputEvents = cast.events.filter { $0.type == "output" }

        let firstOutput = outputEvents.first.map(truncateAndCollapse) ?? "(none)"
        let lastOutput = outputEvents.last.map(truncateAndCollapse) ?? "(none)"

        let recorded: String
        if cast.header.timestamp != 0 {
            recorded = iso8601(Date(timeIntervalSince1970: Double(cast.header.timestamp)))
        } else {
            recorded = "unknown"
        }

        // `.length` in `totalChars += e.data.length` is JS UTF-16 code-unit
        // count, not Swift's grapheme-cluster `.count` — use `.utf16.count`
        // for parity on any non-ASCII fixture content.
        let totalChars = outputEvents.reduce(0) { $0 + $1.data.utf16.count }

        return [
            "Recorded: \(recorded)",
            "Terminal: \(cast.header.width)x\(cast.header.height)",
            "Duration: \(fixed(cast.duration, 2))s",
            "Events: \(cast.events.count) (\(outputEvents.count) output, \(cast.events.count - outputEvents.count) input)",
            "Output size: \(fixed(Double(totalChars) / 1024.0, 1)) KB",
            "First output: \(firstOutput)",
            "Last output:  \(lastOutput)",
        ].joined(separator: "\n")
    }

    /// `.data.slice(0, 80).replace(/\r?\n/g, ' ').trim()` — slice by UTF-16
    /// code unit (JS `String.slice` semantics), THEN collapse newlines, THEN
    /// trim (TS's exact order).
    private static func truncateAndCollapse(_ event: CastEvent) -> String {
        let utf16View = event.data.utf16
        let prefixCount = min(80, utf16View.count)
        let prefixUtf16 = Array(utf16View.prefix(prefixCount))
        let sliced = String(utf16CodeUnits: prefixUtf16, count: prefixUtf16.count)
        let collapsed = sliced
            .replacingOccurrences(of: "\r\n", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `.toFixed(n)` — fixed-point, half-away-from-zero rounding (matches
    /// JS's `toFixed` for the non-pathological magnitudes this op ever sees).
    private static func fixed(_ value: Double, _ digits: Int) -> String {
        String(format: "%.\(digits)f", value)
    }

    /// `Date.toISOString()` — always UTC, always 3-digit milliseconds,
    /// literal "Z" suffix. `en_US_POSIX` + explicit UTC keeps this
    /// locale/timezone-independent of the host.
    private static func iso8601(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter.string(from: date)
    }

    private static func numberValue(_ raw: Any?) -> Double? {
        if let n = raw as? NSNumber { return n.doubleValue }
        if let d = raw as? Double { return d }
        if let i = raw as? Int { return Double(i) }
        return nil
    }
}
