import type { CaptureEntry } from './types.js';
export interface ExportOptions {
    outDir: string;
    /** Write manifest.md alongside the media. Default true. */
    manifest?: boolean;
    /** Flatten all media into outDir/ instead of keeping per-capture subdirs. */
    flatten?: boolean;
    cwd?: string;
}
export interface ExportResult {
    outDir: string;
    filesCopied: number;
    manifestPath?: string;
}
/**
 * Copy a list of captures (plus their media) to an output directory and
 * write a human-readable markdown manifest describing each one.
 */
export declare function exportCaptures(captures: CaptureEntry[], opts: ExportOptions): Promise<ExportResult>;
//# sourceMappingURL=export.d.ts.map