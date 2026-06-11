// src/media/production.ts
import { copyFile, mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { decodePng, encodePng, resizeNearest } from './png.js';
import { extractPosterFrame, probeVideo } from './pipeline.js';
const DEFAULT_THUMBNAIL_MAX_WIDTH = 640;
export async function createProductionBundle(sources, options) {
    if (sources.length === 0) {
        throw new Error('Production bundle requires at least one source');
    }
    const createdAt = options.createdAt ?? new Date().toISOString();
    const title = options.title ?? 'Spectra Production Bundle';
    const mastersDir = join(options.outDir, 'masters');
    const derivativesDir = join(options.outDir, 'derivatives');
    await mkdir(mastersDir, { recursive: true });
    await mkdir(derivativesDir, { recursive: true });
    const assets = [];
    const checks = [];
    const normalizedSources = [];
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        const inputPath = source.inputPath ?? source.path;
        const sourcePreset = source.preset ?? options.preset;
        const filename = source.filename ?? basename(source.path);
        const safeName = safeFilename(`${String(index + 1).padStart(3, '0')}-${filename}`);
        const safeBase = basename(safeName, extname(safeName));
        const format = extname(filename).slice(1).toLowerCase() || 'bin';
        const masterPath = join(mastersDir, safeName);
        const { inputPath: _inputPath, ...manifestSource } = source;
        const normalizedSource = {
            ...manifestSource,
            filename,
            preset: sourcePreset,
        };
        normalizedSources.push(normalizedSource);
        try {
            await copyFile(inputPath, masterPath);
            const masterStat = await stat(masterPath);
            const imageInfo = source.type === 'screenshot'
                ? await readPngInfo(inputPath).catch(() => undefined)
                : undefined;
            const probedVideoInfo = source.type === 'video'
                ? await probeVideo(inputPath).catch(() => undefined)
                : undefined;
            const videoInfo = source.type === 'video'
                ? mergeVideoInfo(videoInfoFromMetadata(source.metadata), probedVideoInfo)
                : undefined;
            if (videoInfo) {
                normalizedSource.metadata = {
                    ...normalizedSource.metadata,
                    video: videoInfo,
                };
            }
            assets.push({
                id: assetId(source.id, 'master'),
                sourceId: source.id,
                kind: 'master',
                path: relativeBundlePath(options.outDir, masterPath),
                format,
                sizeBytes: masterStat.size,
                width: imageInfo?.width ?? videoInfo?.width,
                height: imageInfo?.height ?? videoInfo?.height,
            });
            checks.push(...qualityChecksForSource(source, sourcePreset, masterStat.size, imageInfo, videoInfo));
            if (source.type === 'screenshot' && imageInfo && format === 'png') {
                const thumbnail = await createPngThumbnail(inputPath, options.thumbnailMaxWidth ?? DEFAULT_THUMBNAIL_MAX_WIDTH);
                const thumbName = safeFilename(`${safeBase}-thumb.png`);
                const thumbPath = join(derivativesDir, thumbName);
                await writeFile(thumbPath, thumbnail.buffer);
                const thumbStat = await stat(thumbPath);
                assets.push({
                    id: assetId(source.id, 'thumbnail'),
                    sourceId: source.id,
                    kind: 'thumbnail',
                    path: relativeBundlePath(options.outDir, thumbPath),
                    format: 'png',
                    sizeBytes: thumbStat.size,
                    width: thumbnail.width,
                    height: thumbnail.height,
                });
            }
            if (source.type === 'video') {
                const posterName = safeFilename(`${safeBase}-poster.png`);
                const posterPath = join(derivativesDir, posterName);
                try {
                    await extractPosterFrame(inputPath, posterPath, {
                        atSeconds: options.posterAtSeconds ?? 1,
                        maxWidth: options.posterMaxWidth ?? DEFAULT_THUMBNAIL_MAX_WIDTH,
                    });
                    const posterStat = await stat(posterPath);
                    const posterInfo = await readPngInfo(posterPath).catch(() => undefined);
                    assets.push({
                        id: assetId(source.id, 'poster'),
                        sourceId: source.id,
                        kind: 'poster',
                        path: relativeBundlePath(options.outDir, posterPath),
                        format: 'png',
                        sizeBytes: posterStat.size,
                        width: posterInfo?.width,
                        height: posterInfo?.height,
                    });
                    checks.push({
                        sourceId: source.id,
                        level: 'pass',
                        code: 'video-poster-generated',
                        message: 'Poster frame generated for video.',
                    });
                }
                catch (err) {
                    checks.push({
                        sourceId: source.id,
                        level: 'warn',
                        code: 'video-poster-generated',
                        message: err instanceof Error
                            ? `Poster frame could not be generated: ${err.message}`
                            : 'Poster frame could not be generated.',
                    });
                }
            }
        }
        catch (err) {
            checks.push({
                sourceId: source.id,
                level: 'fail',
                code: 'source-unavailable',
                message: err instanceof Error ? err.message : 'Source could not be copied',
            });
        }
    }
    const quality = summarizeQuality(checks);
    const manifest = {
        schemaVersion: 1,
        title,
        createdAt,
        preset: options.preset,
        sources: normalizedSources,
        assets,
        quality,
    };
    const manifestPath = join(options.outDir, 'manifest.json');
    const qualityReportPath = join(options.outDir, 'quality-report.json');
    const readmePath = join(options.outDir, 'README.md');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await writeFile(qualityReportPath, JSON.stringify(quality, null, 2));
    await writeFile(readmePath, renderBundleReadme(manifest));
    return {
        outDir: options.outDir,
        manifestPath,
        readmePath,
        qualityReportPath,
        manifest,
    };
}
function qualityChecksForSource(source, preset, sizeBytes, imageInfo, videoInfo) {
    const checks = [];
    checks.push({
        sourceId: source.id,
        level: sizeBytes > 0 ? 'pass' : 'fail',
        code: 'non-empty-file',
        message: sizeBytes > 0 ? 'Source media copied successfully.' : 'Source media is empty.',
    });
    checks.push({
        sourceId: source.id,
        level: preset ? 'pass' : 'warn',
        code: 'preset-present',
        message: preset
            ? `Production preset recorded: ${preset}.`
            : 'No production preset recorded; review output manually before publishing.',
    });
    if (source.type === 'screenshot') {
        if (!imageInfo) {
            checks.push({
                sourceId: source.id,
                level: 'warn',
                code: 'image-dimensions-unknown',
                message: 'Image dimensions could not be inspected.',
            });
        }
        else {
            const longEdge = Math.max(imageInfo.width, imageInfo.height);
            checks.push({
                sourceId: source.id,
                level: longEdge >= 1200 ? 'pass' : 'warn',
                code: 'image-resolution',
                message: longEdge >= 1200
                    ? `Image long edge is ${longEdge}px.`
                    : `Image long edge is ${longEdge}px; consider recapturing at a larger viewport for publishing.`,
            });
        }
    }
    if (source.type === 'video') {
        if (!videoInfo) {
            checks.push({
                sourceId: source.id,
                level: 'warn',
                code: 'video-probe',
                message: 'Video metadata could not be inspected; install ffprobe or include duration/codec/fps metadata before publishing.',
            });
        }
        const durationMs = videoInfo?.durationMs ?? numberFromMetadata(source.metadata, 'durationMs');
        checks.push({
            sourceId: source.id,
            level: durationMs ? 'pass' : 'warn',
            code: 'video-duration-present',
            message: durationMs
                ? `Video duration recorded: ${durationMs}ms.`
                : 'Video duration is missing; run a probe before final publishing.',
        });
        const longEdge = Math.max(videoInfo?.width ?? 0, videoInfo?.height ?? 0);
        if (longEdge > 0) {
            checks.push({
                sourceId: source.id,
                level: longEdge >= 1080 ? 'pass' : 'warn',
                code: 'video-resolution',
                message: longEdge >= 1080
                    ? `Video long edge is ${longEdge}px.`
                    : `Video long edge is ${longEdge}px; consider recapturing at 1080p or higher.`,
            });
        }
        const fps = videoInfo?.fps ?? numberFromMetadata(source.metadata, 'fps');
        if (fps !== undefined) {
            checks.push({
                sourceId: source.id,
                level: fps >= 30 ? 'pass' : 'warn',
                code: 'video-fps',
                message: fps >= 30
                    ? `Video frame rate is ${fps} fps.`
                    : `Video frame rate is ${fps} fps; consider recapturing at 30 fps or higher.`,
            });
        }
        const codec = videoInfo?.codec ?? stringFromMetadata(source.metadata, 'codec');
        checks.push({
            sourceId: source.id,
            level: codec ? 'pass' : 'warn',
            code: 'video-codec-present',
            message: codec ? `Video codec recorded: ${codec}.` : 'Video codec is missing.',
        });
    }
    return checks;
}
function summarizeQuality(checks) {
    const failCount = checks.filter((check) => check.level === 'fail').length;
    const warnCount = checks.filter((check) => check.level === 'warn').length;
    const score = checks.length === 0
        ? 0
        : Math.max(0, Math.round(((checks.length - warnCount * 0.35 - failCount) / checks.length) * 100));
    return {
        status: failCount > 0 ? 'draft' : warnCount > 0 ? 'review-needed' : 'production-ready',
        score,
        checks,
    };
}
async function readPngInfo(path) {
    const raw = await readFile(path);
    const image = decodePng(raw);
    return { width: image.width, height: image.height };
}
async function createPngThumbnail(path, maxWidth) {
    const raw = await readFile(path);
    const image = decodePng(raw);
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const thumbnail = width === image.width && height === image.height
        ? image
        : resizeNearest(image, width, height);
    return {
        buffer: encodePng(thumbnail),
        width: thumbnail.width,
        height: thumbnail.height,
    };
}
function assetId(sourceId, kind) {
    return `${sourceId}:${kind}`;
}
function safeFilename(value) {
    return value
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'asset';
}
function relativeBundlePath(outDir, path) {
    return path.startsWith(outDir + '/') ? path.slice(outDir.length + 1) : path;
}
function numberFromMetadata(metadata, key) {
    const value = metadata?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function stringFromMetadata(metadata, key) {
    const value = metadata?.[key];
    return typeof value === 'string' && value ? value : undefined;
}
function videoInfoFromMetadata(metadata) {
    const durationMs = numberFromMetadata(metadata, 'durationMs');
    const width = numberFromMetadata(metadata, 'width');
    const height = numberFromMetadata(metadata, 'height');
    const fps = numberFromMetadata(metadata, 'fps');
    const codec = stringFromMetadata(metadata, 'codec');
    if (!durationMs && !width && !height && !fps && !codec)
        return undefined;
    return { durationMs, width, height, fps, codec };
}
function mergeVideoInfo(fallback, preferred) {
    if (!fallback && !preferred)
        return undefined;
    return {
        durationMs: preferred?.durationMs ?? fallback?.durationMs,
        width: preferred?.width ?? fallback?.width,
        height: preferred?.height ?? fallback?.height,
        fps: preferred?.fps ?? fallback?.fps,
        codec: preferred?.codec ?? fallback?.codec,
    };
}
function renderBundleReadme(manifest) {
    const lines = [
        `# ${manifest.title}`,
        '',
        `Created: ${manifest.createdAt}`,
        `Quality: ${manifest.quality.status} (${manifest.quality.score}/100)`,
        '',
        '## Assets',
        '',
    ];
    for (const asset of manifest.assets) {
        const dims = asset.width && asset.height ? ` ${asset.width}x${asset.height}` : '';
        lines.push(`- ${asset.kind}: \`${asset.path}\` (${asset.format}, ${asset.sizeBytes} bytes${dims})`);
    }
    lines.push('', '## Quality Checks', '');
    for (const check of manifest.quality.checks) {
        lines.push(`- ${check.level.toUpperCase()} ${check.code}: ${check.message}`);
    }
    return lines.join('\n') + '\n';
}
//# sourceMappingURL=production.js.map