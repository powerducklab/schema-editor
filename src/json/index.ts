/**
 * JSON language support for @powerduck/schema-editor.
 */

export {
  buildJsonIndex,
  clearJsonIndexCache,
  getObjectKeys,
  isPropertyKeyNode,
  rangeOfPath,
  rangeOfNode,
  toDisplayPath,
  type JsonIndex,
  type JsonNode,
  type JsonSyntaxError,
} from "./document-index";

export {
  resolveJsonCompletionContext,
  getJsonCompletions,
  getJsonInlineSuggestion,
  clearJsonCompletionCaches,
  type JsonCompletionOptions,
} from "./completion";
