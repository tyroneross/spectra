import { existsSync } from 'node:fs';
import { readFile, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { addEntry, ensureLibraryDirs, getLibraryMediaPath, loadIndex, } from './storage.js';
/**
 * Import a showcase `.showcase/` directory into the spectra library.
 *
 * Non-destructive: original files stay in place. Existing spectra library
 * entries with the same capture id are skipped (not overwritten) so the
 * operation is idempotent.
 */
export async function migrateFromShowcase(showcasePath, cwd) {
    const report = {
        sourcePath: showcasePath,
        found: 0,
        imported: 0,
        skipped: 0,
        mediaCopied: 0,
        mediaMissing: 0,
        issues: [],
    };
    const indexPath = join(showcasePath, 'index.json');
    if (!existsSync(indexPath)) {
        report.issues.push(`Showcase index.json not found at ${indexPath}`);
        return report;
    }
    await ensureLibraryDirs(cwd);
    const libIdx = await loadIndex(cwd);
    const existingIds = new Set(libIdx.captures.map((c) => c.id));
    let raw;
    try {
        raw = JSON.parse(await readFile(indexPath, 'utf8'));
    }
    catch (e) {
        report.issues.push(`Failed to parse showcase index.json: ${e.message}`);
        return report;
    }
    // Showcase index.json shape: { version, captures: [...] } — matches our own.
    const captures = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.captures)
            ? raw.captures
            : [];
    report.found = captures.length;
    const showcaseMediaRoot = join(showcasePath, 'media');
    for (const rawEntry of captures) {
        if (!rawEntry || typeof rawEntry !== 'object')
            continue;
        const e = rawEntry;
        const id = typeof e.id === 'string' ? e.id : undefined;
        if (!id) {
            report.skipped += 1;
            report.issues.push('Entry without id skipped');
            continue;
        }
        if (existingIds.has(id)) {
            report.skipped += 1;
            continue;
        }
        const platform = normalizePlatform(e.platform);
        const entry = {
            id,
            created_at: typeof e.created_at === 'string' ? e.created_at : new Date().toISOString(),
            type: e.type ?? 'screenshot',
            format: typeof e.format === 'string' ? e.format : 'png',
            size_bytes: typeof e.size_bytes === 'number' ? e.size_bytes : 0,
            duration_ms: typeof e.duration_ms === 'number' ? e.duration_ms : undefined,
            source: `migrated-from-showcase (${typeof e.source === 'string' ? e.source : 'unknown'})`,
            platform,
            url: typeof e.url === 'string' ? e.url : undefined,
            viewport: typeof e.viewport === 'string' ? e.viewport : undefined,
            selector: typeof e.selector === 'string' ? e.selector : undefined,
            device_name: typeof e.device_name === 'string' ? e.device_name : undefined,
            title: typeof e.title === 'string' ? e.title : undefined,
            feature: typeof e.feature === 'string' ? e.feature : undefined,
            component: typeof e.component === 'string' ? e.component : undefined,
            tags: Array.isArray(e.tags) ? e.tags : undefined,
            starred: typeof e.starred === 'boolean' ? e.starred : undefined,
            walkthrough: e.walkthrough && typeof e.walkthrough === 'object'
                ? e.walkthrough
                : undefined,
            git_branch: typeof e.git_branch === 'string' ? e.git_branch : undefined,
            git_commit: typeof e.git_commit === 'string' ? e.git_commit : undefined,
        };
        // Copy media dir (showcase structure: media/<id>/original.<ext> + optional step_*.png)
        const srcDir = join(showcaseMediaRoot, id);
        const destDir = join(getLibraryMediaPath(cwd), id);
        if (existsSync(srcDir)) {
            try {
                await mkdir(destDir, { recursive: true });
                await cp(srcDir, destDir, { recursive: true });
                report.mediaCopied += 1;
            }
            catch (err) {
                report.issues.push(`Failed to copy media for ${id}: ${err.message}`);
            }
        }
        else {
            report.mediaMissing += 1;
            // Still import the entry — the manifest knows the media is missing.
            report.issues.push(`Media directory missing for ${id} (source: ${srcDir})`);
        }
        await addEntry(entry, cwd);
        report.imported += 1;
        existingIds.add(id);
    }
    return report;
}
function normalizePlatform(v) {
    const s = typeof v === 'string' ? v.toLowerCase() : 'unknown';
    const ok = ['web', 'macos', 'ios', 'watchos', 'unknown'];
    return (ok.find((p) => p === s) ?? 'unknown');
}
/** Tiny default that callers can use to auto-detect `.showcase/` in the cwd. */
export function defaultShowcasePath(cwd = process.cwd()) {
    return join(cwd, '.showcase');
}
//# sourceMappingURL=migrate.js.map