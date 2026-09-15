/**
 * Schema-driven JSON completion engine.
 *
 * Performance optimizations:
 *   - Completion context cache (LRU, max 8 entries).
 *   - Schema resolution cache (WeakMap in schema-resolver).
 *   - Sample generation cache (WeakMap in sample).
 *   - Avoid json-schema-faker for simple scalar completions.
 *
 * Formatting behavior:
 *   - New property completions automatically insert on a new line when needed.
 *   - Enum / default / examples / const values are offered as dropdown choices.
 *   - Empty documents offer a full schema-generated preview as ghost text.
 */

import { getLocation } from "jsonc-parser";

import {
  getItemSchemas,
  getKnownProperties,
  getPropertySchemas,
  getSchemaTypes,
  getSchemasAtPath,
  isSchemaObject,
  resolveSchemas,
  schemaAllowsType,
} from "../core/schema-resolver";

import { generateSample } from "../core/sample";

import {
  buildJsonIndex,
  getObjectKeys,
  isPropertyKeyNode,
  type JsonIndex,
} from "./document-index";

import type {
  CompletionContext,
  CompletionSuggestion,
  CompletionRuntimeCache,
  JsonPath,
  JsonSchema,
  JsonSchemaObject,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface JsonCompletionOptions {
  indentSize?: number;
  maxSampleDepth?: number;
}

const DEFAULT_INDENT = 2;

/* -------------------------------------------------------------------------- */
/* Context cache                                                              */
/* -------------------------------------------------------------------------- */

interface CachedContext {
  text: string;
  offset: number;
  schema: JsonSchema | undefined;
  context: CompletionContext;
}

const completionContextCache = new Map<string, CachedContext>();
const MAX_CONTEXT_CACHE_SIZE = 8;

function contextCacheKey(text: string, offset: number): string {
  return `${text.length}:${offset}:${text.slice(Math.max(0, offset - 32), offset + 32)}`;
}

function getCachedContext(
  text: string,
  offset: number,
  schema: JsonSchema | undefined,
): CompletionContext | undefined {
  const key = contextCacheKey(text, offset);
  const cached = completionContextCache.get(key);

  if (!cached || cached.text !== text || cached.offset !== offset || cached.schema !== schema) {
    return undefined;
  }

  return cached.context;
}

function setCachedContext(
  text: string,
  offset: number,
  schema: JsonSchema | undefined,
  context: CompletionContext,
): void {
  if (completionContextCache.size >= MAX_CONTEXT_CACHE_SIZE) {
    const firstKey = completionContextCache.keys().next().value;

    if (firstKey) {
      completionContextCache.delete(firstKey);
    }
  }

  completionContextCache.set(contextCacheKey(text, offset), {
    text,
    offset,
    schema,
    context,
  });
}

export function clearJsonCompletionCaches(): void {
  completionContextCache.clear();
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_$./@-]/.test(char);
}

function nextNonWhitespace(text: string, from: number): { char: string; offset: number } {
  let offset = from;

  while (offset < text.length && /\s/.test(text[offset]!)) {
    offset += 1;
  }

  return {
    char: offset < text.length ? text[offset]! : "",
    offset,
  };
}

function lineStartAt(text: string, offset: number): number {
  let index = Math.min(offset, text.length);

  while (index > 0 && text[index - 1] !== "\n" && text[index - 1] !== "\r") {
    index -= 1;
  }

  return index;
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = lineStartAt(text, offset);
  const before = text.slice(lineStart, offset);
  const match = before.match(/^[ \t]*/);

  return match ? match[0] : "";
}

function indentMultiline(text: string, indent: string): string {
  if (!indent || !text.includes("\n")) {
    return text;
  }

  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : indent + line))
    .join("\n");
}

function stringify(value: unknown, indentSize: number): string {
  const json = JSON.stringify(value, null, indentSize);
  return json === undefined ? "null" : json;
}

function isPlaceholderContainer(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (value && typeof value === "object") {
    return Object.keys(value as object).length === 0;
  }

  return false;
}

function needsLeadingNewline(text: string, replaceStart: number): boolean {
  const lineStart = lineStartAt(text, replaceStart);
  const beforeOnLine = text.slice(lineStart, replaceStart);
  return /\S/.test(beforeOnLine);
}

