import { getSharedBridge } from '../native/bridge.js';
import { SimRecordHandle } from './recorder.js';
import { decodePng, encodePng, cropImage } from './png.js';
export async function screenshot(driver, platform, options) {
    // If element or region specified, crop from a full screenshot
    if (options?.element || options?.region) {
        const bounds = options.element?.bounds ?? options.region;
        const fullBuf = await driver.screenshot();
        const raw = decodePng(fullBuf);
        const cropped = cropImage(raw, bounds[0], bounds[1], bounds[2], bounds[3]);
        const buf = encodePng(cropped);
        return {
            buffer: buf,
            format: options?.format ?? 'png',
            bounds,
        };
    }
    // Default: full screenshot
    const buf = await driver.screenshot();
    return {
        buffer: buf,
        format: options?.format ?? 'png',
    };
}
export async function startRecording(platform, deviceId) {
    if (platform === 'ios' || platform === 'watchos') {
        if (!deviceId)
            throw new Error('deviceId required for simulator recording');
        const bridge = getSharedBridge();
        const result = await bridge.send('simRecord', {
            deviceId,
            action: 'start',
        });
        return new SimRecordHandle(bridge, result.recordingId, deviceId);
    }
    throw new Error(`Video recording not yet supported for platform: ${platform}`);
}
//# sourceMappingURL=capture.js.map