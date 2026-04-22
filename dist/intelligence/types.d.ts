import type { Platform, ActionType } from '../core/types.js';
export type { Platform, ActionType };
export interface Viewport {
    width: number;
    height: number;
    devicePixelRatio: number;
}
export type UIState = 'loading' | 'empty' | 'error' | 'populated' | 'focused' | 'unknown';
export interface ImportanceScore {
    elementId: string;
    score: number;
    factors: ScoreFactor[];
}
export interface ScoreFactor {
    name: string;
    weight: number;
    value: number;
    reason: string;
}
export interface RegionOfInterest {
    bounds: [number, number, number, number];
    score: number;
    elements: string[];
    label: string;
}
export interface ChangeResult {
    changed: boolean;
    score: number;
    type: 'none' | 'minor' | 'significant' | 'navigation';
    details: ChangeDetail[];
}
export interface ChangeDetail {
    kind: 'added' | 'removed' | 'moved' | 'changed' | 'content';
    elementId?: string;
    description: string;
}
export interface StateDetection {
    state: UIState;
    confidence: number;
    indicators: string[];
}
export interface NavigationGraph {
    nodes: Map<string, ScreenNode>;
    edges: NavigationEdge[];
    root: string;
}
export interface ScreenNode {
    id: string;
    url?: string;
    appName?: string;
    screenshot: Buffer;
    importance: number;
    visited: boolean;
    sensitiveContent?: boolean;
}
export interface NavigationEdge {
    from: string;
    to: string;
    action: {
        elementId: string;
        type: ActionType;
        label: string;
    };
}
export interface CrawlOptions {
    maxDepth: number;
    maxScreens: number;
    scrollDiscover: boolean;
    captureEach: boolean;
    changeThreshold: number;
    allowExternal: boolean;
    allowFormSubmit: boolean;
}
export interface FrameOptions {
    target?: 'element' | 'region' | 'viewport' | 'fullpage';
    elementId?: string;
    regionIndex?: number;
    aspectRatio?: number;
    padding?: number;
    minSize?: [number, number];
}
export interface FrameResult {
    crop: [number, number, number, number];
    buffer: Buffer;
    label: string;
}
export interface CaptureIntent {
    mode: 'auto' | 'targeted' | 'walkthrough' | 'states';
    target?: string;
    includeStates?: UIState[];
    maxCaptures?: number;
    outputFormat?: 'png' | 'jpeg';
    quality?: number;
}
export interface CaptureManifest {
    sessionId: string;
    captures: CaptureEntry[];
    navigation?: NavigationGraph;
    duration: number;
}
export interface CaptureEntry {
    path: string;
    state: UIState;
    importance: number;
    region?: string;
    framed: boolean;
    timestamp: number;
    sensitiveContent?: boolean;
}
//# sourceMappingURL=types.d.ts.map