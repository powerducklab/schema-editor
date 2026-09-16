/**
 * JSON Schema resolution helpers.
 *
 * Responsibilities:
 *   - Resolve local $ref pointers (#/...), $id-based references, and
 *     $anchor references inside a single schema document.
 *   - Flatten allOf into a single effective schema for completion purposes.
 *   - Expand anyOf / oneOf into a list of candidate branches.
 *   - Walk a resolved schema along a document path.
 *
 * Remote references (https://...) are not fetched. They resolve to an empty
 * schema so that the editor degrades gracefully instead of failing.
 */

import type {
  JsonPath,
  JsonSchema,
  JsonSchemaObject,
  JsonSchemaType,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Basic guards                                                               */
/* -------------------------------------------------------------------------- */

export function isSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Reference index                                                            */
/* -------------------------------------------------------------------------- */

interface ReferenceIndex {
  byId: Map<string, JsonSchemaObject>;
  byAnchor: Map<string, JsonSchemaObject>;
}

const referenceIndexCache = new WeakMap<JsonSchemaObject, ReferenceIndex>();

/**
 * Collect every $id and $anchor in the schema so that non-pointer references
 * can be resolved without a network round trip.
 */
function buildReferenceIndex(root: JsonSchemaObject): ReferenceIndex {
  const cached = referenceIndexCache.get(root);

  if (cached) {
    return cached;
  }

  const index: ReferenceIndex = { byId: new Map(), byAnchor: new Map() };
  const seen = new Set<unknown>();

  const pending: Array<{ value: unknown; baseId: string }> = [{ value: root, baseId: typeof root.$id === "string" ? root.$id : "" }];
  while (pending.length) {
    const { value, baseId } = pending.pop()!;
    if (!isRecord(value) || seen.has(value)) continue;
    seen.add(value);
    let currentBase = baseId;
    if (typeof value.$id === "string" && value.$id) {
      currentBase = resolveUri(baseId, value.$id);
      index.byId.set(currentBase, value as JsonSchemaObject);
    }
    if (typeof value.$anchor === "string" && value.$anchor) {
      index.byAnchor.set(`${currentBase}#${value.$anchor}`, value as JsonSchemaObject);
      index.byAnchor.set(`#${value.$anchor}`, value as JsonSchemaObject);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (let i = child.length - 1; i >= 0; i--) pending.push({ value: child[i], baseId: currentBase });
      } else if (isRecord(child)) pending.push({ value: child, baseId: currentBase });
    }
  }

  referenceIndexCache.set(root, index);
  return index;
}

function resolveUri(base: string, relative: string): string {
  if (!base) {
    return relative;
  }

  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

/* -------------------------------------------------------------------------- */
/* $ref resolution                                                            */
/* -------------------------------------------------------------------------- */

function decodePointerSegment(segment: string): string {
  let decoded = segment;

  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* Keep the raw segment when it is not valid percent-encoding. */
  }

  return decoded.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === "") {
    return root;
  }

  const segments = pointer.split("/").slice(1).map(decodePointerSegment);
  let current: unknown = root;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const position = Number(segment);

      if (!/^(0|[1-9]\d*)$/.test(segment) || !Number.isInteger(position) || position < 0 || position >= current.length) {
        return undefined;
      }

      current = current[position];
      continue;
    }

    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

/**
 * Resolve a $ref string against the root schema. Returns undefined when the
 * target cannot be located (remote or malformed references).
 */
