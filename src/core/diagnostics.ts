/**
 * Schema-driven diagnostics engine.
 *
 * Uses Ajv (draft-04 through 2020-12) with ajv-formats. Compiled validators
 * are cached by schema identity. Errors are mapped to human-readable messages
 * with fix suggestions. Document location is the responsibility of each
 * language layer (json / yaml), which has access to its own document index.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { isSchemaObject } from "./schema-resolver";

import type { Diagnostic, DiagnosticAction, JsonPath, JsonSchema, JsonSchemaObject } from "../types";

/* -------------------------------------------------------------------------- */
/* Validator cache                                                            */
/* -------------------------------------------------------------------------- */

interface CompiledSchema {
  validate?: ValidateFunction;
  compileError?: string;
}

const compiledCache = new WeakMap<JsonSchemaObject, CompiledSchema>();

function isLegacyDraft(schema: JsonSchemaObject): boolean {
  const id = typeof schema.$schema === "string" ? schema.$schema : "";
  return /draft-0[4-7]/.test(id);
}

function createAjv(legacy: boolean) {
  const options = {
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: true,
    loadSchema: undefined,
  };

  const ajv = legacy ? new Ajv(options) : new Ajv2020(options);

  try {
    addFormats(ajv as never);
  } catch {
    /* Ignore optional runtime failure. */
  }

  return ajv;
}

function compileSchema(schema: JsonSchemaObject): CompiledSchema {
  const cached = compiledCache.get(schema);

  if (cached) {
    return cached;
  }

  let compiled: CompiledSchema;

  try {
    const ajv = createAjv(isLegacyDraft(schema));
    const { $schema, ...rest } = schema;
    const target =
      typeof $schema === "string" && /draft-0[46]/.test($schema) ? rest : schema;

    compiled = { validate: ajv.compile(target) };
  } catch (error) {
    compiled = {
      compileError:
        error instanceof Error ? error.message : "The JSON Schema could not be compiled.",
    };
  }

  compiledCache.set(schema, compiled);
  return compiled;
}

/* -------------------------------------------------------------------------- */
/* Path helpers                                                               */
/* -------------------------------------------------------------------------- */

function decodeJsonPointer(pointer: string, document: unknown): JsonPath {
  let current = document;
  if (!pointer) {
    return [];
  }

  return pointer
    .split("/")
    .slice(1)
    .map((rawSegment) => {
      const decoded = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      const segment = Array.isArray(current) && /^(0|[1-9]\d*)$/.test(decoded) ? Number(decoded) : decoded;
      current = current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, segment)
        ? (current as Record<string | number, unknown>)[segment] : undefined;
      return segment;
    });
}

function toDisplayPath(path: JsonPath): string[] {
  return path.map((segment) => (typeof segment === "number" ? `[${segment}]` : segment));
}

function describePath(path: JsonPath): string {
  return path.length === 0 ? "the document root" : toDisplayPath(path).join(".");
}

/* -------------------------------------------------------------------------- */
/* Ajv error mapping                                                          */
/* -------------------------------------------------------------------------- */

interface MappedError {
  path: JsonPath;
  message: string;
  fix?: string;
  action?: DiagnosticAction;
}

function mapAjvError(error: ErrorObject, document: unknown): MappedError {
  const basePath = decodeJsonPointer(error.instancePath, document);
  const params = (error.params ?? {}) as Record<string, unknown>;

  switch (error.keyword) {
    case "required": {
      const missing = String(params.missingProperty ?? "");
      return {
        path: basePath,
        action: { kind: "add-required", property: missing },
        message: `Missing required property "${missing}".`,
        fix: `Add "${missing}" to ${describePath(basePath)}.`,
      };
    }

    case "additionalProperties": {
      const extra = String(params.additionalProperty ?? "");
      return {
        path: [...basePath, extra],
        message: `Property "${extra}" is not allowed here.`,
        fix: `Remove "${extra}" or rename it to a property declared by the schema.`,
      };
    }

    case "enum": {
      const allowed = Array.isArray(params.allowedValues)
        ? (params.allowedValues as unknown[]).map((value) => JSON.stringify(value)).join(", ")
        : "";
      return {
        path: basePath,
        message: `Value must be one of: ${allowed}.`,
        fix: "Replace the value with one of the allowed values.",
      };
    }

    case "const":
      return {
        path: basePath,
        message: `Value must be exactly ${JSON.stringify(params.allowedValue)}.`,
        fix: "Replace the value with the required constant.",
      };

    case "type": {
      const expected = String(params.type ?? "");
      return {
        path: basePath,
        action: expected === "object" || expected === "array" ? { kind: "replace-null", type: expected } : undefined,
        message: `Value must be of type ${expected}.`,
        fix:
          expected === "array"
            ? `Write ${describePath(basePath)} as a JSON array ([...]).`
            : expected === "object"
              ? `Write ${describePath(basePath)} as a JSON object ({...}).`
              : `Change the value of ${describePath(basePath)} to a ${expected}.`,
      };
    }

    case "format":
      return {
        path: basePath,
        message: `Value must match format "${String(params.format ?? "")}".`,
        fix: `Use a valid ${String(params.format ?? "")} value.`,
      };

    case "pattern":
      return {
        path: basePath,
        message: `Value must match pattern ${String(params.pattern ?? "")}.`,
        fix: "Adjust the value so that it matches the required pattern.",
      };

    default:
      return {
        path: basePath,
        message: error.message
          ? capitalize(error.message)
          : `Schema violation (${error.keyword}).`,
      };
  }
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value[0]!.toUpperCase() + value.slice(1) + (value.endsWith(".") ? "" : ".");
}

