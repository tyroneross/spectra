import { normalizeRole } from '../core/normalize.js';
import { getSharedBridge } from './bridge.js';
import { readFile, unlink } from 'node:fs/promises';
export class NativeDriver {
    bridge;
    appName = null;
    appPid = null;
    windowId = null;
    idToPath = new Map();
    constructor(bridge) {
        this.bridge = bridge ?? getSharedBridge();
    }
    async connect(target) {
        if (!target.appName && target.pid === undefined) {
            throw new Error('NativeDriver requires appName or pid in target');
        }
        this.appName = target.appName ?? null;
        this.appPid = target.pid ?? null;
        // Verify the app is accessible by taking a snapshot. A pid-bound target
        // sends ONLY the pid — sending the app name too would let the native
        // helper's name lookup win and silently select another instance.
        await this.bridge.start();
        const result = await this.bridge.send('snapshot', this.targetParams());
        this.windowId = result.window.id;
    }
    /**
     * The process selector for every native bridge call. `pid` wins outright:
     * once a session is pid-bound, no call may ever be resolved by app name.
     */
    targetParams() {
        if (this.appPid !== null)
            return { pid: this.appPid };
        if (this.appName !== null)
            return { app: this.appName };
        return {};
    }
    async snapshot() {
        const result = await this.bridge.send('snapshot', this.targetParams());
        // Map NativeElement[] to Element[] with sequential IDs
        this.idToPath.clear();
        const elements = result.elements.map((nel, i) => {
            const id = `e${i + 1}`;
            this.idToPath.set(id, nel.path);
            return {
                id,
                role: normalizeRole(nel.role, 'macos'),
                label: nel.label,
                value: nel.value,
                enabled: nel.enabled,
                focused: nel.focused,
                actions: nel.actions,
                bounds: nel.bounds,
                parent: null,
            };
        });
        return {
            appName: this.appName ?? undefined,
            platform: 'macos',
            elements,
            timestamp: Date.now(),
            metadata: {
                elementCount: elements.length,
            },
        };
    }
    async act(elementId, action, value) {
        const path = this.idToPath.get(elementId);
        if (!path) {
            return {
                success: false,
                error: `Element '${elementId}' not found. Take a new snapshot — the UI may have changed.`,
                snapshot: await this.snapshot(),
            };
        }
        // Map ActionType to native action names
        const nativeAction = action === 'click' ? 'press'
            : action === 'type' ? 'setValue'
                : action === 'clear' ? 'setValue'
                    : action;
        const params = {
            ...this.targetParams(),
            elementPath: path,
            action: nativeAction,
        };
        if (action === 'type' && value)
            params.value = value;
        if (action === 'clear')
            params.value = '';
        try {
            const result = await this.bridge.send('act', params);
            // Brief delay for native UI to update after action (SwiftUI view refresh)
            await new Promise(r => setTimeout(r, 200));
            const snapshot = await this.snapshot();
            if (!result.success) {
                return { success: false, error: result.error, snapshot };
            }
            return { success: true, snapshot };
        }
        catch (err) {
            const snapshot = await this.snapshot();
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
                snapshot,
            };
        }
    }
    async screenshot() {
        const result = await this.bridge.send('screenshot', this.targetParams());
        const buf = await readFile(result.path);
        await unlink(result.path).catch(() => { });
        return buf;
    }
    async close() {
        this.appName = null;
        this.appPid = null;
        this.windowId = null;
        this.idToPath.clear();
        // Don't close bridge — shared across sessions
    }
    async disconnect() {
        this.appName = null;
        this.appPid = null;
        this.windowId = null;
        this.idToPath.clear();
        await this.bridge.close();
    }
}
//# sourceMappingURL=driver.js.map