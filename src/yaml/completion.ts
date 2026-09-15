/**
 * Schema-driven YAML completion engine.
 *
 * Unlike the original OpenAPI-specific implementation, this engine is driven
 * entirely by the supplied JSON Schema. It enumerates declared properties,
 * resolves value schemas, and offers enum / default / examples / sample
 * completions — the same completion model as the JSON engine.
 */

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
  buildYamlIndex,
  findCurrentLine,
  getExistingKeysInScope,
  resolveContainerAt,
  type YamlLine,
} from "./document-index";

import type {
  CompletionSuggestion,
  JsonPath,
  JsonSchema,
  JsonSchemaObject,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface YamlCompletionOptions {
  indentSize?: number;
  maxSampleDepth?: number;
}

const DEFAULT_INDENT = 2;

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export type YamlCompletionKind = "key" | "value" | "sequence-item" | "empty-document" | "none";

export interface YamlCompletionContext {
  kind: YamlCompletionKind;
  line: YamlLine;
  prefix: string;
  path: JsonPath;
  parentPath: JsonPath;
  containerSchemas: JsonSchemaObject[];
  valueSchemas: JsonSchemaObject[];
  existingKeys: Set<string>;
  indent: number;
  inSequenceItem: boolean;
  /** 1-based column of the cursor, used for afterCursor checks. */
  cursorColumn: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_$./@-]/.test(char);
}

function extractPrefix(text: string, column: number): string {
  let end = Math.min(column, text.length);

  while (end > 0 && /\s/.test(text[end - 1]!)) {
    end -= 1;
  }

  let start = end;

  while (start > 0 && isIdentifierChar(text[start - 1]!)) {
    start -= 1;
  }

  return text.slice(start, end);
}

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

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

/**
 * Remove leading whitespace from the first line of a multi-line YAML block.
 * Used when the block is inserted at a position where the cursor already sits
 * at the target column (for example, after `- ` in a sequence item).
 */
function stripFirstLineIndent(text: string): string {
  const newline = text.indexOf("\n");

  if (newline === -1) {
    return text.trimStart();
  }

  return text.slice(0, newline).trimStart() + text.slice(newline);
}

/* -------------------------------------------------------------------------- */
/* YAML value formatting                                                      */
/* -------------------------------------------------------------------------- */

function toYamlScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    if (value === "" || /[:#\[\]{}&*!|>'"%@`,]/.test(value) || /^\s|\s$/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }

  return JSON.stringify(value);
}

function toYamlBlock(value: unknown, indent: string, indentSize: number): string {
  if (value === null || typeof value !== "object") {
    return toYamlScalar(value);
  }

  const childIndent = indent + " ".repeat(indentSize);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }

    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          /*
           * Object properties inside a sequence item align with the content
           * after "- ". The first line sits right after "- " so its leading
           * whitespace must be stripped; subsequent lines keep the indent.
           */
          const block = toYamlBlock(item, indent + "  ", indentSize);
          const newline = block.indexOf("\n");

          if (newline === -1) {
            return `${indent}- ${block.trimStart()}`;
          }

          const firstLine = block.slice(0, newline).trimStart();
          const rest = block.slice(newline);

          return `${indent}- ${firstLine}${rest}`;
        }
        return `${indent}- ${toYamlScalar(item)}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, val]) => {
      if (val !== null && typeof val === "object") {
        const block = toYamlBlock(val, childIndent, indentSize);
        return `${indent}${key}:\n${block}`;
      }
      return `${indent}${key}: ${toYamlScalar(val)}`;
    })
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Context resolution                                                         */
/* -------------------------------------------------------------------------- */

export function resolveYamlCompletionContext(
  text: string,
  lineNumber: number,
  column: number,
  rootSchema: JsonSchema | undefined,
): YamlCompletionContext {
  const root: JsonSchemaObject = isSchemaObject(rootSchema) ? rootSchema : {};
  const index = buildYamlIndex(text);
  const line = findCurrentLine(index, lineNumber);
  const prefix = extractPrefix(line.text, column - line.indent);

  if (text.trim().length === 0) {
    return {
      kind: "empty-document",
      line,
      prefix,
      path: [],
      parentPath: [],
      containerSchemas: resolveSchemas(root, root),
      valueSchemas: [],
      existingKeys: new Set(),
      indent: 0,
      inSequenceItem: false,
      cursorColumn: column,
    };
  }

  const indent = line.indent;
  const container = resolveContainerAt(index, lineNumber, indent);

  const containerSchemas = getSchemasAtPath(root, container.path).filter((schema) =>
    container.kind === "object"
      ? schemaAllowsType(schema, "object")
      : schemaAllowsType(schema, "array"),
  );

  const existingKeys = getExistingKeysInScope(index, container.path);

  /*
   * Determine whether the cursor is on a key or value position.
   * A key position: line has no colon, or cursor is at or before the colon.
   * A value position: line has a colon and cursor is strictly after it.
   */
  const colonIndex = line.hasColon ? line.raw.indexOf(":") : -1;
  const isValuePosition = colonIndex >= 0 && column > colonIndex;

  if (line.isSequence && !line.hasColon) {
    const itemSchemas = getItemSchemas(
      containerSchemas.filter((schema) => schemaAllowsType(schema, "array")),
      line.sequenceIndex ?? 0,
      root,
    );

    return {
      kind: "sequence-item",
      line,
      prefix,
      path: line.path,
      parentPath: container.path,
      containerSchemas,
      valueSchemas: itemSchemas,
      existingKeys,
      indent,
      inSequenceItem: true,
      cursorColumn: column,
    };
  }

  if (isValuePosition && line.key) {
    const valueSchemas = getPropertySchemas(
      containerSchemas.filter((schema) => schemaAllowsType(schema, "object")),
      line.key,
      root,
    );

    /*
     * At a value position the prefix is everything after the colon with
     * leading whitespace stripped. This differs from key positions where
     * only identifier characters are extracted.
     */
    const valuePrefix = line.raw.slice(colonIndex + 1).trimStart();

    return {
      kind: "value",
      line,
      prefix: valuePrefix,
      path: line.path,
      parentPath: container.path,
      containerSchemas,
      valueSchemas,
      existingKeys,
      indent,
      inSequenceItem: false,
      cursorColumn: column,
    };
  }

  return {
    kind: "key",
    line,
    prefix,
    path: line.path,
    parentPath: container.path,
    containerSchemas,
    valueSchemas: [],
    existingKeys,
    indent,
    inSequenceItem: false,
    cursorColumn: column,
  };
}

/* -------------------------------------------------------------------------- */
/* Suggestion builders                                                        */
/* -------------------------------------------------------------------------- */

function buildKeySuggestions(
  context: YamlCompletionContext,
  root: JsonSchemaObject,
  _options: YamlCompletionOptions,
): CompletionSuggestion[] {
  const properties = getKnownProperties(context.containerSchemas, root).filter(
    (property) => !context.existingKeys.has(property.name),
  );

  return properties.map((property) => {
    const types = getSchemaTypes(property.schema);
    const isContainer = types.includes("object") || types.includes("array");

    let insertText = `${property.name}:`;
    let caretOffset = insertText.length;

    if (isContainer) {
      insertText += "\n";
      caretOffset = insertText.length;
    } else {
      const explicit = firstDefined(
        property.schema.const,
        property.schema.default,
        Array.isArray(property.schema.examples) && property.schema.examples.length > 0
          ? property.schema.examples[0]
          : undefined,
        Array.isArray(property.schema.enum) && property.schema.enum.length > 0
          ? property.schema.enum[0]
          : undefined,
      );

      if (explicit !== undefined) {
        insertText += ` ${toYamlScalar(explicit)}`;
        caretOffset = insertText.length;
      } else if (
        types.includes("string") &&
        property.schema.format
      ) {
        /* Generate a meaningful sample for formatted strings (uri, email, etc.). */
        try {
          const sample = generateSample(property.schema, root);
          if (typeof sample === "string" && sample.length > 0) {
            insertText += ` ${toYamlScalar(sample)}`;
            caretOffset = insertText.length;
          } else {
            insertText += " ";
            caretOffset = insertText.length;
          }
        } catch {
          insertText += " ";
          caretOffset = insertText.length;
        }
      } else {
        insertText += " ";
        caretOffset = insertText.length;
      }
    }

    return {
      label: property.name,
      detail: describeSchema(property.schema),
      documentation: property.schema.description,
      insertText,
      caretOffset,
      filterText: property.name,
      kind: "property",
      sortText: `${property.required ? "0" : "1"}_${property.name}`,
      deprecated: property.schema.deprecated === true,
    };
  });
}

function buildValueSuggestions(
  context: YamlCompletionContext,
  root: JsonSchemaObject,
  options: YamlCompletionOptions,
): CompletionSuggestion[] {
  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  const indent = " ".repeat(context.indent + indentSize);

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
    let insertText: string;

    if (value !== null && typeof value === "object") {
      insertText = "\n" + toYamlBlock(value, indent, indentSize);
    } else {
      insertText = toYamlScalar(value);
    }

    if (seen.has(insertText)) {
      return;
    }

    seen.add(insertText);

    suggestions.push({
      label: label ?? (insertText.length > 60 ? `${insertText.slice(0, 57)}...` : insertText),
      detail,
      documentation,
      insertText,
      caretOffset: insertText.length,
      filterText: insertText,
      kind,
      sortText: `${sortPrefix}_${label ?? insertText}`,
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

  return suggestions;
}

function buildSequenceItemSuggestions(
  context: YamlCompletionContext,
  root: JsonSchemaObject,
  options: YamlCompletionOptions,
): CompletionSuggestion[] {
  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  /*
   * Child properties of a sequence item align with the content column after
   * "- ". Using the line's contentIndent handles non-standard spacing such
   * as "-  value" correctly.
   */
  const itemIndent = " ".repeat(Math.max(context.line.contentIndent, context.indent + 2));

  const suggestions: CompletionSuggestion[] = [];

  for (const schema of context.valueSchemas) {
    const types = getSchemaTypes(schema);

    if (types.includes("object")) {
      const properties = getKnownProperties([schema], root);

      if (properties.length > 0) {
        const first = properties[0]!;
        const insertText = `${first.name}: `;
        suggestions.push({
          label: `${first.name}...`,
          detail: `Object with ${properties.length} properties`,
          documentation: schema.description,
          insertText,
          caretOffset: insertText.length,
          filterText: first.name,
          kind: "snippet",
          sortText: "0",
        });
      }

      const sample = generateSample(schema, root, options);

      if (sample !== null && typeof sample === "object" && !Array.isArray(sample)) {
        const block = stripFirstLineIndent(toYamlBlock(sample, itemIndent, indentSize));
        suggestions.push({
          label: `${schema.title ?? "Object"} (sample)`,
          detail: "sample from schema",
          documentation: schema.description,
          insertText: block,
          caretOffset: block.length,
          filterText: block,
          kind: "snippet",
          sortText: "1",
        });
      }
    }

    if (types.includes("string") || types.includes("number") || types.includes("integer")) {
      if (schema.const !== undefined) {
        const text = toYamlScalar(schema.const);
        suggestions.push({
          label: text,
          detail: "const",
          insertText: text,
          caretOffset: text.length,
          filterText: text,
          kind: "value",
          sortText: "0",
        });
      }

      if (Array.isArray(schema.enum)) {
        for (const value of schema.enum) {
          const text = toYamlScalar(value);
          suggestions.push({
            label: text,
            detail: "enum",
            insertText: text,
            caretOffset: text.length,
            filterText: text,
            kind: "value",
            sortText: "1",
          });
        }
      }

      if (schema.default !== undefined) {
        const text = toYamlScalar(schema.default);
        suggestions.push({
          label: text,
          detail: "default",
          insertText: text,
          caretOffset: text.length,
          filterText: text,
          kind: "value",
          sortText: "2",
        });
      }
    }
  }

  return suggestions;
}

function buildDocumentPreview(
  root: JsonSchemaObject,
  options: YamlCompletionOptions,
): CompletionSuggestion[] {
  const resolved = resolveSchemas(root, root)[0] ?? root;
  const sample = generateSample(resolved, root, options);

  if (sample === undefined) {
    return [];
  }

  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  const yaml = toYamlBlock(sample, "", indentSize);

  return [
    {
      label: root.title ? `${root.title} (preview)` : "Document preview from schema",
      detail: "Generated from the JSON Schema",
      documentation: root.description,
      insertText: yaml,
      caretOffset: yaml.length,
      filterText: yaml,
      kind: "snippet",
      sortText: "0",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function getYamlCompletions(
  context: YamlCompletionContext,
  rootSchema: JsonSchema | undefined,
  options: YamlCompletionOptions = {},
): CompletionSuggestion[] {
  const root: JsonSchemaObject = isSchemaObject(rootSchema) ? rootSchema : {};

  switch (context.kind) {
    case "empty-document":
      return buildDocumentPreview(root, options);
    case "key":
      return buildKeySuggestions(context, root, options);
    case "value":
      return buildValueSuggestions(context, root, options);
    case "sequence-item":
      return buildSequenceItemSuggestions(context, root, options);
    default:
      return [];
  }
}

export function getYamlInlineSuggestion(
  context: YamlCompletionContext,
  rootSchema: JsonSchema | undefined,
  options: YamlCompletionOptions = {},
): CompletionSuggestion | undefined {
  /*
   * Inline ghost text only makes sense at a value position. At a key
   * position the popup dropdown is the right UX, and showing a multi-line
   * ghost while the user is still typing the key name is distracting.
   */
  if (context.kind !== "value") {
    return undefined;
  }

  /*
   * Never ghost-type into a value that already has content after the cursor.
   */
  const raw = context.line.raw;
  const afterCursor = raw.slice(context.cursorColumn - 1).trim();

  if (afterCursor) {
    return undefined;
  }

  const suggestions = getYamlCompletions(context, rootSchema, options);

  if (suggestions.length === 0) {
    return undefined;
  }

  const sorted = [...suggestions].sort((a, b) =>
    (a.sortText ?? "").localeCompare(b.sortText ?? ""),
  );

  const typed = context.prefix;

  const match = sorted.find((suggestion) => {
    /* Skip empty insertText (e.g. empty object samples that render as ""). */
    if (suggestion.insertText.length === 0) {
      return false;
    }

    const candidate = suggestion.filterText ?? suggestion.label;
    return typed.length === 0 || candidate.toLowerCase().startsWith(typed.toLowerCase());
  });

  return match;
}
