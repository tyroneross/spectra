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

import type { AxNode, AxTarget } from './types.js'

export interface VisionContext {
  /** Why the fallback fired: 'empty' | 'no-window' | 'below-threshold'. */
  reason: string
  nodeCount: number
}

export interface VisionFallback {
  readonly name: string
  /** Whether this fallback can currently run (model configured, etc.). */
  available(): boolean
  /** Ground the focused window from pixels, returning AX-shaped nodes so the
   * rest of the pipeline (resolve label→node, act, verify) is identical whether
   * the nodes came from AX or from vision. */
  ground(target: AxTarget | undefined, context: VisionContext): Promise<AxNode[]>
}

export class VisionFallbackUnavailableError extends Error {
  constructor(message = 'Vision fallback is not wired in this build (AX tree was empty/thin).') {
    super(message)
    this.name = 'VisionFallbackUnavailableError'
  }
}

/** Default no-op fallback: reports unavailable and never grounds. Its presence
 * lets callers treat "fallback wired?" uniformly; swapping in a real
 * Screen2AX/OmniParser impl requires no orchestration changes. */
export class StubVisionFallback implements VisionFallback {
  readonly name = 'stub-vision-fallback'
  available(): boolean {
    return false
  }
  async ground(): Promise<AxNode[]> {
    throw new VisionFallbackUnavailableError()
  }
}
