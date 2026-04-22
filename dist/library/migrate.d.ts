export interface MigrationReport {
    sourcePath: string;
    found: number;
    imported: number;
    skipped: number;
    mediaCopied: number;
    mediaMissing: number;
    issues: string[];
}
/**
 * Import a showcase `.showcase/` directory into the spectra library.
 *
 * Non-destructive: original files stay in place. Existing spectra library
 * entries with the same capture id are skipped (not overwritten) so the
 * operation is idempotent.
 */
export declare function migrateFromShowcase(showcasePath: string, cwd?: string): Promise<MigrationReport>;
/** Tiny default that callers can use to auto-detect `.showcase/` in the cwd. */
export declare function defaultShowcasePath(cwd?: string): string;
//# sourceMappingURL=migrate.d.ts.map