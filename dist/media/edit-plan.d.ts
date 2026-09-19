import { z } from 'zod';
export declare const editPlanClaimSchema: z.ZodObject<{
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
}>;
export declare const editPlanNarrationSchema: z.ZodObject<{
    text: z.ZodString;
    durationMs: z.ZodNumber;
    voice: z.ZodDefault<z.ZodString>;
    rate: z.ZodDefault<z.ZodNumber>;
    engine: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    durationMs: number;
    text: string;
    voice: string;
    rate: number;
    engine: string;
}, {
    durationMs: number;
    text: string;
    voice?: string | undefined;
    rate?: number | undefined;
    engine?: string | undefined;
}>;
export declare const editPlanBeatSchema: z.ZodObject<{
    id: z.ZodString;
    startMs: z.ZodNumber;
    endMs: z.ZodNumber;
    keyMessage: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    claimIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    caption: z.ZodOptional<z.ZodString>;
    narration: z.ZodOptional<z.ZodObject<{
        text: z.ZodString;
        durationMs: z.ZodNumber;
        voice: z.ZodDefault<z.ZodString>;
        rate: z.ZodDefault<z.ZodNumber>;
        engine: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        durationMs: number;
        text: string;
        voice: string;
        rate: number;
        engine: string;
    }, {
        durationMs: number;
        text: string;
        voice?: string | undefined;
        rate?: number | undefined;
        engine?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    startMs: number;
    endMs: number;
    keyMessage: string;
    claimIds: string[];
    caption?: string | undefined;
    description?: string | undefined;
    narration?: {
        durationMs: number;
        text: string;
        voice: string;
        rate: number;
        engine: string;
    } | undefined;
}, {
    id: string;
    startMs: number;
    endMs: number;
    keyMessage: string;
    caption?: string | undefined;
    description?: string | undefined;
    claimIds?: string[] | undefined;
    narration?: {
        durationMs: number;
        text: string;
        voice?: string | undefined;
        rate?: number | undefined;
        engine?: string | undefined;
    } | undefined;
}>;
export declare const editPlanSchema: z.ZodEffects<z.ZodObject<{
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
    beats: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        startMs: z.ZodNumber;
        endMs: z.ZodNumber;
        keyMessage: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        claimIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        caption: z.ZodOptional<z.ZodString>;
        narration: z.ZodOptional<z.ZodObject<{
            text: z.ZodString;
            durationMs: z.ZodNumber;
            voice: z.ZodDefault<z.ZodString>;
            rate: z.ZodDefault<z.ZodNumber>;
            engine: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            durationMs: number;
            text: string;
            voice: string;
            rate: number;
            engine: string;
        }, {
            durationMs: number;
            text: string;
            voice?: string | undefined;
            rate?: number | undefined;
            engine?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        startMs: number;
        endMs: number;
        keyMessage: string;
        claimIds: string[];
        caption?: string | undefined;
        description?: string | undefined;
        narration?: {
            durationMs: number;
            text: string;
            voice: string;
            rate: number;
            engine: string;
        } | undefined;
    }, {
        id: string;
        startMs: number;
        endMs: number;
        keyMessage: string;
        caption?: string | undefined;
        description?: string | undefined;
        claimIds?: string[] | undefined;
        narration?: {
            durationMs: number;
            text: string;
            voice?: string | undefined;
            rate?: number | undefined;
            engine?: string | undefined;
        } | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    fps: number;
    title: string;
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
    beats: {
        id: string;
        startMs: number;
        endMs: number;
        keyMessage: string;
        claimIds: string[];
        caption?: string | undefined;
        description?: string | undefined;
        narration?: {
            durationMs: number;
            text: string;
            voice: string;
            rate: number;
            engine: string;
        } | undefined;
    }[];
}, {
    id: string;
    title: string;
    schemaVersion: 1;
    canvas: {
        width: number;
        height: number;
    };
    beats: {
        id: string;
        startMs: number;
        endMs: number;
        keyMessage: string;
        caption?: string | undefined;
        description?: string | undefined;
        claimIds?: string[] | undefined;
        narration?: {
            durationMs: number;
            text: string;
            voice?: string | undefined;
            rate?: number | undefined;
            engine?: string | undefined;
        } | undefined;
    }[];
    fps?: number | undefined;
    claims?: {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence?: string[] | undefined;
    }[] | undefined;
}>, {
    id: string;
    fps: number;
    title: string;
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
    beats: {
        id: string;
        startMs: number;
        endMs: number;
        keyMessage: string;
        claimIds: string[];
        caption?: string | undefined;
        description?: string | undefined;
        narration?: {
            durationMs: number;
            text: string;
            voice: string;
            rate: number;
            engine: string;
        } | undefined;
    }[];
}, {
    id: string;
    title: string;
    schemaVersion: 1;
    canvas: {
        width: number;
        height: number;
    };
    beats: {
        id: string;
        startMs: number;
        endMs: number;
        keyMessage: string;
        caption?: string | undefined;
        description?: string | undefined;
        claimIds?: string[] | undefined;
        narration?: {
            durationMs: number;
            text: string;
            voice?: string | undefined;
            rate?: number | undefined;
            engine?: string | undefined;
        } | undefined;
    }[];
    fps?: number | undefined;
    claims?: {
        id: string;
        text: string;
        status: "supported" | "qualified" | "blocked";
        evidence?: string[] | undefined;
    }[] | undefined;
}>;
export type EditPlanInput = z.input<typeof editPlanSchema>;
export type EditPlan = z.output<typeof editPlanSchema>;
export type EditPlanClaim = z.output<typeof editPlanClaimSchema>;
export type EditPlanBeat = z.output<typeof editPlanBeatSchema>;
export type EditPlanNarration = z.output<typeof editPlanNarrationSchema>;
export interface CompiledNarrationJob extends EditPlanNarration {
    beatId: string;
    cacheKey: string;
}
export interface EditPlanManifest {
    schemaVersion: 1;
    planId: string;
    title: string;
    durationMs: number;
    fps: number;
    canvas: EditPlan['canvas'];
    beats: Array<Pick<EditPlanBeat, 'id' | 'startMs' | 'endMs' | 'keyMessage' | 'claimIds'>>;
    narration: Array<{
        beatId: string;
        cacheKey: string;
    }>;
}
export interface CompiledEditPlan {
    plan: EditPlan;
    durationMs: number;
    captionsSrt: string;
    narration: CompiledNarrationJob[];
    manifest: EditPlanManifest;
}
export declare function parseEditPlan(input: unknown): EditPlan;
export declare function compileEditPlan(input: unknown): CompiledEditPlan;
export declare function narrationCacheKey(narration: Pick<EditPlanNarration, 'text' | 'voice' | 'rate' | 'engine'>): string;
//# sourceMappingURL=edit-plan.d.ts.map