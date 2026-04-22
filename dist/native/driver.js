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
        if (!target.appName) {
            throw new Error('NativeDriver requires appName in target');
        }
        this.appName = target.appName;
        // Verify the app is accessible by taking a snapshot
        await this.bridge.start();
        const result = await this.bridge.send('snapshot', { app: this.appName });
        this.windowId = result.window.id;
    }
    async snapshot() {
        const params = {};
        if (this.appPid)
            params.pid = this.appPid;
        else if (this.appName)
            params.app = this.appName;
        const result = await this.bridge.send('snapshot', params);
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
            app: this.appName,
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
        const result = await this.bridge.send('screenshot', { app: this.appName });
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