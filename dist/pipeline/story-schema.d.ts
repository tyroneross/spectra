import { z } from 'zod';
export declare const localPathSchema: z.ZodEffects<z.ZodString, string, string>;
export declare const polishStyleSchema: z.ZodEnum<["cool", "warm", "bold"]>;
export declare const autoFocusSchema: z.ZodUnion<[z.ZodBoolean, z.ZodObject<{
    app: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    app?: string | undefined;
    title?: string | undefined;
}, {
    app?: string | undefined;
    title?: string | undefined;
}>]>;
export declare const storySpotlightSchema: z.ZodObject<{
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
}>;
export declare const storySchema: z.ZodEffects<z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    title: z.ZodString;
    fps: z.ZodDefault<z.ZodNumber>;
    canvas: z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
    }, {
        width: number;
        height: number;
    }>;
    claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        status: z.ZodEnum<["supported", "qualified", "blocked"]>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence: string[];
    }, {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence?: string[] | undefined;
    }>, "many">>;
    scenes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        keyMessage: z.ZodString;
        durationMs: z.ZodNumber;
        caption: z.ZodOptional<z.ZodString>;
        claimIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        source: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"capture">;
            input: z.ZodEffects<z.ZodString, string, string>;
            startMs: z.ZodDefault<z.ZodNumber>;
            evidence: z.ZodString;
            keepAudio: z.ZodDefault<z.ZodBoolean>;
            polish: z.ZodOptional<z.ZodObject<{
                script: z.ZodObject<{
                    beats: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        startMs: z.ZodNumber;
                        endMs: z.ZodNumber;
                        stepLabel: z.ZodOptional<z.ZodString>;
                        stepText: z.ZodOptional<z.ZodString>;
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
                    }, "strict", z.ZodTypeAny, {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }, {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }>, "many">;
                    finalCaption: z.ZodOptional<z.ZodString>;
                }, "strict", z.ZodTypeAny, {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                }, {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                }>;
                style: z.ZodOptional<z.ZodEnum<["cool", "warm", "bold"]>>;
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
            }, "strict", z.ZodTypeAny, {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            }>>;
        }, "strict", z.ZodTypeAny, {
            input: string;
            evidence: string;
            startMs: number;
            kind: "capture";
            keepAudio: boolean;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        }, {
            input: string;
            evidence: string;
            kind: "capture";
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"media">;
            input: z.ZodEffects<z.ZodString, string, string>;
            startMs: z.ZodDefault<z.ZodNumber>;
            producer: z.ZodString;
            sourcePath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            keepAudio: z.ZodDefault<z.ZodBoolean>;
        }, "strict", z.ZodTypeAny, {
            input: string;
            startMs: number;
            kind: "media";
            keepAudio: boolean;
            producer: string;
            sourcePath?: string | undefined;
        }, {
            input: string;
            kind: "media";
            producer: string;
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            sourcePath?: string | undefined;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"html">;
            entry: z.ZodEffects<z.ZodString, string, string>;
            seed: z.ZodDefault<z.ZodNumber>;
            props: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, "strict", z.ZodTypeAny, {
            entry: string;
            kind: "html";
            seed: number;
            props: Record<string, unknown>;
        }, {
            entry: string;
            kind: "html";
            seed?: number | undefined;
            props?: Record<string, unknown> | undefined;
        }>]>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        durationMs: number;
        source: {
            input: string;
            evidence: string;
            startMs: number;
            kind: "capture";
            keepAudio: boolean;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        } | {
            input: string;
            startMs: number;
            kind: "media";
            keepAudio: boolean;
            producer: string;
            sourcePath?: string | undefined;
        } | {
            entry: string;
            kind: "html";
            seed: number;
            props: Record<string, unknown>;
        };
        keyMessage: string;
        claimIds: string[];
        caption?: string | undefined;
    }, {
        id: string;
        durationMs: number;
        source: {
            input: string;
            evidence: string;
            kind: "capture";
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        } | {
            input: string;
            kind: "media";
            producer: string;
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            sourcePath?: string | undefined;
        } | {
            entry: string;
            kind: "html";
            seed?: number | undefined;
            props?: Record<string, unknown> | undefined;
        };
        keyMessage: string;
        caption?: string | undefined;
        claimIds?: string[] | undefined;
    }>, "many">;
    narration: z.ZodDefault<z.ZodArray<z.ZodObject<{
        sceneId: z.ZodString;
        offsetMs: z.ZodDefault<z.ZodNumber>;
        file: z.ZodEffects<z.ZodString, string, string>;
        text: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        text: string;
        file: string;
        sceneId: string;
        offsetMs: number;
    }, {
        text: string;
        file: string;
        sceneId: string;
        offsetMs?: number | undefined;
    }>, "many">>;
    music: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    sfx: z.ZodDefault<z.ZodArray<z.ZodObject<{
        atMs: z.ZodNumber;
        file: z.ZodEffects<z.ZodString, string, string>;
    }, "strict", z.ZodTypeAny, {
        file: string;
        atMs: number;
    }, {
        file: string;
        atMs: number;
    }>, "many">>;
}, "strict", z.ZodTypeAny, {
    id: string;
    fps: number;
    title: string;
    narration: {
        text: string;
        file: string;
        sceneId: string;
        offsetMs: number;
    }[];
    schemaVersion: 1;
    canvas: {
        width: number;
        height: number;
    };
    claims: {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence: string[];
    }[];
    scenes: {
        id: string;
        durationMs: number;
        source: {
            input: string;
            evidence: string;
            startMs: number;
            kind: "capture";
            keepAudio: boolean;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        } | {
            input: string;
            startMs: number;
            kind: "media";
            keepAudio: boolean;
            producer: string;
            sourcePath?: string | undefined;
        } | {
            entry: string;
            kind: "html";
            seed: number;
            props: Record<string, unknown>;
        };
        keyMessage: string;
        claimIds: string[];
        caption?: string | undefined;
    }[];
    sfx: {
        file: string;
        atMs: number;
    }[];
    music?: string | undefined;
}, {
    id: string;
    title: string;
    schemaVersion: 1;
    canvas: {
        width: number;
        height: number;
    };
    scenes: {
        id: string;
        durationMs: number;
        source: {
            input: string;
            evidence: string;
            kind: "capture";
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        } | {
            input: string;
            kind: "media";
            producer: string;
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            sourcePath?: string | undefined;
        } | {
            entry: string;
            kind: "html";
            seed?: number | undefined;
            props?: Record<string, unknown> | undefined;
        };
        keyMessage: string;
        caption?: string | undefined;
        claimIds?: string[] | undefined;
    }[];
    fps?: number | undefined;
    narration?: {
        text: string;
        file: string;
        sceneId: string;
        offsetMs?: number | undefined;
    }[] | undefined;
    claims?: {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence?: string[] | undefined;
    }[] | undefined;
    music?: string | undefined;
    sfx?: {
        file: string;
        atMs: number;
    }[] | undefined;
}>, {
    id: string;
    fps: number;
    title: string;
    narration: {
        text: string;
        file: string;
        sceneId: string;
        offsetMs: number;
    }[];
    schemaVersion: 1;
    canvas: {
        width: number;
        height: number;
    };
    claims: {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence: string[];
    }[];
    scenes: {
        id: string;
        durationMs: number;
        source: {
            input: string;
            evidence: string;
            startMs: number;
            kind: "capture";
            keepAudio: boolean;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        } | {
            input: string;
            startMs: number;
            kind: "media";
            keepAudio: boolean;
            producer: string;
            sourcePath?: string | undefined;
        } | {
            entry: string;
            kind: "html";
            seed: number;
            props: Record<string, unknown>;
        };
        keyMessage: string;
        claimIds: string[];
        caption?: string | undefined;
    }[];
    sfx: {
        file: string;
        atMs: number;
    }[];
    music?: string | undefined;
}, {
    id: string;
    title: string;
    schemaVersion: 1;
    canvas: {
        width: number;
        height: number;
    };
    scenes: {
        id: string;
        durationMs: number;
        source: {
            input: string;
            evidence: string;
            kind: "capture";
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            polish?: {
                script: {
                    beats: {
                        id: string;
                        startMs: number;
                        endMs: number;
                        stepText?: string | undefined;
                        stepLabel?: string | undefined;
                        zoom?: {
                            cx: number;
                            cy: number;
                            scale: number;
                        } | undefined;
                    }[];
                    finalCaption?: string | undefined;
                };
                style?: "bold" | "cool" | "warm" | undefined;
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
            } | undefined;
        } | {
            input: string;
            kind: "media";
            producer: string;
            startMs?: number | undefined;
            keepAudio?: boolean | undefined;
            sourcePath?: string | undefined;
        } | {
            entry: string;
            kind: "html";
            seed?: number | undefined;
            props?: Record<string, unknown> | undefined;
        };
        keyMessage: string;
        caption?: string | undefined;
        claimIds?: string[] | undefined;
    }[];
    fps?: number | undefined;
    narration?: {
        text: string;
        file: string;
        sceneId: string;
        offsetMs?: number | undefined;
    }[] | undefined;
    claims?: {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence?: string[] | undefined;
    }[] | undefined;
    music?: string | undefined;
    sfx?: {
        file: string;
        atMs: number;
    }[] | undefined;
}>;
export type Story = z.output<typeof storySchema>;
export type StoryInput = z.input<typeof storySchema>;
export type StoryScene = Story['scenes'][number];
/** Quantize once; every consumer uses these frame boundaries. */
export declare function storyTimeline<S extends {
    id: string;
    keyMessage: string;
    durationMs: number;
    claimIds: string[];
    caption?: string;
}>(story: {
    fps: number;
    scenes: S[];
}): (S & {
    startFrame: number;
    frames: number;
    startMs: number;
    endMs: number;
})[];
export declare const composeParamsSchema: z.ZodObject<{
    action: z.ZodLiteral<"compose">;
    storyPath: z.ZodEffects<z.ZodString, string, string>;
    outDir: z.ZodEffects<z.ZodString, string, string>;
}, "strict", z.ZodTypeAny, {
    action: "compose";
    outDir: string;
    storyPath: string;
}, {
    action: "compose";
    outDir: string;
    storyPath: string;
}>;
export declare const composeStatusParamsSchema: z.ZodObject<{
    action: z.ZodLiteral<"compose-status">;
    outDir: z.ZodEffects<z.ZodString, string, string>;
}, "strict", z.ZodTypeAny, {
    action: "compose-status";
    outDir: string;
}, {
    action: "compose-status";
    outDir: string;
}>;
//# sourceMappingURL=story-schema.d.ts.map