/* -------------------------------------------------------------------------- */
/* Deduplication                                                              */
/* -------------------------------------------------------------------------- */

function dedupe(diagnostics: SchemaDiagnostic[]): SchemaDiagnostic[] {
  const seen = new Set<string>();

  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify([diagnostic.path, diagnostic.message]);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface ValidateOptions {
  maxSchemaErrors?: number;
}

export interface SchemaDiagnostic {
  message: string;
  path: JsonPath;
  severity: "error" | "warning";
  source: string;
  fix?: string;
  action?: DiagnosticAction;
}

/**
 * Validate a parsed JSON document against a JSON Schema.
 * Returns diagnostics with semantic paths but no text locations.
 * Each language layer is responsible for converting paths to positions.
 */
export function validateParsedDocument(
  document: unknown,
  schema: JsonSchema | undefined,
  options: ValidateOptions = {},
): SchemaDiagnostic[] {
  if (schema === false) return [{ message: "The schema does not allow any value.", path: [], severity: "error", source: "json-schema" }];
  if (!isSchemaObject(schema)) {
    return [];
  }

  const compiled = compileSchema(schema);

  if (compiled.compileError || !compiled.validate) {
    return [
      {
        message: `The JSON Schema could not be compiled: ${compiled.compileError ?? "unknown error"}`,
        path: [],
        severity: "warning",
        source: "json-schema",
        fix: "Check the schema supplied to the editor.",
      },
    ];
  }

  let valid = false;

  try {
    valid = compiled.validate(document) as boolean;
  } catch (error) {
    return [
      {
        message: error instanceof Error ? error.message : "Schema validation failed.",
        path: [],
        severity: "error",
        source: "json-schema",
      },
    ];
  }

  if (valid) {
    return [];
  }

  const errors = compiled.validate.errors ?? [];
  const maxErrors = options.maxSchemaErrors ?? 100;
  const nestedErrorPaths = new Set<string>();

  for (const error of errors) {
    if (error.keyword !== "oneOf" && error.keyword !== "anyOf" && error.keyword !== "if") {
      nestedErrorPaths.add(error.instancePath);
    }
  }

  const result: SchemaDiagnostic[] = [];

  for (const error of errors.slice(0, maxErrors)) {
    if (
      (error.keyword === "oneOf" || error.keyword === "anyOf" || error.keyword === "if") &&
      nestedErrorPaths.has(error.instancePath)
    ) {
      continue;
    }

    const mapped = mapAjvError(error, document);

    result.push({
      message: mapped.message,
      path: mapped.path,
      severity: "error",
      source: "json-schema",
      fix: mapped.fix,
      action: mapped.action,
    });
  }

  return dedupe(result);
}

/**
 * Convert schema diagnostics to editor diagnostics using a path-to-range
 * locator function provided by the language layer.
 */
export function toEditorDiagnostics(
  diagnostics: SchemaDiagnostic[],
  locate: (path: JsonPath) => { line: number; column: number; endLine: number; endColumn: number },
): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    const range = locate(diagnostic.path);

    return {
      message: diagnostic.message,
      path: toDisplayPath(diagnostic.path),
      ...range,
      severity: diagnostic.severity,
      source: diagnostic.source,
      fix: diagnostic.fix,
      semanticPath: diagnostic.path,
      action: diagnostic.action,
    };
  });
}
