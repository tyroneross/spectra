const DEFAULT_OUTPUT_WIDTH = 1920;
const DEFAULT_OUTPUT_HEIGHT = 1080;
const DEFAULT_OUTPUT_FPS = 60;
const EPSILON = 0.000001;
const MAX_EXPRESSION_POINTS = 120;
const DEFAULT_EASE_IN_MS = 900;
const DEFAULT_EASE_OUT_MS = 1000;
export function zoomFilter(track, srcW, srcH, outW = DEFAULT_OUTPUT_WIDTH, outH = DEFAULT_OUTPUT_HEIGHT, fps = DEFAULT_OUTPUT_FPS) {
    assertPositiveInteger(srcW, 'srcW');
    assertPositiveInteger(srcH, 'srcH');
    assertPositiveInteger(outW, 'outW');
    assertPositiveInteger(outH, 'outH');
    assertPositiveInteger(fps, 'fps');
    const normalized = compactTrack(normalizeTrack(track));
    const zoomExpr = interpolatedExpression(1, normalized.map((point) => ({ frame: point.frame, value: point.scale })));
    const cxExpr = interpolatedExpression(0.5, normalized.map((point) => ({ frame: point.frame, value: point.cx })));
    const cyExpr = interpolatedExpression(0.5, normalized.map((point) => ({ frame: point.frame, value: point.cy })));
    const xExpr = `max(0\\,min(iw-iw/zoom\\,iw*(${cxExpr})-(iw/zoom/2)))`;
    const yExpr = `max(0\\,min(ih-ih/zoom\\,ih*(${cyExpr})-(ih/zoom/2)))`;
    return [
        `zoompan=z='${zoomExpr}'`,
        `x='${xExpr}'`,
        `y='${yExpr}'`,
        'd=1',
        `s=${outW}x${outH}`,
        `fps=${fps}`,
    ].join(':');
}
export function timedZoomFilter(windows, totalMs, srcW, srcH, outW = DEFAULT_OUTPUT_WIDTH, outH = DEFAULT_OUTPUT_HEIGHT, fps = DEFAULT_OUTPUT_FPS) {
    assertNonNegativeFinite(totalMs, 'totalMs');
    assertPositiveInteger(srcW, 'srcW');
    assertPositiveInteger(srcH, 'srcH');
    assertPositiveInteger(outW, 'outW');
    assertPositiveInteger(outH, 'outH');
    assertPositiveInteger(fps, 'fps');
    const normalized = normalizeWindows(windows, totalMs);
    const zoomExpr = timedExpression(1, normalized, fps, 'n', (window) => timedScaleExpression(window, fps, 'n'));
    const cxExpr = timedExpression(0.5, normalized, fps, 'n', (window) => formatNumber(clamp(window.cx, 0, 1)));
    const cyExpr = timedExpression(0.5, normalized, fps, 'n', (window) => formatNumber(clamp(window.cy, 0, 1)));
    const scaledWExpr = `trunc(${outW}*(${zoomExpr})/2)*2`;
    const scaledHExpr = `trunc(${outH}*(${zoomExpr})/2)*2`;
    const xExpr = `max(0\\,min(iw-${outW}\\,iw*(${cxExpr})-${outW / 2}))`;
    const yExpr = `max(0\\,min(ih-${outH}\\,ih*(${cyExpr})-${outH / 2}))`;
    return [
        `scale=w='${scaledWExpr}':h='${scaledHExpr}':eval=frame:flags=bicubic`,
        `crop=${outW}:${outH}:x='${xExpr}':y='${yExpr}'`,
    ].join(',');
}
function compactTrack(track) {
    if (track.length <= MAX_EXPRESSION_POINTS)
        return track;
    const stride = Math.ceil(track.length / MAX_EXPRESSION_POINTS);
    const selected = new Map();
    const add = (index) => {
        const point = track[Math.min(track.length - 1, Math.max(0, index))];
        selected.set(point.frame, point);
    };
    add(0);
    add(track.length - 1);
    for (let index = 1; index < track.length - 1; index += 1) {
        const previous = track[index - 1];
        const current = track[index];
        const next = track[index + 1];
        const boundary = isDefault(previous) !== isDefault(current) || isDefault(current) !== isDefault(next);
        if (boundary || index % stride === 0)
            add(index);
    }
    return [...selected.values()].sort((a, b) => a.frame - b.frame);
}
function isDefault(point) {
    return Math.abs(point.scale - 1) <= EPSILON
        && Math.abs(point.cx - 0.5) <= EPSILON
        && Math.abs(point.cy - 0.5) <= EPSILON;
}
function normalizeTrack(track) {
    const byFrame = new Map();
    for (const point of track) {
        if (!Number.isInteger(point.frame) || point.frame < 0) {
            throw new Error('track frames must be non-negative integers');
        }
        if (!Number.isFinite(point.scale) || point.scale < 1) {
            throw new Error('track scale values must be finite numbers greater than or equal to 1');
        }
        if (!Number.isFinite(point.cx) || !Number.isFinite(point.cy)) {
            throw new Error('track center values must be finite numbers');
        }
        byFrame.set(point.frame, {
            frame: point.frame,
            scale: point.scale,
            cx: clamp(point.cx, 0, 1),
            cy: clamp(point.cy, 0, 1),
        });
    }
    return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}
