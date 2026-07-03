// macos/Spectra/DaemonCore/FakeDriver.swift
//
// M3.G2 (S1) — the conformance-seed Driver seam. A deterministic, headless
// conformer of the frozen `Driver` protocol (DriverProtocol.swift), used ONLY
// when `SPECTRA_CONFORMANCE_SEED=1` and createSession's target carries the
// `fake:` prefix (ConnectOps.swift, this daemon's sole construction site).
// This is the seam that makes 13/16 G2 ops headless-verifiable (PC-4): every
// op handler that resolves a driver via `ctx.driverRegistry.get(sessionId)`
// exercises its REAL code path against this fake, exactly like
// tests/conformance/lib/fakes.ts's FakeDriver does for the TS daemon.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// A minimal, valid, statically-encoded 1x1 transparent PNG — the exact same
/// base64 source as tests/conformance/lib/fakes.ts's FAKE_PNG_BASE64, so the
/// fixed screenshot fixture decodes identically on both sides of the port
/// (V-B's artifact probe checks decodability + dimensions, not raw bytes, per
/// the plan's pre-ruled `generated-image-content` class — using the identical
/// source constant removes any doubt regardless of that leniency).
private let fakePngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

/// Deterministic conformance-seed conformer of the frozen `Driver` protocol.
///
/// W0 AMBIGUITY (flagged, not silently resolved either direction — see the
/// returned build summary): `tests/conformance/lib/fakes.ts`'s FakeDriver
/// uses STABLE literal element ids ("el-1" / "el-2", its `FAKE_ELEMENT_ID`)
/// that are never reassigned across calls. `DriverProtocol.swift`'s
/// `snapshot()` doc freezes SEQUENTIAL "e1".."eN" ids, "freshly for THIS
/// call", as a "byte-for-byte" invariant across EVERY conformer — no
/// FakeDriver-only carve-out is written into that frozen contract, and the
/// fakes.ts precedent predates the G2 freeze. This conformer follows the
/// newer, compiled, cross-agent W0 text literally (ids "e1"/"e2", recomputed
/// fresh on every `snapshot()` call) while mirroring EVERYTHING ELSE about
/// fakes.ts byte-for-byte: 2-element tree, role "button", label text, `value`
/// nil, `enabled` true, `focused` false, `actions` ["click"], `bounds` [0, 0,
/// 100, 24], `parent` nil, the fixed PNG, and the act-echoes-success-and-
/// resnapshots shape for a KNOWN id.
final class FakeDriver: Driver {
    private let lock = NSLock()
    private var connected = false
    private var lastElementIds: Set<String> = []
    /// Exposed for any future introspection/testing need — mirrors fakes.ts's
    /// public `actionsSeen` log (act-call history for a KNOWN element id).
    private(set) var actionsSeen: [(elementId: String, action: DriverActionType, value: String?)] = []

    /// Mirrors fakes.ts: connect() never validates `target` — it just flips
    /// `connected`. Deliberately permissive (unlike NativeDriver's eager
    /// `appName` check documented on the frozen `Driver.connect(target:)`)
    /// because the conformance-seed seam has no real transport to fail
    /// against; there is no "unusable target shape" for a fixed in-memory
    /// fixture.
    func connect(target: SpectraDriverTarget) throws {
        lock.lock(); defer { lock.unlock() }
        connected = true
    }

    func snapshot() throws -> DriverSnapshot {
        lock.lock(); defer { lock.unlock() }
        return snapshotLocked()
    }

    /// Caller must hold `lock`.
    private func snapshotLocked() -> DriverSnapshot {
        // V-B parity: match TS fakes.ts FAKE_ELEMENT_ID ("el-1"/"el-2") exactly.
        // The W0 doc's "e1..eN" wording predates the differential byte-gate; the
        // TS reference stub is the byte oracle, so we conform to it (RESUME ruling,
        // step 3). Label uses \(id) → "Fake Element el-1" == TS output.
        let ids = ["el-1", "el-2"]
        lastElementIds = Set(ids)
        let elements = ids.map { id in
            DriverElement(
                id: id,
                role: "button",
                label: "Fake Element \(id)",
                value: nil,
                enabled: true,
                focused: false,
                actions: ["click"],
                bounds: DriverBounds(x: 0, y: 0, width: 100, height: 24),
                parent: nil
            )
        }
        let now = Int(Date().timeIntervalSince1970 * 1000)
        return DriverSnapshot(
            url: "https://fake.local/conformance",
            appName: "Fake Conformance App",
            platform: .web,
            elements: elements,
            timestampMs: now,
            metadata: DriverSnapshotMetadata(elementCount: elements.count, stableAtMs: now, timedOut: false)
        )
    }

    /// FROZEN CONTRACT (PC-4, DriverProtocol.swift act() doc): an
    /// unknown/stale elementId returns `success: false` + a descriptive
    /// error + a FRESH re-snapshot — it does NOT throw. fakes.ts's own act()
    /// never validates elementId at all (always success:true); that TS stub
    /// predates the G2 freeze's explicit stale-id clause. This conformer
    /// layers the W0-required validation on top of fakes.ts's echo
    /// semantics: a known id (e1/e2 from the most recently captured
    /// snapshot) still echoes success:true exactly like fakes.ts; an
    /// unknown/stale id is the one behavior fakes.ts never exercised.
    func act(elementId: String, action: DriverActionType, value: String?) throws -> DriverActResult {
        lock.lock()
        let isKnown = lastElementIds.contains(elementId)
        if isKnown {
            actionsSeen.append((elementId: elementId, action: action, value: value))
        }
        lock.unlock()

        // Always freshly captured POST-action, success or failure alike
        // (frozen act() contract's last bullet).
        let freshSnapshot = try snapshot()
        guard isKnown else {
            return DriverActResult(
                success: false,
                error: "unknown or stale elementId: \(elementId)",
                snapshot: freshSnapshot
            )
        }
        return DriverActResult(success: true, error: nil, snapshot: freshSnapshot)
    }

    /// Byte-identical fixture to fakes.ts's fakePngBuffer() — decodable,
    /// non-empty PNG bytes, always (never throws in practice; the static
    /// constant above is a known-good literal).
    func screenshot() throws -> Data {
        guard let data = Data(base64Encoded: fakePngBase64) else {
            throw DaemonApiError(.internalError, "FakeDriver PNG fixture failed to decode", status: 500)
        }
        return data
    }

    /// Best-effort, never throws — mirrors fakes.ts's no-op close(). No
    /// shared underlying infrastructure to preserve for a fake driver, but
    /// the no-throw contract still applies.
    func close() {}

    func disconnect() {
        lock.lock(); defer { lock.unlock() }
        connected = false
    }
}
