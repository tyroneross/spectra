// src/media/presets.ts
export const CAPTURE_PRESETS = {
    docs: {
        id: 'docs',
        label: 'Docs',
        intent: 'Clean explanatory captures for documentation and release notes.',
        productionReady: true,
        screenshot: { mode: 'auto', aspectRatio: '16:9', clean: true, quality: 'lossless' },
        recording: { fps: 30, quality: 'lossless', hardware: false, codec: 'h264', bitrate: '8M' },
    },
    demo: {
        id: 'demo',
        label: 'Demo',
        intent: 'Smooth widescreen walkthroughs for product demos and launch posts.',
        productionReady: true,
        screenshot: { mode: 'full', aspectRatio: '16:9', clean: true, quality: 'high' },
        recording: { fps: 60, quality: 'high', hardware: true, codec: 'h264', bitrate: '8M' },
    },
    social: {
        id: 'social',
        label: 'Social',
        intent: 'Vertical or square-friendly captures for short social clips.',
        productionReady: true,
        screenshot: { mode: 'auto', aspectRatio: '9:16', clean: true, quality: 'high' },
        recording: { fps: 30, quality: 'high', hardware: true, codec: 'h264', bitrate: '8M' },
    },
    'app-store': {
        id: 'app-store',
        label: 'App Store',
        intent: 'Stable, clean product shots suitable for marketplace review.',
        productionReady: true,
        screenshot: { mode: 'full', aspectRatio: '16:9', clean: true, quality: 'high' },
        recording: { fps: 30, quality: 'high', hardware: true, codec: 'h264', bitrate: '8M' },
    },
};
export function getCapturePresetDefinition(preset) {
    return preset ? CAPTURE_PRESETS[preset] : undefined;
}
export function resolveScreenshotCaptureOptions(input) {
    const definition = getCapturePresetDefinition(input.preset);
    const defaults = definition?.screenshot;
    return {
        preset: input.preset,
        productionReady: definition?.productionReady,
        mode: input.mode ?? defaults?.mode ?? 'full',
        aspectRatio: input.aspectRatio ?? defaults?.aspectRatio,
        clean: input.clean ?? defaults?.clean ?? true,
        quality: input.quality ?? defaults?.quality,
    };
}
export function resolveRecordingCaptureOptions(input) {
    const definition = getCapturePresetDefinition(input.preset);
    const defaults = definition?.recording;
    return compactVideoOptions({
        fps: input.fps ?? defaults?.fps,
        quality: input.quality ?? defaults?.quality,
        hardware: input.hardware ?? defaults?.hardware,
        codec: input.codec ?? defaults?.codec,
        bitrate: input.bitrate ?? defaults?.bitrate,
    });
}
function compactVideoOptions(options) {
    const compact = {};
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
            compact[key] = value;
        }
    }
    return compact;
}
//# sourceMappingURL=presets.js.map