export type AppleEditorAssetRole = 'web-master' | 'edit-master' | 'audio-stem' | 'captions';
export interface AppleEditorAsset {
    path: string;
    role: AppleEditorAssetRole;
    label?: string;
    /** Include this video in the small, duplicate-free folder intended for iMovie import. */
    imovieImport?: boolean;
}
export interface AppleEditorHandoffOptions {
    outDir: string;
    title: string;
    createdAt?: string;
}
export interface AppleEditorHandoffFile {
    role: AppleEditorAssetRole;
    label: string;
    filename: string;
    path: string;
    sizeBytes: number;
    sha256: string;
    imovieImport: boolean;
}
export interface AppleEditorHandoffManifest {
    schemaVersion: 1;
    title: string;
    createdAt: string;
    files: AppleEditorHandoffFile[];
}
export interface AppleEditorHandoffResult {
    outDir: string;
    manifestPath: string;
    readmePath: string;
    imovieImportDir?: string;
    manifest: AppleEditorHandoffManifest;
}
/**
 * Packages Spectra-rendered assets for optional finishing in iMovie or Final Cut Pro.
 * Spectra remains the renderer of record; this function only creates a local handoff.
 */
export declare function createAppleEditorHandoff(assets: AppleEditorAsset[], options: AppleEditorHandoffOptions): Promise<AppleEditorHandoffResult>;
//# sourceMappingURL=apple-editor-handoff.d.ts.map