// src/computer-use/computer-use.ts
//
// AX-first, vision-fallback computer-use orchestration, focused-window scoped.
//
// Design (per efficient-computer-use research, 2026):
//   • AX-first        — resolve actions against the semantic AX tree (role/label),
//                       never coordinate clicks. Cheap + label-free grounding.
//   • Focused scope   — every perceive/act call targets the focused window only.
//   • Snapshot cache  — reuse the last AX snapshot; re-read only on change. A
//                       verified set-value updates the cached node in place
//                       instead of forcing a full re-walk (ReVision idea).
//   • Vision fallback — gated on AX-node-count. If the tree is empty/thin AND a
//                       VisionFallback is wired + available, ground from pixels;
//                       otherwise return a needsVisionFallback SIGNAL, not a crash.
//   • Form-filling    — first-class: resolve {label→value} against editable AX
//                       nodes, set, and VERIFY each field via read-back.
//   • Failure modes   — permission errors surface as AxPermissionError; empty AX
//                       and unmatched labels degrade to the fallback signal.
//
// SPDX-License-Identifier: Apache-2.0
import { AxPermissionError, isPermissionMessage } from './port.js';
/** Editable AX roles for form-field resolution. */
const EDITABLE_ROLES = new Set(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSecureTextField']);
function normalize(text) {
    return text.trim().toLowerCase();
}
function isEditable(node) {
    return node.actions.includes('setValue') || EDITABLE_ROLES.has(node.role);
}
function isVisionNode(node) {
    return node.source === 'vision';
}
function nodeCenter(node) {
    const [x, y, width, height] = node.bounds;
    return { x: x + width / 2, y: y + height / 2 };
}
export class ComputerUse {
    port;
    opts;
    threshold;
    cache = null;
    constructor(port, opts = {}) {
        this.port = port;
        this.opts = opts;
        this.threshold = opts.visionFallbackThreshold ?? 1;
    }
    /** Preflight the Accessibility permission without prompting. */
    async preflight() {
        return this.port.preflight();
    }
    /** Discard the cached snapshot so the next perceive re-reads the window. */
    invalidate() {
        this.cache = null;
    }
    /**
     * Snapshot the focused window as a scoped AX tree. Cached: repeated calls
     * reuse the last snapshot until an action invalidates it or `refresh` is set.
     */
    async snapshotFocusedWindow(options = {}) {
        if (this.cache && !options.refresh)
            return this.cache;
        // Per-call override so a reused/shared ComputerUse instance (see
        // core-impl.ts's persistent-instance-per-target cache) can still honor a
        // per-request threshold without needing to be reconstructed.
        const threshold = options.visionFallbackThreshold ?? this.threshold;
        let raw;
        try {
            raw = await this.port.snapshotFocused(this.opts.target);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (err instanceof AxPermissionError || isPermissionMessage(message)) {
                throw new AxPermissionError('Accessibility permission not granted. Grant it in System Settings → Privacy & Security → Accessibility, then retry.');
            }
            throw err;
        }
        let nodes = raw.elements;
        let needsVisionFallback = raw.axStatus !== 'ok' || raw.nodeCount < threshold;
        let fallbackReason;
        if (needsVisionFallback) {
            fallbackReason =
                raw.axStatus === 'no-window' ? 'no-window'
                    : raw.axStatus === 'empty' ? 'empty'
                        : 'below-threshold';
            const vf = this.opts.visionFallback;
            if (vf && vf.available()) {
                const grounded = await vf.ground(this.opts.target, { reason: fallbackReason, nodeCount: raw.nodeCount });
                if (grounded.length >= threshold) {
                    nodes = grounded;
                    needsVisionFallback = false;
                    fallbackReason = 'vision-fallback-applied';
                }
            }
        }
        // A vision-grounded snapshot carries real nodes; keeping the original
        // 'empty'/'no-window' axStatus would misreport a usable snapshot as failed.
        const axStatus = fallbackReason === 'vision-fallback-applied' ? 'ok' : raw.axStatus;
        const snapshot = {
            window: raw.window,
            nodes,
            nodeCount: nodes.length,
            axStatus,
            focusedWindowTitle: raw.focusedWindowTitle,
            needsVisionFallback,
            fallbackReason,
        };
        this.cache = snapshot;
        return snapshot;
    }
    /** Route a single action to the right primitive. AX-node resolution first;
     * fall back to a signal (never a crash) when the tree can't ground it. */
    async act(action) {
        switch (action.kind) {
            case 'click':
                return this.click(action);
            case 'set-value':
                return this.setValue(action.label, action.value, action);
            case 'key':
                return this.key(action);
        }
    }
    /**
     * Resolve a {label → value} map against the focused window's editable AX
     * nodes, set each via AX, and verify each by read-back. First-class
     * form-filling: one snapshot, per-field verification, no blind coordinate typing.
     */
    async fillForm(fields) {
        const snapshot = await this.snapshotFocusedWindow();
        const results = [];
        for (const [label, value] of Object.entries(fields)) {
            const node = this.resolveEditable(label);
            if (!node) {
                results.push({ label, expected: value, matched: false, set: false, verified: false });
                continue;
            }
            const outcome = await this.setValue(label, value, { kind: 'set-value', label, value });
            results.push({
                label,
                expected: value,
                matched: true,
                set: outcome.success,
                verified: outcome.verified === true,
                actual: outcome.actualValue,
                error: outcome.error,
            });
        }
        const anyMatched = results.some((r) => r.matched);
        const allVerified = results.length > 0 && results.every((r) => r.verified);
        // If nothing could be matched and the tree was thin, that's a fallback case.
        const needsVisionFallback = snapshot.needsVisionFallback && !anyMatched;
        return { fields: results, allVerified, needsVisionFallback };
    }
    // ─── Primitives ─────────────────────────────────────────
    async click(action) {
        // Lazy self-snapshot: a standalone act/click call (no prior in-instance
        // snapshot) must ground itself first, exactly like fillForm already does
        // at ~line 153 — otherwise this.cache is empty and every standalone act
        // spuriously reports matched:false. Only snapshot when there is no cache
        // yet; a prior in-instance snapshot (or a cached one from an earlier act)
        // is reused untouched.
        if (!this.cache)
            await this.snapshotFocusedWindow();
        const node = this.resolveByLabel(action.label, {
            role: action.role,
            prefer: (n) => n.actions.includes('press'),
        });
        if (!node)
            return this.unresolved(action);
        if (isVisionNode(node))
            return this.clickVisionNode(action, node);
        const res = await this.port.act({ target: this.opts.target, elementPath: node.path, action: 'press' });
        this.invalidate(); // a click may mutate the window arbitrarily
        return {
            action,
            success: res.success,
            matched: true,
            matchedNode: node,
            error: res.error,
        };
    }
    async setValue(label, value, action) {
        // Lazy self-snapshot — see click() above for rationale.
        if (!this.cache)
            await this.snapshotFocusedWindow();
        const node = this.resolveEditable(label);
        if (!node)
            return this.unresolved(action);
        if (isVisionNode(node))
            return this.setVisionValue(label, value, action, node);
        const res = await this.port.act({
            target: this.opts.target,
            elementPath: node.path,
            action: 'setValue',
            value,
        });
        const verified = res.success && normalize(res.value ?? '') === normalize(value);
        // Known change: patch the cached node value in place instead of re-walking
        // the whole window (efficiency — only re-read on unknown change).
        if (verified && this.cache) {
            const cached = this.cache.nodes.find((n) => n.path.join(',') === node.path.join(','));
            if (cached)
                cached.value = res.value ?? value;
        }
        return {
            action,
            success: res.success,
            matched: true,
            verified,
            matchedNode: node,
            actualValue: res.value,
            error: res.error,
        };
    }
    async key(action) {
        const res = await this.port.key({ target: this.opts.target, key: action.key });
        this.invalidate();
        return { action, success: res.success, matched: true, error: res.error };
    }
    async clickVisionNode(action, node) {
        const point = nodeCenter(node);
        const res = await this.port.clickAt({ target: this.opts.target, ...point });
        this.invalidate();
        return {
            action,
            success: res.success,
            matched: true,
            matchedNode: node,
            error: res.error,
        };
    }
    async setVisionValue(_label, value, action, node) {
        const point = nodeCenter(node);
        const click = await this.port.clickAt({ target: this.opts.target, ...point });
        if (!click.success) {
            this.invalidate();
            return {
                action,
                success: false,
                matched: true,
                verified: false,
                matchedNode: node,
                actualValue: null,
                error: click.error,
            };
        }
        const typed = await this.port.typeText({ target: this.opts.target, text: value });
        this.invalidate();
        return {
            action,
            success: typed.success,
            matched: true,
            verified: false,
            matchedNode: node,
            actualValue: null,
            error: typed.error,
        };
    }
    // ─── Resolution ─────────────────────────────────────────
    resolveEditable(label) {
        return this.resolveByLabel(label, { prefer: isEditable, require: isEditable });
    }
    resolveByLabel(label, opts = {}) {
        const nodes = this.cache?.nodes ?? [];
        const target = normalize(label);
        const rank = { exact: 2, 'target-in-label': 1, 'label-in-target': 0 };
        const matched = [];
        for (const n of nodes) {
            if (opts.role && normalize(n.role) !== normalize(opts.role))
                continue;
            if (opts.require && !opts.require(n))
                continue;
            const nl = normalize(n.label);
            if (nl.length === 0)
                continue;
            if (nl === target)
                matched.push({ node: n, kind: 'exact' });
            else if (nl.includes(target))
                matched.push({ node: n, kind: 'target-in-label' });
            else if (target.includes(nl))
                matched.push({ node: n, kind: 'label-in-target' });
        }
        if (matched.length === 0)
            return undefined;
        // Exact-match-preferred: once an exact label match exists, no substring
        // candidate is eligible to shadow it — filter down before ranking.
        const hasExact = matched.some((m) => m.kind === 'exact');
        const eligible = hasExact ? matched.filter((m) => m.kind === 'exact') : matched;
        // Rank: match strength, then preferred (interactive/editable), then
        // shortest label (most specific). Deterministic, no coordinates.
        eligible.sort((a, b) => {
            if (rank[a.kind] !== rank[b.kind])
                return rank[b.kind] - rank[a.kind];
            if (opts.prefer) {
                const ap = opts.prefer(a.node) ? 1 : 0;
                const bp = opts.prefer(b.node) ? 1 : 0;
                if (ap !== bp)
                    return bp - ap;
            }
            return a.node.label.length - b.node.label.length;
        });
        return eligible[0]?.node;
    }
    /** Unresolved target: not a crash. Signals a vision fallback when the tree is thin. */
    unresolved(action) {
        const thin = this.cache?.needsVisionFallback ?? true;
        const label = 'label' in action ? action.label : action.kind;
        return {
            action,
            success: false,
            matched: false,
            needsVisionFallback: thin,
            error: `No AX node matched "${label}" in the focused window.${thin ? ' AX tree is empty/thin — vision fallback recommended.' : ''}`,
        };
    }
}
//# sourceMappingURL=computer-use.js.map