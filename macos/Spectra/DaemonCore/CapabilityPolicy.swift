// macos/Spectra/DaemonCore/CapabilityPolicy.swift
//
// M3.G1 flip (S2) — capability-enforcement parity. Mirrors src/daemon/security.ts
// assertCapabilities/assertOperationAllowed: a unix-socket caller is granted ALL
// capabilities by default (mode-0600 peer trust — matches the TS daemon's
// verifyUnixCaller with no restriction), UNLESS SPECTRA_CONFORMANCE_UNIX_CAPS is
// set (a JSON array of Capability raw values), in which case the caller is
// granted ONLY that set — the same env hook the M2B conformance oracle already
// uses against the TS daemon (tests/conformance/lib/daemon-runner.ts:132-143).
// No new vocabulary: this introduces zero new capability names or env vars.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Enforces the daemon's capability gate for every native op dispatch.
/// Pinned interface (P1, frozen): `CapabilityPolicy.shared.assert(_:operation:)`
/// — S1's Router calls this BEFORE invoking a native handler, i.e. before any
/// param validation, mirroring the TS dispatch order.
final class CapabilityPolicy: @unchecked Sendable {
    /// The process-wide policy. Swift initializes `static let` properties
    /// lazily but thread-safely on first access; `DaemonContext.init()`
    /// (HandlerRegistry.swift) forces that first access during daemon boot —
    /// BEFORE the socket ever accepts a connection — so a malformed
    /// SPECTRA_CONFORMANCE_UNIX_CAPS value fails the process closed at start
    /// time rather than lazily on the first request.
    static let shared = CapabilityPolicy()

    /// nil == default all-grant (unix 0600 peer trust, matches the TS daemon's
    /// unrestricted unix caller). Non-nil == restricted to exactly this set
    /// (SPECTRA_CONFORMANCE_UNIX_CAPS was set and parsed successfully).
    private let restrictedGrant: Set<Capability>?

    private init() {
        let envValue = ProcessInfo.processInfo.environment["SPECTRA_CONFORMANCE_UNIX_CAPS"]
        guard let raw = envValue, !raw.isEmpty else {
            self.restrictedGrant = nil
            return
        }

        // Malformed CAPS JSON (bad JSON, not an array, or containing an
        // unrecognized capability string) fails CLOSED: refuse to start with a
        // clear stderr message and a nonzero exit — NEVER silently fall back
        // to the all-grant default (that would defeat the entire probe this
        // env hook exists to run: T-04's restricted-boot capability gate).
        guard
            let data = raw.data(using: .utf8),
            let decoded = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
            let rawList = decoded as? [String]
        else {
            CapabilityPolicy.failClosed(
                "SPECTRA_CONFORMANCE_UNIX_CAPS is set but is not valid JSON array-of-strings: \(raw)"
            )
        }

        var caps = Set<Capability>()
        for token in rawList {
            guard let cap = Capability(rawValue: token) else {
                CapabilityPolicy.failClosed(
                    "SPECTRA_CONFORMANCE_UNIX_CAPS contains an unknown capability: \"\(token)\""
                )
            }
            caps.insert(cap)
        }
        self.restrictedGrant = caps
    }

    /// Forces `shared`'s lazy initializer to run now. Call once, early, during
    /// process boot (see DaemonContext.init) — never on a request path.
    static func validateAtBoot() { _ = shared }

    /// stderr + nonzero exit; never returns (Never lets call sites `guard ...
    /// else { failClosed(...) }` without an extra `return`/`fatalError`).
    private static func failClosed(_ message: String) -> Never {
        FileHandle.standardError.write(Data("[spectra-daemon] fatal: \(message)\n".utf8))
        exit(1)
    }

    /// The capability set granted to the current (single, unix-peer) caller.
    func grantedCapabilities() -> Set<Capability> {
        restrictedGrant ?? Set(Capability.allCases)
    }

    /// Mirrors src/daemon/security.ts assertCapabilities: required ⊄ granted →
    /// throws a `capability_denied` / 403 DaemonApiError. Called BEFORE param
    /// validation for every native op dispatch (S1's Router, per the pinned
    /// call site: `try CapabilityPolicy.shared.assert(entry.requiredCapabilities,
    /// operation: operation)`).
    func assert(_ required: [Capability], operation: String) throws {
        let granted = grantedCapabilities()
        let missing = required.filter { !granted.contains($0) }
        guard missing.isEmpty else {
            throw DaemonApiError(
                .capabilityDenied,
                "Caller lacks capabilities for \(operation): \(missing.map(\.rawValue).joined(separator: ", "))",
                status: 403
            )
        }
    }
}
