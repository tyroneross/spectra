import { z } from 'zod';
export declare const DemoSchema: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
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
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            startSec: number;
            durationSec: number;
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }, {
            input: string;
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            startSec: number;
            durationSec: number;
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
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            startSec: number;
            durationSec: number;
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
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            startSec: number;
            durationSec: number;
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
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            startSec: number;
            durationSec: number;
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
            focal: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            startSec: number;
            durationSec: number;
            caption?: string | undefined;
            captionPngPath?: string | undefined;
        }[];
        fps?: number | undefined;
        speed?: number | undefined;
    };
}>]>;
export declare function handleDemo(params: unknown): Promise<object>;
//# sourceMappingURL=demo.d.ts.map