function propertyIndent(text: string, replaceStart: number, indentSize: number): string {
  const lineStart = lineStartAt(text, replaceStart);
  const beforeOnLine = text.slice(lineStart, replaceStart);
  const currentIndent = beforeOnLine.match(/^[ \t]*/)?.[0] ?? "";

  /*
   * If the cursor is right after an opening '{' on the same line (e.g.
   * `"license": {|"`), properties inside that object need one more indent
   * level than the key. Detect this by checking for a '{' before the cursor
   * with no intervening '}' on the same line.
   */
  const lastOpenBrace = beforeOnLine.lastIndexOf("{");
  const lastCloseBrace = beforeOnLine.lastIndexOf("}");
  const afterOpeningBrace = lastOpenBrace > lastCloseBrace;

  if (afterOpeningBrace) {
    return currentIndent + " ".repeat(indentSize);
  }

  if (currentIndent.length > 0) {
    return currentIndent;
  }

  let offset = Math.min(replaceStart - 1, text.length - 1);

  while (offset >= 0 && /\s/.test(text[offset]!)) {
    offset -= 1;
  }

  if (offset >= 0) {
    const previousLineStart = lineStartAt(text, offset);
    const previousLine = text.slice(previousLineStart, offset + 1);
    const match = previousLine.match(/^[ \t]*/);

    if (match?.[0]) {
      return match[0];
    }
  }

  return " ".repeat(indentSize);
}

/* -------------------------------------------------------------------------- */
/* Token description                                                          */
/* -------------------------------------------------------------------------- */

interface TokenInfo {
  start: number;
  end: number;
  word: string;
  insideQuotes: boolean;
  node: ReturnType<JsonIndex["findNodeAtOffset"]>;
}

function describeToken(index: JsonIndex, offset: number): TokenInfo {
  const text = index.text;
  const node = index.findNodeAtOffset(offset);

  if (
    node &&
    node.type !== "object" &&
    node.type !== "array" &&
    node.type !== "property" &&
    offset >= node.offset &&
    offset <= node.offset + node.length
  ) {
    const raw = text.slice(node.offset, node.offset + node.length);
    const insideQuotes = node.type === "string";
    const word = insideQuotes ? raw.replace(/^"/, "").replace(/"$/, "") : raw;

    return { start: node.offset, end: node.offset + node.length, word, insideQuotes, node };
  }

  let start = offset;

  while (start > 0 && isIdentifierChar(text[start - 1]!)) {
    start -= 1;
  }

  let end = offset;

  while (end < text.length && isIdentifierChar(text[end]!)) {
    end += 1;
  }

  let insideQuotes = false;

  if (start > 0 && text[start - 1] === '"') {
    start -= 1;
    insideQuotes = true;

    if (text[end] === '"') {
      end += 1;
    }
  }

  const raw = text.slice(start, end);
  const word = insideQuotes ? raw.replace(/^"/, "").replace(/"$/, "") : raw;

  return { start, end, word, insideQuotes, node: undefined };
}

