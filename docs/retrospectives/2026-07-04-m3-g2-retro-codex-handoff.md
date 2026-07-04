# M3.G2 retrospective + Codex handoff (2026-07-04)

**From:** Claude (M3 lane — Swift daemon-core strangler)
**To:** Codex (M1-GUI / M4-CDP / M5-pipeline lanes)
**Status of M3.G2:** built, gate-verified, committed to `main`; live flip proven-executable but rolled back pending one reboot (macOS TCC quirk). Two real bugs fixed — including a **recording privacy leak**.

---

## 1. TL;DR — what you're picking up

- **G2 (16 capture/AX ops native in the Swift daemon-core) is DONE + verified.** Headless V-A + V-B ×3 green, on-device V-C 9/9, capability-mutation gates bite. Commits `660513d` → `a5e8f3d` on `main`.
- **The daemon-core is now `0.3.2-swift-g2`** and can serve all 16 G2 ops native. Routing v2 config lives at `~/.spectra/routing-config-g2.json`.
- **The live flip is NOT persisted.** It went live and was verified, then rolled back on a macOS TCC sticky-grant bug (§4). Machine is back on the original G1 topology, Spectra MCP-verified working. Re-flip = 2 min after a reboot (`.build-loop/flip-evidence/gate-g2-flip-status.md`).
- **Two bugs you should know about are fixed** (§3): a recording privacy leak + a recording RPC helper-path/leak bug. Both touch `native/swift/` — YOUR M4/M5 code shares that helper (`spectra-native`), so read §3.

---

## 2. Verification approach (reuse this for M4/M5)

The G2 port used a **three-class gate** that repeatedly convicted real bugs a compile-green + unit-pass would have shipped. Recommend adopting it for the M4 CDP-in-Swift and M5 pipeline ports.

**V-A — headless contract conformance.** The existing conformance vitest suite (`tests/conformance/*.test.ts`) run against a standalone Swift daemon via `SPECTRA_DAEMON_SOCKET`, with a milestone env gate (`SPECTRA_CONFORMANCE_MILESTONE=g2`) that widens the verifiable-op allowlist. Proves each op's wire shape + error taxonomy. **The 4 importer test files are FROZEN (SG-5, zero edits)** — widen via `tests/conformance/lib/external-mode.ts`, not by editing the `.test.ts` files.

**V-B — differential semantic parity (the adversarial gate).** Two independently-booted daemons (TS reference vs Swift) driven with identical deterministic fixtures, compared op-by-op. This is where compile-green hides bugs. Acceptance = **3 consecutive fully-green chains, each including the G1 31/31 arm**. `macos/Spectra/DaemonCore/verify-g2-suite.ts`.

**V-C — on-device native-integration (user-present, once before flip).** 9 scripted steps against a real repo TestApp under the **launchd production context** (TCC attribution keys on the launch context — a dev-shell run is a FALSE result). `verify-g2-ondevice.sh` + `.ts`.

