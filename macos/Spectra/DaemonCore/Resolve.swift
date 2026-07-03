// macos/Spectra/DaemonCore/Resolve.swift
//
// M3.G2 (S3, step-intelligence-engine) — intent -> element resolution. Port
// of src/core/resolve.ts (both the 'claude' text-scoring mode used by
// step/llmStep's planner-free path, and the 'algorithmic' spatial-hint mode
// kept for parity even though no current G2 caller selects it). Fully
// deterministic string/spatial matching — NO LLM call anywhere in this file.
// `step` executes this scoring locally; `llmStep` never calls it at all (it
// executes a CLIENT-supplied ActionPlan verbatim — see StepOps.swift).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

// ─── Types (mirror core/types.ts ResolveOptions/ResolveResult) ─────────────

enum ResolveMode: String {
    case claude
    case algorithmic
}

struct ResolveResult {
    var element: DriverElement?
    var confidence: Double
    var candidates: [DriverElement]?
    var visionFallback: Bool?
}

private struct ScoredElement { var element: DriverElement; var score: Double }

// ─── Public entry point ─────────────────────────────────────────────────────

func resolve(intent: String, elements: [DriverElement], mode: ResolveMode) -> ResolveResult {
    switch mode {
    case .algorithmic:
        return resolveAlgorithmic(intent: intent, elements: elements)
    case .claude:
        return resolveClaude(intent: intent, elements: elements)
    }
}

// ─── Regex helpers (file-scoped copies — see Actions.swift's note on why
// this is duplicated rather than shared) ────────────────────────────────────

private func regexTest(_ pattern: String, _ text: String, caseInsensitive: Bool = true) -> Bool {
    var opts: String.CompareOptions = [.regularExpression]
    if caseInsensitive { opts.insert(.caseInsensitive) }
    return text.range(of: pattern, options: opts) != nil
}

private func captureGroups(
    _ pattern: String,
    _ text: String,
    options: NSRegularExpression.Options = []
) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let m = regex.firstMatch(in: text, options: [], range: range) else { return nil }
    var groups: [String] = []
    for i in 1..<m.numberOfRanges {
        if let r = Range(m.range(at: i), in: text) {
            groups.append(String(text[r]))
        } else {
            groups.append("")
        }
    }
    return groups
}

private func replaceAllRegex(_ pattern: String, _ replacement: String, _ text: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
}

private func escapeRegex(_ s: String) -> String {
    let special: Set<Character> = [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]
    var out = ""
    for ch in s {
        if special.contains(ch) { out.append("\\") }
        out.append(ch)
    }
    return out
}

/// Mirrors `.split(/\s+/)` closely enough for natural-language intent/label
/// text: splits on any run of ASCII whitespace, omitting empty subsequences
/// (JS `"".split(/\s+/)` yields `['']`, a harmless edge TS callers already
/// filter with `.length > 2`-style guards before use).
private func splitWords(_ s: String) -> [String] {
    s.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }).map(String.init)
}

// ─── Claude-mode scoring (mirrors resolve.ts's default/claude path) ────────

private func resolveClaude(intent: String, elements: [DriverElement]) -> ResolveResult {
    if elements.isEmpty {
        return ResolveResult(element: nil, confidence: 0, candidates: [])
    }

    let intentLower = intent.lowercased()
    let scored = scoreElementsClaude(elements, intentLower)

    if scored.isEmpty {
        return ResolveResult(
            element: elements[0],
            confidence: 0,
            candidates: elements.filter { !$0.actions.isEmpty },
            visionFallback: true
        )
    }

    let best = scored[0]

    // High confidence: single clear winner.
    if best.score >= 1.0 || (scored.count == 1 && best.score >= 0.5) {
        return ResolveResult(element: best.element, confidence: best.score)
    }

    // Multiple close candidates.
    let threshold = best.score * 0.8
    let candidates = scored.filter { $0.score >= threshold }.map { $0.element }

    var result = ResolveResult(
        element: best.element,
        confidence: best.score,
        candidates: candidates.count > 1 ? candidates : nil
    )

    // Vision fallback: confidence < 0.3 in claude mode signals screenshot needed.
    if best.score < 0.3 {
        result.visionFallback = true
    }

    return result
}

