import type { CaptureEntry } from './types.js';
export interface FindOptions {
    /** Match any of these tags (OR). If both tagsAll and tagsAny are given, both must pass. */
    tagsAny?: string[];
    /** Match all of these tags (AND). */
    tagsAll?: string[];
    feature?: string;
    component?: string;
    platform?: string;
    type?: string;
    /** Created on or after this ISO date */
    since?: string;
    /** Created on or before this ISO date */
    until?: string;
    starred?: boolean;
    /** Free-text match against title/tags/feature/component */
    text?: string;
    /** Cap results */
    limit?: number;
}
export declare function find(all: CaptureEntry[], opts: FindOptions): CaptureEntry[];
export type GroupBy = 'feature' | 'date' | 'component' | 'platform' | 'type';
export declare function groupBy(all: CaptureEntry[], by: GroupBy): Array<{
    key: string;
    captures: CaptureEntry[];
}>;
export interface LibraryStats {
    total: number;
    by_type: Record<string, number>;
    by_platform: Record<string, number>;
    by_feature: Record<string, number>;
    total_size_bytes: number;
    oldest?: string;
    newest?: string;
    starred_count: number;
}
export declare function stats(all: CaptureEntry[]): LibraryStats;
//# sourceMappingURL=query.d.ts.map