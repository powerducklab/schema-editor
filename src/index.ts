/**
 * @powerduck/schema-editor
 *
 * A schema-aware Monaco editor for JSON, YAML, and JavaScript.
 *
 * Framework-agnostic core:
 *   - JSON Schema resolution ($ref, allOf, anyOf, oneOf)
 *   - Sample generation with caching
 *   - Schema validation (Ajv, draft-04 through 2020-12)
 *
 * Language support:
 *   - json: schema-driven completion + diagnostics
 *   - yaml: schema-driven completion + diagnostics
 *   - javascript: snippet-based ghost completion
 *
 * React component:
 *   import { SchemaEditor } from "@powerduck/schema-editor/react";
 */

export * from "./types";

/* Core */
export {
  isSchemaObject,
  resolveReference,
  resolveSchemas,
  getSchemaTypes,
  jsonTypeOf,
  schemaAllowsType,
  getPropertySchemas,
  getItemSchemas,
  getSchemasAtPath,
  getKnownProperties,
  type KnownProperty,
} from "./core/schema-resolver";

export {
  generateSample,
  generateSampleForSchema,
  clearSampleCache,
  type SampleOptions,
} from "./core/sample";

export {
  validateParsedDocument,
  toEditorDiagnostics,
  type ValidateOptions,
  type SchemaDiagnostic,
} from "./core/diagnostics";

/* JSON */
export {
  buildJsonIndex,
  clearJsonIndexCache,
  getObjectKeys,
  isPropertyKeyNode,
  rangeOfPath as jsonRangeOfPath,
  rangeOfNode as jsonRangeOfNode,
  type JsonIndex,
  type JsonNode,
  type JsonSyntaxError,
} from "./json/document-index";

export {
  resolveJsonCompletionContext,
  getJsonCompletions,
  getJsonInlineSuggestion,
  clearJsonCompletionCaches,
  type JsonCompletionOptions,
} from "./json/completion";

/* YAML */
export {
  buildYamlIndex,
  findCurrentLine,
  getExistingKeysInScope,
  findPreviousContentLine,
  findEnclosingScope,
  resolveContainerAt,
  rangeOfPath as yamlRangeOfPath,
  stripYamlComment,
  getIndent,
  findYamlColon,
  normalizeKey,
  type YamlIndex,
  type YamlLine,
  type YamlScope,
  type YamlNode,
} from "./yaml/document-index";

export {
  resolveYamlCompletionContext,
  getYamlCompletions,
  getYamlInlineSuggestion,
  type YamlCompletionOptions,
  type YamlCompletionContext,
  type YamlCompletionKind,
} from "./yaml/completion";

export { formatYaml } from "./yaml/format";

/* JavaScript */
export {
  resolveJavascriptCompletionContext,
  getJavascriptCompletions,
  getJavascriptInlineSuggestion,
  type JavascriptCompletionOptions,
  type JavascriptCompletionContext,
} from "./javascript/completion";
