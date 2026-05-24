export type LaunchKind = 'web-next' | 'web-vite' | 'web-static' | 'macos';
export interface LaunchHandle {
    kind: LaunchKind;
    pid?: number;
    url?: string;
    appName?: string;
    appPath?: string;
    killOnDisconnect: boolean;
    kill: () => Promise<void>;
}
export interface DetectionResult {
    kind: LaunchKind;
    startCommand?: string[];
    /** For static, the path to index.html or the dir to serve. */
    staticEntry?: string;
    /** For macos, the resolved xcodeproj / xcworkspace path. */
    xcodeTarget?: string;
}
export declare class LauncherError extends Error {
    reason: string;
    hint?: string | undefined;
    constructor(reason: string, hint?: string | undefined);
}
//# sourceMappingURL=types.d.ts.map