function emptyContext(kind: CompletionContext["kind"], text: string): CompletionContext {
  return {
    kind,
    containerPath: [],
    valuePath: [],
    containerSchemas: [],
    valueSchemas: [],
    existingKeys: [],
    currentWord: "",
    replaceStart: 0,
    replaceEnd: kind === "empty-document" ? text.length : 0,
    insideQuotes: false,
    hasColonAfter: false,
    hasTerminatorAfter: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Context resolution                                                         */
/* -------------------------------------------------------------------------- */

export function resolveJsonCompletionContext(
  text: string,
  offset: number,
  rootSchema: JsonSchema | undefined,
  runtimeCache?: CompletionRuntimeCache,
): CompletionContext {
  if (
    runtimeCache &&
    runtimeCache.offset === offset &&
    runtimeCache.schema === rootSchema &&
    runtimeCache.context
  ) {
    return runtimeCache.context;
  }

  const cached = getCachedContext(text, offset, rootSchema);

  if (cached) {
    return cached;
  }

  const root: JsonSchemaObject = isSchemaObject(rootSchema) ? rootSchema : {};

  if (text.trim().length === 0) {
    const context = emptyContext("empty-document", text);
    context.valueSchemas = resolveSchemas(root, root);
    setCachedContext(text, offset, rootSchema, context);
    return context;
  }

  const index = buildJsonIndex(text);

  if (!index.root) {
    return emptyContext("none", text);
  }

  const location = getLocation(text, offset);
  const token = describeToken(index, offset);

  if (token.node && (token.node.type === "object" || token.node.type === "array")) {
    return emptyContext("none", text);
  }

  const after = nextNonWhitespace(text, token.end);
  const hasColonAfter = after.char === ":";

  const hasTerminatorAfter =
    after.char === "" || after.char === "," || after.char === "}" || after.char === "]";

  /*
   * When the cursor is on whitespace inside an object (blank line, or after
   * a property value before the closing brace), the user is about to type a
   * new property key. jsonc-parser's getLocation is inconsistent here: for
   * the root object it returns path ending with "", but for nested objects it
   * returns the object's own path (no trailing ""). We therefore use
   * findNodeAtOffset to directly detect the container: no token node + the
   * nearest containing node is an object => property-key context.
   *
   * We also re-query getLocation just inside the container's opening brace to
   * obtain a path with a trailing "", which keeps containerPath derivation
   * uniform (slice off the last segment).
   */
  let effectiveLocation = location;
  let insideObjectBlank = false;

  if (!token.node) {
    const containerNode = index.findNodeAtOffset(offset);
    if (
      containerNode &&
      containerNode.type === "object" &&
      offset >= containerNode.offset &&
      offset <= containerNode.offset + containerNode.length
    ) {
      insideObjectBlank = true;
      effectiveLocation = getLocation(text, containerNode.offset + 1);
    }
  }

  const onKey =
    location.isAtPropertyKey ||
    isPropertyKeyNode(token.node) ||
    (!token.node && hasColonAfter) ||
    insideObjectBlank;

  let context: CompletionContext;

  if (onKey) {
    const containerPath = effectiveLocation.path.slice(0, -1) as JsonPath;
    const containerNode = index.findNode(containerPath);

    if (containerNode && containerNode.type !== "object") {
      return emptyContext("none", text);
    }

    const containerSchemas = getSchemasAtPath(root, containerPath).filter((schema) =>
      schemaAllowsType(schema, "object"),
    );

    const existingKeys = getObjectKeys(containerNode).filter((key) => key !== token.word);

    /*
     * When the cursor is on whitespace inside an object, token.start/end may
     * point at the previous token (on a different line). Use the cursor offset
     * so that propertyIndent and insertText positioning use the correct line.
     */
    const effectiveReplaceStart = insideObjectBlank ? offset : token.start;
    const effectiveReplaceEnd = insideObjectBlank ? offset : token.end;

    context = {
      kind: "property-key",
      containerPath,
      valuePath: effectiveLocation.path as JsonPath,
      containerSchemas,
      valueSchemas: [],
      existingKeys,
      currentWord: token.word,
      replaceStart: effectiveReplaceStart,
      replaceEnd: effectiveReplaceEnd,
      insideQuotes: token.insideQuotes,
      hasColonAfter,
      hasTerminatorAfter,
    };

    setCachedContext(text, offset, rootSchema, context);
    return context;
  }

  const valuePath = location.path as JsonPath;

  if (valuePath.length === 0) {
    return emptyContext("none", text);
  }

  const containerPath = valuePath.slice(0, -1);
  const lastSegment = valuePath[valuePath.length - 1];

  const kind: CompletionContext["kind"] =
    typeof lastSegment === "number" ? "array-item" : "property-value";

  const containerSchemas = getSchemasAtPath(root, containerPath);

  const valueSchemas =
    kind === "array-item"
      ? (() => {
          const arraySchemas = containerSchemas.filter((schema) =>
            schemaAllowsType(schema, "array"),
          );
          return getItemSchemas(arraySchemas, lastSegment as number, root);
        })()
      : getPropertySchemas(
          containerSchemas.filter((schema) => schemaAllowsType(schema, "object")),
          String(lastSegment),
          root,
        );

  const containerNode = index.findNode(containerPath);

  context = {
    kind,
    containerPath,
    valuePath,
    containerSchemas,
    valueSchemas,
    existingKeys: getObjectKeys(containerNode),
    currentWord: token.word,
    replaceStart: token.start,
    replaceEnd: token.end,
    insideQuotes: token.insideQuotes,
    hasColonAfter,
    hasTerminatorAfter,
  };

  setCachedContext(text, offset, rootSchema, context);
  return context;
}

/* -------------------------------------------------------------------------- */
/* Placeholder                                                                */
/* -------------------------------------------------------------------------- */

interface Placeholder {
  text: string;
  caretOffset: number;
}

function placeholderFor(
  schema: JsonSchemaObject,
  root: JsonSchemaObject,
  _indentSize: number,
): Placeholder {
  const explicit = firstDefined(
    schema.const,
    schema.default,
    Array.isArray(schema.examples) && schema.examples.length > 0
      ? schema.examples[0]
      : undefined,
    Array.isArray(schema.enum) && schema.enum.length > 0 ? schema.enum[0] : undefined,
  );

  if (explicit !== undefined) {
    const text = JSON.stringify(explicit);
    return { text, caretOffset: text.length };
  }

  const types = getSchemaTypes(schema);
  const type = types[0];

  /*
   * For strings with a format, generate a meaningful sample value
   * (e.g. uri -> "https://example.com", email -> "user@example.com").
   * generateSample is cached via WeakMap, so this is cheap.
   */
  if (type === "string" && schema.format) {
    try {
      const sample = generateSample(schema, root);
      if (typeof sample === "string" && sample.length > 0) {
        const text = JSON.stringify(sample);
        return { text, caretOffset: text.length };
      }
    } catch {
      /* Fall through to empty string placeholder. */
    }
  }

  switch (type) {
    case "object":
      return { text: "{}", caretOffset: 1 };
    case "array":
      return { text: "[]", caretOffset: 1 };
    case "number":
    case "integer":
      return { text: "0", caretOffset: 1 };
    case "boolean":
      return { text: "false", caretOffset: 5 };
    case "null":
      return { text: "null", caretOffset: 4 };
    case "string":
      return { text: '""', caretOffset: 1 };
    default:
      return { text: '""', caretOffset: 1 };
  }
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

/* -------------------------------------------------------------------------- */
/* Suggestion builders                                                        */
/* -------------------------------------------------------------------------- */

function describeSchema(schema: JsonSchemaObject): string | undefined {
  const parts: string[] = [];
  const types = getSchemaTypes(schema);

  if (types.length > 0) {
    parts.push(types.join(" | "));
  }

  if (schema.format) {
    parts.push(schema.format);
  }

  if (schema.title) {
    parts.unshift(schema.title);
  }

  return parts.length > 0 ? parts.join(" \u00b7 ") : undefined;
}

function buildKeySuggestions(
  context: CompletionContext,
  root: JsonSchemaObject,
  text: string,
  options: JsonCompletionOptions,
): CompletionSuggestion[] {
  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  const existing = new Set(context.existingKeys);

  const properties = getKnownProperties(context.containerSchemas, root).filter(
    (property) => !existing.has(property.name),
  );

  const after = nextNonWhitespace(text, context.replaceEnd);

  const needsComma =
    !context.hasColonAfter && !context.hasTerminatorAfter && after.char !== "";

  const leadingNewline = needsLeadingNewline(text, context.replaceStart);
  const indent = propertyIndent(text, context.replaceStart, indentSize);

  return properties.map((property) => {
    const quotedKey = JSON.stringify(property.name);
    const placeholder = placeholderFor(property.schema, root, indentSize);
    const prefix = leadingNewline ? `\n${indent}` : "";
    const valueText = indentMultiline(placeholder.text, indent);

    let insertText = `${prefix}${quotedKey}`;
    let caretOffset = insertText.length;

    if (!context.hasColonAfter) {
      insertText += `: ${valueText}`;

      caretOffset =
        prefix.length +
        quotedKey.length +
        2 +
        (placeholder.text.includes("\n") ? valueText.length : placeholder.caretOffset);

      if (needsComma) {
        insertText += ",";
      }
    }

    return {
      label: property.name,
      detail: describeSchema(property.schema),
      documentation: property.schema.description,
      insertText,
      caretOffset,
      filterText: context.insideQuotes ? quotedKey : property.name,
      kind: "property",
      sortText: `${property.required ? "0" : "1"}_${property.name}`,
      deprecated: property.schema.deprecated === true,
    };
  });
}

function buildValueSuggestions(
  context: CompletionContext,
  root: JsonSchemaObject,
  text: string,
  options: JsonCompletionOptions,
): CompletionSuggestion[] {
  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  const indent = lineIndentAt(text, context.replaceStart);

  const suggestions: CompletionSuggestion[] = [];
  const seen = new Set<string>();

  const push = (
    value: unknown,
    label: string | undefined,
    detail: string,
    kind: CompletionSuggestion["kind"],
    sortPrefix: string,
    documentation?: string,
  ): void => {
    const json = indentMultiline(stringify(value, indentSize), indent);

    if (seen.has(json)) {
      return;
    }

    seen.add(json);

    const isContainer = typeof value === "object" && value !== null;

    suggestions.push({
      label: label ?? (json.length > 60 ? `${json.slice(0, 57)}...` : json),
      detail,
      documentation,
      insertText: json,
      caretOffset: isContainer && isPlaceholderContainer(value) ? 1 : json.length,
      filterText: json,
      kind,
      sortText: `${sortPrefix}_${label ?? json}`,
    });
  };

  for (const schema of context.valueSchemas) {
    if (schema.const !== undefined) {
      push(schema.const, undefined, "const", "value", "0", schema.description);
    }

    if (Array.isArray(schema.enum)) {
      for (const value of schema.enum) {
        push(value, undefined, "enum", "value", "0", schema.description);
      }
    }

    if (schema.default !== undefined) {
      push(schema.default, undefined, "default", "value", "1", schema.description);
    }

    if (Array.isArray(schema.examples)) {
      for (const example of schema.examples.slice(0, 5)) {
        push(example, undefined, "example", "value", "2", schema.description);
      }
    }

    const types = getSchemaTypes(schema);

    if (types.includes("boolean")) {
      push(true, undefined, "boolean", "value", "3");
      push(false, undefined, "boolean", "value", "3");
    }

    if (types.includes("null")) {
      push(null, undefined, "null", "value", "4");
    }

    if (types.includes("object") || types.includes("array")) {
      const sample = generateSample(schema, root, options);

      if (
        sample !== undefined &&
        sample !== null &&
        typeof sample === "object" &&
        (Array.isArray(sample) ? sample.length > 0 : Object.keys(sample).length > 0)
      ) {
        push(
          sample,
          `${schema.title ?? (types.includes("array") ? "Array" : "Object")} (sample)`,
          "sample from schema",
          "snippet",
          "5",
          schema.description,
        );
      }

      if (types.includes("object")) {
        push({}, "{}", "empty object", "snippet", "6");
      }

      if (types.includes("array")) {
        push([], "[]", "empty array", "snippet", "6");
      }
    }

    if (
      types.includes("string") &&
      schema.const === undefined &&
      !Array.isArray(schema.enum) &&
      schema.format
    ) {
      const sample = generateSample(schema, root, options);

      if (typeof sample === "string" && sample) {
        push(sample, undefined, `${schema.format} (example)`, "value", "5", schema.description);
      }
    }
  }

  const after = nextNonWhitespace(text, context.replaceEnd);

  const needsComma =
    !context.hasTerminatorAfter && after.char !== "" && after.char !== ":";

  if (needsComma) {
    for (const suggestion of suggestions) {
      suggestion.insertText += ",";
    }
  }

  return suggestions;
}

function buildDocumentPreview(
  root: JsonSchemaObject,
  options: JsonCompletionOptions,
): CompletionSuggestion[] {
  const resolved = resolveSchemas(root, root)[0] ?? root;
  const sample = generateSample(resolved, root, options);

  if (sample === undefined) {
    return [];
  }

  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  const json = stringify(sample, indentSize);

  return [
    {
      label: root.title ? `${root.title} (preview)` : "Document preview from schema",
      detail: "Generated from the JSON Schema",
      documentation: root.description,
      insertText: json,
      caretOffset: json.length,
      filterText: json,
      kind: "snippet",
      sortText: "0",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function getJsonCompletions(
  text: string,
  context: CompletionContext,
  rootSchema: JsonSchema | undefined,
  options: JsonCompletionOptions = {},
): CompletionSuggestion[] {
  const root: JsonSchemaObject = isSchemaObject(rootSchema) ? rootSchema : {};

  switch (context.kind) {
    case "empty-document":
      return buildDocumentPreview(root, options);
    case "property-key":
      return buildKeySuggestions(context, root, text, options);
    case "property-value":
    case "array-item":
      return buildValueSuggestions(context, root, text, options);
    default:
      return [];
  }
}

export function getJsonInlineSuggestion(
  text: string,
  context: CompletionContext,
  rootSchema: JsonSchema | undefined,
  options: JsonCompletionOptions = {},
): CompletionSuggestion | undefined {
  const suggestions = getJsonCompletions(text, context, rootSchema, options);

  if (suggestions.length === 0) {
    return undefined;
  }

  if (context.kind === "empty-document") {
    return suggestions[0];
  }

  /*
   * Do not use newline-prefixed property suggestions as inline ghost text.
   * Ghost text cannot safely represent structural insertion before the cursor.
   */
  const candidates = suggestions.filter((suggestion) => !suggestion.insertText.startsWith("\n"));

  const typed = context.insideQuotes ? `"${context.currentWord}` : context.currentWord;

  const sorted = [...candidates].sort((a, b) =>
    (a.sortText ?? "").localeCompare(b.sortText ?? ""),
  );

  const match = sorted.find((suggestion) => {
    const candidate = suggestion.filterText ?? suggestion.label;
    return typed.length === 0 || candidate.startsWith(typed);
  });

  if (!match) {
    return undefined;
  }

  const candidate = match.insertText;

  if (typed.length > 0 && !candidate.startsWith(typed)) {
    return undefined;
  }

  return match;
}
