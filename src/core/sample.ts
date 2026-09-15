/**
 * Schema-driven sample generation with identity-keyed caching.
 *
 * Performance strategy:
 *   - WeakMap cache keyed by schema object identity (not lossy string keys).
 *   - Fast path for simple scalar schemas avoids json-schema-faker.
 *   - Explicit values (const / default / examples / enum) never invoke faker.
 *   - Fallback generator handles schemas that faker rejects.
 */

import { generateSync } from "json-schema-faker";

import {
  getItemSchemas,
  getSchemaTypes,
  isSchemaObject,
  resolveSchemas,
} from "./schema-resolver";

import type { JsonSchema, JsonSchemaObject, JsonSchemaType } from "../types";

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface SampleOptions {
  indentSize?: number;
  maxSampleDepth?: number;
}

const DEFAULT_MAX_DEPTH = 5;

/* -------------------------------------------------------------------------- */
/* Sample cache                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Sample cache keyed by schema object identity.
 *
 * Using the schema object itself as the WeakMap key guarantees that samples
 * generated for one schema can never be reused by another unrelated schema
 * that happens to share the same title/type.
 */
const sampleCache = new WeakMap<JsonSchemaObject, Map<number, unknown>>();

function getSampleCache(schema: JsonSchemaObject): Map<number, unknown> {
  let cache = sampleCache.get(schema);

  if (!cache) {
    cache = new Map<number, unknown>();
    sampleCache.set(schema, cache);
  }

  return cache;
}

