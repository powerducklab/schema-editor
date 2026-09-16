/**
 * Fault-tolerant YAML document index.
 *
 * A line-based structural indexer that tracks mappings, sequences, indentation
 * scopes, and document paths. Designed for completion and diagnostics rather
 * than full YAML parsing — it never throws on malformed input.
 */

import type { JsonPath } from "../types";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface YamlLine {
  line: number;
  raw: string;
  text: string;
  indent: number;
  key?: string;
  value?: string;
  hasColon: boolean;
  isSequence: boolean;
  sequenceIndex?: number;
  isBlank: boolean;
  childIndent: number;
  contentIndent: number;
  parentPath: JsonPath;
  path: JsonPath;
}

export interface YamlScope {
  path: JsonPath;
  parentPath: JsonPath;
  kind: "object" | "sequence";
  startLine: number;
  endLine: number;
  indent: number;
}

export interface YamlNode {
  path: JsonPath;
  key: string;
  line: number;
  column: number;
  indent: number;
  value?: string;
}

export interface YamlIndex {
  lines: YamlLine[];
  scopes: YamlScope[];
  nodes: YamlNode[];

  findNode(path: JsonPath): YamlNode | undefined;
  findNearestNode(path: JsonPath): YamlNode | undefined;
}

/* -------------------------------------------------------------------------- */
/* Low-level text helpers                                                     */
/* -------------------------------------------------------------------------- */

export function stripYamlComment(text: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(text[index - 1]!))) {
      return text.slice(0, index).trimEnd();
    }
  }

  return text.trimEnd();
}

export function getIndent(line: string): number {
  const match = line.match(/^[ \t]*/);
  return match ? match[0].length : 0;
}

export function findYamlColon(text: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if ((char === '"' || char === "'") && index === 0) {
      quote = char;
      continue;
    }

    if (char === ":") {
      const next = text[index + 1];
      if (next === undefined || next === " " || next === "\t") {
        return index;
      }
    }
  }

  return -1;
}

