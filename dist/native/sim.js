import { getSharedBridge } from './bridge.js';
import { readFile, unlink } from 'node:fs/promises';
export class SimDriver {
    bridge;
    deviceId = null;
    platform = 'ios';
    constructor(bridge) {
        this.bridge = bridge ?? getSharedBridge();
    }
    async connect(target) {
        if (!target.deviceId) {
            throw new Error('SimDriver requires deviceId in target');
        }
        await this.bridge.start();
        // Look up the device
        const result = await this.bridge.send('simDevices');
        const name = target.deviceId.toLowerCase();
        const booted = result.devices.filter(d => d.state === 'Booted');
        const device = booted.find(d => d.name.toLowerCase().includes(name));
        if (!device) {
            const available = booted.map(d => d.name).join(', ');
            throw new Error(`No booted simulator matching '${target.deviceId}'.`
                + (available ? ` Available: ${available}` : ' No simulators are booted.')
                + `\nRun: xcrun simctl boot "${target.deviceId}"`);
        }
        this.deviceId = device.udid;
        this.platform = device.runtime.includes('watchOS') ? 'watchos' : 'ios';
    }
    async snapshot() {
        // Simulators have limited AX access — return minimal snapshot
        // For iOS, we could walk the Simulator.app AX tree in the future
        return {
            platform: this.platform,
            elements: [],
            timestamp: Date.now(),
            metadata: {
                elementCount: 0,
                timedOut: false,
            },
        };
    }
    async act(elementId, action, value) {
        // Coordinate-based tap only for simulators
        return {
            success: false,
            error: 'Simulator automation uses coordinate-based taps via spectra_capture. Element-based actions are limited.',
            snapshot: await this.snapshot(),
        };
    }
    async tap(x, y) {
        if (!this.deviceId) {
            throw new Error('SimDriver not connected. Call connect() first.');
        }
        return this.bridge.send('simTap', { deviceId: this.deviceId, x, y });
    }
    async screenshot() {
        if (!this.deviceId) {
            throw new Error('SimDriver not connected. Call connect() first.');
        }
        const mask = this.platform === 'watchos' ? 'black' : undefined;
        const params = { deviceId: this.deviceId };
        if (mask)
            params.mask = mask;
        const result = await this.bridge.send('simScreenshot', params);
        const buf = await readFile(result.path);
        await unlink(result.path).catch(() => { });
        return buf;
    }
    async close() {
        this.deviceId = null;
    }
    async disconnect() {
        this.deviceId = null;
        await this.bridge.close();
    }
}
//# sourceMappingURL=sim.js.map