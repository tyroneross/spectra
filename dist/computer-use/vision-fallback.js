// src/computer-use/vision-fallback.ts
//
// The vision-fallback INTERFACE. AX-first perception is cheap (~30–80ms BFS of
// the focused window) and semantically labeled; a screenshot→vision pipeline is
// ~5–50× slower and grounding is the field's accuracy bottleneck (<70% on
// ScreenSpot-Pro). So vision is a FALLBACK, gated on AX-node-count, not the
// default path. The concrete impl (Screen2AX-style tree-from-screenshot, or
// OmniParser set-of-mark) is stubbed here behind this interface — wiring a model
// is out of scope for this slice, but the gate + hook are real and reachable.
//
// SPDX-License-Identifier: Apache-2.0
export class VisionFallbackUnavailableError extends Error {
    constructor(message = 'Vision fallback is not wired in this build (AX tree was empty/thin).') {
        super(message);
        this.name = 'VisionFallbackUnavailableError';
    }
}
/** Default no-op fallback: reports unavailable and never grounds. Its presence
 * lets callers treat "fallback wired?" uniformly; swapping in a real
 * Screen2AX/OmniParser impl requires no orchestration changes. */
export class StubVisionFallback {
    name = 'stub-vision-fallback';
    available() {
        return false;
    }
    async ground() {
        throw new VisionFallbackUnavailableError();
    }
}
//# sourceMappingURL=vision-fallback.js.map