# V-C on-device gate — 8/9 GREEN (2026-07-03, user present)

Run: `verify-g2-ondevice.sh --skip-build`, Developer-ID-signed daemon under launchd
production context, real AX grant + Screen Recording grant, real repo TestApp.
Evidence: `.build-loop/flip-evidence/gate-g2-ondevice.txt` + `gate-g2-tcc-spike.txt`.

| Step | Op | Result |
|------|-----|--------|
| 1 | TCC-attribution spike (accessibility, launchd context, ppid=1) | ✅ GREEN |
| 2 | createSession(macos) + real AX snapshot (elementCount=10) | ✅ GREEN |
| 3 | act press → state change verified by re-snapshot | ✅ GREEN |
| 4 | computerUse snapshot vs TestApp | ✅ GREEN |
| 5 | screenshot full mode → decodable PNG | ✅ GREEN (human-visual = excluded, non-interactive) |
| 6 | **startRecording→stopRecording (SCK video)** | ❌ **RED — RPC timeout** |
| 7 | discover + walkthrough one-pass | ✅ GREEN |
| 8 | observe + analyze (real AX tree) | ✅ GREEN |
| 9 | step (intent) + llmStep (1-action native) | ✅ GREEN |

## Integration fixes applied to land 8/9 (were S7 pre-integration scaffold gaps)
- `verify-g2-ondevice.sh`: `-parse-as-library` TestApp compile; provision the
  `spectra-native` AX helper into the test HOME; **launch the TestApp** before the
  9-step handoff (scaffold only compiled it); kill it in teardown.
- `verify-g2-ondevice.ts`: createSession target = flat string (ConnectOps landed);
  `computerUse action: 'snapshot'` string discriminator (schemas.ts:434); pass
  `name:` so startRecording's window-title hint matches; TTY-guard the human
  readline (was ERR_USE_AFTER_CLOSE in orchestrated runs).
- `native/swift/TestApp/TestApp.swift`: clear window title + a persistent purpose
  banner ("test fixture, closes itself, ⌘Q to close") — the unlabeled window
  popping up read as malware (user-reported).
- **PRODUCT FIX — `ConnectOps.swift`**: a macos session's default `name` is now the
  app-name slug (TS `generateName` parity, session.ts:372-383), NOT `session-<id>`.
  This is contract-visible AND load-bearing: `session.name` feeds startRecording's
  HARD SCK window-title filter — the old default could never match a real window.

## Step 6 — REMAINING (real bug, blocks the recording-route flip only)
NOT a permission issue: screenshot uses the SAME `spectra-native` bridge and is
GREEN, so Screen Recording is attributed. The G2 `RecordingOps` RPC to
spectra-native's `startRecording` times out at 15s ("spectra-native started").
Production recording (TS daemon → same helper) works (CURRENT.md), so it's the new
Swift RecordingOps `NativeRecordingRpcProcess` RPC path. Dispatched to a focused
debug. **Flip decision: hold the 3 recording ops (startRecording/stopRecording/
getRecording) on TS proxy until step 6 goes green; the other 13 G2 ops are V-C-verified.**