**Capability-mutation gates (T-26 / Gate D#2).** Prove the capability gate BITES by transiently removing a `CapabilityPolicy.shared.assert` call → confirm RED → revert → confirm GREEN. Evidence: `.build-loop/flip-evidence/gate-g2-capability-mutation.txt`. Finding worth reusing: a single-layer mutation was absorbed by the layered design (`dispatchNativeDecoded`'s assert catches affinity ops routed native); only the all-layers mutation proved the class bites. Mutate ALL enforcement sites, not one.

**Discipline that mattered (please carry it):**
- **Do NOT self-mask the comparator to reach green.** When V-B convicted ~20 divergences, they were partitioned by two Fable "Advisor" rulings (`docs/plans/m3-g2-vb-advisor-ruling.md` + `-2.md`) into *volatile* (comparator/mask change, each with a named surviving floor) vs *real* (implementer fix). Every exclusion names what stays asserted so a real regression still convicts.
- **A mask may never hide a semantic divergence** — element count, role sequence, labels-after-id-normalization, bounds tuples, enabled/actions type parity stay compared even inside a masked field.
- **Ground-truth over inference.** One suspected bug (ConnectOps fake-seam) was DISPROVEN by booting the daemon and probing the socket directly, rather than editing correct code.
- **Real-Chrome/stateful ops are non-deterministic** — `createSession(web)` launches a real headless Chrome; it must be a classed basis-exclusion in differential gates, not byte-compared. (This bit us in chain 3: a Chrome flake false-RED'd Gate B-diff after chains 1&2 passed.)

---

## 3. Bugs fixed — READ THIS (shared `spectra-native` helper)

### 3a. Recording privacy leak (`native/swift/SingleWindowRecording.swift`) — commit `241847d`

**THE IMPORTANT ONE.** Single-window recording is supposed to capture ONLY the target window's pixels (SCK desktop-independent-window filter — occlusion-proof). Two bugs defeated that:

1. **Hard title filter** (`selectSingleWindow`): macOS sessions default `session.name` to an app-name slug (`core/session.ts` `generateName`, e.g. `"secrets-vault"`), passed as the SCK title hint and used as a HARD filter (`appMatches && titleMatches`). A real window titled `"Secrets Vault"` never substring-matches `"secrets-vault"` (space vs hyphen) → resolution threw → **fell back to full-display capture**. Fix: app-name is the hard filter; the title hint only *disambiguates* multiple same-app windows, falling back to the app-only set.

2. **The actual leak** (`singleWindowSeedPixelBuffer`): the writer "seed frame" used `/usr/sbin/screencapture -x` (full-DISPLAY, all monitors, whatever's on top) then cropped to the window rect. That crop is **occlusion-DEPENDENT** — anything overlapping the window's screen region got captured and cropped in. Live-reproduced capturing System Settings' Privacy pane *instead of* the target window. Fix: removed the full-display-then-crop path entirely; the seed frame now comes only from `SCScreenshotManager.captureImage(contentFilter:)` (window-isolated, same filter as the stream). No desktop substitution is possible anymore.

**Why you care (M4/M5):** any capture/record path you build in Swift that uses a "grab the screen then crop" fallback has this leak. Always capture from the window-isolated SCK filter, never a display screenshot cropped to a rect.

### 3b. Recording RPC helper-path + subprocess leak (`RecordingOps.swift`) — commit `e6874bc`

- `resolveNativeBinaryPath()` used bare `NSHomeDirectory()` instead of the env-first `HOME` pattern (`BridgeClient.swift:84`, `StoragePath.swift:81`). Under a launchd daemon with an env-only `HOME` override it resolved the WRONG `spectra-native`. **This is why `screenshot` worked but `startRecording` didn't — they talked to two different helper binaries.** Use the env-first HOME pattern everywhere you resolve `~/.spectra/bin/*`.
- A failed `startRecording` never aborted the spawned `spectra-native` (rpc was a `let` unreachable from `catch`). Every failure leaked a live SCK-holding subprocess; the pile-up turned fast failures into a 15s timeout. Always make the spawned-process handle a `var` assigned pre-`catch` so cleanup can reach it.

### 3c. Known-stale artifact (action for you)

`~/.spectra/bin/spectra-native` was a stale "coming in Phase 3a" stub build. I ran `npm run build:native` (fresh). If your M4/M5 work touches `native/swift/*`, rebuild + re-sign the helper, and note grants key on code signature (re-sign with the SAME Developer ID identity or grants drop).

---

## 4. Open items / handoff

| Item | Owner | Notes |
|------|-------|-------|
| **G2 route flip (persist)** | user + M3 | Proven-executable; blocked on a macOS TCC sticky-grant bug (bare binary re-add restores a prior cdhash's grant). Reboot clears it. Procedure: `gate-g2-flip-status.md`. |
| **Marketing-video window-scope** | open | MCP `spectra_capture start_recording` still emits display-sized output — resolved `windowId` isn't engaging window-scope through the daemon→helper orchestration (helper-direct test gets correct window size). Needs instrumented debug of the windowId plumbing on a low-SCK-load machine. |
| **C11 Swift-baseline corpus refresh** | M3 | Post-flip, record a Swift-native corpus for the 16 G2 ops so `corpus.test.ts` has a valid same-implementation byte-diff basis (currently createSession corpus is a classed exclusion). |
| **M4 CDP-in-Swift / M5 pipeline** | **you (Codex)** | G3-web flips after M4 lands + oracle-green; G4-demo after M5. Reuse the §2 gate approach. The daemon-core routing config (`SPECTRA_ROUTING_CONFIG` v2) is how you add your ops to the native surface when ready. |

---

## 5. Durable lessons

1. **TCC attribution is launch-context-sensitive AND signature-sticky.** On-device gates must run under launchd, not a dev shell. Bare executables (no bundle id) can't be `tccutil reset` by name and accumulate sticky stale grants across rebuilds — give production helpers a real app bundle / stable bundle id if they need durable TCC grants, or expect a reboot to clear churn.
2. **Differential parity gates earn their cost.** V-B convicted bugs (ProxyClient keep-alive/SSE in G1; the recording privacy leak surfaced via the same discipline) that standalone-pass + compile-green shipped clean.
3. **Full-display-then-crop is a privacy anti-pattern** for any "capture one window" feature. Capture from the window-isolated source.
4. **env-first HOME** resolution everywhere under launchd — bare `NSHomeDirectory()` silently ignores env-only overrides and splits your process across two homes.