private func scoreElementsClaude(_ elements: [DriverElement], _ intentLower: String) -> [ScoredElement] {
    var scored: [ScoredElement] = []

    for el in elements {
        let labelLower = el.label.lowercased()
        var score = 0.0
        if labelLower.isEmpty { continue }

        // Exact match: intent contains the full label as a word-bounded substring.
        let escapedLabel = escapeRegex(labelLower)
        let labelIsInIntent = regexTest("\\b\(escapedLabel)\\b", intentLower)

        if labelIsInIntent {
            let labelWords = splitWords(labelLower.trimmingCharacters(in: .whitespaces))
            if labelWords.count > 1 {
                score = 1.0
            } else {
                let intentWords = splitWords(intentLower)
                let exactWordMatch = intentWords.contains(labelLower)
                if exactWordMatch, (labelWords.first?.count ?? 0) > 1 {
                    score = 0.5
                }
            }
        } else {
            // Partial match: some intent words appear in the label.
            let intentWords = splitWords(intentLower)
            let matchedWords = intentWords.filter { $0.count > 2 && labelLower.contains($0) }
            if !matchedWords.isEmpty {
                score = 0.5
            }
        }

        // Role match bonus.
        if intentLower.contains(el.role) {
            score = min(score + 0.2, 1.0)
        }

        // Interactive elements get priority; penalize non-interactive.
        if el.actions.isEmpty && score > 0 {
            score *= 0.5
        }

        if score > 0 {
            scored.append(ScoredElement(element: el, score: score))
        }
    }

    return scored.sorted { $0.score > $1.score }
}

// ─── Algorithmic-mode scoring (mirrors resolve.ts's spatial-hint path;
// currently unreferenced by any G2 op but ported for full contract parity
// and the ported XCTest vectors) ─────────────────────────────────────────────

private struct SpatialHints {
    var position: String? // first/last/top/bottom
    var near: String?
    var direction: String? // above/below/left/right/near
    var reference: String?
    var ordinal: Int?
}

private func resolveAlgorithmic(intent: String, elements: [DriverElement]) -> ResolveResult {
    if elements.isEmpty {
        return ResolveResult(element: nil, confidence: 0, candidates: [])
    }

    let intentLower = intent.lowercased()
    let hints = parseSpatialHints(intentLower)
    let cleanedIntent = cleanIntent(intentLower)

    var scored: [ScoredElement] = []

    for (i, el) in elements.enumerated() {
        let roleScore = scoreRoleAlgo(cleanedIntent, el.role)

        let trimmedClean = cleanedIntent.trimmingCharacters(in: .whitespaces)
        let intentIsOnlyRole = trimmedClean == el.role.lowercased()
            || splitWords(trimmedClean).allSatisfy { scoreRoleAlgo($0, el.role) > 0 }
        let labelScore = intentIsOnlyRole ? 0 : scoreLabelSimilarity(cleanedIntent, el.label)

        let spatialScore = scoreSpatial(hints, el, i, elements)

        var score = roleScore * 0.3 + labelScore * 0.5 + spatialScore * 0.2

        // Exact label match floor.
        if labelScore >= 0.99 {
            score = max(score, 0.75)
        }

        if score > 0 {
            scored.append(ScoredElement(element: el, score: score))
        }
    }

    scored.sort { $0.score > $1.score }

    if scored.isEmpty {
        return ResolveResult(element: elements[0], confidence: 0, candidates: [])
    }

    let best = scored[0]

    if best.score >= 0.7 {
        return ResolveResult(element: best.element, confidence: best.score)
    }

    return ResolveResult(element: best.element, confidence: best.score, candidates: scored.map { $0.element })
}

private func scoreRoleAlgo(_ intent: String, _ role: String) -> Double {
    let roleLower = role.lowercased()
    for word in splitWords(intent) {
        if word == roleLower { return 1.0 }
        if word == "btn" && roleLower == "button" { return 0.8 }
        if word == "input" && roleLower == "textfield" { return 0.8 }
        if word == "text" && roleLower == "textfield" { return 0.6 }
    }
    return 0
}

private func scoreLabelSimilarity(_ intent: String, _ label: String) -> Double {
    if label.isEmpty { return 0 }
    let labelLower = label.lowercased()

    if intent.contains(labelLower) { return 1.0 }
    if labelLower.contains(intent.trimmingCharacters(in: .whitespaces)) { return 0.9 }

    let jw = jaroWinkler(intent, labelLower)

    let intentWords = splitWords(intent).filter { $0.count > 2 }
    var bestWordJw = 0.0
    for word in intentWords {
        bestWordJw = max(bestWordJw, jaroWinkler(word, labelLower))
    }

    let labelWords = splitWords(labelLower).filter { $0.count > 2 }
    var bestLabelWordJw = 0.0
    for lw in labelWords {
        for iw in intentWords {
            bestLabelWordJw = max(bestLabelWordJw, jaroWinkler(iw, lw))
        }
    }

    return max(jw, bestWordJw, bestLabelWordJw)
}

