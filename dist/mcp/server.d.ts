import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DaemonClient } from '../client/daemon-client.js';
/**
 * Flat ZodRawShape for the `spectra_demo` tool input — exported (rather than
 * inlined into the `server.tool(...)` call) so tests can validate the EXACT
 * shape the MCP SDK enforces at the public boundary, instead of only
 * exercising the daemon-side handleDemo handler (which a prior pass did,
 * masking the fact that the SDK rejected polish-clip/polish-script before
 * forward() ever ran). Keep this a flat object of zod fields (not a
 * discriminatedUnion) — that's what server.tool()'s SDK signature requires.
 */
export declare const spectraDemoInputShape: {
    action: z.ZodEnum<["scan", "polish", "auto-ramp", "record-composite", "polish-clip", "polish-script"]>;
    input: z.ZodOptional<z.ZodString>;
    threshold: z.ZodOptional<z.ZodNumber>;
    deadSpeed: z.ZodOptional<z.ZodNumber>;
    minDeadSec: z.ZodOptional<z.ZodNumber>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    crf: z.ZodOptional<z.ZodNumber>;
    fps: z.ZodOptional<z.ZodNumber>;
    spec: z.ZodOptional<z.ZodObject<{
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
    }>>;
    out: z.ZodOptional<z.ZodString>;
    appA: z.ZodOptional<z.ZodString>;
    titleA: z.ZodOptional<z.ZodString>;
    labelA: z.ZodOptional<z.ZodString>;
    appB: z.ZodOptional<z.ZodString>;
    titleB: z.ZodOptional<z.ZodString>;
    labelB: z.ZodOptional<z.ZodString>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    caption: z.ZodOptional<z.ZodString>;
    spotlight: z.ZodOptional<z.ZodUnion<[z.ZodEnum<["none", "a", "b"]>, z.ZodObject<{
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
    }>]>>;
    cursor: z.ZodOptional<z.ZodBoolean>;
    outPath: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    async: z.ZodOptional<z.ZodBoolean>;
    clicksJson: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodObject<{
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
    }>]>>;
    script: z.ZodOptional<z.ZodObject<{
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
    }>>;
};
/**
 * Build a coreless Spectra MCP server bound to the given daemon client. The
 * client is injectable so tests can point it at a mock daemon.
 */
export declare function createSpectraServer(client: DaemonClient): McpServer;
/** Default stdio entry — the path Claude Code spawns (coreless daemon proxy). */
export declare function startStdio(): Promise<void>;
//# sourceMappingURL=server.d.ts.map