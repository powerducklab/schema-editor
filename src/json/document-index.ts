/**
 * Fault-tolerant JSON document index.
 *
 * Built on jsonc-parser.
 *
 * Performance:
 *   - Caches the most recent parsed document.
 *   - Keeps line-start lookup O(log n).
 *   - Avoids repeated parseTree() calls for identical text.
 */

import {
  findNodeAtLocation,
  findNodeAtOffset,
  getNodePath,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from "jsonc-parser";

import type { JsonPath, TextPosition } from "../types";

export type { Node as JsonNode } from "jsonc-parser";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface JsonSyntaxError {
  message: string;
  offset: number;
  length: number;
}

export interface JsonIndex {
  text: string;
  root: Node | undefined;
  errors: JsonSyntaxError[];

  positionAt(offset: number): TextPosition;
  offsetAt(position: TextPosition): number;
  findNode(path: JsonPath): Node | undefined;
  findNodeAtOffset(offset: number): Node | undefined;
  pathOf(node: Node): JsonPath;
  getObjectKeys(node: Node | undefined): string[];
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

let lastText: string | null = null;
let lastIndex: JsonIndex | null = null;

export function clearJsonIndexCache(): void {
  lastText = null;
  lastIndex = null;
}

/* -------------------------------------------------------------------------- */
/* Line table                                                                 */
/* -------------------------------------------------------------------------- */

function buildLineStarts(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);

    if (char === 10) {
      starts.push(index + 1);
      continue;
    }

    if (char === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        index += 1;
      }
      starts.push(index + 1);
    }
  }

  return starts;
}

function positionFromOffset(
  lineStarts: number[],
  textLength: number,
  offset: number,
): TextPosition {
  const clamped = Math.max(0, Math.min(offset, textLength));

  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;

    if (lineStarts[mid]! <= clamped) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return {
    line: low + 1,
    column: clamped - lineStarts[low]! + 1,
  };
}

function offsetFromPosition(
  lineStarts: number[],
  textLength: number,
  position: TextPosition,
): number {
  const lineIndex = Math.max(0, Math.min(position.line - 1, lineStarts.length - 1));
  const lineStart = lineStarts[lineIndex]!;

  const nextStart =
    lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1]! : textLength + 1;

  const maxColumn = Math.max(1, nextStart - lineStart);

  return lineStart + Math.max(0, Math.min(position.column - 1, maxColumn - 1));
}

/* -------------------------------------------------------------------------- */
/* Node helpers                                                               */
/* -------------------------------------------------------------------------- */

export function getObjectKeys(node: Node | undefined): string[] {
  if (!node || node.type !== "object" || !node.children) {
    return [];
  }

  const keys: string[] = [];

  for (const property of node.children) {
    if (
      property.type !== "property" ||
      !property.children ||
      property.children.length === 0
    ) {
      continue;
    }

    const keyNode = property.children[0];

    if (keyNode && keyNode.type === "string" && typeof keyNode.value === "string") {
      keys.push(keyNode.value);
    }
  }

  return keys;
}

export function isPropertyKeyNode(node: Node | undefined): boolean {
  return (
    !!node &&
    node.type === "string" &&
    !!node.parent &&
    node.parent.type === "property" &&
    node.parent.children?.[0] === node
  );
}

function toJsonPath(segments: Array<string | number>): JsonPath {
  return segments.map((segment) => (typeof segment === "number" ? segment : String(segment)));
}

/* -------------------------------------------------------------------------- */
/* Index construction                                                         */
/* -------------------------------------------------------------------------- */

export function buildJsonIndex(text: string): JsonIndex {
  if (lastText === text && lastIndex) {
    return lastIndex;
  }

  const parseErrors: ParseError[] = [];

  const root = parseTree(text, parseErrors, {
    allowTrailingComma: true,
    allowEmptyContent: true,
    disallowComments: false,
  });

  const lineStarts = buildLineStarts(text);

  const errors = parseErrors.map((error) => ({
    message: describeParseError(error),
    offset: error.offset,
    length: Math.max(1, error.length),
  }));

  const index: JsonIndex = {
    text,
    root,
    errors,

    positionAt: (offset) => positionFromOffset(lineStarts, text.length, offset),
    offsetAt: (position) => offsetFromPosition(lineStarts, text.length, position),

    findNode: (path) => (root ? findNodeAtLocation(root, path) : undefined),
    findNodeAtOffset: (offset) => (root ? findNodeAtOffset(root, offset, true) : undefined),
    pathOf: (node) => toJsonPath(getNodePath(node)),
    getObjectKeys,
  };

  lastText = text;
  lastIndex = index;

  return index;
}

/* -------------------------------------------------------------------------- */
/* Error formatting                                                           */
/* -------------------------------------------------------------------------- */

const ERROR_MESSAGES: Record<string, string> = {
  InvalidSymbol: "Invalid symbol.",
  InvalidNumberFormat: "Invalid number format.",
  PropertyNameExpected: "Property name expected.",
  ValueExpected: "Value expected.",
  ColonExpected: "Colon expected.",
  CommaExpected: "Comma expected.",
  CloseBraceExpected: 'Closing "}" expected.',
  CloseBracketExpected: 'Closing "]" expected.',
  EndOfFileExpected: "End of file expected.",
  InvalidCommentToken: "Comments are not allowed in JSON.",
  UnexpectedEndOfComment: "Unexpected end of comment.",
  UnexpectedEndOfString: "Unterminated string.",
  UnexpectedEndOfNumber: "Unexpected end of number.",
  InvalidUnicode: "Invalid unicode escape sequence.",
  InvalidEscapeCharacter: "Invalid escape character.",
  InvalidCharacter: "Invalid character.",
};

function describeParseError(error: ParseError): string {
  const code = printParseErrorCode(error.error);
  return ERROR_MESSAGES[code] ?? `JSON syntax error (${code}).`;
}

/* -------------------------------------------------------------------------- */
/* Path location                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Locate a JSON path in the document index, returning a 1-based range.
 * For property paths, the range covers the key node.
 */
export function rangeOfPath(
  index: JsonIndex,
  path: JsonPath,
): { line: number; column: number; endLine: number; endColumn: number } {
  const node = index.findNode(path);

  if (node?.parent?.type === "property" && node.parent.children?.[0]) {
    return rangeOfNode(index, node.parent.children[0]);
  }

  return rangeOfNode(index, node);
}

export function rangeOfNode(
  index: JsonIndex,
  node: Node | undefined,
): { line: number; column: number; endLine: number; endColumn: number } {
  if (!node) {
    return { line: 1, column: 1, endLine: 1, endColumn: 2 };
  }

  let start = node.offset;
  let length = node.length;

  if (node.type === "object" || node.type === "array") {
    length = 1;
  }

  const startPosition = index.positionAt(start);
  const endPosition = index.positionAt(start + Math.max(1, length));

  return {
    line: startPosition.line,
    column: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
  };
}

export function toDisplayPath(path: JsonPath): string[] {
  return path.map((segment) => (typeof segment === "number" ? `[${segment}]` : segment));
}
