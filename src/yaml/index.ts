/**
 * YAML language support for @powerduck/schema-editor.
 */

export {
  buildYamlIndex,
  findCurrentLine,
  getExistingKeysInScope,
  findPreviousContentLine,
  findEnclosingScope,
  resolveContainerAt,
  rangeOfPath,
  stripYamlComment,
  getIndent,
  findYamlColon,
  normalizeKey,
  findYamlColonSpacingIssues,
  type YamlIndex,
  type YamlLine,
  type YamlScope,
  type YamlNode,
  type YamlColonSpacingIssue,
} from "./document-index";

export {
  resolveYamlCompletionContext,
  getYamlCompletions,
  getYamlInlineSuggestion,
  type YamlCompletionOptions,
  type YamlCompletionContext,
  type YamlCompletionKind,
} from "./completion";

export { formatYaml } from "./format";
