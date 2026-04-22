import type { CaptureEntry, LibraryIndex } from './types.js';
export declare function getLibraryPath(cwd?: string): string;
export declare function getLibraryIndexPath(cwd?: string): string;
export declare function getLibraryMediaPath(cwd?: string): string;
export declare function ensureLibraryDirs(cwd?: string): Promise<void>;
export declare function loadIndex(cwd?: string): Promise<LibraryIndex>;
export declare function saveIndex(index: LibraryIndex, cwd?: string): Promise<void>;
export declare function newCaptureId(): string;
/**
 * Copy a media file into the library at media/<captureId>/<basename>.
 * Returns the absolute path where it was stored.
 */
export declare function storeMedia(captureId: string, sourcePath: string, cwd?: string): Promise<{
    path: string;
    size_bytes: number;
    format: string;
}>;
export declare function deleteCaptureMedia(captureId: string, cwd?: string): Promise<void>;
export declare function addEntry(entry: CaptureEntry, cwd?: string): Promise<void>;
export declare function updateEntry(id: string, patch: Partial<CaptureEntry>, cwd?: string): Promise<CaptureEntry | null>;
export declare function removeEntry(id: string, cwd?: string): Promise<CaptureEntry | null>;
export declare function getEntry(id: string, cwd?: string): Promise<CaptureEntry | null>;
/**
 * Utility: read basename of a capture's stored media for an index entry.
 * Library stores every capture under media/<id>/original.<ext>, so the
 * media path is derivable from the id + format.
 */
export declare function mediaPathForEntry(entry: CaptureEntry, cwd?: string): string;
/** For debug / UIs: a one-line summary of a capture. */
export declare function summarize(e: CaptureEntry): string;
//# sourceMappingURL=storage.d.ts.map