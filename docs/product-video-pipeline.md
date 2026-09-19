# Product video pipeline

Spectra should compile one approved edit plan into every downstream artifact. Capture, rendering, review, editor handoff, and publishing consume that plan; none of them owns story text or timing.

## Pipeline

1. **Brief and claim boundaries**
   - Input: audience, objective, product evidence, prohibited claims.
   - Output: claim ledger with `supported`, `qualified`, or `blocked` status.
   - Gate: every planned message has product evidence and an owner.
2. **Narrative and edit plan**
   - Input: claim ledger and source inventory.
   - Output: validated `edit-plan.json` with beats, timing, captions, and narration.
   - Gate: unique beat IDs, ordered non-overlapping timing, valid claim references, narration that fits each beat.
3. **Capture requirements**
   - Input: edit plan and existing source registry.
   - Output: only the missing capture recipes.
   - Gate: a recipe identifies the target build, initial state, actions, viewport, and privacy profile.
4. **Capture and source registry**
   - Input: recipes.
   - Output: immutable source files with hashes and provenance.
   - Gate: stable app state, expected dimensions, no unexpected notifications or private data.
5. **Deterministic compile**
   - Input: edit plan and source registry.
   - Output: rough cut, captions, narration jobs, render manifest, and review frames.
   - Gate: generated durations and hashes match the edit plan.
6. **Automated QA**
   - Input: compiled outputs.
   - Output: technical and privacy reports.
   - Gate: `ffprobe` verifies media properties; OCR covers every frame in every intentionally sharp region; captions and narration match the plan.
7. **Human review**
   - Input: rough cut, claim ledger, QA reports.
   - Output: approval tied to the edit-plan and render hashes.
   - Gate: any story, timing, source, or render change invalidates approval.
8. **Finals and derivatives**
   - Input: approved plan.
   - Output: web master, edit master, teaser, captions, and audio stems.
   - Gate: QA runs again on the final files.
9. **Editor handoff**
   - Input: approved final hashes.
   - Output: verified Apple editor bundle; FCPXML only when timeline interchange is needed.
   - Gate: copied file hashes match the approved render manifest.
10. **Publish and measure**
    - Input: an approved render hash.
    - Output: published placements and performance observations.
    - Gate: publication records the exact asset hash and channel-specific derivative.

## Tool choices

- Use **FFmpeg and ffprobe** as the renderer and technical validator. Generate commands from the edit plan instead of maintaining campaign-specific shell scripts.
- Use **Vision OCR** inside the privacy gate. Sampling is insufficient for intentionally unblurred UI regions.
- Use **ScreenCaptureKit** for native macOS capture and Spectra's existing **CDP** path for web capture when the source registry lacks required footage.
- Defer **Remotion** until motion graphics exceed the title and overlay capabilities already available in Spectra and FFmpeg.
- Generate **FCPXML** from the canonical plan only when a Final Cut workflow needs an editable timeline. File packaging remains useful without it.

## Build order

1. Canonical edit-plan schema, compiler outputs, content-addressed narration keys, and claim/timing validation.
2. Exhaustive privacy gate for every sharp region, plus technical media validation.
3. Source registry and generated FFmpeg render graph.
4. Review UI with hash-bound approvals.
5. Derivative presets and optional FCPXML export.
6. Publishing receipts and channel analytics.
