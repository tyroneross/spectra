import { z } from 'zod';
import type { ApiErrorCode, Capability, CoreApiOperation } from './wire.js';
export type ParamTypeNode = {
    kind: 'string';
} | {
    kind: 'number';
} | {
    kind: 'boolean';
} | {
    kind: 'null';
} | {
    kind: 'void';
} | {
    kind: 'unknown';
} | {
    kind: 'any';
} | {
    kind: 'json-value';
} | {
    kind: 'literal';
    value: string | number | boolean | null;
} | {
    kind: 'enum';
    values: string[];
} | {
    kind: 'array';
    items: ParamFieldSchema;
} | {
    kind: 'object';
    properties: Record<string, ParamFieldSchema>;
    required: string[];
} | {
    kind: 'record';
    valueType: ParamFieldSchema;
} | {
    kind: 'union';
    options: ParamFieldSchema[];
} | {
    kind: 'discriminatedUnion';
    discriminator: string;
    options: ParamFieldSchema[];
} | {
    kind: 'unresolved';
    note: string;
};
export type ParamFieldSchema = ParamTypeNode & {
    optional?: true;
    nullable?: true;
    coerce?: true;
    default?: unknown;
};
/**
 * Peels ZodOptional/ZodNullable/ZodDefault wrappers (recording each as a flag),
 * detects coercion on the unwrapped core schema, then delegates to
 * `describeZodCore` for the structural shape. This is the entry point for
 * every param schema and every nested field.
 */
export declare function describeParamSchema(schema: z.ZodTypeAny, depth?: number): ParamFieldSchema;
export interface ResultPropertyDescriptor {
    name: string;
    optional: boolean;
    typeText: string;
    type?: ResultShapeNode;
}
export type ResultShapeNode = {
    kind: 'interface';
    typeName: string;
    properties: ResultPropertyDescriptor[];
} | {
    kind: 'union';
    members: ResultShapeNode[];
} | {
    kind: 'array';
    items: ResultShapeNode;
} | {
    kind: 'tuple';
    elements: ResultShapeNode[];
} | {
    kind: 'literal';
    value: string | number | boolean;
} | {
    kind: 'unresolved';
    typeName: string;
};
export interface EnrichedOperationSpec {
    operation: CoreApiOperation;
    params: ParamFieldSchema;
    result: ResultShapeNode;
    errorCodes: ApiErrorCode[];
    capabilities: Capability[];
}
export interface EnrichedContractSpecBody {
    apiVersion: number;
    operations: Record<string, EnrichedOperationSpec>;
}
export interface EnrichedContractSpec extends EnrichedContractSpecBody {
    hash: string;
}
export declare function buildEnrichedSpecBody(coreApiSource?: string): EnrichedContractSpecBody;
export declare function hashSpecBody(body: EnrichedContractSpecBody): string;
export declare function buildEnrichedSpec(): EnrichedContractSpec;
//# sourceMappingURL=enriched-spec.d.ts.map