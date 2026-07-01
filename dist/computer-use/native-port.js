// src/computer-use/native-port.ts
//
// The real AxBridgePort: forwards to the spectra-native Swift helper over the
// existing JSON-RPC NativeBridge (cuSnapshot / cuAct / cuKey / cuPreflight —
// see native/swift/AXComputerUse.swift). Kept separate from ./computer-use.ts
// so the orchestrator stays free of child-process concerns and unit tests never
// spawn a binary. This is the daemon's injection point (src/daemon/core-impl.ts).
//
// SPDX-License-Identifier: Apache-2.0
import { getSharedBridge } from '../native/bridge.js';
import { AxPermissionError, isPermissionMessage } from './port.js';
function targetParams(target) {
    const params = {};
    if (target?.pid !== undefined)
        params.pid = target.pid;
    else if (target?.app !== undefined)
        params.app = target.app;
    return params;
}
export class NativeAxBridgePort {
    bridge;
    constructor(bridge = getSharedBridge()) {
        this.bridge = bridge;
    }
    async snapshotFocused(target) {
        let res;
        try {
            res = await this.bridge.send('cuSnapshot', targetParams(target));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isPermissionMessage(message))
                throw new AxPermissionError(message);
            throw err;
        }
        return {
            window: res.window ? { title: res.window.title, bounds: res.window.bounds } : null,
            elements: Array.isArray(res.elements) ? res.elements : [],
            nodeCount: res.nodeCount ?? 0,
            axStatus: res.axStatus ?? 'empty',
            focusedWindowTitle: res.focusedWindowTitle ?? '',
        };
    }
    async act(req) {
        const res = await this.bridge.send('cuAct', {
            ...targetParams(req.target),
            elementPath: req.elementPath,
            action: req.action,
            value: req.value,
        });
        return { success: res.success, value: res.value ?? null, error: res.error };
    }
    async key(req) {
        return this.bridge.send('cuKey', {
            ...targetParams(req.target),
            key: req.key,
        });
    }
    async preflight() {
        return this.bridge.send('cuPreflight');
    }
}
//# sourceMappingURL=native-port.js.map