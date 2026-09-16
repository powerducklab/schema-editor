/**
 * Shared types for @powerduck/schema-editor.
 *
 * The editor is schema-agnostic: any JSON Schema (draft-04 through 2020-12)
 * can be supplied, including but not limited to the OpenAPI document schema.
 */

/* -------------------------------------------------------------------------- */
/* JSON Schema                                                                */
/* -------------------------------------------------------------------------- */

export type JsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

/**
 * A permissive JSON Schema object. Only the keywords the editor reasons about
 * are typed; everything else is kept as `unknown` so that arbitrary
 * vocabularies and vendor extensions pass through untouched.
 */
export interface JsonSchemaObject {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $anchor?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;

  /**
   * JSON Schema type. Declared as `string | string[]` rather than a strict
   * union so that plain object literals passed by consumers are assignable
   * without `as const`. Internal code should narrow via `getSchemaTypes()`.
   */
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  examples?: readonly unknown[];
  enum?: readonly unknown[];
  const?: unknown;
  format?: string;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;

  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema;
  required?: readonly string[];
  propertyNames?: JsonSchema;

  items?: JsonSchema;
  prefixItems?: readonly JsonSchema[];

  allOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  oneOf?: readonly JsonSchema[];
  not?: JsonSchema;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;

  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  [keyword: string]: unknown;
}

export type JsonSchema = boolean | JsonSchemaObject;

/* -------------------------------------------------------------------------- */
/* Document addressing                                                        */
/* -------------------------------------------------------------------------- */

/** A path into a JSON document. Numbers address array items. */
export type JsonPath = Array<string | number>;

/** 1-based text position. */
export interface TextPosition {
  line: number;
  column: number;
}

/* -------------------------------------------------------------------------- */
/* Editor languages                                                           */
/* -------------------------------------------------------------------------- */

export type EditorLanguage = "json" | "yaml" | "javascript";

export type EditorTheme = "light" | "dark";

/* -------------------------------------------------------------------------- */
/* Completion                                                                 */
/* -------------------------------------------------------------------------- */

export type CompletionKind =
  /** Document is blank; offer a full preview built from the schema. */
  | "empty-document"
  /** Cursor sits where a property key belongs. */
  | "property-key"
  /** Cursor sits where a property value belongs. */
  | "property-value"
  /** Cursor sits where an array item belongs. */
  | "array-item"
  /** Cursor is somewhere completion does not apply. */
  | "none";

export interface CompletionContext {
  kind: CompletionKind;

  /** Path of the container (object or array) that owns the cursor. */
  containerPath: JsonPath;

  /** Path of the value under the cursor, if any. */
  valuePath: JsonPath;

  /** Resolved schemas that apply to the container. */
  containerSchemas: JsonSchemaObject[];

  /** Resolved schemas that apply to the value under the cursor. */
  valueSchemas: JsonSchemaObject[];

  /** Property names already present in the owning object. */
  existingKeys: string[];

  /** Raw text of the token being edited (without quotes), if any. */
  currentWord: string;

  /** Absolute offsets of the text that a completion should replace. */
  replaceStart: number;
  replaceEnd: number;

  /** True when the token being edited is already wrapped in quotes. */
  insideQuotes: boolean;

  /** True when a colon already follows the key token (JSON only). */
  hasColonAfter: boolean;

  /** True when a terminator already follows the edited token (JSON only). */
  hasTerminatorAfter: boolean;
}

export interface CompletionSuggestion {
  label: string;
  detail?: string;
  documentation?: string;

  /** Full text to write into the replacement range. */
  insertText: string;

  /** Where the caret should land relative to the start of insertText. */
  caretOffset?: number;

  /** Text the editor should match the typed prefix against. */
  filterText?: string;

  kind: "property" | "value" | "snippet";
  sortText?: string;
  deprecated?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

export type DiagnosticAction =
  | { kind: "add-required"; property: string }
  | { kind: "replace-null"; type: "object" | "array" };

export interface Diagnostic {
  semanticPath?: JsonPath;
  action?: DiagnosticAction;
  message: string;
  path: string[];

  /** 1-based. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;

  severity: "error" | "warning";
  source: string;

  /** Human-readable fix suggestion. */
  fix?: string;
}

/* -------------------------------------------------------------------------- */
/* Runtime cache                                                              */
/* -------------------------------------------------------------------------- */

export interface CompletionRuntimeCache {
  /** Source text must match before reusing a completion context. */
  text?: string;
  versionId: number;
  offset: number;
  schema: JsonSchema | undefined;
  context: CompletionContext | null;
}

export function createCompletionRuntimeCache(): CompletionRuntimeCache {
  return {
    versionId: -1,
    offset: -1,
    schema: undefined,
    context: null,
  };
}
