# Spectra Capture Optimization — Implementation Plan

**Spec**: `docs/superpowers/specs/2026-03-23-spectra-capture-optimization-design.md`
**Date**: 2026-03-23

---

## Chunk 1 — Foundation (parallel, no deps)

### Task 1: Add `navigate?()` to Driver interface
- **File**: `src/core/types.ts`
- **Change**: Add `navigate?(url: string): Promise<void>` to `Driver` interface
- **Verify**: Existing tests still pass (`vitest run`)

### Task 2: Intelligence types
- **File**: `src/intelligence/types.ts`
- **Content**: Viewport, CaptureIntent, CaptureManifest, CaptureEntry, UIState type re-exports
- **Verify**: TypeScript compiles

### Task 3: Minimal PNG codec
- **Files**: `src/media/png.ts`, `tests/media/png.test.ts`
- **Functions**: decodePng, encodePng, cropImage, resizeNearest, toGrayscale
- **Test approach**: Create known PNG buffers, decode, verify pixel values. Encode, re-decode, verify roundtrip. Crop known regions, verify dimensions. Resize to 9x8, verify output size.
- **Verify**: `vitest run tests/media/png.test.ts`

### Task 4: Importance scoring
- **Files**: `src/intelligence/importance.ts`, `tests/intelligence/importance.test.ts`
- **Functions**: scoreElements, findRegions
- **Test approach**: Score arrays of mock elements with known roles/positions/labels. Verify buttons score higher than decorative groups. Verify top-left bias. Verify region clustering.
- **Verify**: `vitest run tests/intelligence/importance.test.ts`

## Chunk 2 — Detection (depends on Chunk 1)

### Task 5: Change detection (dHash + structural diff)
- **Files**: `src/intelligence/change.ts`, `tests/intelligence/change.test.ts`
- **Functions**: perceptualHash, hashDistance, diffSnapshots, detectChange
- **Test approach**: Generate 2 PNG buffers (identical → distance 0, different → distance > 0). Structural diff with added/removed elements. Combined detection with threshold.
- **Verify**: `vitest run tests/intelligence/change.test.ts`

### Task 6: State detection
- **Files**: `src/intelligence/states.ts`, `tests/intelligence/states.test.ts`
- **Functions**: detectState, createStateTriggers
- **Test approach**: Detect loading (progressbar elements), error (alert elements), empty (few elements + "no items" label), populated (many content elements).
- **Verify**: `vitest run tests/intelligence/states.test.ts`

### Task 7: Smart framing
- **Files**: `src/intelligence/framing.ts`, `tests/intelligence/framing.test.ts`
- **Functions**: frame, autoFrame
- **Test approach**: Given known element positions and a mock PNG, verify crop rects. Test aspect ratio enforcement. Test padding. Test autoFrame returns top regions.
- **Verify**: `vitest run tests/intelligence/framing.test.ts`

## Chunk 3 — Navigation & Media (depends on Chunks 1-2)

### Task 8: Navigation engine
- **Files**: `src/intelligence/navigation.ts`, `tests/intelligence/navigation.test.ts`
- **Functions**: crawl, discoverByScroll
- **Test approach**: Mock driver that returns scripted snapshots per action. Verify BFS order, deduplication, max depth, scroll termination. Verify sensitive content detection.
- **Verify**: `vitest run tests/intelligence/navigation.test.ts`

### Task 9: Capture cleanup
- **Files**: `src/media/clean.ts`, `tests/media/clean.test.ts`
- **Functions**: prepareForCapture, restoreAfterCapture
- **Test approach**: Mock CdpConnection, verify correct CDP commands sent (scrollbar hide, etc). Verify simctl status_bar command for iOS.
- **Verify**: `vitest run tests/media/clean.test.ts`

### Task 10: Video pipeline
- **Files**: `src/media/pipeline.ts`, `tests/media/pipeline.test.ts`
- **Functions**: startVideoCapture, stopVideoCapture, encodeVideo
- **Test approach**: Verify ffmpeg command construction for lossless capture, encode pass, hardware accel flag. Skip actual ffmpeg execution in tests.
- **Verify**: `vitest run tests/media/pipeline.test.ts`

### Task 11: Enhanced capture + CDP clip
- **Files**: `src/media/capture.ts` (enhance), `src/cdp/page.ts` (add clip param)
- **Changes**: Add element-level capture (clip param), region capture, format selection
- **Verify**: Existing capture tests pass + new tests for element capture

## Chunk 4 — MCP Integration (depends on all above)

### Task 12: Enhanced spectra_capture tool
- **File**: `src/mcp/tools/capture.ts`
- **Changes**: Add mode, elementId, region, aspectRatio, clean, quality params
- **Verify**: `vitest run tests/mcp/`

### Task 13: New spectra_discover tool
- **Files**: `src/mcp/tools/discover.ts`, `tests/mcp/discover.test.ts`
- **Orchestrator**: Wires together crawl + detect + score + frame + capture
- **Verify**: Integration test with mock driver

### Task 14: New spectra_analyze tool
- **Files**: `src/mcp/tools/analyze.ts`, `tests/mcp/analyze.test.ts`
- **Returns**: State, regions, top elements
- **Verify**: `vitest run tests/mcp/analyze.test.ts`

### Task 15: Export + MCP server registration
- **Files**: `src/index.ts`, `src/mcp/server.ts`
- **Changes**: Export new intelligence types, register discover + analyze tools
- **Verify**: `vitest run` (full suite)

---

## Execution Strategy

- Chunks 1 tasks are fully parallel (4 subagents)
- After Chunk 1 passes, Chunks 2 tasks are parallel (3 subagents)
- After Chunk 2 passes, Chunks 3 tasks are parallel (4 subagents)
- After Chunk 3 passes, Chunk 4 tasks are mostly sequential (orchestrator depends on all)
- Each subagent runs tests after implementation and iterates if tests fail
- Full test suite run after each chunk merge
