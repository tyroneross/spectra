import { type GroupBy } from '../../library/query.js';
import type { CaptureEntry, Platform } from '../../library/types.js';
export interface LibraryParams {
    /**
     * Action router. All library ops go through this one tool to match the
     * spectra_session / spectra_capture action-dispatch pattern.
     */
    action: 'add' | 'find' | 'gallery' | 'get' | 'tag' | 'delete' | 'status' | 'export' | 'migrate-from-showcase';
    sourcePath?: string;
    type?: CaptureEntry['type'];
    platform?: Platform;
    url?: string;
    viewport?: string;
    selector?: string;
    deviceName?: string;
    title?: string;
    feature?: string;
    component?: string;
    tags?: string[];
    starred?: boolean;
    walkthrough?: CaptureEntry['walkthrough'];
    durationMs?: number;
    gitBranch?: string;
    gitCommit?: string;
    tagsAny?: string[];
    tagsAll?: string[];
    since?: string;
    until?: string;
    text?: string;
    limit?: number;
    groupBy?: GroupBy;
    id?: string;
    outDir?: string;
    flatten?: boolean;
    manifest?: boolean;
    showcasePath?: string;
}
export declare function handleLibrary(params: LibraryParams): Promise<unknown>;
//# sourceMappingURL=library.d.ts.map