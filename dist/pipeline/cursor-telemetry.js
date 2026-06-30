import { readFile } from 'node:fs/promises';
export async function loadCursorTelemetry(jsonPath) {
    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('cursor telemetry must be a JSON object');
    }
    const cursorPath = readPointArray(parsed.samples, 'samples');
    const clicks = readPointArray(parsed.clicks, 'clicks');
    assertMonotonic(cursorPath, 'samples');
    assertMonotonic(clicks, 'clicks');
    return { clicks, cursorPath };
}
function readPointArray(value, field) {
    if (!Array.isArray(value)) {
        throw new Error(`cursor telemetry ${field} must be an array`);
    }
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`cursor telemetry ${field}[${index}] must be an object`);
        }
        const candidate = entry;
        const tMs = readNonNegativeFinite(candidate.tMs, `${field}[${index}].tMs`);
        const cx = readNormalized(candidate.cx, `${field}[${index}].cx`);
        const cy = readNormalized(candidate.cy, `${field}[${index}].cy`);
        return { tMs, cx, cy };
    });
}
function readNonNegativeFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`cursor telemetry ${label} must be a non-negative finite number`);
    }
    return value;
}
function readNormalized(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`cursor telemetry ${label} must be a finite number in [0,1]`);
    }
    return value;
}
function assertMonotonic(points, field) {
    for (let index = 1; index < points.length; index += 1) {
        if (points[index].tMs < points[index - 1].tMs) {
            throw new Error(`cursor telemetry ${field} tMs values must be monotonic`);
        }
    }
}
//# sourceMappingURL=cursor-telemetry.js.map