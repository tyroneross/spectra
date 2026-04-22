export interface CastHeader {
    version: number;
    width: number;
    height: number;
    timestamp: number;
    env: Record<string, string>;
}
export interface CastEvent {
    time: number;
    type: 'output' | 'input';
    data: string;
}
export interface CastFile {
    header: CastHeader;
    events: CastEvent[];
    duration: number;
}
export declare function parseCast(filePath: string): Promise<CastFile>;
export declare function searchCast(cast: CastFile, pattern: string | RegExp): CastEvent[];
export declare function extractCommands(cast: CastFile): string[];
export declare function formatCastSummary(cast: CastFile): string;
//# sourceMappingURL=parser.d.ts.map