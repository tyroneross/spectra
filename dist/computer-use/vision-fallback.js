// src/computer-use/vision-fallback.ts
//
// The vision-fallback INTERFACE. AX-first perception is cheap (~30-80ms BFS of
// the focused window) and semantically labeled; a screenshot→vision pipeline is
// ~5-50x slower and grounding is the field's accuracy bottleneck (<70% on
// ScreenSpot-Pro). So vision is a FALLBACK, gated on AX-node-count, not the
// default path. The concrete impl here uses Apple's native Vision framework
// through the same Swift bridge as AX; Screen2AX/OmniParser can still swap in
// behind this interface later.
//
// SPDX-License-Identifier: Apache-2.0
export class VisionFallbackUnavailableError extends Error {
    constructor(message = 'Vision fallback is not wired in this build (AX tree was empty/thin).') {
        super(message);
        this.name = 'VisionFallbackUnavailableError';
    }
}
const FIELD_LABEL_HINT = /\b(email|e-mail|password|passcode|username|user name|login|search|name|first name|last name|phone|address|city|state|zip|postal|company|title|subject|message)\b/i;
const BUTTON_LABEL_HINT = /\b(ok|cancel|save|submit|sign in|log in|login|continue|next|back|done|apply|send|close|open|play|stop|record|create|delete|remove|add)\b/i;
function roleForVisionLabel(label) {
    if (FIELD_LABEL_HINT.test(label) || /:\s*$/.test(label))
        return 'AXTextField';
    if (BUTTON_LABEL_HINT.test(label))
        return 'AXButton';
    return 'AXStaticText';
}
function actionsForVisionRole(role) {
    if (role === 'AXTextField')
        return ['press', 'setValue'];
    return ['press'];
}
function normalizeGrounding(raw) {
    const label = raw.label.trim();
    if (!label)
        return undefined;
    const bounds = raw.bounds;
    if (bounds.length !== 4
        || bounds.some((v) => !Number.isFinite(v))
        || bounds[2] <= 0
        || bounds[3] <= 0) {
        return undefined;
    }
    const role = roleForVisionLabel(label);
    return {
        source: 'vision',
        role,
        label,
        value: null,
        enabled: true,
        focused: false,
        actions: actionsForVisionRole(role),
        bounds,
        path: [],
        confidence: raw.confidence,
    };
}
/** Native macOS Vision fallback: focused-window screenshot -> OCR -> AX-shaped
 * coordinate nodes. `available()` is synchronous because ComputerUse calls it
 * inside the snapshot hot path; use `NativeVisionFallback.create()` so the
 * native screenshot/permission preflight runs before construction. */
export class NativeVisionFallback {
    port;
    name = 'native-vision-fallback';
    unavailableReason;
    usable;
    target;
    constructor(port, options) {
        this.port = port;
        this.target = options.target;
        this.usable = options.available;
        this.unavailableReason = options.unavailableReason;
    }
    static async create(port, target) {
        if (process.platform !== 'darwin') {
            return new NativeVisionFallback(port, {
                target,
                available: false,
                unavailableReason: 'native Vision fallback is macOS-only',
            });
        }
        try {
            const availability = await port.visionAvailable(target);
            return new NativeVisionFallback(port, {
                target,
                available: availability.available,
                unavailableReason: availability.reason,
            });
        }
        catch (error) {
            return new NativeVisionFallback(port, {
                target,
                available: false,
                unavailableReason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    available() {
        return this.usable;
    }
    async ground(target, _context) {
        if (!this.usable) {
            throw new VisionFallbackUnavailableError(this.unavailableReason);
        }
        const grounded = await this.port.visionGround(target ?? this.target);
        return grounded
            .map(normalizeGrounding)
            .filter((node) => node !== undefined);
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