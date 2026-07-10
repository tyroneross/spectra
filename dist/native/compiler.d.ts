declare const BIN_DIR: string;
declare const BINARY_PATH: string;
declare const COMPOSITE_BINARY_PATH: string;
declare const SCREEN_RECORDING_PREFLIGHT_PATH: string;
declare const CURSOR_SAMPLER_BINARY_PATH: string;
declare const TEXT_RENDER_BINARY_PATH: string;
declare const DAEMON_LAUNCHER_PATH: string;
declare const WINDOW_BOUNDS_BINARY_PATH: string;
declare const TEST_APP_PATH: string;
export declare const HELPER_MODE_ENV = "SPECTRA_HELPER_MODE";
export declare const BUNDLE_HELPERS_DIR_ENV = "SPECTRA_APP_BUNDLE_HELPERS_DIR";
export declare const BUNDLE_PATH_ENV = "SPECTRA_APP_BUNDLE_PATH";
export declare const NATIVE_HELPER_PATH_ENV = "SPECTRA_NATIVE_HELPER_PATH";
export declare const CURSOR_SAMPLER_PATH_ENV = "SPECTRA_CURSOR_SAMPLER_PATH";
export declare const WINDOW_BOUNDS_PATH_ENV = "SPECTRA_WINDOW_BOUNDS_BIN";
export type HelperMode = 'bundle' | 'development';
export declare function resolveHelperMode(): HelperMode | undefined;
/** Locate an available bundle Helpers directory for unset-mode app discovery. */
export declare function resolveBundleHelpersDir(): string | null;
/**
 * Resolve a bundle-contained helper without enabling a home fallback.
 * Bundle mode requires an explicit bundle/helpers setting. Development
 * returns directly to the caller's home/compile path so one process never
 * mixes bare and bundled helper attribution.
 */
export declare function resolveBundledHelperPath(helperName: string): string | null;
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
export declare function ensureTextRenderBinary(): string;
/** Window bounds has a build-script-owned development binary, not an on-demand compiler. */
export declare function ensureWindowBoundsBinary(): string;
export declare function compileTestApp(): string;
export { BINARY_PATH, BIN_DIR, COMPOSITE_BINARY_PATH, CURSOR_SAMPLER_BINARY_PATH, DAEMON_LAUNCHER_PATH, SCREEN_RECORDING_PREFLIGHT_PATH, TEST_APP_PATH, TEXT_RENDER_BINARY_PATH, WINDOW_BOUNDS_BINARY_PATH, };
//# sourceMappingURL=compiler.d.ts.map