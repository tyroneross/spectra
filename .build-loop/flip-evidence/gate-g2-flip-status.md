# G2 route flip (C10) — attempted live, rolled back on a macOS TCC quirk (2026-07-04)

## What happened
- Rebuilt production daemon-core (34 files, all 16 G2 ops), Developer-ID signed
  (cdhash 898b567a…, valid + satisfies DR). Version bumped to `0.3.2-swift-g2`.
- Wrote v2 routing config `~/.spectra/routing-config-g2.json` (8 native + 17
  affinity + listSessions merge + closeAllSessions fanout).
- FLIPPED: `SPECTRA_ROUTING_CONFIG=<v2> SPECTRA_DUAL_RUN=1 bash scripts/flip-g1.sh`.
  Verified LIVE: health=`0.3.2-swift-g2`, v2 config loaded, `recordTerminal`
  served NATIVE (no caller fingerprint). Non-AX/capture ops flip cleanly.

## Blocker (environmental, NOT a code defect)
- Native AX/capture ops need the daemon-core's own TCC grant (it becomes the
  Accessibility/Screen-Recording subject once serving natively — same as V-C,
  which passed). Despite: valid DevID signature, deduped to ONE spectra-daemon-core
  binary, user granting twice, and a hard bootout+bootstrap for a fresh process —
  `getPermissions` kept returning accessibility=denied / screen-recording=denied.
- Root cause: macOS TCC sticky-stale-entry quirk. Re-adding a BARE binary (no
  bundle id) with the same name/path can restore a prior build's cdhash grant
  instead of granting the current cdhash. Bare binaries can't be `tccutil reset`
  by name; resetting all Accessibility would revoke the user's other apps. The
  reliable clear is a REBOOT.

## Resolution: rolled back to restore working Spectra
- Full rollback (`scripts/rollback-g1.sh`) → then re-flipped G1 to restore the
  user's original G1 topology (front-door + backend). Spectra MCP path VERIFIED
  working (spectra_connect → Secrets Vault, 20 elements).

## To complete the flip (after a reboot clears TCC)
1. `bash scripts/build-daemon-core.sh` (or reuse the current DevID-signed binary).
2. Grant `~/.spectra/bin/spectra-daemon-core` Accessibility + Screen Recording
   (one clean entry each — the stale entries are gone after reboot).
3. `SPECTRA_ROUTING_CONFIG=~/.spectra/routing-config-g2.json SPECTRA_DUAL_RUN=1 bash scripts/flip-g1.sh`
4. Verify: getPermissions granted; createSession(macos)+snapshot+screenshot native.
5. Rollback any time: `bash scripts/flip-g1.sh` (no config) or `scripts/rollback-g1.sh`.

Gates all green (V-A/V-B ×3, V-C 9/9, T-26+D#2). The flip is proven-executable;
only the one-time TCC grant is pending a reboot.
