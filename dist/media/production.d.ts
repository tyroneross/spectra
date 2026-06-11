import type { CapturePreset } from '../core/types.js';
export type ProductionSourceType = 'screenshot' | 'video';
export type ProductionAssetKind = 'master' | 'thumbnail' | 'poster';
export type ProductionQualityLevel = 'pass' | 'warn' | 'fail';
export type ProductionQualityStatus = 'production-ready' | 'review-needed' | 'draft';
export interface ProductionBundleSource {
    id: string;
    path: string;
    inputPath?: string;
    type: ProductionSourceType;
    filename?: string;
    caption?: string;
    preset?: CapturePreset;
    projectName?: string;
    sessionName?: string;
    capturedAt?: string;
    metadata?: Record<string, unknown>;
}
export interface ProductionBundleOptions {
    outDir: string;
    title?: string;
    preset?: CapturePreset;
    createdAt?: string;
    thumbnailMaxWidth?: number;
    posterAtSeconds?: number;
    posterMaxWidth?: number;
}
export interface ProductionAsset {
    id: string;
    sourceId: string;
    kind: ProductionAssetKind;
    path: string;
    format: string;
    sizeBytes: number;
    width?: number;
    height?: number;
}
export interface ProductionQualityCheck {
    sourceId: string;
    level: ProductionQualityLevel;
    code: string;
    message: string;
}
export interface ProductionQualityReport {
    status: ProductionQualityStatus;
    score: number;
    checks: ProductionQualityCheck[];
}
export interface ProductionBundleManifest {
    schemaVersion: 1;
    title: string;
    createdAt: string;
    preset?: CapturePreset;
    sources: ProductionBundleSource[];
    assets: ProductionAsset[];
    quality: ProductionQualityReport;
}
export interface ProductionBundleResult {
    outDir: string;
    manifestPath: string;
    readmePath: string;
    qualityReportPath: string;
    manifest: ProductionBundleManifest;
}
export declare function createProductionBundle(sources: ProductionBundleSource[], options: ProductionBundleOptions): Promise<ProductionBundleResult>;
//# sourceMappingURL=production.d.ts.map