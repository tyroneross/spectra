# Spectra M1 packaging and attribution boundary audit

symptom:
  - Initial contract probes were green while a symlinked stable parent could redirect production helpers outside the installed app path.
  - The native manager separately accepted a physical app whose `Contents/Helpers` directory escaped through a symlink.
  - Swift recording could continue after strict cursor-helper resolution failed.
  - The legacy on-device verifier could recreate real daemon labels with bare helpers.
  - The first real Release build produced a universal app with arm64-only helpers.
  - The Make recipe could swallow nested copy/sign failures, and the first Release oracle did not distinguish ad-hoc from Apple signing.

root_cause:
  - Fixture coverage validated helper files and app-level symlinks, but not parent-directory symlinks or every LaunchAgent producer.
  - Optional cursor behavior did not distinguish explicit development mode from production bundle mode.
  - The old verifier predated the explicit helper-mode contract.
  - Helper compilation inherited the build host architecture while Xcode built the app for arm64 and x86_64.
  - The compound Make recipe lacked fail-fast shell options, while generic `codesign --verify` proves integrity but not signing mode, hardened runtime, or signer parity.

fix:
  - Reject symlink components and canonical-path escapes in shell, Swift, TypeScript, and packaging boundaries.
  - Validate the manager's canonical `Contents/Helpers` directory before any inventory or plist write.
  - Fail recording startup on bundle-mode cursor resolution errors; retain warnings only for explicit development mode.
  - Refuse the verifier's obsolete production mode and declare development helper paths in both test plists.
  - Build Release helpers for arm64 and x86_64, enforce architecture parity in the Xcode phase, and verify the signed final bundle.
  - Propagate Make failures and require exact inventory, hardened runtime, requested signature mode, and common signer/team before replacing artifacts.

tags:
  - macos
  - tcc-attribution
  - launchagent
  - fail-closed
  - packaging
  - universal-binary

files:
  - scripts/spectra-helper-paths.sh
  - macos/Spectra/Daemon/LaunchAgentManager.swift
  - macos/Spectra/DaemonCore/BundleHelperPaths.swift
  - macos/Spectra/DaemonCore/RecordingOps.swift
  - macos/Spectra/DaemonCore/verify-g2-ondevice.sh
  - src/native/compiler.ts
  - macos/Makefile
  - scripts/build-swift-helper.sh
  - scripts/build-and-refresh.sh
  - tests/macos/launch-agent-contract.sh
  - tests/macos/helper-packaging-contract.sh
  - tests/macos/release-bundle-contract.sh

verification:
  - `npm test`: 966 passed, 2 skipped.
  - Full Xcode test: 75 passed.
  - `npm run build:dmg:adhoc`: universal Release app and DMG built with no user signing identity.
  - `tests/macos/release-bundle-contract.sh Spectra.app`: inventory, architecture parity, nested/outer signatures, metadata, and resource scope passed.
  - Rosetta x86_64 `spectra-screen-recording-preflight --no-request`: exited 0 without prompting.
