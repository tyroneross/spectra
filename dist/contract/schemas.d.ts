import { z } from 'zod';
import { API_VERSION, type CoreApiOperation } from './wire.js';
export { API_VERSION };
export declare const apiVersion: 2;
export declare const jsonValueSchema: z.ZodType<unknown>;
export declare const platformSchema: z.ZodEnum<["web", "macos", "ios", "watchos", "terminal"]>;
export declare const libraryPlatformSchema: z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>;
export declare const captureModeSchema: z.ZodEnum<["full", "element", "region", "auto"]>;
export declare const capturePresetSchema: z.ZodEnum<["docs", "demo", "social", "app-store"]>;
export declare const captureQualitySchema: z.ZodEnum<["lossless", "high", "medium"]>;
export declare const videoCodecSchema: z.ZodEnum<["h264", "hevc"]>;
export declare const videoBitrateSchema: z.ZodEnum<["4M", "8M"]>;
export declare const recordingFpsSchema: z.ZodUnion<[z.ZodLiteral<30>, z.ZodLiteral<60>]>;
export declare const actionTypeSchema: z.ZodEnum<["click", "type", "clear", "select", "scroll", "hover", "focus"]>;
export declare const permissionKindSchema: z.ZodEnum<["accessibility", "screen-recording", "automation", "developer-tools"]>;
export declare const compositeSpotlightSchema: z.ZodEnum<["none", "a", "b"]>;
export declare const libraryCaptureTypeSchema: z.ZodEnum<["screenshot", "video", "walkthrough"]>;
export declare const libraryGroupBySchema: z.ZodEnum<["feature", "date", "component", "platform", "type"]>;
export declare const viewportSchema: z.ZodObject<{
    width: z.ZodNumber;
    height: z.ZodNumber;
    devicePixelRatio: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    width: number;
    height: number;
    devicePixelRatio?: number | undefined;
}, {
    width: number;
    height: number;
    devicePixelRatio?: number | undefined;
}>;
export declare const recordingCompositePaneSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    width: number;
    height: number;
    x: number;
    y: number;
}, {
    width: number;
    height: number;
    x: number;
    y: number;
}>;
export declare const recordingCompositeOptionsSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    displayWidth: z.ZodOptional<z.ZodNumber>;
    displayHeight: z.ZodOptional<z.ZodNumber>;
    left: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        x: number;
        y: number;
    }, {
        width: number;
        height: number;
        x: number;
        y: number;
    }>>;
    right: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        x: number;
        y: number;
    }, {
        width: number;
        height: number;
        x: number;
        y: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    left?: {
        width: number;
        height: number;
        x: number;
        y: number;
    } | undefined;
    right?: {
        width: number;
        height: number;
        x: number;
        y: number;
    } | undefined;
    enabled?: boolean | undefined;
    displayWidth?: number | undefined;
    displayHeight?: number | undefined;
}, {
    left?: {
        width: number;
        height: number;
        x: number;
        y: number;
    } | undefined;
    right?: {
        width: number;
        height: number;
        x: number;
        y: number;
    } | undefined;
    enabled?: boolean | undefined;
    displayWidth?: number | undefined;
    displayHeight?: number | undefined;
}>;
export declare const actionPlanStepSchema: z.ZodObject<{
    type: z.ZodEnum<["click", "type", "clear", "select", "scroll", "hover", "focus"]>;
    elementId: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    intent: z.ZodOptional<z.ZodString>;
    waitAfterMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
    elementId: string;
    intent?: string | undefined;
    value?: string | undefined;
    waitAfterMs?: number | undefined;
}, {
    type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
    elementId: string;
    intent?: string | undefined;
    value?: string | undefined;
    waitAfterMs?: number | undefined;
}>;
export declare const healthParamsSchema: z.ZodObject<{
    includePermissions: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    includePermissions?: boolean | undefined;
}, {
    includePermissions?: boolean | undefined;
}>;
export declare const getPermissionsParamsSchema: z.ZodObject<{
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<["accessibility", "screen-recording", "automation", "developer-tools"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    permissions?: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[] | undefined;
}, {
    permissions?: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[] | undefined;
}>;
export declare const requestPermissionsParamsSchema: z.ZodObject<{
    permissions: z.ZodArray<z.ZodEnum<["accessibility", "screen-recording", "automation", "developer-tools"]>, "many">;
    prompt: z.ZodOptional<z.ZodBoolean>;
    openSettings: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    permissions: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[];
    prompt?: boolean | undefined;
    openSettings?: boolean | undefined;
}, {
    permissions: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[];
    prompt?: boolean | undefined;
    openSettings?: boolean | undefined;
}>;
export declare const listWindowsParamsSchema: z.ZodObject<{
    app: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    onScreenOnly: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    app?: string | undefined;
    title?: string | undefined;
    onScreenOnly?: boolean | undefined;
}, {
    app?: string | undefined;
    title?: string | undefined;
    onScreenOnly?: boolean | undefined;
}>;
export declare const createSessionParamsSchema: z.ZodObject<{
    target: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    record: z.ZodOptional<z.ZodBoolean>;
    repoPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    target: string;
    name?: string | undefined;
    record?: boolean | undefined;
    repoPath?: string | undefined;
}, {
    target: string;
    name?: string | undefined;
    record?: boolean | undefined;
    repoPath?: string | undefined;
}>;
export declare const listSessionsParamsSchema: z.ZodObject<{
    includeClosed: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    includeClosed?: boolean | undefined;
}, {
    includeClosed?: boolean | undefined;
}>;
export declare const sessionByIdParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
}, {
    sessionId: string;
}>;
export declare const recordLlmUsageParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    usage: z.ZodType<unknown, z.ZodTypeDef, unknown>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    usage?: unknown;
}, {
    sessionId: string;
    usage?: unknown;
}>;
export declare const snapshotParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    screenshot: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    screenshot?: boolean | undefined;
}, {
    sessionId: string;
    screenshot?: boolean | undefined;
}>;
export declare const observeParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    screenshot: z.ZodOptional<z.ZodBoolean>;
    analyze: z.ZodOptional<z.ZodBoolean>;
    viewport: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        devicePixelRatio: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    }, {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    screenshot?: boolean | undefined;
    viewport?: {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    } | undefined;
    analyze?: boolean | undefined;
}, {
    sessionId: string;
    screenshot?: boolean | undefined;
    viewport?: {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    } | undefined;
    analyze?: boolean | undefined;
}>;
export declare const actParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    elementId: z.ZodString;
    action: z.ZodEnum<["click", "type", "clear", "select", "scroll", "hover", "focus"]>;
    value: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
    sessionId: string;
    elementId: string;
    value?: string | undefined;
}, {
    action: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
    sessionId: string;
    elementId: string;
    value?: string | undefined;
}>;
export declare const stepParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    intent: z.ZodString;
}, "strip", z.ZodTypeAny, {
    intent: string;
    sessionId: string;
}, {
    intent: string;
    sessionId: string;
}>;
export declare const llmStepParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    actions: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["click", "type", "clear", "select", "scroll", "hover", "focus"]>;
        elementId: z.ZodString;
        value: z.ZodOptional<z.ZodString>;
        intent: z.ZodOptional<z.ZodString>;
        waitAfterMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
        elementId: string;
        intent?: string | undefined;
        value?: string | undefined;
        waitAfterMs?: number | undefined;
    }, {
        type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
        elementId: string;
        intent?: string | undefined;
        value?: string | undefined;
        waitAfterMs?: number | undefined;
    }>, "many">;
    continueOnError: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    actions: {
        type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
        elementId: string;
        intent?: string | undefined;
        value?: string | undefined;
        waitAfterMs?: number | undefined;
    }[];
    continueOnError?: boolean | undefined;
}, {
    sessionId: string;
    actions: {
        type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
        elementId: string;
        intent?: string | undefined;
        value?: string | undefined;
        waitAfterMs?: number | undefined;
    }[];
    continueOnError?: boolean | undefined;
}>;
export declare const walkthroughParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    steps: z.ZodArray<z.ZodObject<{
        intent: z.ZodString;
        capture: z.ZodOptional<z.ZodBoolean>;
        waitMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        intent: string;
        capture?: boolean | undefined;
        waitMs?: number | undefined;
    }, {
        intent: string;
        capture?: boolean | undefined;
        waitMs?: number | undefined;
    }>, "many">;
    clean: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    steps: {
        intent: string;
        capture?: boolean | undefined;
        waitMs?: number | undefined;
    }[];
    clean?: boolean | undefined;
}, {
    sessionId: string;
    steps: {
        intent: string;
        capture?: boolean | undefined;
        waitMs?: number | undefined;
    }[];
    clean?: boolean | undefined;
}>;
export declare const screenshotParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    preset: z.ZodOptional<z.ZodEnum<["docs", "demo", "social", "app-store"]>>;
    mode: z.ZodOptional<z.ZodEnum<["full", "element", "region", "auto"]>>;
    elementId: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodString>;
    aspectRatio: z.ZodOptional<z.ZodString>;
    clean: z.ZodOptional<z.ZodBoolean>;
    quality: z.ZodOptional<z.ZodEnum<["lossless", "high", "medium"]>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    region?: string | undefined;
    mode?: "full" | "element" | "region" | "auto" | undefined;
    preset?: "docs" | "demo" | "social" | "app-store" | undefined;
    quality?: "lossless" | "high" | "medium" | undefined;
    elementId?: string | undefined;
    aspectRatio?: string | undefined;
    clean?: boolean | undefined;
}, {
    sessionId: string;
    region?: string | undefined;
    mode?: "full" | "element" | "region" | "auto" | undefined;
    preset?: "docs" | "demo" | "social" | "app-store" | undefined;
    quality?: "lossless" | "high" | "medium" | undefined;
    elementId?: string | undefined;
    aspectRatio?: string | undefined;
    clean?: boolean | undefined;
}>;
export declare const startRecordingParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    preset: z.ZodOptional<z.ZodEnum<["docs", "demo", "social", "app-store"]>>;
    fps: z.ZodOptional<z.ZodUnion<[z.ZodLiteral<30>, z.ZodLiteral<60>]>>;
    codec: z.ZodOptional<z.ZodEnum<["h264", "hevc"]>>;
    bitrate: z.ZodOptional<z.ZodEnum<["4M", "8M"]>>;
    hardware: z.ZodOptional<z.ZodBoolean>;
    composite: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        displayWidth: z.ZodOptional<z.ZodNumber>;
        displayHeight: z.ZodOptional<z.ZodNumber>;
        left: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            width: number;
            height: number;
            x: number;
            y: number;
        }, {
            width: number;
            height: number;
            x: number;
            y: number;
        }>>;
        right: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            width: number;
            height: number;
            x: number;
            y: number;
        }, {
            width: number;
            height: number;
            x: number;
            y: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        left?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        right?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        enabled?: boolean | undefined;
        displayWidth?: number | undefined;
        displayHeight?: number | undefined;
    }, {
        left?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        right?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        enabled?: boolean | undefined;
        displayWidth?: number | undefined;
        displayHeight?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    preset?: "docs" | "demo" | "social" | "app-store" | undefined;
    codec?: "h264" | "hevc" | undefined;
    fps?: 60 | 30 | undefined;
    bitrate?: "4M" | "8M" | undefined;
    composite?: {
        left?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        right?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        enabled?: boolean | undefined;
        displayWidth?: number | undefined;
        displayHeight?: number | undefined;
    } | undefined;
    hardware?: boolean | undefined;
}, {
    sessionId: string;
    preset?: "docs" | "demo" | "social" | "app-store" | undefined;
    codec?: "h264" | "hevc" | undefined;
    fps?: 60 | 30 | undefined;
    bitrate?: "4M" | "8M" | undefined;
    composite?: {
        left?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        right?: {
            width: number;
            height: number;
            x: number;
            y: number;
        } | undefined;
        enabled?: boolean | undefined;
        displayWidth?: number | undefined;
        displayHeight?: number | undefined;
    } | undefined;
    hardware?: boolean | undefined;
}>;
export declare const stopRecordingParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    preset: z.ZodOptional<z.ZodEnum<["docs", "demo", "social", "app-store"]>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    preset?: "docs" | "demo" | "social" | "app-store" | undefined;
}, {
    sessionId: string;
    preset?: "docs" | "demo" | "social" | "app-store" | undefined;
}>;
export declare const recordCompositeParamsSchema: z.ZodObject<{
    appA: z.ZodString;
    titleA: z.ZodOptional<z.ZodString>;
    labelA: z.ZodOptional<z.ZodString>;
    appB: z.ZodString;
    titleB: z.ZodOptional<z.ZodString>;
    labelB: z.ZodOptional<z.ZodString>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    fps: z.ZodOptional<z.ZodNumber>;
    spotlight: z.ZodOptional<z.ZodEnum<["none", "a", "b"]>>;
    caption: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodBoolean>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    crf: z.ZodOptional<z.ZodNumber>;
    outPath: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    async: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    appA: string;
    appB: string;
    outPath: string;
    fps?: number | undefined;
    sessionId?: string | undefined;
    caption?: string | undefined;
    titleA?: string | undefined;
    labelA?: string | undefined;
    titleB?: string | undefined;
    labelB?: string | undefined;
    durationSeconds?: number | undefined;
    spotlight?: "none" | "a" | "b" | undefined;
    cursor?: boolean | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    async?: boolean | undefined;
}, {
    appA: string;
    appB: string;
    outPath: string;
    fps?: number | undefined;
    sessionId?: string | undefined;
    caption?: string | undefined;
    titleA?: string | undefined;
    labelA?: string | undefined;
    titleB?: string | undefined;
    labelB?: string | undefined;
    durationSeconds?: number | undefined;
    spotlight?: "none" | "a" | "b" | undefined;
    cursor?: boolean | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    async?: boolean | undefined;
}>;
export declare const getRecordingParamsSchema: z.ZodObject<{
    recordingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    recordingId: string;
}, {
    recordingId: string;
}>;
export declare const analyzeParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    viewport: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        devicePixelRatio: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    }, {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    viewport?: {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    } | undefined;
}, {
    sessionId: string;
    viewport?: {
        width: number;
        height: number;
        devicePixelRatio?: number | undefined;
    } | undefined;
}>;
export declare const discoverParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    maxDepth: z.ZodOptional<z.ZodNumber>;
    maxScreens: z.ZodOptional<z.ZodNumber>;
    captureStates: z.ZodOptional<z.ZodBoolean>;
    clean: z.ZodOptional<z.ZodBoolean>;
    outputDir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    maxDepth?: number | undefined;
    maxScreens?: number | undefined;
    clean?: boolean | undefined;
    captureStates?: boolean | undefined;
    outputDir?: string | undefined;
}, {
    sessionId: string;
    maxDepth?: number | undefined;
    maxScreens?: number | undefined;
    clean?: boolean | undefined;
    captureStates?: boolean | undefined;
    outputDir?: string | undefined;
}>;
export declare const terminalRecordParamsSchema: z.ZodObject<{
    command: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
    watch_files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    outputDir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    command: string;
    outputDir?: string | undefined;
    timeout?: number | undefined;
    watch_files?: string[] | undefined;
}, {
    command: string;
    outputDir?: string | undefined;
    timeout?: number | undefined;
    watch_files?: string[] | undefined;
}>;
export declare const terminalReplayParamsSchema: z.ZodObject<{
    file: z.ZodString;
    search: z.ZodOptional<z.ZodString>;
    commands_only: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    file: string;
    search?: string | undefined;
    commands_only?: boolean | undefined;
}, {
    file: string;
    search?: string | undefined;
    commands_only?: boolean | undefined;
}>;
export declare const libraryParamsSchema: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
    action: z.ZodLiteral<"add">;
    sourcePath: z.ZodString;
    type: z.ZodOptional<z.ZodEnum<["screenshot", "video", "walkthrough"]>>;
    platform: z.ZodOptional<z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>>;
    url: z.ZodOptional<z.ZodString>;
    viewport: z.ZodOptional<z.ZodString>;
    selector: z.ZodOptional<z.ZodString>;
    deviceName: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    feature: z.ZodOptional<z.ZodString>;
    component: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    starred: z.ZodOptional<z.ZodBoolean>;
    walkthrough: z.ZodOptional<z.ZodObject<{
        step_count: z.ZodNumber;
        steps: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        steps: string[];
        step_count: number;
    }, {
        steps: string[];
        step_count: number;
    }>>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    gitBranch: z.ZodOptional<z.ZodString>;
    gitCommit: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "add";
    sourcePath: string;
    type?: "screenshot" | "video" | "walkthrough" | undefined;
    durationMs?: number | undefined;
    url?: string | undefined;
    platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
    viewport?: string | undefined;
    walkthrough?: {
        steps: string[];
        step_count: number;
    } | undefined;
    feature?: string | undefined;
    component?: string | undefined;
    title?: string | undefined;
    selector?: string | undefined;
    deviceName?: string | undefined;
    tags?: string[] | undefined;
    starred?: boolean | undefined;
    gitBranch?: string | undefined;
    gitCommit?: string | undefined;
}, {
    action: "add";
    sourcePath: string;
    type?: "screenshot" | "video" | "walkthrough" | undefined;
    durationMs?: number | undefined;
    url?: string | undefined;
    platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
    viewport?: string | undefined;
    walkthrough?: {
        steps: string[];
        step_count: number;
    } | undefined;
    feature?: string | undefined;
    component?: string | undefined;
    title?: string | undefined;
    selector?: string | undefined;
    deviceName?: string | undefined;
    tags?: string[] | undefined;
    starred?: boolean | undefined;
    gitBranch?: string | undefined;
    gitCommit?: string | undefined;
}>, z.ZodObject<{
    tagsAny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    tagsAll: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    feature: z.ZodOptional<z.ZodString>;
    component: z.ZodOptional<z.ZodString>;
    platform: z.ZodOptional<z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>>;
    type: z.ZodOptional<z.ZodEnum<["screenshot", "video", "walkthrough"]>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    starred: z.ZodOptional<z.ZodBoolean>;
    text: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    action: z.ZodLiteral<"find">;
}, "strip", z.ZodTypeAny, {
    action: "find";
    type?: "screenshot" | "video" | "walkthrough" | undefined;
    text?: string | undefined;
    platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
    feature?: string | undefined;
    component?: string | undefined;
    starred?: boolean | undefined;
    tagsAny?: string[] | undefined;
    tagsAll?: string[] | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
}, {
    action: "find";
    type?: "screenshot" | "video" | "walkthrough" | undefined;
    text?: string | undefined;
    platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
    feature?: string | undefined;
    component?: string | undefined;
    starred?: boolean | undefined;
    tagsAny?: string[] | undefined;
    tagsAll?: string[] | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"gallery">;
    groupBy: z.ZodOptional<z.ZodEnum<["feature", "date", "component", "platform", "type"]>>;
}, "strip", z.ZodTypeAny, {
    action: "gallery";
    groupBy?: "type" | "platform" | "feature" | "date" | "component" | undefined;
}, {
    action: "gallery";
    groupBy?: "type" | "platform" | "feature" | "date" | "component" | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"get">;
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    action: "get";
}, {
    id: string;
    action: "get";
}>, z.ZodObject<{
    action: z.ZodLiteral<"tag">;
    id: z.ZodString;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    feature: z.ZodOptional<z.ZodString>;
    component: z.ZodOptional<z.ZodString>;
    starred: z.ZodOptional<z.ZodBoolean>;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    action: "tag";
    feature?: string | undefined;
    component?: string | undefined;
    title?: string | undefined;
    tags?: string[] | undefined;
    starred?: boolean | undefined;
}, {
    id: string;
    action: "tag";
    feature?: string | undefined;
    component?: string | undefined;
    title?: string | undefined;
    tags?: string[] | undefined;
    starred?: boolean | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"delete">;
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    action: "delete";
}, {
    id: string;
    action: "delete";
}>, z.ZodObject<{
    action: z.ZodLiteral<"status">;
}, "strip", z.ZodTypeAny, {
    action: "status";
}, {
    action: "status";
}>, z.ZodObject<{
    tagsAny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    tagsAll: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    feature: z.ZodOptional<z.ZodString>;
    component: z.ZodOptional<z.ZodString>;
    platform: z.ZodOptional<z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>>;
    type: z.ZodOptional<z.ZodEnum<["screenshot", "video", "walkthrough"]>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    starred: z.ZodOptional<z.ZodBoolean>;
    text: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    action: z.ZodLiteral<"export">;
    outDir: z.ZodString;
    flatten: z.ZodOptional<z.ZodBoolean>;
    manifest: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    action: "export";
    outDir: string;
    type?: "screenshot" | "video" | "walkthrough" | undefined;
    text?: string | undefined;
    flatten?: boolean | undefined;
    platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
    manifest?: boolean | undefined;
    feature?: string | undefined;
    component?: string | undefined;
    starred?: boolean | undefined;
    tagsAny?: string[] | undefined;
    tagsAll?: string[] | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
}, {
    action: "export";
    outDir: string;
    type?: "screenshot" | "video" | "walkthrough" | undefined;
    text?: string | undefined;
    flatten?: boolean | undefined;
    platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
    manifest?: boolean | undefined;
    feature?: string | undefined;
    component?: string | undefined;
    starred?: boolean | undefined;
    tagsAny?: string[] | undefined;
    tagsAll?: string[] | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"migrate-from-showcase">;
    showcasePath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "migrate-from-showcase";
    showcasePath?: string | undefined;
}, {
    action: "migrate-from-showcase";
    showcasePath?: string | undefined;
}>]>;
export declare const autoRampDemoParamsSchema: z.ZodObject<{
    input: z.ZodString;
    out: z.ZodString;
    deadSpeed: z.ZodOptional<z.ZodNumber>;
    minDeadSec: z.ZodOptional<z.ZodNumber>;
    padSec: z.ZodOptional<z.ZodNumber>;
    threshold: z.ZodOptional<z.ZodNumber>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    crf: z.ZodOptional<z.ZodNumber>;
    fps: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    input: string;
    out: string;
    fps?: number | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    deadSpeed?: number | undefined;
    minDeadSec?: number | undefined;
    padSec?: number | undefined;
    threshold?: number | undefined;
}, {
    input: string;
    out: string;
    fps?: number | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    deadSpeed?: number | undefined;
    minDeadSec?: number | undefined;
    padSec?: number | undefined;
    threshold?: number | undefined;
}>;
export declare const demoParamsSchema: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
    action: z.ZodLiteral<"scan">;
    input: z.ZodString;
    threshold: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    action: "scan";
    input: string;
    threshold?: number | undefined;
}, {
    action: "scan";
    input: string;
    threshold?: number | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"polish">;
    spec: z.ZodObject<{
        canvas: z.ZodObject<{
            w: z.ZodNumber;
            h: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            w: number;
            h: number;
        }, {
            w: number;
            h: number;
        }>;
        fps: z.ZodOptional<z.ZodNumber>;
        segments: z.ZodArray<z.ZodObject<{
            input: z.ZodString;
            startSec: z.ZodNumber;
            durationSec: z.ZodNumber;
            focal: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                w: z.ZodNumber;
                h: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                x: number;
                y: number;
                w: number;
                h: number;
            }, {
                x: number;
                y: number;
                w: number;
                h: number;
            }>;
            caption: z.ZodOptional<z.ZodString>;
            captionPngPath: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            input: string;
            startSec: number;
            durationSec: number;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }, {
            input: string;
            startSec: number;
            durationSec: number;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }>, "many">;
        speed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        canvas: {
            w: number;
            h: number;
        };
        segments: {
            input: string;
            startSec: number;
            durationSec: number;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }[];
        fps?: number | undefined;
        speed?: number | undefined;
    }, {
        canvas: {
            w: number;
            h: number;
        };
        segments: {
            input: string;
            startSec: number;
            durationSec: number;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }[];
        fps?: number | undefined;
        speed?: number | undefined;
    }>;
    out: z.ZodString;
}, "strip", z.ZodTypeAny, {
    action: "polish";
    out: string;
    spec: {
        canvas: {
            w: number;
            h: number;
        };
        segments: {
            input: string;
            startSec: number;
            durationSec: number;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }[];
        fps?: number | undefined;
        speed?: number | undefined;
    };
}, {
    action: "polish";
    out: string;
    spec: {
        canvas: {
            w: number;
            h: number;
        };
        segments: {
            input: string;
            startSec: number;
            durationSec: number;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }[];
        fps?: number | undefined;
        speed?: number | undefined;
    };
}>, z.ZodObject<{
    input: z.ZodString;
    out: z.ZodString;
    deadSpeed: z.ZodOptional<z.ZodNumber>;
    minDeadSec: z.ZodOptional<z.ZodNumber>;
    padSec: z.ZodOptional<z.ZodNumber>;
    threshold: z.ZodOptional<z.ZodNumber>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    crf: z.ZodOptional<z.ZodNumber>;
    fps: z.ZodOptional<z.ZodNumber>;
    action: z.ZodLiteral<"auto-ramp">;
}, "strip", z.ZodTypeAny, {
    action: "auto-ramp";
    input: string;
    out: string;
    fps?: number | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    deadSpeed?: number | undefined;
    minDeadSec?: number | undefined;
    padSec?: number | undefined;
    threshold?: number | undefined;
}, {
    action: "auto-ramp";
    input: string;
    out: string;
    fps?: number | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    deadSpeed?: number | undefined;
    minDeadSec?: number | undefined;
    padSec?: number | undefined;
    threshold?: number | undefined;
}>, z.ZodObject<{
    appA: z.ZodString;
    titleA: z.ZodOptional<z.ZodString>;
    labelA: z.ZodOptional<z.ZodString>;
    appB: z.ZodString;
    titleB: z.ZodOptional<z.ZodString>;
    labelB: z.ZodOptional<z.ZodString>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    fps: z.ZodOptional<z.ZodNumber>;
    spotlight: z.ZodOptional<z.ZodEnum<["none", "a", "b"]>>;
    caption: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodBoolean>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    crf: z.ZodOptional<z.ZodNumber>;
    outPath: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    async: z.ZodOptional<z.ZodBoolean>;
    action: z.ZodLiteral<"record-composite">;
}, "strip", z.ZodTypeAny, {
    action: "record-composite";
    appA: string;
    appB: string;
    outPath: string;
    fps?: number | undefined;
    sessionId?: string | undefined;
    caption?: string | undefined;
    titleA?: string | undefined;
    labelA?: string | undefined;
    titleB?: string | undefined;
    labelB?: string | undefined;
    durationSeconds?: number | undefined;
    spotlight?: "none" | "a" | "b" | undefined;
    cursor?: boolean | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    async?: boolean | undefined;
}, {
    action: "record-composite";
    appA: string;
    appB: string;
    outPath: string;
    fps?: number | undefined;
    sessionId?: string | undefined;
    caption?: string | undefined;
    titleA?: string | undefined;
    labelA?: string | undefined;
    titleB?: string | undefined;
    labelB?: string | undefined;
    durationSeconds?: number | undefined;
    spotlight?: "none" | "a" | "b" | undefined;
    cursor?: boolean | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    async?: boolean | undefined;
}>]>;
export declare const operationParamSchemas: {
    health: z.ZodObject<{
        includePermissions: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        includePermissions?: boolean | undefined;
    }, {
        includePermissions?: boolean | undefined;
    }>;
    getPermissions: z.ZodObject<{
        permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<["accessibility", "screen-recording", "automation", "developer-tools"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        permissions?: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[] | undefined;
    }, {
        permissions?: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[] | undefined;
    }>;
    requestPermissions: z.ZodObject<{
        permissions: z.ZodArray<z.ZodEnum<["accessibility", "screen-recording", "automation", "developer-tools"]>, "many">;
        prompt: z.ZodOptional<z.ZodBoolean>;
        openSettings: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissions: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[];
        prompt?: boolean | undefined;
        openSettings?: boolean | undefined;
    }, {
        permissions: ("accessibility" | "screen-recording" | "automation" | "developer-tools")[];
        prompt?: boolean | undefined;
        openSettings?: boolean | undefined;
    }>;
    listWindows: z.ZodObject<{
        app: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        onScreenOnly: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        app?: string | undefined;
        title?: string | undefined;
        onScreenOnly?: boolean | undefined;
    }, {
        app?: string | undefined;
        title?: string | undefined;
        onScreenOnly?: boolean | undefined;
    }>;
    createSession: z.ZodObject<{
        target: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        record: z.ZodOptional<z.ZodBoolean>;
        repoPath: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        target: string;
        name?: string | undefined;
        record?: boolean | undefined;
        repoPath?: string | undefined;
    }, {
        target: string;
        name?: string | undefined;
        record?: boolean | undefined;
        repoPath?: string | undefined;
    }>;
    listSessions: z.ZodObject<{
        includeClosed: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        includeClosed?: boolean | undefined;
    }, {
        includeClosed?: boolean | undefined;
    }>;
    getSession: z.ZodObject<{
        sessionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
    }, {
        sessionId: string;
    }>;
    getRun: z.ZodObject<{
        sessionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
    }, {
        sessionId: string;
    }>;
    closeSession: z.ZodObject<{
        sessionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
    }, {
        sessionId: string;
    }>;
    closeAllSessions: z.ZodOptional<z.ZodVoid>;
    recordLlmUsage: z.ZodObject<{
        sessionId: z.ZodString;
        usage: z.ZodType<unknown, z.ZodTypeDef, unknown>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        usage?: unknown;
    }, {
        sessionId: string;
        usage?: unknown;
    }>;
    snapshot: z.ZodObject<{
        sessionId: z.ZodString;
        screenshot: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        screenshot?: boolean | undefined;
    }, {
        sessionId: string;
        screenshot?: boolean | undefined;
    }>;
    observe: z.ZodObject<{
        sessionId: z.ZodString;
        screenshot: z.ZodOptional<z.ZodBoolean>;
        analyze: z.ZodOptional<z.ZodBoolean>;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            devicePixelRatio: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        }, {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        screenshot?: boolean | undefined;
        viewport?: {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        } | undefined;
        analyze?: boolean | undefined;
    }, {
        sessionId: string;
        screenshot?: boolean | undefined;
        viewport?: {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        } | undefined;
        analyze?: boolean | undefined;
    }>;
    act: z.ZodObject<{
        sessionId: z.ZodString;
        elementId: z.ZodString;
        action: z.ZodEnum<["click", "type", "clear", "select", "scroll", "hover", "focus"]>;
        value: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
        sessionId: string;
        elementId: string;
        value?: string | undefined;
    }, {
        action: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
        sessionId: string;
        elementId: string;
        value?: string | undefined;
    }>;
    step: z.ZodObject<{
        sessionId: z.ZodString;
        intent: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        intent: string;
        sessionId: string;
    }, {
        intent: string;
        sessionId: string;
    }>;
    llmStep: z.ZodObject<{
        sessionId: z.ZodString;
        actions: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<["click", "type", "clear", "select", "scroll", "hover", "focus"]>;
            elementId: z.ZodString;
            value: z.ZodOptional<z.ZodString>;
            intent: z.ZodOptional<z.ZodString>;
            waitAfterMs: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
            elementId: string;
            intent?: string | undefined;
            value?: string | undefined;
            waitAfterMs?: number | undefined;
        }, {
            type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
            elementId: string;
            intent?: string | undefined;
            value?: string | undefined;
            waitAfterMs?: number | undefined;
        }>, "many">;
        continueOnError: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        actions: {
            type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
            elementId: string;
            intent?: string | undefined;
            value?: string | undefined;
            waitAfterMs?: number | undefined;
        }[];
        continueOnError?: boolean | undefined;
    }, {
        sessionId: string;
        actions: {
            type: "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus";
            elementId: string;
            intent?: string | undefined;
            value?: string | undefined;
            waitAfterMs?: number | undefined;
        }[];
        continueOnError?: boolean | undefined;
    }>;
    walkthrough: z.ZodObject<{
        sessionId: z.ZodString;
        steps: z.ZodArray<z.ZodObject<{
            intent: z.ZodString;
            capture: z.ZodOptional<z.ZodBoolean>;
            waitMs: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            intent: string;
            capture?: boolean | undefined;
            waitMs?: number | undefined;
        }, {
            intent: string;
            capture?: boolean | undefined;
            waitMs?: number | undefined;
        }>, "many">;
        clean: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        steps: {
            intent: string;
            capture?: boolean | undefined;
            waitMs?: number | undefined;
        }[];
        clean?: boolean | undefined;
    }, {
        sessionId: string;
        steps: {
            intent: string;
            capture?: boolean | undefined;
            waitMs?: number | undefined;
        }[];
        clean?: boolean | undefined;
    }>;
    screenshot: z.ZodObject<{
        sessionId: z.ZodString;
        preset: z.ZodOptional<z.ZodEnum<["docs", "demo", "social", "app-store"]>>;
        mode: z.ZodOptional<z.ZodEnum<["full", "element", "region", "auto"]>>;
        elementId: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodString>;
        aspectRatio: z.ZodOptional<z.ZodString>;
        clean: z.ZodOptional<z.ZodBoolean>;
        quality: z.ZodOptional<z.ZodEnum<["lossless", "high", "medium"]>>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        region?: string | undefined;
        mode?: "full" | "element" | "region" | "auto" | undefined;
        preset?: "docs" | "demo" | "social" | "app-store" | undefined;
        quality?: "lossless" | "high" | "medium" | undefined;
        elementId?: string | undefined;
        aspectRatio?: string | undefined;
        clean?: boolean | undefined;
    }, {
        sessionId: string;
        region?: string | undefined;
        mode?: "full" | "element" | "region" | "auto" | undefined;
        preset?: "docs" | "demo" | "social" | "app-store" | undefined;
        quality?: "lossless" | "high" | "medium" | undefined;
        elementId?: string | undefined;
        aspectRatio?: string | undefined;
        clean?: boolean | undefined;
    }>;
    startRecording: z.ZodObject<{
        sessionId: z.ZodString;
        preset: z.ZodOptional<z.ZodEnum<["docs", "demo", "social", "app-store"]>>;
        fps: z.ZodOptional<z.ZodUnion<[z.ZodLiteral<30>, z.ZodLiteral<60>]>>;
        codec: z.ZodOptional<z.ZodEnum<["h264", "hevc"]>>;
        bitrate: z.ZodOptional<z.ZodEnum<["4M", "8M"]>>;
        hardware: z.ZodOptional<z.ZodBoolean>;
        composite: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            displayWidth: z.ZodOptional<z.ZodNumber>;
            displayHeight: z.ZodOptional<z.ZodNumber>;
            left: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                width: z.ZodNumber;
                height: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                width: number;
                height: number;
                x: number;
                y: number;
            }, {
                width: number;
                height: number;
                x: number;
                y: number;
            }>>;
            right: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                width: z.ZodNumber;
                height: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                width: number;
                height: number;
                x: number;
                y: number;
            }, {
                width: number;
                height: number;
                x: number;
                y: number;
            }>>;
        }, "strip", z.ZodTypeAny, {
            left?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            right?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            enabled?: boolean | undefined;
            displayWidth?: number | undefined;
            displayHeight?: number | undefined;
        }, {
            left?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            right?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            enabled?: boolean | undefined;
            displayWidth?: number | undefined;
            displayHeight?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        preset?: "docs" | "demo" | "social" | "app-store" | undefined;
        codec?: "h264" | "hevc" | undefined;
        fps?: 60 | 30 | undefined;
        bitrate?: "4M" | "8M" | undefined;
        composite?: {
            left?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            right?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            enabled?: boolean | undefined;
            displayWidth?: number | undefined;
            displayHeight?: number | undefined;
        } | undefined;
        hardware?: boolean | undefined;
    }, {
        sessionId: string;
        preset?: "docs" | "demo" | "social" | "app-store" | undefined;
        codec?: "h264" | "hevc" | undefined;
        fps?: 60 | 30 | undefined;
        bitrate?: "4M" | "8M" | undefined;
        composite?: {
            left?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            right?: {
                width: number;
                height: number;
                x: number;
                y: number;
            } | undefined;
            enabled?: boolean | undefined;
            displayWidth?: number | undefined;
            displayHeight?: number | undefined;
        } | undefined;
        hardware?: boolean | undefined;
    }>;
    stopRecording: z.ZodObject<{
        sessionId: z.ZodString;
        preset: z.ZodOptional<z.ZodEnum<["docs", "demo", "social", "app-store"]>>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        preset?: "docs" | "demo" | "social" | "app-store" | undefined;
    }, {
        sessionId: string;
        preset?: "docs" | "demo" | "social" | "app-store" | undefined;
    }>;
    recordComposite: z.ZodObject<{
        appA: z.ZodString;
        titleA: z.ZodOptional<z.ZodString>;
        labelA: z.ZodOptional<z.ZodString>;
        appB: z.ZodString;
        titleB: z.ZodOptional<z.ZodString>;
        labelB: z.ZodOptional<z.ZodString>;
        durationSeconds: z.ZodOptional<z.ZodNumber>;
        fps: z.ZodOptional<z.ZodNumber>;
        spotlight: z.ZodOptional<z.ZodEnum<["none", "a", "b"]>>;
        caption: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodBoolean>;
        maxWidth: z.ZodOptional<z.ZodNumber>;
        crf: z.ZodOptional<z.ZodNumber>;
        outPath: z.ZodString;
        sessionId: z.ZodOptional<z.ZodString>;
        async: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        appA: string;
        appB: string;
        outPath: string;
        fps?: number | undefined;
        sessionId?: string | undefined;
        caption?: string | undefined;
        titleA?: string | undefined;
        labelA?: string | undefined;
        titleB?: string | undefined;
        labelB?: string | undefined;
        durationSeconds?: number | undefined;
        spotlight?: "none" | "a" | "b" | undefined;
        cursor?: boolean | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        async?: boolean | undefined;
    }, {
        appA: string;
        appB: string;
        outPath: string;
        fps?: number | undefined;
        sessionId?: string | undefined;
        caption?: string | undefined;
        titleA?: string | undefined;
        labelA?: string | undefined;
        titleB?: string | undefined;
        labelB?: string | undefined;
        durationSeconds?: number | undefined;
        spotlight?: "none" | "a" | "b" | undefined;
        cursor?: boolean | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        async?: boolean | undefined;
    }>;
    getRecording: z.ZodObject<{
        recordingId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        recordingId: string;
    }, {
        recordingId: string;
    }>;
    analyze: z.ZodObject<{
        sessionId: z.ZodString;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            devicePixelRatio: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        }, {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        viewport?: {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        } | undefined;
    }, {
        sessionId: string;
        viewport?: {
            width: number;
            height: number;
            devicePixelRatio?: number | undefined;
        } | undefined;
    }>;
    discover: z.ZodObject<{
        sessionId: z.ZodString;
        maxDepth: z.ZodOptional<z.ZodNumber>;
        maxScreens: z.ZodOptional<z.ZodNumber>;
        captureStates: z.ZodOptional<z.ZodBoolean>;
        clean: z.ZodOptional<z.ZodBoolean>;
        outputDir: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        maxDepth?: number | undefined;
        maxScreens?: number | undefined;
        clean?: boolean | undefined;
        captureStates?: boolean | undefined;
        outputDir?: string | undefined;
    }, {
        sessionId: string;
        maxDepth?: number | undefined;
        maxScreens?: number | undefined;
        clean?: boolean | undefined;
        captureStates?: boolean | undefined;
        outputDir?: string | undefined;
    }>;
    recordTerminal: z.ZodObject<{
        command: z.ZodString;
        timeout: z.ZodOptional<z.ZodNumber>;
        watch_files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        outputDir: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        command: string;
        outputDir?: string | undefined;
        timeout?: number | undefined;
        watch_files?: string[] | undefined;
    }, {
        command: string;
        outputDir?: string | undefined;
        timeout?: number | undefined;
        watch_files?: string[] | undefined;
    }>;
    replayTerminal: z.ZodObject<{
        file: z.ZodString;
        search: z.ZodOptional<z.ZodString>;
        commands_only: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        file: string;
        search?: string | undefined;
        commands_only?: boolean | undefined;
    }, {
        file: string;
        search?: string | undefined;
        commands_only?: boolean | undefined;
    }>;
    library: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
        action: z.ZodLiteral<"add">;
        sourcePath: z.ZodString;
        type: z.ZodOptional<z.ZodEnum<["screenshot", "video", "walkthrough"]>>;
        platform: z.ZodOptional<z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>>;
        url: z.ZodOptional<z.ZodString>;
        viewport: z.ZodOptional<z.ZodString>;
        selector: z.ZodOptional<z.ZodString>;
        deviceName: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        feature: z.ZodOptional<z.ZodString>;
        component: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        starred: z.ZodOptional<z.ZodBoolean>;
        walkthrough: z.ZodOptional<z.ZodObject<{
            step_count: z.ZodNumber;
            steps: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            steps: string[];
            step_count: number;
        }, {
            steps: string[];
            step_count: number;
        }>>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        gitBranch: z.ZodOptional<z.ZodString>;
        gitCommit: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "add";
        sourcePath: string;
        type?: "screenshot" | "video" | "walkthrough" | undefined;
        durationMs?: number | undefined;
        url?: string | undefined;
        platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
        viewport?: string | undefined;
        walkthrough?: {
            steps: string[];
            step_count: number;
        } | undefined;
        feature?: string | undefined;
        component?: string | undefined;
        title?: string | undefined;
        selector?: string | undefined;
        deviceName?: string | undefined;
        tags?: string[] | undefined;
        starred?: boolean | undefined;
        gitBranch?: string | undefined;
        gitCommit?: string | undefined;
    }, {
        action: "add";
        sourcePath: string;
        type?: "screenshot" | "video" | "walkthrough" | undefined;
        durationMs?: number | undefined;
        url?: string | undefined;
        platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
        viewport?: string | undefined;
        walkthrough?: {
            steps: string[];
            step_count: number;
        } | undefined;
        feature?: string | undefined;
        component?: string | undefined;
        title?: string | undefined;
        selector?: string | undefined;
        deviceName?: string | undefined;
        tags?: string[] | undefined;
        starred?: boolean | undefined;
        gitBranch?: string | undefined;
        gitCommit?: string | undefined;
    }>, z.ZodObject<{
        tagsAny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tagsAll: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        feature: z.ZodOptional<z.ZodString>;
        component: z.ZodOptional<z.ZodString>;
        platform: z.ZodOptional<z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>>;
        type: z.ZodOptional<z.ZodEnum<["screenshot", "video", "walkthrough"]>>;
        since: z.ZodOptional<z.ZodString>;
        until: z.ZodOptional<z.ZodString>;
        starred: z.ZodOptional<z.ZodBoolean>;
        text: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        action: z.ZodLiteral<"find">;
    }, "strip", z.ZodTypeAny, {
        action: "find";
        type?: "screenshot" | "video" | "walkthrough" | undefined;
        text?: string | undefined;
        platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
        feature?: string | undefined;
        component?: string | undefined;
        starred?: boolean | undefined;
        tagsAny?: string[] | undefined;
        tagsAll?: string[] | undefined;
        since?: string | undefined;
        until?: string | undefined;
        limit?: number | undefined;
    }, {
        action: "find";
        type?: "screenshot" | "video" | "walkthrough" | undefined;
        text?: string | undefined;
        platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
        feature?: string | undefined;
        component?: string | undefined;
        starred?: boolean | undefined;
        tagsAny?: string[] | undefined;
        tagsAll?: string[] | undefined;
        since?: string | undefined;
        until?: string | undefined;
        limit?: number | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"gallery">;
        groupBy: z.ZodOptional<z.ZodEnum<["feature", "date", "component", "platform", "type"]>>;
    }, "strip", z.ZodTypeAny, {
        action: "gallery";
        groupBy?: "type" | "platform" | "feature" | "date" | "component" | undefined;
    }, {
        action: "gallery";
        groupBy?: "type" | "platform" | "feature" | "date" | "component" | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"get">;
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        action: "get";
    }, {
        id: string;
        action: "get";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"tag">;
        id: z.ZodString;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        feature: z.ZodOptional<z.ZodString>;
        component: z.ZodOptional<z.ZodString>;
        starred: z.ZodOptional<z.ZodBoolean>;
        title: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        action: "tag";
        feature?: string | undefined;
        component?: string | undefined;
        title?: string | undefined;
        tags?: string[] | undefined;
        starred?: boolean | undefined;
    }, {
        id: string;
        action: "tag";
        feature?: string | undefined;
        component?: string | undefined;
        title?: string | undefined;
        tags?: string[] | undefined;
        starred?: boolean | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"delete">;
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        action: "delete";
    }, {
        id: string;
        action: "delete";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"status">;
    }, "strip", z.ZodTypeAny, {
        action: "status";
    }, {
        action: "status";
    }>, z.ZodObject<{
        tagsAny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tagsAll: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        feature: z.ZodOptional<z.ZodString>;
        component: z.ZodOptional<z.ZodString>;
        platform: z.ZodOptional<z.ZodEnum<["web", "macos", "ios", "watchos", "terminal", "unknown"]>>;
        type: z.ZodOptional<z.ZodEnum<["screenshot", "video", "walkthrough"]>>;
        since: z.ZodOptional<z.ZodString>;
        until: z.ZodOptional<z.ZodString>;
        starred: z.ZodOptional<z.ZodBoolean>;
        text: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        action: z.ZodLiteral<"export">;
        outDir: z.ZodString;
        flatten: z.ZodOptional<z.ZodBoolean>;
        manifest: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        action: "export";
        outDir: string;
        type?: "screenshot" | "video" | "walkthrough" | undefined;
        text?: string | undefined;
        flatten?: boolean | undefined;
        platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
        manifest?: boolean | undefined;
        feature?: string | undefined;
        component?: string | undefined;
        starred?: boolean | undefined;
        tagsAny?: string[] | undefined;
        tagsAll?: string[] | undefined;
        since?: string | undefined;
        until?: string | undefined;
        limit?: number | undefined;
    }, {
        action: "export";
        outDir: string;
        type?: "screenshot" | "video" | "walkthrough" | undefined;
        text?: string | undefined;
        flatten?: boolean | undefined;
        platform?: "web" | "macos" | "ios" | "watchos" | "terminal" | "unknown" | undefined;
        manifest?: boolean | undefined;
        feature?: string | undefined;
        component?: string | undefined;
        starred?: boolean | undefined;
        tagsAny?: string[] | undefined;
        tagsAll?: string[] | undefined;
        since?: string | undefined;
        until?: string | undefined;
        limit?: number | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"migrate-from-showcase">;
        showcasePath: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "migrate-from-showcase";
        showcasePath?: string | undefined;
    }, {
        action: "migrate-from-showcase";
        showcasePath?: string | undefined;
    }>]>;
    demo: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
        action: z.ZodLiteral<"scan">;
        input: z.ZodString;
        threshold: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        action: "scan";
        input: string;
        threshold?: number | undefined;
    }, {
        action: "scan";
        input: string;
        threshold?: number | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"polish">;
        spec: z.ZodObject<{
            canvas: z.ZodObject<{
                w: z.ZodNumber;
                h: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                w: number;
                h: number;
            }, {
                w: number;
                h: number;
            }>;
            fps: z.ZodOptional<z.ZodNumber>;
            segments: z.ZodArray<z.ZodObject<{
                input: z.ZodString;
                startSec: z.ZodNumber;
                durationSec: z.ZodNumber;
                focal: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    w: z.ZodNumber;
                    h: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                }, {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                }>;
                caption: z.ZodOptional<z.ZodString>;
                captionPngPath: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                input: string;
                startSec: number;
                durationSec: number;
                focal: {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                };
                caption?: string | undefined;
                captionPngPath?: string | undefined;
            }, {
                input: string;
                startSec: number;
                durationSec: number;
                focal: {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                };
                caption?: string | undefined;
                captionPngPath?: string | undefined;
            }>, "many">;
            speed: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            canvas: {
                w: number;
                h: number;
            };
            segments: {
                input: string;
                startSec: number;
                durationSec: number;
                focal: {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                };
                caption?: string | undefined;
                captionPngPath?: string | undefined;
            }[];
            fps?: number | undefined;
            speed?: number | undefined;
        }, {
            canvas: {
                w: number;
                h: number;
            };
            segments: {
                input: string;
                startSec: number;
                durationSec: number;
                focal: {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                };
                caption?: string | undefined;
                captionPngPath?: string | undefined;
            }[];
            fps?: number | undefined;
            speed?: number | undefined;
        }>;
        out: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        action: "polish";
        out: string;
        spec: {
            canvas: {
                w: number;
                h: number;
            };
            segments: {
                input: string;
                startSec: number;
                durationSec: number;
                focal: {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                };
                caption?: string | undefined;
                captionPngPath?: string | undefined;
            }[];
            fps?: number | undefined;
            speed?: number | undefined;
        };
    }, {
        action: "polish";
        out: string;
        spec: {
            canvas: {
                w: number;
                h: number;
            };
            segments: {
                input: string;
                startSec: number;
                durationSec: number;
                focal: {
                    x: number;
                    y: number;
                    w: number;
                    h: number;
                };
                caption?: string | undefined;
                captionPngPath?: string | undefined;
            }[];
            fps?: number | undefined;
            speed?: number | undefined;
        };
    }>, z.ZodObject<{
        input: z.ZodString;
        out: z.ZodString;
        deadSpeed: z.ZodOptional<z.ZodNumber>;
        minDeadSec: z.ZodOptional<z.ZodNumber>;
        padSec: z.ZodOptional<z.ZodNumber>;
        threshold: z.ZodOptional<z.ZodNumber>;
        maxWidth: z.ZodOptional<z.ZodNumber>;
        crf: z.ZodOptional<z.ZodNumber>;
        fps: z.ZodOptional<z.ZodNumber>;
        action: z.ZodLiteral<"auto-ramp">;
    }, "strip", z.ZodTypeAny, {
        action: "auto-ramp";
        input: string;
        out: string;
        fps?: number | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        deadSpeed?: number | undefined;
        minDeadSec?: number | undefined;
        padSec?: number | undefined;
        threshold?: number | undefined;
    }, {
        action: "auto-ramp";
        input: string;
        out: string;
        fps?: number | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        deadSpeed?: number | undefined;
        minDeadSec?: number | undefined;
        padSec?: number | undefined;
        threshold?: number | undefined;
    }>, z.ZodObject<{
        appA: z.ZodString;
        titleA: z.ZodOptional<z.ZodString>;
        labelA: z.ZodOptional<z.ZodString>;
        appB: z.ZodString;
        titleB: z.ZodOptional<z.ZodString>;
        labelB: z.ZodOptional<z.ZodString>;
        durationSeconds: z.ZodOptional<z.ZodNumber>;
        fps: z.ZodOptional<z.ZodNumber>;
        spotlight: z.ZodOptional<z.ZodEnum<["none", "a", "b"]>>;
        caption: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodBoolean>;
        maxWidth: z.ZodOptional<z.ZodNumber>;
        crf: z.ZodOptional<z.ZodNumber>;
        outPath: z.ZodString;
        sessionId: z.ZodOptional<z.ZodString>;
        async: z.ZodOptional<z.ZodBoolean>;
        action: z.ZodLiteral<"record-composite">;
    }, "strip", z.ZodTypeAny, {
        action: "record-composite";
        appA: string;
        appB: string;
        outPath: string;
        fps?: number | undefined;
        sessionId?: string | undefined;
        caption?: string | undefined;
        titleA?: string | undefined;
        labelA?: string | undefined;
        titleB?: string | undefined;
        labelB?: string | undefined;
        durationSeconds?: number | undefined;
        spotlight?: "none" | "a" | "b" | undefined;
        cursor?: boolean | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        async?: boolean | undefined;
    }, {
        action: "record-composite";
        appA: string;
        appB: string;
        outPath: string;
        fps?: number | undefined;
        sessionId?: string | undefined;
        caption?: string | undefined;
        titleA?: string | undefined;
        labelA?: string | undefined;
        titleB?: string | undefined;
        labelB?: string | undefined;
        durationSeconds?: number | undefined;
        spotlight?: "none" | "a" | "b" | undefined;
        cursor?: boolean | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        async?: boolean | undefined;
    }>]>;
    autoRampDemo: z.ZodObject<{
        input: z.ZodString;
        out: z.ZodString;
        deadSpeed: z.ZodOptional<z.ZodNumber>;
        minDeadSec: z.ZodOptional<z.ZodNumber>;
        padSec: z.ZodOptional<z.ZodNumber>;
        threshold: z.ZodOptional<z.ZodNumber>;
        maxWidth: z.ZodOptional<z.ZodNumber>;
        crf: z.ZodOptional<z.ZodNumber>;
        fps: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        input: string;
        out: string;
        fps?: number | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        deadSpeed?: number | undefined;
        minDeadSec?: number | undefined;
        padSec?: number | undefined;
        threshold?: number | undefined;
    }, {
        input: string;
        out: string;
        fps?: number | undefined;
        maxWidth?: number | undefined;
        crf?: number | undefined;
        deadSpeed?: number | undefined;
        minDeadSec?: number | undefined;
        padSec?: number | undefined;
        threshold?: number | undefined;
    }>;
};
export declare const apiOperations: CoreApiOperation[];
export declare const clientSurfaces: readonly ["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"];
export declare const capabilities: readonly ["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"];
export declare const apiErrorCodes: readonly ["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "unsupported_api_version", "permission_denied", "capability_denied", "capture_failed", "recording_failed", "daemon_unhealthy", "internal_error"];
export declare const daemonEventTypes: readonly ["daemon.ready", "daemon.health", "permission.changed", "windows.changed", "session.created", "session.closed", "snapshot.observed", "decision.recorded", "action.completed", "artifact.added", "recording.status", "library.changed", "error"];
export declare const callerHintSchema: z.ZodObject<{
    surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
    name: z.ZodOptional<z.ZodString>;
    pid: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
    pid?: number | undefined;
    name?: string | undefined;
}, {
    surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
    pid?: number | undefined;
    name?: string | undefined;
}>;
export declare const apiErrorBodySchema: z.ZodObject<{
    code: z.ZodEnum<["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "unsupported_api_version", "permission_denied", "capability_denied", "capture_failed", "recording_failed", "daemon_unhealthy", "internal_error"]>;
    message: z.ZodString;
    hint: z.ZodOptional<z.ZodString>;
    details: z.ZodOptional<z.ZodType<unknown, z.ZodTypeDef, unknown>>;
    retryable: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    message: string;
    code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
    hint?: string | undefined;
    details?: unknown;
    retryable?: boolean | undefined;
}, {
    message: string;
    code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
    hint?: string | undefined;
    details?: unknown;
    retryable?: boolean | undefined;
}>;
export declare const verifiedCallerSchema: z.ZodObject<{
    surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
    verifiedBy: z.ZodEnum<["unix-peer", "bearer-token"]>;
    capabilities: z.ZodArray<z.ZodEnum<["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"]>, "many">;
    uid: z.ZodOptional<z.ZodNumber>;
    gid: z.ZodOptional<z.ZodNumber>;
    pid: z.ZodOptional<z.ZodNumber>;
    tokenId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
    verifiedBy: "unix-peer" | "bearer-token";
    capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
    pid?: number | undefined;
    uid?: number | undefined;
    gid?: number | undefined;
    tokenId?: string | undefined;
}, {
    surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
    verifiedBy: "unix-peer" | "bearer-token";
    capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
    pid?: number | undefined;
    uid?: number | undefined;
    gid?: number | undefined;
    tokenId?: string | undefined;
}>;
export declare const apiRequestEnvelopeSchema: z.ZodObject<{
    apiVersion: z.ZodLiteral<2>;
    requestId: z.ZodString;
    operation: z.ZodEnum<[CoreApiOperation, ...CoreApiOperation[]]>;
    caller: z.ZodOptional<z.ZodObject<{
        surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
        name: z.ZodOptional<z.ZodString>;
        pid: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        pid?: number | undefined;
        name?: string | undefined;
    }, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        pid?: number | undefined;
        name?: string | undefined;
    }>>;
    params: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    apiVersion: 2;
    requestId: string;
    operation: CoreApiOperation;
    params?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        pid?: number | undefined;
        name?: string | undefined;
    } | undefined;
}, {
    apiVersion: 2;
    requestId: string;
    operation: CoreApiOperation;
    params?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        pid?: number | undefined;
        name?: string | undefined;
    } | undefined;
}>;
export declare const apiSuccessEnvelopeSchema: z.ZodObject<{
    apiVersion: z.ZodLiteral<2>;
    requestId: z.ZodString;
    ok: z.ZodLiteral<true>;
    result: z.ZodUnknown;
    timestamp: z.ZodNumber;
    caller: z.ZodOptional<z.ZodObject<{
        surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
        verifiedBy: z.ZodEnum<["unix-peer", "bearer-token"]>;
        capabilities: z.ZodArray<z.ZodEnum<["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"]>, "many">;
        uid: z.ZodOptional<z.ZodNumber>;
        gid: z.ZodOptional<z.ZodNumber>;
        pid: z.ZodOptional<z.ZodNumber>;
        tokenId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }>>;
    deliveryPath: z.ZodOptional<z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>>;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    ok: true;
    apiVersion: 2;
    requestId: string;
    result?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}, {
    timestamp: number;
    ok: true;
    apiVersion: 2;
    requestId: string;
    result?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}>;