export function clearSampleCache(): void {
  /* WeakMap cannot be cleared directly; rely on GC. Exposed for API symmetry. */
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function scalarSample(type: JsonSchemaType, schema: JsonSchemaObject): unknown {
  switch (type) {
    case "string":
      return stringSampleForFormat(schema.format);

    case "number":
    case "integer":
      return schema.minimum ?? 0;

    case "boolean":
      return false;

    case "null":
      return null;

    default:
      return "";
  }
}

function stringSampleForFormat(format: string | undefined): string {
  switch (format) {
    case "date":
      return "2025-01-01";

    case "date-time":
      return "2025-01-01T00:00:00Z";

    case "time":
      return "00:00:00Z";

    case "email":
      return "user@example.com";

    case "uri":
    case "url":
    case "uri-reference":
      return "https://example.com";

    case "uuid":
      return "00000000-0000-0000-0000-000000000000";

    case "hostname":
      return "example.com";

    case "ipv4":
      return "192.0.2.1";

    case "ipv6":
      return "2001:db8::1";

    default:
      return "string";
  }
}

/**
 * Derive a human-readable placeholder key name for a dynamic-map schema.
 * Uses propertyNames.pattern when it contains a recognizable template,
 * otherwise falls back to "key".
 */
function derivePlaceholderKey(schema: JsonSchemaObject): string {
  const pattern =
    typeof schema.propertyNames === "object" && schema.propertyNames !== null
      ? schema.propertyNames.pattern
      : undefined;

  if (!pattern) {
    return "key";
  }

  /* Common OpenAPI patterns: paths use "/path", callbacks use expressions. */
  if (pattern.startsWith("^/") || pattern.includes("\\/")) {
    return "/path";
  }

  if (pattern.includes("x-") || pattern.includes("^x")) {
    return "x-extension";
  }

  return "key";
}

/* -------------------------------------------------------------------------- */
/* Fallback generator                                                         */
/* -------------------------------------------------------------------------- */

function generateFallbackSample(
  schema: JsonSchemaObject,
  root: JsonSchemaObject,
  depth: number,
  maxDepth: number,
): unknown {
  const explicit = firstDefined(
    schema.const,
    schema.default,
    Array.isArray(schema.examples) ? schema.examples[0] : undefined,
    Array.isArray(schema.enum) ? schema.enum[0] : undefined,
  );

  if (explicit !== undefined) {
    return explicit;
  }

  const resolved = resolveSchemas(schema, root);
  const effective = resolved[0];

  if (!effective) {
    return undefined;
  }

  if (effective !== schema) {
    return generateFallbackSample(effective, root, depth, maxDepth);
  }

  const types = getSchemaTypes(effective);
  const type: JsonSchemaType = types[0] ?? "object";

  if (depth >= maxDepth) {
    return type === "array" ? [] : type === "object" ? {} : scalarSample(type, effective);
  }

  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const required = new Set(effective.required ?? []);

      let count = 0;
      const MAX_OPTIONAL_PROPERTIES = 3;

      for (const [name, propertySchema] of Object.entries(effective.properties ?? {})) {
        if (!required.has(name) && count >= MAX_OPTIONAL_PROPERTIES) {
          continue;
        }

        const resolvedProperty = resolveSchemas(propertySchema, root)[0];

        if (!resolvedProperty) {
          continue;
        }

        out[name] = generateFallbackSample(resolvedProperty, root, depth + 1, maxDepth);
        count += 1;
      }

      /*
       * Dynamic maps (additionalProperties with no fixed properties) need a
       * placeholder key so the sample is not an empty object. The placeholder
       * name is derived from propertyNames.pattern when available, otherwise
       * a generic "key" is used.
       */
      if (
        count === 0 &&
        effective.additionalProperties !== undefined &&
        effective.additionalProperties !== false
      ) {
        const placeholderKey = derivePlaceholderKey(effective);
        const additionalSchema =
          effective.additionalProperties === true
            ? {}
            : resolveSchemas(effective.additionalProperties, root)[0] ?? {};

        out[placeholderKey] = generateFallbackSample(
          additionalSchema,
          root,
          depth + 1,
          maxDepth,
        );
      }

      return out;
    }

    case "array": {
      const itemSchemas = getItemSchemas([effective], 0, root);

      if (itemSchemas.length === 0) {
        return [];
      }

      const firstItem = itemSchemas[0];

      if (!firstItem) {
        return [];
      }

      return [generateFallbackSample(firstItem, root, depth + 1, maxDepth)];
    }

    default:
      return scalarSample(type, effective);
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function generateSample(
  schema: JsonSchemaObject,
  root: JsonSchemaObject,
  options: SampleOptions = {},
): unknown {
  const maxDepth = options.maxSampleDepth ?? DEFAULT_MAX_DEPTH;

  const cache = getSampleCache(schema);

  if (cache.has(maxDepth)) {
    return cache.get(maxDepth);
  }

  /*
   * Explicit values should never invoke json-schema-faker.
   */
  const explicit = firstDefined(
    schema.const,
    schema.default,
    Array.isArray(schema.examples) ? schema.examples[0] : undefined,
    Array.isArray(schema.enum) ? schema.enum[0] : undefined,
  );

  if (explicit !== undefined) {
    cache.set(maxDepth, explicit);
    return explicit;
  }

  const types = getSchemaTypes(schema);

  /*
   * Fast path for simple scalar schemas.
   */
  if (types.length === 1) {
    const type = types[0];

    if (
      type === "string" ||
      type === "number" ||
      type === "integer" ||
      type === "boolean" ||
      type === "null"
    ) {
      const value = scalarSample(type, schema);
      cache.set(maxDepth, value);
      return value;
    }
  }

  let value: unknown;

  try {
    /*
     * json-schema-faker's types require mutable arrays, but our schema type
     * uses readonly arrays for consumer flexibility. The library does not
     * mutate its input, so this cast is safe.
     */
    value = generateSync(schema as Parameters<typeof generateSync>[0], {
      seed: 999,
      useExamplesValue: true,
      useDefaultValue: true,
      alwaysFakeOptionals: false,
      optionalsProbability: 0.15,
      fillProperties: false,
      maxDepth,
      maxDefaultItems: 1,
      failOnInvalidTypes: false,
    });
  } catch {
    value = undefined;
  }

  if (value === undefined) {
    value = generateFallbackSample(schema, root, 0, maxDepth);
  }

  cache.set(maxDepth, value);
  return value;
}

/**
 * Generate a sample for a schema that may be undefined or boolean.
 * Returns undefined when the schema does not accept any value.
 */
export function generateSampleForSchema(
  schema: JsonSchema | undefined,
  root: JsonSchemaObject,
  options: SampleOptions = {},
): unknown {
  if (schema === undefined || schema === false) {
    return undefined;
  }

  if (schema === true) {
    return {};
  }

  if (!isSchemaObject(schema)) {
    return undefined;
  }

  return generateSample(schema, root, options);
}