export function resolveReference(
  root: JsonSchemaObject,
  ref: string,
): JsonSchema | undefined {
  if (typeof ref !== "string" || !ref) {
    return undefined;
  }

  const index = buildReferenceIndex(root);
  const hashIndex = ref.indexOf("#");
  const base = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : ref.slice(hashIndex + 1);

  let target: unknown = root;

  if (base) {
    const rootId = typeof root.$id === "string" ? root.$id : "";
    const absolute = resolveUri(rootId, base);
    target = index.byId.get(absolute) ?? index.byId.get(base);

    if (!target) {
      return undefined;
    }
  }

  if (!fragment) {
    return isSchemaObject(target) ? target : undefined;
  }

  if (fragment.startsWith("/")) {
    const resolved = resolvePointer(target, fragment);
    return isSchemaObject(resolved) || typeof resolved === "boolean" ? resolved : undefined;
  }

  /* Plain-name fragment: $anchor. */
  const anchored =
    index.byAnchor.get(`${base}#${fragment}`) ?? index.byAnchor.get(`#${fragment}`);

  return anchored;
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

const MAX_RESOLUTION_DEPTH = 32;

/**
 * Deep-merge two effective schemas produced by allOf flattening.
 * Properties are unioned, required is unioned, and scalar keywords from the
 * later schema win. This is a completion-oriented approximation, not a
 * validation-grade merge; validation is handled separately by Ajv.
 */
function mergeSchemas(base: JsonSchemaObject, extra: JsonSchemaObject): JsonSchemaObject {
  const merged: JsonSchemaObject = { ...base, ...extra };

  if (base.properties || extra.properties) {
    merged.properties = {
      ...(base.properties ?? {}),
      ...(extra.properties ?? {}),
    };
  }

  if (base.patternProperties || extra.patternProperties) {
    merged.patternProperties = {
      ...(base.patternProperties ?? {}),
      ...(extra.patternProperties ?? {}),
    };
  }

  if (base.required || extra.required) {
    merged.required = Array.from(
      new Set([...(base.required ?? []), ...(extra.required ?? [])]),
    );
  }

  if (base.type && extra.type && base.type !== extra.type) {
    merged.type =
      Array.isArray(extra.type) && !Array.isArray(base.type) ? base.type : extra.type;
  }

  delete merged.allOf;
  delete merged.$ref;

  return merged;
}

/**
 * Resolve a schema into a list of concrete candidate schemas:
 *   - $ref is followed;
 *   - allOf is flattened into one schema;
 *   - anyOf / oneOf / if-then-else fan out into multiple candidates.
 *
 * true resolves to an empty permissive schema, false resolves to nothing.
 */
export function resolveSchemas(
  schema: JsonSchema | undefined,
  root: JsonSchemaObject,
  depth = 0,
  seen: Set<JsonSchemaObject> = new Set(),
  budget = { remaining: 2048 },
): JsonSchemaObject[] {
  if (--budget.remaining < 0) return [];
  if (schema === undefined || schema === false) {
    return [];
  }

  if (schema === true) {
    return [{}];
  }

  if (!isSchemaObject(schema) || depth > MAX_RESOLUTION_DEPTH || seen.has(schema)) {
    return [];
  }

  const nextSeen = new Set(seen);
  nextSeen.add(schema);

  let effective: JsonSchemaObject = schema;

  if (typeof schema.$ref === "string") {
    const target = resolveReference(root, schema.$ref);

    if (target === false) return [];
    if (target === undefined) {
      const { $ref: _ignored, ...rest } = schema;
      effective = rest;
    } else {
      const { $ref: _ignored, ...siblings } = schema;
      const resolvedTargets = resolveSchemas(target, root, depth + 1, nextSeen, budget);

      if (resolvedTargets.length === 0) {
        effective = siblings;
      } else if (Object.keys(siblings).length === 0) {
        return resolvedTargets;
      } else {
        return resolvedTargets.map((resolved) => mergeSchemas(resolved, siblings));
      }
    }
  }

  if (Array.isArray(effective.allOf) && effective.allOf.length > 0) {
    const { allOf, ...rest } = effective;
    let candidates: JsonSchemaObject[] = [rest];

    for (const part of allOf.slice(0, 64)) {
      if (part === false) return [];
      const partCandidates = resolveSchemas(part, root, depth + 1, nextSeen, budget);

      if (partCandidates.length === 0) {
        continue;
      }

      const next: JsonSchemaObject[] = [];

      for (const candidate of candidates) {
        for (const partCandidate of partCandidates) {
          if (next.length < 16) next.push(mergeSchemas(candidate, partCandidate));
        }
      }

      /* Guard against combinatorial blow-up on pathological schemas. */
      candidates = next.slice(0, 16);
    }

    effective =
      candidates.length === 1 && candidates[0]
        ? candidates[0]
        : { anyOf: candidates, ...stripCombinators(rest) };

    if (candidates.length > 1) {
      return candidates.flatMap((candidate) =>
        resolveSchemas(candidate, root, depth + 1, nextSeen, budget),
      );
    }
  }

  const branches: JsonSchemaObject[] = [];
  const combinators = [effective.anyOf, effective.oneOf].filter(
    Array.isArray,
  ) as JsonSchema[][];

  if (combinators.length > 0) {
    const { anyOf: _a, oneOf: _o, ...rest } = effective;

    for (const list of combinators) {
      for (const branch of list.slice(0, 64)) {
        if (branches.length >= 64) break;
        for (const resolved of resolveSchemas(branch, root, depth + 1, nextSeen, budget)) {
          if (branches.length < 64) branches.push(mergeSchemas(rest, resolved));
        }
      }
    }
  }

  if (effective.then || effective.else) {
    const { if: _i, then, else: otherwise, ...rest } = effective;

    for (const conditional of [then, otherwise]) {
      for (const resolved of resolveSchemas(conditional, root, depth + 1, nextSeen, budget)) {
        branches.push(mergeSchemas(rest, resolved));
      }
    }

    if (branches.length === 0) {
      branches.push(rest);
    }
  }

  if (branches.length > 0) {
    return dedupeSchemas(branches);
  }

  return [effective];
}

function stripCombinators(schema: JsonSchemaObject): JsonSchemaObject {
  const { allOf: _a, anyOf: _b, oneOf: _c, ...rest } = schema;
  return rest;
}

function dedupeSchemas(schemas: JsonSchemaObject[]): JsonSchemaObject[] {
  const seen = new Set<JsonSchemaObject>();
  const out: JsonSchemaObject[] = [];

  for (const schema of schemas) {
    if (!seen.has(schema)) {
      seen.add(schema);
      out.push(schema);
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Type inference                                                             */
/* -------------------------------------------------------------------------- */

const VALID_JSON_TYPES = new Set<JsonSchemaType>([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

function asJsonSchemaType(value: string): JsonSchemaType | undefined {
  return VALID_JSON_TYPES.has(value as JsonSchemaType)
    ? (value as JsonSchemaType)
    : undefined;
}

/** Return the JSON types a schema accepts, inferring from structure when type is absent. */
export function getSchemaTypes(schema: JsonSchemaObject): JsonSchemaType[] {
  if (Array.isArray(schema.type)) {
    return schema.type
      .map(asJsonSchemaType)
      .filter((type): type is JsonSchemaType => type !== undefined);
  }

  if (typeof schema.type === "string") {
    const narrowed = asJsonSchemaType(schema.type);
    return narrowed ? [narrowed] : [];
  }

  const inferred = new Set<JsonSchemaType>();

  if (
    schema.properties ||
    schema.patternProperties ||
    schema.additionalProperties !== undefined ||
    schema.required
  ) {
    inferred.add("object");
  }

  if (schema.items !== undefined || schema.prefixItems) {
    inferred.add("array");
  }

  if (Array.isArray(schema.enum)) {
    for (const value of schema.enum) {
      const type = jsonTypeOf(value);

      if (type) {
        inferred.add(type);
      }
    }
  }

  if (schema.const !== undefined) {
    const type = jsonTypeOf(schema.const);

    if (type) {
      inferred.add(type);
    }
  }

  if (
    schema.format ||
    schema.pattern ||
    schema.minLength !== undefined ||
    schema.maxLength !== undefined
  ) {
    inferred.add("string");
  }

  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    inferred.add("number");
  }

  return Array.from(inferred);
}

export function jsonTypeOf(value: unknown): JsonSchemaType | undefined {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return undefined;
  }
}

export function schemaAllowsType(schema: JsonSchemaObject, type: JsonSchemaType): boolean {
  const types = getSchemaTypes(schema);

  if (types.length === 0) {
    return true;
  }

  if (type === "integer") {
    return types.includes("integer") || types.includes("number");
  }

  return types.includes(type);
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

function safeRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "u");
  } catch {
    try {
      return new RegExp(pattern);
    } catch {
      return undefined;
    }
  }
}

/** Resolve the schemas describing key inside a set of object schemas. */
export function getPropertySchemas(
  schemas: JsonSchemaObject[],
  key: string,
  root: JsonSchemaObject,
): JsonSchemaObject[] {
  const out: JsonSchemaObject[] = [];

  for (const schema of schemas) {
    let matched = false;

    if (
      schema.properties &&
      Object.prototype.hasOwnProperty.call(schema.properties, key)
    ) {
      out.push(...resolveSchemas(schema.properties[key], root));
      matched = true;
    }

    if (schema.patternProperties) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        const regex = safeRegExp(pattern);

        if (regex && regex.test(key)) {
          out.push(...resolveSchemas(patternSchema, root));
          matched = true;
        }
      }
    }

    if (!matched) {
      if (schema.additionalProperties === undefined) {
        out.push({});
      } else {
        out.push(...resolveSchemas(schema.additionalProperties, root));
      }
    }
  }

  return dedupeSchemas(out);
}

