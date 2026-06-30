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
}>, z.ZodObject<{
    action: z.ZodLiteral<"polish-clip">;
    input: z.ZodString;
    clicksJson: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodObject<{
        tMs: z.ZodNumber;
        cx: z.ZodNumber;
        cy: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        cx: number;
        cy: number;
        tMs: number;
    }, {
        cx: number;
        cy: number;
        tMs: number;
    }>, "many">, z.ZodObject<{
        clicks: z.ZodOptional<z.ZodArray<z.ZodObject<{
            tMs: z.ZodNumber;
            cx: z.ZodNumber;
            cy: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            cx: number;
            cy: number;
            tMs: number;
        }, {
            cx: number;
            cy: number;
            tMs: number;
        }>, "many">>;
        cursorPath: z.ZodOptional<z.ZodArray<z.ZodObject<{
            tMs: z.ZodNumber;
            cx: z.ZodNumber;
            cy: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            cx: number;
            cy: number;
            tMs: number;
        }, {
            cx: number;
            cy: number;
            tMs: number;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        clicks?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
        cursorPath?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
    }, {
        clicks?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
        cursorPath?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
    }>]>;
    caption: z.ZodOptional<z.ZodString>;
    out: z.ZodString;
    fps: z.ZodOptional<z.ZodNumber>;
    spotlight: z.ZodOptional<z.ZodObject<{
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
        dim: z.ZodOptional<z.ZodNumber>;
        blur: z.ZodOptional<z.ZodNumber>;
        feather: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        focal: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        dim?: number | undefined;
        blur?: number | undefined;
        feather?: number | undefined;
    }, {
        focal: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        dim?: number | undefined;
        blur?: number | undefined;
        feather?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    action: "polish-clip";
    input: string;
    out: string;
    clicksJson: string | {
        cx: number;
        cy: number;
        tMs: number;
    }[] | {
        clicks?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
        cursorPath?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
    };
    fps?: number | undefined;
    caption?: string | undefined;
    spotlight?: {
        focal: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        dim?: number | undefined;
        blur?: number | undefined;
        feather?: number | undefined;
    } | undefined;
}, {
    action: "polish-clip";
    input: string;
    out: string;
    clicksJson: string | {
        cx: number;
        cy: number;
        tMs: number;
    }[] | {
        clicks?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
        cursorPath?: {
            cx: number;
            cy: number;
            tMs: number;
        }[] | undefined;
    };
    fps?: number | undefined;
    caption?: string | undefined;
    spotlight?: {
        focal: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        dim?: number | undefined;
        blur?: number | undefined;
        feather?: number | undefined;
    } | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"polish-script">;
    input: z.ZodString;
    script: z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        finalCaption: z.ZodOptional<z.ZodString>;
        beats: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            stepLabel: z.ZodOptional<z.ZodString>;
            stepText: z.ZodOptional<z.ZodString>;
            startMs: z.ZodNumber;
            endMs: z.ZodNumber;
            zoom: z.ZodOptional<z.ZodObject<{
                cx: z.ZodNumber;
                cy: z.ZodNumber;
                scale: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                cx: number;
                cy: number;
                scale: number;
            }, {
                cx: number;
                cy: number;
                scale: number;
            }>>;
            action: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["search", "click", "scroll", "navigate", "hold"]>;
                target: z.ZodOptional<z.ZodString>;
                value: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            }, {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            startMs: number;
            endMs: number;
            action?: {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            } | undefined;
            stepLabel?: string | undefined;
            stepText?: string | undefined;
            zoom?: {
                cx: number;
                cy: number;
                scale: number;
            } | undefined;
        }, {
            id: string;
            startMs: number;
            endMs: number;
            action?: {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            } | undefined;
            stepLabel?: string | undefined;
            stepText?: string | undefined;
            zoom?: {
                cx: number;
                cy: number;
                scale: number;
            } | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        beats: {
            id: string;
            startMs: number;
            endMs: number;
            action?: {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            } | undefined;
            stepLabel?: string | undefined;
            stepText?: string | undefined;
            zoom?: {
                cx: number;
                cy: number;
                scale: number;
            } | undefined;
        }[];
        title?: string | undefined;
        finalCaption?: string | undefined;
    }, {
        beats: {
            id: string;
            startMs: number;
            endMs: number;
            action?: {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            } | undefined;
            stepLabel?: string | undefined;
            stepText?: string | undefined;
            zoom?: {
                cx: number;
                cy: number;
                scale: number;
            } | undefined;
        }[];
        title?: string | undefined;
        finalCaption?: string | undefined;
    }>;
    out: z.ZodString;
    fps: z.ZodOptional<z.ZodNumber>;
    voiceover: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "polish-script";
    input: string;
    out: string;
    script: {
        beats: {
            id: string;
            startMs: number;
            endMs: number;
            action?: {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            } | undefined;
            stepLabel?: string | undefined;
            stepText?: string | undefined;
            zoom?: {
                cx: number;
                cy: number;
                scale: number;
            } | undefined;
        }[];
        title?: string | undefined;
        finalCaption?: string | undefined;
    };
    fps?: number | undefined;
    voiceover?: string | undefined;
}, {
    action: "polish-script";
    input: string;
    out: string;
    script: {
        beats: {
            id: string;
            startMs: number;
            endMs: number;
            action?: {
                kind: "click" | "scroll" | "search" | "navigate" | "hold";
                value?: string | undefined;
                target?: string | undefined;
            } | undefined;
            stepLabel?: string | undefined;
            stepText?: string | undefined;
            zoom?: {
                cx: number;
                cy: number;
                scale: number;
            } | undefined;
        }[];
        title?: string | undefined;
        finalCaption?: string | undefined;
    };
    fps?: number | undefined;
    voiceover?: string | undefined;
}>]>;
export declare function handleDemo(params: unknown, _ctx?: ToolContext): Promise<object>;
//# sourceMappingURL=demo.d.ts.map