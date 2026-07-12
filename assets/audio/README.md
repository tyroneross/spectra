# Spectra audio assets

A Spectra-owned catalogue of audio for video production and app sound design.
See `manifest.json` for the tagged index (id, role, genre, energy, duration,
source, licensing, suggested use).

## Roles

- **bed** — background music under videos. Pass to `polish-script` via `music`.
  Genres: `warm-chill` (intros / calm), `driving-electro` (energy / feature),
  `hiphop-rnb`, `funk`. ~24s, mixed as standalone loops — **duck ~15 dB** when
  placed under a video.
- **sfx-cue** — per-beat sound cue. Pass to a `polish-script` beat via `sound`.
  Six personality-mapped cues (precision / verification / momentum / craft /
  foundation / attention).
- **alert** — short app/UI event tones (notify / success / error / message /
  complete / warning / open / dismiss). Intended for host apps like Easy
  Terminal's status events; not a Spectra render input.

## Provenance & licensing

- **Beds** are rendered from **GarageBand Apple Loops** (royalty-free, licensed
  for use in your own productions). Only the rendered mixdowns live here — not
  the raw loops. Each bed layers one same-key/same-tempo stem *family*.
- **SFX cues + alerts** are original synthesis (ffmpeg lavfi), no third-party
  content.

## Status: catalogued, not wired

This is a **parallel catalogue**, not yet part of `spectra_library` — that tool
today only types `screenshot | video | walkthrough` (no `audio` kind), and
`polish-script`'s `music`/`sfx` take file **paths**, not library refs. Promotion
into the real library is a held decision (needs an `audio` kind + music/sfx
library-ref resolution). Until then, reference these by path from `assets/audio/`.

## Not here yet

Longer **arranged** tracks (intro → build → outro, 60–120s, energy variants) —
a future build. Current beds are static 24s loops.
