declare const BIN_DIR: string;
declare const BINARY_PATH: string;
declare const COMPOSITE_BINARY_PATH: string;
declare const SCREEN_RECORDING_PREFLIGHT_PATH: string;
declare const CURSOR_SAMPLER_BINARY_PATH: string;
declare const TEXT_RENDER_BINARY_PATH: string;
declare const DAEMON_LAUNCHER_PATH: string;
declare const TEST_APP_PATH: string;
/**
 * Locate `Contents/Helpers/` of an installed Spectra.app bundle, if any.
 * Override with `SPECTRA_APP_BUNDLE_HELPERS_DIR` (points straight at the
 * Helpers dir) or `SPECTRA_APP_BUNDLE_PATH` (points at the .app) -- useful
 * for tests/dev without a real install. Falls back to the standard
 * `/Applications` locations. Returns null when nothing is found, which is
 * the case in every environment today (nothing has shipped the bundle yet).
 */
export declare function resolveBundleHelpersDir(): string | null;
export declare function isStale(): boolean;
export declare function isCompositeStale(): boolean;
export declare function isScreenRecordingPreflightStale(): boolean;
export declare function isCursorSamplerStale(): boolean;
export declare function isTextRenderStale(): boolean;
export declare function compile(): void;
export declare function compileComposite(): void;
export declare function compileScreenRecordingPreflight(): void;
export declare function compileDaemonLauncher(): string;
export declare function compileCursorSampler(): string;
export declare function compileTextRender(): void;
export declare function ensureBinary(): string;
export declare function ensureCompositeBinary(): string;
export declare function ensureScreenRecordingPreflightBinary(): string;
export declare function ensureCursorSamplerBinary(): string;
/**
 * `skipEmbedded` bypasses the app-bundle-embedded helper and forces the
 * source-compiled binary. An installed bundle's helper can lag this source
 * tree (e.g. a render kind added here before the bundle is rebuilt);
 * text-render.ts retries with this flag when the embedded helper rejects a
 * request with "unknown render kind".
 */
export declare function ensureTextRenderBinary(opts?: {
    skipEmbedded?: boolean;
}): string;
export declare function compileTestApp(): string;
export { BINARY_PATH, BIN_DIR, COMPOSITE_BINARY_PATH, CURSOR_SAMPLER_BINARY_PATH, DAEMON_LAUNCHER_PATH, SCREEN_RECORDING_PREFLIGHT_PATH, TEST_APP_PATH, TEXT_RENDER_BINARY_PATH, };
//# sourceMappingURL=compiler.d.ts.map