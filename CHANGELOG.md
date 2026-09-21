# Changelog

## [0.4.3](https://github.com/tyroneross/spectra/compare/spectra-v0.4.2...spectra-v0.4.3) (2026-09-17)


### Features

* **status:** spectra_session action=status preflight with serving build and grantee ([7b802a4](https://github.com/tyroneross/spectra/commit/7b802a4d4ef5b792bad8dfd6042e352e9d300a64))


### Bug Fixes

* **build:** include RecordingNotice.swift in build:composite ([cabf024](https://github.com/tyroneross/spectra/commit/cabf0244793eab0e2f7feaa89c8f15a6e0b3ba93))
* **native:** refuse ambiguous app-name targets instead of binding the first match ([41439b8](https://github.com/tyroneross/spectra/commit/41439b804e560fc41b162b743a44c0fc0a1c33a4))
* **permissions:** name the process macOS actually checks for Accessibility ([69aaca8](https://github.com/tyroneross/spectra/commit/69aaca8c0792ccf11a17282301b910470fb229e5))
* **proxy:** bound health's backend shadow call to 5s; build dist ([3fcc083](https://github.com/tyroneross/spectra/commit/3fcc0838e053ac3d32d268cc73b0d346ddc63b8b))
* **proxy:** send envelope operation on Swift→TS internal calls; find launcher across hops ([486cafb](https://github.com/tyroneross/spectra/commit/486cafb1508e08fdaefe2fa4fa16d1f191f42821))
* **status:** name a grantee only for launcher-started daemons; record servedBy in corpus ([fde3d1a](https://github.com/tyroneross/spectra/commit/fde3d1aac604b421a45c686bafa013a2b4b29e99))

## [0.4.2](https://github.com/tyroneross/spectra/compare/spectra-v0.4.1...spectra-v0.4.2) (2026-09-13)


### Bug Fixes

* **resolve:** recognize absent normalized roles without losing compatibility ([5b4dfe3](https://github.com/tyroneross/spectra/commit/5b4dfe3948283cf6a8a6992c467b1d1fa9ae6b1e))
* **resolve:** select ordinal matches before fuzzy scoring ([3d6075e](https://github.com/tyroneross/spectra/commit/3d6075ecc69673d9495873e63afc42354c674c2a))

## [0.4.1](https://github.com/tyroneross/spectra/compare/spectra-v0.4.0...spectra-v0.4.1) (2026-09-06)


### Features

* **marketing:** define the creative quality protocol ([4c3bb14](https://github.com/tyroneross/spectra/commit/4c3bb142034776c66e347b616b75f97db6770504))
* **marketing:** ship deterministic planner and command ([7f21f55](https://github.com/tyroneross/spectra/commit/7f21f55dbad961bf9a10671fc839ba4e991247d3))
* **pipeline:** animate step-card entrances ([71f82d3](https://github.com/tyroneross/spectra/commit/71f82d3bed329c6e99612b719a61a67e7ce7cc4c))
* **pipeline:** layered sound design — music bed + SFX cues mixed via buildMixedAudioArgs ([8cbfb0d](https://github.com/tyroneross/spectra/commit/8cbfb0d7d4755512faf810f836bb489ecd6190f0))
* **pipeline:** per-beat sound cues — Beat.sound feeds the layered-audio mix ([9093f72](https://github.com/tyroneross/spectra/commit/9093f7249da4832cac4672832f78eded714ee4dd))
* **pipeline:** render script.title as a 2.2s intro title card ([0ece64b](https://github.com/tyroneross/spectra/commit/0ece64bb0437935712fd715878f5130ec6c87b7a))
* **plugin:** route feedback to GitHub Issues, drop the inbox ([04087b7](https://github.com/tyroneross/spectra/commit/04087b79d08f64bf6791eaf87995678df4c02df3))
* **recording:** crash-safe writes + on-screen REC notice [seq 5546] ([dc9b066](https://github.com/tyroneross/spectra/commit/dc9b066e41d109bec120c97a44f4966a9d38211e))
* **skills:** audio-cues maps demo beats to sound cues deterministically ([352d10c](https://github.com/tyroneross/spectra/commit/352d10cc94b65287e27c4810a854d29819737863))


### Bug Fixes

* **cli:** treat an omitted JSON argument as {} so `spectra health` works ([6dd1777](https://github.com/tyroneross/spectra/commit/6dd1777a31d21951c1c01686e919fd38e73f6795))
* **macos:** enforce bundle-owned privacy helpers ([f3e332d](https://github.com/tyroneross/spectra/commit/f3e332d602c2055b4a6a5888f6113592daff1669))
* **macos:** harden signing fallback + clear regrant marker (review findings) ([fea3013](https://github.com/tyroneross/spectra/commit/fea30134753b56afcc8f8d5b29811fb0d6d0bf92))
* **macos:** stable signing identity + rebuild-staleness self-diagnosis for TCC grants ([bef8cfb](https://github.com/tyroneross/spectra/commit/bef8cfb83061de21739408f1e5e7eae13882343f))
* **media:** finalize recordings for broad playback ([c32d72f](https://github.com/tyroneross/spectra/commit/c32d72fc5372a925538760f74efbe96ff508c34d))
* **pipeline:** final caption owns a clip-tail window, no beat-caption overlap ([7577723](https://github.com/tyroneross/spectra/commit/7577723355e69f9263058f4793fe5065ea67c55f))
* read last-release-sha by putting it where release-please looks ([b8afb51](https://github.com/tyroneross/spectra/commit/b8afb51c23d58e1b447fb53cbacf9d2dd9ee496d))
* replace an incorrect contact address in 59 copyright headers ([08518b7](https://github.com/tyroneross/spectra/commit/08518b7c3365d1e4eb038f16e5acda431b9bfd17))
* **skills:** front-load trigger and boundary in skill descriptions ([fc55ff0](https://github.com/tyroneross/spectra/commit/fc55ff01cebcab42c4d95499d8b4caba0d3fb7ac))
* **tests:** read the whole codesign stream instead of exiting early ([48d59ce](https://github.com/tyroneross/spectra/commit/48d59cee34815102169627d1111928739893c43d))
* **web-ui:** bind the local UI to loopback instead of every interface ([04bdefb](https://github.com/tyroneross/spectra/commit/04bdefb781ca9afd9d8ec56b657b4633aeddf47e))
