// src/contract/enriched-spec.ts
//
// M1b — enriched, machine-checkable contract spec generator.
//
// contract.snapshot.json (contractSurface() in schemas.ts) captures NAMES ONLY:
// operation names, param key lists, envelope key lists, a flat error-code list.
// It cannot tell a Swift port that `name` on createSession is optional, that
// `fps` is a 30|60 literal union, or that `getSession` can return `not_found`.
// This module derives a FULL per-operation spec — param types/optionality/
// defaults/coercion/nested shapes (hand-walked from the live zod schemas in
// schemas.ts — no zod-to-json-schema dependency added, per the repo's
// minimal-deps stance: 2 runtime deps today, see package.json), result shapes
// (statically parsed from the CoreApi interface + *Result types in
// core-api.ts via the TypeScript compiler API — a devDependency already in
// this repo, used generation-time only), and an op→allowed-error-code mapping
// (hand-derived, see OPERATION_SPECIFIC_ERROR_CODES below).
//
// This file has NO side effects when imported (tests import buildEnrichedSpec
// / describeParamSchema directly). Running it as a script (`npm run
// build:contract-spec`, i.e. `tsx src/contract/enriched-spec.ts`) regenerates
// contract.spec.json. The generator emits no timestamps — output is a pure
// function of the live source (schemas.ts + core-api.ts), so re-running it
// with no source changes reproduces byte-identical output and the same hash.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { z } from 'zod';
import { operationCapabilities } from './wire.js';
import { apiOperations, jsonValueSchema, operationParamSchemas, API_VERSION } from './schemas.js';
const here = dirname(fileURLToPath(import.meta.url));
const coreApiPath = join(here, 'core-api.ts');
const specPath = join(here, 'contract.spec.json');
const MAX_ZOD_DEPTH = 24;
/**
 * Peels ZodOptional/ZodNullable/ZodDefault wrappers (recording each as a flag),
 * detects coercion on the unwrapped core schema, then delegates to
 * `describeZodCore` for the structural shape. This is the entry point for
 * every param schema and every nested field.
 */