function normalizeWindows(windows, totalMs) {
    return windows
        .filter((window) => Number.isFinite(window.startMs)
        && Number.isFinite(window.endMs)
        && Number.isFinite(window.cx)
        && Number.isFinite(window.cy)
        && Number.isFinite(window.scale)
        && window.scale >= 1)
        .map((window) => ({
        startMs: clamp(window.startMs, 0, totalMs),
        endMs: clamp(window.endMs, 0, totalMs),
        cx: window.cx,
        cy: window.cy,
        scale: window.scale,
    }))
        .filter((window) => window.endMs > window.startMs)
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
function timedExpression(defaultValue, windows, fps, frameVariable, valueExpression) {
    let expr = formatNumber(defaultValue);
    for (let index = windows.length - 1; index >= 0; index -= 1) {
        const window = windows[index];
        const startFrame = Math.ceil((window.startMs / 1000) * fps);
        const endFrame = Math.ceil((window.endMs / 1000) * fps);
        if (endFrame <= startFrame)
            continue;
        expr = `if(gte(${frameVariable}\\,${startFrame})*lt(${frameVariable}\\,${endFrame})\\,${valueExpression(window)}\\,${expr})`;
    }
    return expr;
}
function timedScaleExpression(window, fps, frameVariable) {
    const durationMs = window.endMs - window.startMs;
    const easeInMs = Math.min(DEFAULT_EASE_IN_MS, durationMs / 2);
    const easeOutMs = Math.min(DEFAULT_EASE_OUT_MS, Math.max(0, durationMs - easeInMs));
    const easeOutStartMs = window.endMs - easeOutMs;
    const targetScale = formatNumber(window.scale);
    const delta = round6(window.scale - 1);
    if (delta <= EPSILON)
        return '1';
    const tMs = `${frameVariable}*${formatNumber(1000 / fps)}`;
    const easeIn = easeInMs > EPSILON
        ? `1+${formatNumber(delta)}*${smoothstepExpression(`((${tMs})-${formatNumber(window.startMs)})/${formatNumber(easeInMs)}`)}`
        : targetScale;
    const easeOut = easeOutMs > EPSILON
        ? `${targetScale}-${formatNumber(delta)}*${smoothstepExpression(`((${tMs})-${formatNumber(easeOutStartMs)})/${formatNumber(easeOutMs)}`)}`
        : targetScale;
    let expr = targetScale;
    if (easeOutMs > EPSILON) {
        const easeOutStartFrame = Math.ceil((easeOutStartMs / 1000) * fps);
        expr = `if(gte(${frameVariable}\\,${easeOutStartFrame})\\,${easeOut}\\,${expr})`;
    }
    if (easeInMs > EPSILON) {
        const easeInEndFrame = Math.ceil(((window.startMs + easeInMs) / 1000) * fps);
        expr = `if(lt(${frameVariable}\\,${easeInEndFrame})\\,${easeIn}\\,${expr})`;
    }
    return expr;
}
function smoothstepExpression(progress) {
    return `(3*(${progress})*(${progress})-2*(${progress})*(${progress})*(${progress}))`;
}
function interpolatedExpression(defaultValue, values) {
    const points = values
        .map(({ frame, value }) => ({ frame, value: round6(value) }))
        .filter((point, index, all) => index === 0
        || index === all.length - 1
        || Math.abs(point.value - all[index - 1].value) > EPSILON
        || Math.abs(point.value - all[index + 1].value) > EPSILON);
    if (points.length === 0)
        return formatNumber(defaultValue);
    if (points.length === 1) {
        const point = points[0];
        return `if(eq(on\\,${point.frame})\\,${formatNumber(point.value)}\\,${formatNumber(defaultValue)})`;
    }
    let expr = formatNumber(defaultValue);
    for (let index = points.length - 2; index >= 0; index -= 1) {
        const current = points[index];
        const next = points[index + 1];
        expr = `if(lte(on\\,${next.frame})\\,${linearExpression(current, next)}\\,${expr})`;
    }
    if (points[0].frame > 0) {
        expr = `if(lt(on\\,${points[0].frame})\\,${formatNumber(defaultValue)}\\,${expr})`;
    }
    return expr;
}
function linearExpression(current, next) {
    if (current.frame === next.frame || Math.abs(current.value - next.value) <= EPSILON) {
        return formatNumber(current.value);
    }
    const delta = round6(next.value - current.value);
    const sign = delta < 0 ? '-' : '+';
    return `${formatNumber(current.value)}${sign}${formatNumber(Math.abs(delta))}*((on-${current.frame})/${next.frame - current.frame})`;
}
function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
}
function assertNonNegativeFinite(value, name) {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a non-negative finite number`);
    }
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function round6(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
//# sourceMappingURL=zoom-render.js.map