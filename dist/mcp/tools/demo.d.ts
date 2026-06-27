import { z } from 'zod';
import type { ToolContext } from '../context.js';
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
    action: z.ZodLiteral<"auto-ramp">;
    input: z.ZodString;
    out: z.ZodString;
    deadSpeed: z.ZodOptional<z.ZodNumber>;
    minDeadSec: z.ZodOptional<z.ZodNumber>;
    threshold: z.ZodOptional<z.ZodNumber>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    crf: z.ZodOptional<z.ZodNumber>;
    fps: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    action: "auto-ramp";
    input: string;
    out: string;
    fps?: number | undefined;
    maxWidth?: number | undefined;
    crf?: number | undefined;
    deadSpeed?: number | undefined;
    minDeadSec?: number | undefined;
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
    threshold?: number | undefined;
}>]>;
export declare function handleDemo(params: unknown, _ctx?: ToolContext): Promise<object>;
//# sourceMappingURL=demo.d.ts.map