export function describeParamSchema(schema, depth = 0) {
    if (depth > MAX_ZOD_DEPTH) {
        return { kind: 'unresolved', note: 'max-depth-exceeded' };
    }
    let optional;
    let nullable;
    let hasDefault;
    let current = schema;
    for (;;) {
        if (current instanceof z.ZodOptional) {
            optional = true;
            current = current.unwrap();
            continue;
        }
        if (current instanceof z.ZodNullable) {
            nullable = true;
            current = current.unwrap();
            continue;
        }
        if (current instanceof z.ZodDefault) {
            hasDefault = { value: current._def.defaultValue() };
            current = current._def.innerType;
            continue;
        }
        if (current instanceof z.ZodEffects) {
            // .refine()/.transform() wrap an inner schema transparently for shape
            // purposes — no refine/transform is used in operationParamSchemas today,
            // but this keeps the walker correct if one is added later.
            current = current._def.schema;
            continue;
        }
        break;
    }
    const coerce = current._def?.coerce === true;
    const core = describeZodCore(current, depth);
    return {
        ...core,
        ...(optional ? { optional: true } : {}),
        ...(nullable ? { nullable: true } : {}),
        ...(coerce ? { coerce: true } : {}),
        ...(hasDefault ? { default: hasDefault.value } : {}),
    };
}
function describeZodCore(schema, depth) {
    if (schema === jsonValueSchema)
        return { kind: 'json-value' };
    if (schema instanceof z.ZodString)
        return { kind: 'string' };
    if (schema instanceof z.ZodNumber)
        return { kind: 'number' };
    if (schema instanceof z.ZodBoolean)
        return { kind: 'boolean' };
    if (schema instanceof z.ZodNull)
        return { kind: 'null' };
    if (schema instanceof z.ZodVoid)
        return { kind: 'void' };
    if (schema instanceof z.ZodUnknown)
        return { kind: 'unknown' };
    if (schema instanceof z.ZodAny)
        return { kind: 'any' };
    if (schema instanceof z.ZodLiteral) {
        return { kind: 'literal', value: schema._def.value };
    }
    if (schema instanceof z.ZodEnum) {
        return { kind: 'enum', values: [...schema._def.values] };
    }
    if (schema instanceof z.ZodArray) {
        return { kind: 'array', items: describeParamSchema(schema._def.type, depth + 1) };
    }
    if (schema instanceof z.ZodRecord) {
        return { kind: 'record', valueType: describeParamSchema(schema._def.valueType, depth + 1) };
    }
    if (schema instanceof z.ZodDiscriminatedUnion) {
        const options = schema._def.options.map((option) => describeParamSchema(option, depth + 1));
        return { kind: 'discriminatedUnion', discriminator: schema._def.discriminator, options };
    }
    if (schema instanceof z.ZodUnion) {
        const options = schema._def.options.map((option) => describeParamSchema(option, depth + 1));
        return { kind: 'union', options };
    }
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        const properties = {};
        const required = [];
        for (const key of Object.keys(shape).sort()) {
            const field = describeParamSchema(shape[key], depth + 1);
            properties[key] = field;
            if (!field.optional)
                required.push(key);
        }
        return { kind: 'object', properties, required };
    }
    if (schema instanceof z.ZodLazy) {
        // Resolve one level through the getter (guarded by depth). jsonValueSchema
        // (the only lazy schema in this contract) is already handled above by
        // identity, so this only fires for a future self-referential schema.
        return describeParamSchema(schema._def.getter(), depth + 1);
    }
    return { kind: 'unresolved', note: schema.constructor?.name ?? 'unknown-zod-type' };
}
function parseCoreApiSource(sourceText) {
    const text = sourceText ?? readFileSync(coreApiPath, 'utf8');
    const sourceFile = ts.createSourceFile(coreApiPath, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const declarations = new Map();
    for (const statement of sourceFile.statements) {
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
            declarations.set(statement.name.text, statement);
        }
    }
    return { sourceFile, declarations };
}
// A type node is "expandable" when it (optionally through an array wrapper)
// is a reference to a *declared* name, a union, or an inline type literal —
// i.e. resolveTypeNode has a real chance of returning structure for it
// rather than falling through to `unresolved`. Plain keyword types (string,
// number, boolean, ...) are intentionally left alone: attaching a `type`
// node that just repeats `typeText` in a different shape would be noise,
// not signal.
function isExpandableTypeNode(typeNode) {
    if (ts.isArrayTypeNode(typeNode))
        return isExpandableTypeNode(typeNode.elementType);
    return ts.isTypeReferenceNode(typeNode) || ts.isUnionTypeNode(typeNode) || ts.isTypeLiteralNode(typeNode);
}
// Whether a resolved ResultShapeNode actually carries structure worth
// attaching to a property descriptor (as opposed to a bare `unresolved`,
// which adds nothing `typeText` didn't already say). `tuple` counts
// unconditionally — arity itself (e.g. Bounds's 4 positions) is the
// structural fact, even when every element resolves to an opaque keyword
// like `number`.
function shapeHasStructure(node) {
    if (node.kind === 'interface')
        return true;
    if (node.kind === 'tuple')
        return true;
    // A literal constrains the value to an exact constant — that IS structure
    // worth freezing (it's what lets the validator gate an enum value), so a
    // property typed as a literal or a union-of-literals gets a real `.type`.
    if (node.kind === 'literal')
        return true;
    if (node.kind === 'union')
        return node.members.some(shapeHasStructure);
    if (node.kind === 'array')
        return shapeHasStructure(node.items);
    return false;
}
function buildPropertyDescriptor(member, sourceFile, declarations, depth) {
    const name = member.name.getText(sourceFile);
    const optional = member.questionToken !== undefined;
    const typeText = member.type ? member.type.getText(sourceFile) : 'unknown';
    const descriptor = { name, optional, typeText };
    // The H1 fix: recurse into the property's own type node (one MAX_TS_DEPTH
    // step deeper) instead of stopping at typeText. Reuses the same
    // declarations map (scoped to core-api.ts's own statements — external/
    // node_modules types are never in that map, so they stay `unresolved` by
    // construction) and the same depth guard resolveTypeNode already enforces.
    if (member.type && isExpandableTypeNode(member.type)) {
        const resolved = resolveTypeNode(member.type, sourceFile, declarations, depth + 1);
        if (shapeHasStructure(resolved)) {
            descriptor.type = resolved;
        }
    }
    return descriptor;
}
function buildPropertyDescriptors(members, sourceFile, declarations, depth) {
    const properties = [];
    for (const member of members) {
        if (ts.isPropertySignature(member) && member.name) {
            properties.push(buildPropertyDescriptor(member, sourceFile, declarations, depth));
        }
    }
    return properties.sort((a, b) => a.name.localeCompare(b.name));
}
function resolveInterfaceProperties(node, sourceFile, declarations, visitedHeritage, depth) {
    const props = new Map();
    if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
            for (const type of clause.types) {
                const name = type.expression.getText(sourceFile);
                if (visitedHeritage.has(name))
                    continue;
                visitedHeritage.add(name);
                const parent = declarations.get(name);
                if (parent && ts.isInterfaceDeclaration(parent)) {
                    for (const prop of resolveInterfaceProperties(parent, sourceFile, declarations, visitedHeritage, depth)) {
                        props.set(prop.name, prop);
                    }
                }
            }
        }
    }
    for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
            props.set(member.name.getText(sourceFile), buildPropertyDescriptor(member, sourceFile, declarations, depth));
        }
    }
    return [...props.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const MAX_TS_DEPTH = 8;
function resolveTypeNode(typeNode, sourceFile, declarations, depth) {
    if (depth > MAX_TS_DEPTH) {
        return { kind: 'unresolved', typeName: typeNode.getText(sourceFile) };
    }
    // String / numeric / boolean literal type (`'granted'`, `30`, `-1`, `true`).
    // Keyword types (`number`, `string`, `boolean`) are NOT LiteralTypeNodes, so
    // they fall through to `unresolved` below — preserving the existing behavior
    // (e.g. Bounds's `[number,number,number,number]` tuple of unresolved numbers).
    // A `null` literal is intentionally left unresolved (permissive) so a
    // `T | null` union keeps its prior shape rather than gaining a null member.
    if (ts.isLiteralTypeNode(typeNode)) {
        const lit = typeNode.literal;
        if (ts.isStringLiteral(lit))
            return { kind: 'literal', value: lit.text };
        if (ts.isNumericLiteral(lit))
            return { kind: 'literal', value: Number(lit.text) };
        if (lit.kind === ts.SyntaxKind.TrueKeyword)
            return { kind: 'literal', value: true };
        if (lit.kind === ts.SyntaxKind.FalseKeyword)
            return { kind: 'literal', value: false };
        if (ts.isPrefixUnaryExpression(lit) &&
            lit.operator === ts.SyntaxKind.MinusToken &&
            ts.isNumericLiteral(lit.operand)) {
            return { kind: 'literal', value: -Number(lit.operand.text) };
        }
        return { kind: 'unresolved', typeName: typeNode.getText(sourceFile) };
    }
    if (ts.isUnionTypeNode(typeNode)) {
        return {
            kind: 'union',
            members: typeNode.types.map((member) => resolveTypeNode(member, sourceFile, declarations, depth + 1)),
        };
    }
    if (ts.isArrayTypeNode(typeNode)) {
        return {
            kind: 'array',
            items: resolveTypeNode(typeNode.elementType, sourceFile, declarations, depth + 1),
        };
    }
    if (ts.isTupleTypeNode(typeNode)) {
        return {
            kind: 'tuple',
            elements: typeNode.elements.map((element) => resolveTypeNode(element, sourceFile, declarations, depth + 1)),
        };
    }
    if (ts.isTypeLiteralNode(typeNode)) {
        return {
            kind: 'interface',
            typeName: '(inline)',
            properties: buildPropertyDescriptors(typeNode.members, sourceFile, declarations, depth),
        };
    }
    if (ts.isTypeReferenceNode(typeNode)) {
        const name = typeNode.typeName.getText(sourceFile);
        const declaration = declarations.get(name);
        if (!declaration)
            return { kind: 'unresolved', typeName: name };
        if (ts.isInterfaceDeclaration(declaration)) {
            return {
                kind: 'interface',
                typeName: name,
                properties: resolveInterfaceProperties(declaration, sourceFile, declarations, new Set([name]), depth),
            };
        }
        if (ts.isTypeAliasDeclaration(declaration)) {
            return resolveTypeNode(declaration.type, sourceFile, declarations, depth + 1);
        }
        return { kind: 'unresolved', typeName: name };
    }
    return { kind: 'unresolved', typeName: typeNode.getText(sourceFile) };
}
function extractResultShapes(sourceText) {
    const { sourceFile, declarations } = parseCoreApiSource(sourceText);
    const coreApiDecl = declarations.get('CoreApi');
    if (!coreApiDecl || !ts.isInterfaceDeclaration(coreApiDecl)) {
        throw new Error('enriched-spec: could not locate `interface CoreApi` in core-api.ts');
    }
    const results = {};
    for (const member of coreApiDecl.members) {
        if (!ts.isMethodSignature(member) || !member.name)
            continue;
        const opName = member.name.getText(sourceFile);
        const returnType = member.type;
        if (!returnType || !ts.isTypeReferenceNode(returnType) || returnType.typeName.getText(sourceFile) !== 'Promise') {
            results[opName] = { kind: 'unresolved', typeName: 'non-promise-return' };
            continue;
        }
        const inner = returnType.typeArguments?.[0];
        if (!inner) {
            results[opName] = { kind: 'unresolved', typeName: 'Promise<void>' };
            continue;
        }
        results[opName] = resolveTypeNode(inner, sourceFile, declarations, 0);
    }
    return results;
}
// ─── Part (c-lite): op → allowed-error-code mapping ────────────────────────
//
// Hand-derived (verified 2026-07-01 by static read of src/daemon/server.ts,
// src/daemon/security.ts, src/daemon/core-impl.ts — read-only per the M1b
// ownership boundary, no daemon files edited). src/daemon/core-impl.ts is
// under active concurrent development on this same tree; this mapping was
// re-verified against its state as of the last `getSession`/`stopRecording`
// re-read (post-refactor: the finalizeRecording step and its
// `recording_finalize_failed` code were removed from stopRecording and from
// wire.ts's ApiErrorCode union in that same peer change). If core-impl.ts's
// error-throwing sites change again, re-grep `DaemonApiError(` there and
// update this table — the enriched-spec sync test will not catch daemon-side
// drift on its own since this map is hand-authored, not parsed.
//
// Envelope/auth/transport-layer codes below apply to EVERY operation
// regardless of which handler runs (server.ts validateEnvelope/dispatch,
// security.ts assertCapabilities/verifyCaller, the daemon's catch-all →
// internal_error). Operation-specific additions are the DaemonApiError codes
// actually thrown inside core-impl.ts for that operation's method body.
// src/mcp/tools/* handlers (used by snapshot/observe/act/step/llmStep/
// walkthrough/screenshot/analyze/discover/recordTerminal/replayTerminal/
// library/demo/autoRampDemo) throw NO DaemonApiError today — their failure
// modes surface as an inline `error` field on an `ok:true` result (see
// ActResult.error, ScreenshotResult.error, etc. in core-api.ts) rather than a
// wire-level error code, so those operations carry only the universal set.
const UNIVERSAL_ERROR_CODES = [
    'bad_request',
    'unsupported_api_version',
    'unauthorized',
    'forbidden',
    'capability_denied',
    'daemon_unhealthy',
    'internal_error',
];
const OPERATION_SPECIFIC_ERROR_CODES = {
    getSession: ['not_found'],
    getRun: ['not_found'],
    startRecording: ['not_found', 'conflict', 'recording_failed'],
    stopRecording: ['not_found', 'recording_failed'],
    recordComposite: ['conflict', 'recording_failed'],
    getRecording: ['not_found'],
    computerUse: ['permission_denied'],
};
function errorCodesFor(operation) {
    const extra = OPERATION_SPECIFIC_ERROR_CODES[operation] ?? [];
    return [...new Set([...UNIVERSAL_ERROR_CODES, ...extra])].sort();
}
// `coreApiSource` is test-only: pass an in-memory alternate core-api.ts text
// to prove the resolver reacts to a nested-type mutation without touching
// the real file on disk (see the H1 mutation-regression test in
// tests/contract/enriched-spec.test.ts). Production callers (buildEnrichedSpec,
// the CLI runner below) always omit it, which reads the real file.
export function buildEnrichedSpecBody(coreApiSource) {
    const resultShapes = extractResultShapes(coreApiSource);
    const operations = {};
    for (const operation of apiOperations) {
        operations[operation] = {
            operation,
            params: describeParamSchema(operationParamSchemas[operation]),
            result: resultShapes[operation] ?? { kind: 'unresolved', typeName: 'not-found-in-core-api' },
            errorCodes: errorCodesFor(operation),
            capabilities: [...operationCapabilities[operation]],
        };
    }
    return { apiVersion: API_VERSION, operations };
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const record = value;
        const out = {};
        for (const key of Object.keys(record).sort()) {
            out[key] = canonicalize(record[key]);
        }
        return out;
    }
    return value;
}
export function hashSpecBody(body) {
    return createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
}
export function buildEnrichedSpec() {
    const body = buildEnrichedSpecBody();
    return { ...body, hash: hashSpecBody(body) };
}
// ─── CLI runner: `npm run build:contract-spec` ─────────────────────────────
function isMainModule() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    return fileURLToPath(import.meta.url) === resolve(entry);
}
if (isMainModule()) {
    const spec = buildEnrichedSpec();
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const opCount = Object.keys(spec.operations).length;
    console.log(`Wrote ${specPath} — ${opCount} operations, hash ${spec.hash.slice(0, 16)}…`);
}
//# sourceMappingURL=enriched-spec.js.map