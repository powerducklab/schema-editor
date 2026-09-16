/**
 * Core entry point for @powerduck/schema-editor.
 *
 * Framework-agnostic utilities that can be used without React or Monaco:
 *   - Schema resolution ($ref, allOf, anyOf, oneOf)
 *   - Sample generation with caching
 *   - Schema validation (Ajv)
 */

export * from "../types";

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
} from "./schema-resolver";

export {
  generateSample,
  generateSampleForSchema,
  clearSampleCache,
  type SampleOptions,
} from "./sample";

export {
  validateParsedDocument,
  toEditorDiagnostics,
  type ValidateOptions,
  type SchemaDiagnostic,
} from "./diagnostics";

export { getDiagnosticEdits } from "./diagnostic-fix";