/// Public (mirrors resolve.ts's exported `parseSpatialHints`).
private func parseSpatialHints(_ intent: String) -> SpatialHints {
    var hints = SpatialHints()

    if regexTest("\\bfirst\\b", intent) { hints.position = "first" }
    else if regexTest("\\blast\\b", intent) { hints.position = "last" }
    else if regexTest("\\btop\\b", intent) { hints.position = "top" }
    else if regexTest("\\bbottom\\b", intent) { hints.position = "bottom" }

    if let near = captureGroups("\\b(?:next to|near|beside|by)\\s+(.+?)(?:\\s*$)", intent)?.first {
        hints.near = near.trimmingCharacters(in: .whitespaces)
    }

    if let ord = captureGroups(
        "\\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\\b",
        intent,
        options: [.caseInsensitive]
    )?.first {
        let ordinals: [String: Int] = [
            "first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
            "fourth": 4, "4th": 4, "fifth": 5, "5th": 5,
        ]
        hints.ordinal = ordinals[ord.lowercased()] ?? 1
    }

    if let groups = captureGroups(
        "\\b(above|below|under|left of|right of|near)\\s+(?:the\\s+)?(.+?)(?:\\s*$)",
        intent,
        options: [.caseInsensitive]
    ), groups.count >= 2 {
        let dirMap: [String: String] = [
            "above": "above", "below": "below", "under": "below",
            "left of": "left", "right of": "right", "near": "near",
        ]
        hints.direction = dirMap[groups[0].lowercased()]
        hints.reference = groups[1].trimmingCharacters(in: .whitespaces)
    }

    return hints
}

private func scoreSpatial(
    _ hints: SpatialHints,
    _ el: DriverElement,
    _ index: Int,
    _ allElements: [DriverElement]
) -> Double {
    if hints.position == nil && hints.near == nil { return 0 }

    var score = 0.0

    if let position = hints.position {
        switch position {
        case "first", "top":
            score = max(0, 1.0 - Double(index) / Double(max(allElements.count - 1, 1)))
        case "last", "bottom":
            score = Double(index) / Double(max(allElements.count - 1, 1))
        default:
            break
        }
    }

    if let near = hints.near {
        let nearLower = near.lowercased()
        for i in 0..<allElements.count {
            if allElements[i].label.lowercased().contains(nearLower) {
                let distance = abs(index - i)
                if distance > 0 && distance <= 3 {
                    score = max(score, 1.0 - Double(distance - 1) * 0.3)
                }
                break
            }
        }
    }

    return score
}

private func cleanIntent(_ intent: String) -> String {
    var s = replaceAllRegex("\\b(first|last|top|bottom)\\b", "", intent)
    s = replaceAllRegex("\\b(next to|near|beside|by)\\s+\\S+", "", s)
    s = replaceAllRegex("\\b(click|tap|press|select|choose)\\b", "", s)
    s = replaceAllRegex("\\s+", " ", s)
    return s.trimmingCharacters(in: .whitespaces)
}

// ─── Jaro-Winkler (byte-for-byte port of resolve.ts's algorithm) ────────────

func jaroWinkler(_ s1: String, _ s2: String, prefixScale: Double = 0.1) -> Double {
    if s1 == s2 { return 1.0 }
    if s1.isEmpty || s2.isEmpty { return 0.0 }

    let jaro = jaroDistance(s1, s2)
    if jaro == 0 { return 0 }

    let a1 = Array(s1), a2 = Array(s2)
    var prefixLen = 0
    let maxPrefix = min(4, min(a1.count, a2.count))
    for i in 0..<maxPrefix {
        if a1[i] == a2[i] { prefixLen += 1 } else { break }
    }

    return jaro + Double(prefixLen) * prefixScale * (1 - jaro)
}

private func jaroDistance(_ s1: String, _ s2: String) -> Double {
    if s1 == s2 { return 1.0 }

    let a1 = Array(s1), a2 = Array(s2)
    let len1 = a1.count, len2 = a2.count

    let matchWindow = max(0, max(len1, len2) / 2 - 1)

    var s1Matches = [Bool](repeating: false, count: len1)
    var s2Matches = [Bool](repeating: false, count: len2)

    var matches = 0

    for i in 0..<len1 {
        let start = max(0, i - matchWindow)
        let end = min(i + matchWindow + 1, len2)
        var j = start
        while j < end {
            if !s2Matches[j] && a1[i] == a2[j] {
                s1Matches[i] = true
                s2Matches[j] = true
                matches += 1
                break
            }
            j += 1
        }
    }

    if matches == 0 { return 0 }

    var transpositions = 0
    var k = 0
    for i in 0..<len1 {
        if !s1Matches[i] { continue }
        while !s2Matches[k] { k += 1 }
        if a1[i] != a2[k] { transpositions += 1 }
        k += 1
    }

    let m = Double(matches)
    return (m / Double(len1) + m / Double(len2) + (m - Double(transpositions) / 2) / m) / 3
}