export function normalizeKey(key: string): string {
  const trimmed = key.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function isBlockScalarIndicator(value: string): boolean {
  return /^[|>][+-]?\d?$|^[|>]\d?[+-]?$/.test(value.trim());
}

/* -------------------------------------------------------------------------- */
/* Parser state                                                               */
/* -------------------------------------------------------------------------- */

interface StackEntry {
  kind: "object" | "sequence";
  path: JsonPath;
  indent: number;
  indentResolved: boolean;
  pendingKey?: string;
  count: number;
  startLine: number;
}

interface ParsedLine {
  isSequence: boolean;
  dashColumn: number;
  contentIndent: number;
  content: string;
  key?: string;
  value?: string;
  hasColon: boolean;
  keyColumn: number;
}

function parseLineStructure(raw: string): ParsedLine {
  const indent = getIndent(raw);
  const withoutComment = stripYamlComment(raw);
  const text = withoutComment.slice(indent);

  let isSequence = false;
  let dashColumn = -1;
  let contentIndent = indent;
  let content = text;

  if (text === "-" || text.startsWith("- ") || text.startsWith("-\t")) {
    isSequence = true;
    dashColumn = indent;

    const afterDash = text.slice(1);
    const spaces = afterDash.match(/^[ \t]*/)?.[0].length ?? 0;

    content = afterDash.slice(spaces);
    contentIndent = indent + 1 + (content ? spaces : 1);
  }

  const colon = content ? findYamlColon(content) : -1;

  if (colon === -1) {
    return {
      isSequence,
      dashColumn,
      contentIndent,
      content,
      hasColon: false,
      keyColumn: contentIndent,
    };
  }

  const rawKey = content.slice(0, colon);
  const rawValue = content.slice(colon + 1).trim();

  return {
    isSequence,
    dashColumn,
    contentIndent,
    content,
    key: normalizeKey(rawKey),
    value: rawValue.length > 0 ? rawValue : undefined,
    hasColon: true,
    keyColumn: contentIndent,
  };
}

/* -------------------------------------------------------------------------- */
/* Index builder                                                              */
/* -------------------------------------------------------------------------- */

let cachedSource: string | undefined;
let cachedIndex: YamlIndex | undefined;

/** Reuse the most recent bounded document across completion and diagnostics. */
export function buildYamlIndex(source: string): YamlIndex {
  if (source === cachedSource && cachedIndex) return cachedIndex;
  const index = createYamlIndex(source);
  if (source.length <= 512 * 1024) {
    cachedSource = source;
    cachedIndex = index;
  }
  return index;
}

function createYamlIndex(source: string): YamlIndex {
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");

  const lines: YamlLine[] = [];
  const scopes: YamlScope[] = [];
  const nodes: YamlNode[] = [];

  const root: StackEntry = {
    kind: "object",
    path: [],
    indent: 0,
    indentResolved: false,
    count: 0,
    startLine: 1,
  };

  const stack: StackEntry[] = [root];
  let blockScalarIndent: number | null = null;

  const top = (): StackEntry => stack[stack.length - 1]!;

  const closeScope = (entry: StackEntry, endLine: number): void => {
    if (entry === root) {
      return;
    }

    scopes.push({
      path: entry.path,
      parentPath: entry.path.slice(0, -1),
      kind: entry.kind,
      startLine: entry.startLine,
      endLine: Math.max(entry.startLine, endLine),
      indent: entry.indent,
    });
  };

  const popTo = (indent: number, lineNumber: number): void => {
    while (stack.length > 1) {
      const entry = top();

      if (entry.indent > indent) {
        stack.pop();
        closeScope(entry, lineNumber - 1);
        continue;
      }

      break;
    }
  };

  const pushBlank = (lineNumber: number, raw: string): void => {
    const owner = top();

    lines.push({
      line: lineNumber,
      raw,
      text: "",
      indent: getIndent(raw),
      hasColon: false,
      isSequence: false,
      isBlank: true,
      childIndent: owner.indent,
      contentIndent: getIndent(raw),
      parentPath: owner.path,
      path: owner.path,
    });
  };

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const raw = rawLines[lineIndex]!;
    const lineNumber = lineIndex + 1;
    const indent = getIndent(raw);
    const stripped = stripYamlComment(raw);
    const trimmed = stripped.trim();

    if (blockScalarIndent !== null) {
      if (raw.trim() === "" || indent > blockScalarIndent) {
        const owner = top();

        lines.push({
          line: lineNumber,
          raw,
          text: raw.trim(),
          indent,
          hasColon: false,
          isSequence: false,
          isBlank: raw.trim() === "",
          childIndent: indent,
          contentIndent: indent,
          parentPath: owner.path,
          path: owner.path,
        });

        continue;
      }

      blockScalarIndent = null;
    }

    if (trimmed === "" || raw.trim().startsWith("#")) {
      pushBlank(lineNumber, raw);
      continue;
    }

    if (trimmed === "---" || trimmed === "...") {
      pushBlank(lineNumber, raw);
      continue;
    }

    const parsed = parseLineStructure(raw);
    popTo(indent, lineNumber);

    if (parsed.isSequence) {
      let sequence: StackEntry | undefined;

      while (stack.length > 1) {
        const entry = top();

        if (entry.kind === "sequence" && entry.indent === indent) {
          sequence = entry;
          break;
        }

        if (entry.kind === "object" && entry.indentResolved && entry.indent === indent) {
          if (entry.pendingKey !== undefined) {
            break;
          }

          stack.pop();
          closeScope(entry, lineNumber - 1);
          continue;
        }

        break;
      }

      if (!sequence) {
        const owner = top();

        const sequencePath: JsonPath =
          owner.kind === "object"
            ? owner.pendingKey !== undefined
              ? [...owner.path, owner.pendingKey]
              : owner.path
            : [...owner.path, Math.max(owner.count - 1, 0)];

        if (owner.kind === "object") {
          owner.pendingKey = undefined;
        }

        sequence = {
          kind: "sequence",
          path: sequencePath,
          indent,
          indentResolved: true,
          count: 0,
          startLine: lineNumber,
        };

        stack.push(sequence);
      }

      const itemIndex = sequence.count;
      sequence.count += 1;

      const itemPath: JsonPath = [...sequence.path, itemIndex];

      if (parsed.hasColon && parsed.key !== undefined) {
        const itemObject: StackEntry = {
          kind: "object",
          path: itemPath,
          indent: parsed.contentIndent,
          indentResolved: true,
          count: 0,
          startLine: lineNumber,
          pendingKey: parsed.value === undefined ? parsed.key : undefined,
        };

        stack.push(itemObject);

        nodes.push({
          path: [...itemPath, parsed.key],
          key: parsed.key,
          line: lineNumber,
          column: parsed.keyColumn + 1,
          indent: parsed.contentIndent,
          value: parsed.value,
        });

        lines.push({
          line: lineNumber,
          raw,
          text: trimmed,
          indent,
          key: parsed.key,
          value: parsed.value,
          hasColon: true,
          isSequence: true,
          sequenceIndex: itemIndex,
          isBlank: false,
          childIndent:
            parsed.value === undefined ? parsed.contentIndent + 2 : parsed.contentIndent,
          contentIndent: parsed.contentIndent,
          parentPath: itemPath,
          path: [...itemPath, parsed.key],
        });

        if (parsed.value !== undefined && isBlockScalarIndicator(parsed.value)) {
          blockScalarIndent = indent;
        }

        continue;
      }

      if (parsed.content === "") {
        stack.push({
          kind: "object",
          path: itemPath,
          indent: indent + 1,
          indentResolved: false,
          count: 0,
          startLine: lineNumber,
        });

        lines.push({
          line: lineNumber,
          raw,
          text: trimmed,
          indent,
          hasColon: false,
          isSequence: true,
          sequenceIndex: itemIndex,
          isBlank: false,
          childIndent: indent + 2,
          contentIndent: indent + 2,
          parentPath: sequence.path,
          path: itemPath,
        });

        continue;
      }

      lines.push({
        line: lineNumber,
        raw,
        text: trimmed,
        indent,
        value: parsed.content,
        hasColon: false,
        isSequence: true,
        sequenceIndex: itemIndex,
        isBlank: false,
        childIndent: indent,
        contentIndent: parsed.contentIndent,
        parentPath: sequence.path,
        path: itemPath,
      });

      continue;
    }

    while (stack.length > 1) {
      const entry = top();

      if (entry.kind === "sequence" && entry.indent >= indent) {
        stack.pop();
        closeScope(entry, lineNumber - 1);
        continue;
      }

      break;
    }

    let owner = top();

    if (owner.kind === "object" && !owner.indentResolved) {
      owner.indent = indent;
      owner.indentResolved = true;
    } else if (owner.indent < indent || owner.kind === "sequence") {
      const nestedPath: JsonPath =
        owner.kind === "object"
          ? owner.pendingKey !== undefined
            ? [...owner.path, owner.pendingKey]
            : owner.path
          : [...owner.path, Math.max(owner.count - 1, 0)];

      if (owner.kind === "object") {
        owner.pendingKey = undefined;
      }

      const nested: StackEntry = {
        kind: "object",
        path: nestedPath,
        indent,
        indentResolved: true,
        count: 0,
        startLine: lineNumber,
      };

      stack.push(nested);
      owner = nested;
    }

    if (parsed.hasColon && parsed.key !== undefined) {
      owner.pendingKey = parsed.value === undefined ? parsed.key : undefined;

      const path: JsonPath = [...owner.path, parsed.key];

      nodes.push({
        path,
        key: parsed.key,
        line: lineNumber,
        column: parsed.keyColumn + 1,
        indent,
        value: parsed.value,
      });

      lines.push({
        line: lineNumber,
        raw,
        text: trimmed,
        indent,
        key: parsed.key,
        value: parsed.value,
        hasColon: true,
        isSequence: false,
        isBlank: false,
        childIndent: indent + 2,
        contentIndent: indent,
        parentPath: owner.path,
        path,
      });

      if (parsed.value !== undefined && isBlockScalarIndicator(parsed.value)) {
        blockScalarIndent = indent;
      }

      continue;
    }

    lines.push({
      line: lineNumber,
      raw,
      text: trimmed,
      indent,
      value: trimmed,
      hasColon: false,
      isSequence: false,
      isBlank: false,
      childIndent: indent,
      contentIndent: indent,
      parentPath: owner.path,
      path: owner.path,
    });
  }

  while (stack.length > 1) {
    const entry = stack.pop()!;
    closeScope(entry, rawLines.length);
  }

  const nodeMap = new Map<string, YamlNode>();

  for (const node of nodes) {
    const key = JSON.stringify(node.path);

    if (!nodeMap.has(key)) {
      nodeMap.set(key, node);
    }
  }

  return {
    lines,
    scopes,
    nodes,

    findNode(path: JsonPath): YamlNode | undefined {
      return nodeMap.get(JSON.stringify(path));
    },

    findNearestNode(path: JsonPath): YamlNode | undefined {
      for (let length = path.length; length > 0; length -= 1) {
        const node = nodeMap.get(JSON.stringify(path.slice(0, length)));

        if (node) {
          return node;
        }
      }

      return undefined;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export function findCurrentLine(index: YamlIndex, lineNumber: number): YamlLine {
  const line = index.lines[lineNumber - 1];

  if (line) {
    return line;
  }

  return {
    line: lineNumber,
    raw: "",
    text: "",
    indent: 0,
    hasColon: false,
    isSequence: false,
    isBlank: true,
    childIndent: 0,
    contentIndent: 0,
    parentPath: [],
    path: [],
  };
}

export function getExistingKeysInScope(index: YamlIndex, parentPath: JsonPath): Set<string> {
  const keys = new Set<string>();

  for (const node of index.nodes) {
    if (
      node.path.length === parentPath.length + 1 &&
      pathsEqual(node.path.slice(0, -1), parentPath)
    ) {
      keys.add(node.key);
    }
  }

  return keys;
}

export function findPreviousContentLine(
  index: YamlIndex,
  lineNumber: number,
): YamlLine | undefined {
  for (let current = lineNumber - 1; current >= 1; current -= 1) {
    const line = index.lines[current - 1];

    if (line && !line.isBlank) {
      return line;
    }
  }

  return undefined;
}

export function findEnclosingScope(
  index: YamlIndex,
  lineNumber: number,
  indent: number,
): YamlScope | undefined {
  let best: YamlScope | undefined;

  for (const scope of index.scopes) {
    if (scope.startLine > lineNumber || scope.endLine < lineNumber) {
      continue;
    }

    if (scope.indent > indent) {
      continue;
    }

    if (!best || scope.path.length > best.path.length) {
      best = scope;
    }
  }

  return best;
}

export function resolveContainerAt(
  index: YamlIndex,
  lineNumber: number,
  indent: number,
): { path: JsonPath; kind: "object" | "sequence" } {
  const previous = findPreviousContentLine(index, lineNumber);

  if (previous) {
    if (previous.hasColon && previous.value === undefined && indent >= previous.childIndent) {
      /*
       * A key with no inline value may contain either a mapping (object) or
       * a sequence (array). Inspect the current line to determine which:
       * if it begins with "- ", the container is a sequence.
       */
      const current = findCurrentLine(index, lineNumber);
      const isSequenceContainer = current?.isSequence === true;
      return { path: previous.path, kind: isSequenceContainer ? "sequence" : "object" };
    }

    if (
      previous.isSequence &&
      !previous.hasColon &&
      previous.value === undefined &&
      indent > previous.indent
    ) {
      return { path: previous.path, kind: "object" };
    }

    if (previous.isSequence && previous.hasColon && indent >= previous.contentIndent) {
      return { path: previous.parentPath, kind: "object" };
    }
  }

  const scope = findEnclosingScope(index, lineNumber, indent);

  if (scope) {
    return { path: scope.path, kind: scope.kind };
  }

  return { path: [], kind: "object" };
}

function pathsEqual(a: JsonPath, b: JsonPath): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Path location                                                              */
/* -------------------------------------------------------------------------- */

export interface YamlColonSpacingIssue {
  line: number;
  column: number;
  message: string;
  fix: string;
}

/**
 * Detect `key:value` (missing space after the mapping colon) which YAML
 * silently parses as a plain scalar instead of a key/value pair.
 */
export function findYamlColonSpacingIssues(source: string): YamlColonSpacingIssue[] {
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
  const issues: YamlColonSpacingIssue[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index]!;
    const indent = getIndent(raw);
    const text = stripYamlComment(raw).slice(indent);

    let content = text;
    let offset = indent;

    if (content.startsWith("- ") || content.startsWith("-\t")) {
      content = content.slice(2);
      offset += 2;
    }

    if (!content || content.startsWith("#")) {
      continue;
    }

    /* A valid mapping colon exists; nothing to report. */
    if (findYamlColon(content) !== -1) {
      continue;
    }

    /* Skip URLs, flow collections, and quoted scalars. */
    if (
      /^["'{[]/.test(content) ||
      /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(content)
    ) {
      continue;
    }

    const match = content.match(/^([A-Za-z_$][\w$./{}-]*):(?=\S)/);

    if (!match || match[1] === undefined) {
      continue;
    }

    issues.push({
      line: index + 1,
      column: offset + match[1].length + 1,
      message: "Missing space after the mapping colon.",
      fix: 'Insert a space after ":" so that YAML treats this line as a key/value pair.',
    });
  }

  return issues;
}

export function rangeOfPath(
  index: YamlIndex,
  path: JsonPath,
): { line: number; column: number; endLine: number; endColumn: number } {
  const node = index.findNode(path);

  if (node) {
    return {
      line: node.line,
      column: node.column,
      endLine: node.line,
      endColumn: node.column + node.key.length,
    };
  }

  const nearest = index.findNearestNode(path);

  if (nearest) {
    return {
      line: nearest.line,
      column: nearest.column,
      endLine: nearest.line,
      endColumn: nearest.column + nearest.key.length,
    };
  }

  return { line: 1, column: 1, endLine: 1, endColumn: 2 };
}