/** Resolve the schemas describing the item at index inside a set of array schemas. */
export function getItemSchemas(
  schemas: JsonSchemaObject[],
  index: number,
  root: JsonSchemaObject,
): JsonSchemaObject[] {
  const out: JsonSchemaObject[] = [];

  for (const schema of schemas) {
    if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) {
      out.push(...resolveSchemas(schema.prefixItems[index], root));
      continue;
    }

    if (schema.items !== undefined) {
      if (Array.isArray(schema.items)) {
        const tuple = schema.items as JsonSchema[];

        if (index < tuple.length) {
          out.push(...resolveSchemas(tuple[index], root));
        } else {
          out.push({});
        }
      } else {
        out.push(...resolveSchemas(schema.items as JsonSchema, root));
      }

      continue;
    }

    out.push({});
  }

  return dedupeSchemas(out);
}

/** Walk the root schema along a document path. */
export function getSchemasAtPath(root: JsonSchemaObject, path: JsonPath): JsonSchemaObject[] {
  let current = resolveSchemas(root, root);

  for (const segment of path) {
    if (current.length === 0) {
      return [];
    }

    if (typeof segment === "number") {
      current = getItemSchemas(
        current.filter((schema) => schemaAllowsType(schema, "array")),
        segment,
        root,
      );
    } else {
      current = getPropertySchemas(
        current.filter((schema) => schemaAllowsType(schema, "object")),
        segment,
        root,
      );
    }
  }

  return current;
}

/* -------------------------------------------------------------------------- */
/* Property enumeration                                                       */
/* -------------------------------------------------------------------------- */

export interface KnownProperty {
  name: string;
  schema: JsonSchemaObject;
  required: boolean;
}

/** Enumerate declared properties across candidate object schemas. */
export function getKnownProperties(
  schemas: JsonSchemaObject[],
  root: JsonSchemaObject,
): KnownProperty[] {
  const byName = new Map<string, KnownProperty>();

  for (const schema of schemas) {
    const required = new Set(schema.required ?? []);

    if (!schema.properties) {
      continue;
    }

    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      const resolved = resolveSchemas(propertySchema, root);
      const effective = resolved[0] ?? {};

      const existing = byName.get(name);

      if (!existing) {
        byName.set(name, {
          name,
          schema: effective,
          required: required.has(name),
        });
      } else if (required.has(name)) {
        existing.required = true;
      }
    }
  }

  return Array.from(byName.values());
}
