export interface RawImage {
    width: number;
    height: number;
    data: Uint8Array;
}
export declare function decodePng(buffer: Buffer): RawImage;
export declare function encodePng(image: RawImage): Buffer;
export declare function cropImage(image: RawImage, x: number, y: number, w: number, h: number): RawImage;
export declare function resizeNearest(image: RawImage, targetW: number, targetH: number): RawImage;
export declare function toGrayscale(image: RawImage): Uint8Array;
//# sourceMappingURL=png.d.ts.map