export declare const apiErrorEnvelopeSchema: z.ZodObject<{
    apiVersion: z.ZodLiteral<2>;
    requestId: z.ZodOptional<z.ZodString>;
    ok: z.ZodLiteral<false>;
    error: z.ZodObject<{
        code: z.ZodEnum<["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "unsupported_api_version", "permission_denied", "capability_denied", "capture_failed", "recording_failed", "daemon_unhealthy", "internal_error"]>;
        message: z.ZodString;
        hint: z.ZodOptional<z.ZodString>;
        details: z.ZodOptional<z.ZodType<unknown, z.ZodTypeDef, unknown>>;
        retryable: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    }, {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    }>;
    timestamp: z.ZodNumber;
    caller: z.ZodOptional<z.ZodObject<{
        surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
        verifiedBy: z.ZodEnum<["unix-peer", "bearer-token"]>;
        capabilities: z.ZodArray<z.ZodEnum<["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"]>, "many">;
        uid: z.ZodOptional<z.ZodNumber>;
        gid: z.ZodOptional<z.ZodNumber>;
        pid: z.ZodOptional<z.ZodNumber>;
        tokenId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }>>;
    deliveryPath: z.ZodOptional<z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>>;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    error: {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    };
    ok: false;
    apiVersion: 2;
    requestId?: string | undefined;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}, {
    timestamp: number;
    error: {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    };
    ok: false;
    apiVersion: 2;
    requestId?: string | undefined;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}>;
export declare const apiResponseEnvelopeSchema: z.ZodDiscriminatedUnion<"ok", [z.ZodObject<{
    apiVersion: z.ZodLiteral<2>;
    requestId: z.ZodString;
    ok: z.ZodLiteral<true>;
    result: z.ZodUnknown;
    timestamp: z.ZodNumber;
    caller: z.ZodOptional<z.ZodObject<{
        surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
        verifiedBy: z.ZodEnum<["unix-peer", "bearer-token"]>;
        capabilities: z.ZodArray<z.ZodEnum<["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"]>, "many">;
        uid: z.ZodOptional<z.ZodNumber>;
        gid: z.ZodOptional<z.ZodNumber>;
        pid: z.ZodOptional<z.ZodNumber>;
        tokenId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }>>;
    deliveryPath: z.ZodOptional<z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>>;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    ok: true;
    apiVersion: 2;
    requestId: string;
    result?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}, {
    timestamp: number;
    ok: true;
    apiVersion: 2;
    requestId: string;
    result?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}>, z.ZodObject<{
    apiVersion: z.ZodLiteral<2>;
    requestId: z.ZodOptional<z.ZodString>;
    ok: z.ZodLiteral<false>;
    error: z.ZodObject<{
        code: z.ZodEnum<["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "unsupported_api_version", "permission_denied", "capability_denied", "capture_failed", "recording_failed", "daemon_unhealthy", "internal_error"]>;
        message: z.ZodString;
        hint: z.ZodOptional<z.ZodString>;
        details: z.ZodOptional<z.ZodType<unknown, z.ZodTypeDef, unknown>>;
        retryable: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    }, {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    }>;
    timestamp: z.ZodNumber;
    caller: z.ZodOptional<z.ZodObject<{
        surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
        verifiedBy: z.ZodEnum<["unix-peer", "bearer-token"]>;
        capabilities: z.ZodArray<z.ZodEnum<["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"]>, "many">;
        uid: z.ZodOptional<z.ZodNumber>;
        gid: z.ZodOptional<z.ZodNumber>;
        pid: z.ZodOptional<z.ZodNumber>;
        tokenId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }>>;
    deliveryPath: z.ZodOptional<z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>>;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    error: {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    };
    ok: false;
    apiVersion: 2;
    requestId?: string | undefined;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}, {
    timestamp: number;
    error: {
        message: string;
        code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unsupported_api_version" | "permission_denied" | "capability_denied" | "capture_failed" | "recording_failed" | "daemon_unhealthy" | "internal_error";
        hint?: string | undefined;
        details?: unknown;
        retryable?: boolean | undefined;
    };
    ok: false;
    apiVersion: 2;
    requestId?: string | undefined;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}>]>;
export declare const daemonEventEnvelopeSchema: z.ZodObject<{
    apiVersion: z.ZodLiteral<2>;
    eventId: z.ZodString;
    type: z.ZodEnum<["daemon.ready", "daemon.health", "permission.changed", "windows.changed", "session.created", "session.closed", "snapshot.observed", "decision.recorded", "action.completed", "artifact.added", "recording.status", "library.changed", "error"]>;
    emittedAt: z.ZodNumber;
    sessionId: z.ZodOptional<z.ZodString>;
    caller: z.ZodOptional<z.ZodObject<{
        surface: z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>;
        verifiedBy: z.ZodEnum<["unix-peer", "bearer-token"]>;
        capabilities: z.ZodArray<z.ZodEnum<["daemon:read", "permissions:read", "permissions:request", "windows:read", "sessions:read", "sessions:write", "ui:read", "ui:act", "analysis:read", "discover:write", "media:capture", "media:record", "terminal:read", "terminal:record", "library:read", "library:write", "demo:write"]>, "many">;
        uid: z.ZodOptional<z.ZodNumber>;
        gid: z.ZodOptional<z.ZodNumber>;
        pid: z.ZodOptional<z.ZodNumber>;
        tokenId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }, {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    }>>;
    deliveryPath: z.ZodOptional<z.ZodEnum<["stdio-mcp", "cli", "menubar", "slash-command", "http-mcp", "test", "unknown"]>>;
    data: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "error" | "session.created" | "decision.recorded" | "artifact.added" | "recording.status" | "session.closed" | "action.completed" | "daemon.ready" | "daemon.health" | "permission.changed" | "windows.changed" | "snapshot.observed" | "library.changed";
    apiVersion: 2;
    eventId: string;
    emittedAt: number;
    sessionId?: string | undefined;
    data?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}, {
    type: "error" | "session.created" | "decision.recorded" | "artifact.added" | "recording.status" | "session.closed" | "action.completed" | "daemon.ready" | "daemon.health" | "permission.changed" | "windows.changed" | "snapshot.observed" | "library.changed";
    apiVersion: 2;
    eventId: string;
    emittedAt: number;
    sessionId?: string | undefined;
    data?: unknown;
    caller?: {
        surface: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test";
        verifiedBy: "unix-peer" | "bearer-token";
        capabilities: ("daemon:read" | "permissions:read" | "permissions:request" | "windows:read" | "sessions:read" | "sessions:write" | "ui:read" | "ui:act" | "analysis:read" | "discover:write" | "media:capture" | "media:record" | "terminal:read" | "terminal:record" | "library:read" | "library:write" | "demo:write")[];
        pid?: number | undefined;
        uid?: number | undefined;
        gid?: number | undefined;
        tokenId?: string | undefined;
    } | undefined;
    deliveryPath?: "unknown" | "stdio-mcp" | "cli" | "menubar" | "slash-command" | "http-mcp" | "test" | undefined;
}>;
export interface ContractSurface {
    apiVersion: number;
    operations: string[];
    capabilities: string[];
    errorCodes: string[];
    clientSurfaces: string[];
    eventTypes: string[];
    operationParams: Record<string, string[]>;
    routes: {
        socketPath: string;
        socketMode: string;
        events: string;
        mcp: string;
    };
    envelopes: {
        request: string[];
        success: string[];
        error: string[];
        event: string[];
    };
}
export declare function contractSurface(): ContractSurface;
//# sourceMappingURL=schemas.d.ts.map