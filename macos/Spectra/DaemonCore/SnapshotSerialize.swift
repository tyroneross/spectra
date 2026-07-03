// macos/Spectra/DaemonCore/SnapshotSerialize.swift
//
// M3.G2 (S2) — serializes a `DriverSnapshot` (DriverProtocol.swift, §1) to the
// exact line-oriented text format `src/core/serialize.ts` produces. This IS
// the wire `snapshot` field (contract.spec.json: SnapshotResult.snapshot is
// typeText "string") — SnapshotOps.swift calls this, never a raw dictionary
// dump of DriverSnapshot.
//
// Byte-format is load-bearing: the conformance seeding regex
// `[e42] button "…"` (tests/conformance/lib/fixture-context.ts:87) depends on
// the exact `[id] role "label"` prefix and comma-joined trailing prop list —
// do not reflow spacing, quoting, or prop order below.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

enum SnapshotSerialize {
    /// Ports `serializeSnapshot(snapshot)` from src/core/serialize.ts verbatim.
    static func serializeSnapshot(_ snapshot: DriverSnapshot) -> String {
        let target = snapshot.url ?? snapshot.appName ?? "unknown"
        var lines: [String] = [
            "# Page: \(target)",
            "# Platform: \(snapshot.platform.rawValue) | Elements: \(snapshot.elements.count) | Timestamp: \(snapshot.timestampMs)",
            "",
        ]
        for el in snapshot.elements {
            lines.append(serializeElement(el))
        }
        return lines.joined(separator: "\n")
    }

    /// Ports `serializeElement(el)` from src/core/serialize.ts verbatim,
    /// reading DriverBounds via its frozen `.asArray` (§1 doc comment:
    /// `[x, y, width, height]`, the exact order this destructures).
    static func serializeElement(_ el: DriverElement) -> String {
        var line = "[\(el.id)] \(el.role) \"\(el.label)\""
        var props: [String] = []

        if el.role == "textfield" {
            if let value = el.value, !value.isEmpty {
                props.append("value=\"\(value)\"")
            } else {
                props.append("empty")
            }
        } else if let value = el.value, !value.isEmpty {
            props.append("value=\"\(value)\"")
        }

        if el.focused { props.append("focused") }

        if el.role == "button" {
            props.append(el.enabled ? "enabled" : "disabled")
        }

        if !el.actions.isEmpty {
            props.append("actions:[\(el.actions.joined(separator: ","))]")
        }

        let bounds = el.bounds.asArray
        let x = Int(bounds[0].rounded())
        let y = Int(bounds[1].rounded())
        let w = Int(bounds[2].rounded())
        let h = Int(bounds[3].rounded())
        props.append("bounds:[\(x),\(y),\(w),\(h)]")

        if let parent = el.parent { props.append("parent:\(parent)") }

        if !props.isEmpty { line += " " + props.joined(separator: ", ") }
        return line
    }
}
