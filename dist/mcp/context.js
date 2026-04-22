// src/mcp/context.ts
import { SessionManager } from '../core/session.js';
export function createContext() {
    return {
        sessions: new SessionManager(),
        drivers: new Map(),
    };
}
export function detectPlatform(target) {
    if (/^https?:\/\//.test(target)) {
        return { platform: 'web', driverType: 'cdp' };
    }
    if (target.startsWith('sim:')) {
        const device = target.slice(4).toLowerCase();
        const platform = device.includes('watch') ? 'watchos' : 'ios';
        return { platform, driverType: 'sim' };
    }
    return { platform: 'macos', driverType: 'native' };
}
//# sourceMappingURL=context.js.map