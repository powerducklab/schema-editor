/**
 * Tolerant YAML formatter.
 *
 * Two-tier strategy:
 *   1. Try js-yaml load + dump for structurally valid documents.
 *   2. Fall back to a line-based normalizer that fixes indentation and
 *      colon spacing even when the document has syntax errors.
 *
 * The formatter never throws — it returns the original text on any failure.
 */

import { load, dump } from "js-yaml";

const INDENT_SIZE = 2;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function formatYaml(text: string): string {
  if (text.trim().length === 0) {
    return text;
  }

  /* Tier 1: js-yaml round-trip for valid documents. */
  try {
    const parsed = load(text);
    if (parsed !== null && parsed !== undefined) {
      let formatted = dump(parsed, {
        indent: INDENT_SIZE,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      });
      /*
       * js-yaml parses empty values (`key:`) as null and dumps them as
       * `key: null`. Restore the empty-value form since it is semantically
       * equivalent and preferred by users. Only matches end-of-line nulls
       * (optionally followed by a comment), never nulls inside strings.
       */
      formatted = formatted.replace(/: null(\s*(?:#.*)?)$/gm, ":$1");
      /* js-yaml dump adds a trailing newline; preserve original ending. */
      const endsWithNewline = text.endsWith("\n");
      return endsWithNewline ? formatted : formatted.replace(/\n$/, "");
    }
  } catch {
    /* Fall through to tolerant formatter. */
  }

  /* Tier 2: line-based tolerant formatting. */
  return formatYamlTolerant(text);
}

/* -------------------------------------------------------------------------- */
/* Tolerant line-based formatter                                              */
/* -------------------------------------------------------------------------- */

interface FormattedLine {
  indent: number;
  content: string;
  isBlank: boolean;
  isComment: boolean;
}

function formatYamlTolerant(text: string): string {
  const lines = text.split("\n");
  const formatted: FormattedLine[] = [];
  const indentStack: number[] = [0];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      formatted.push({ indent: 0, content: "", isBlank: true, isComment: false });
      continue;
    }

    if (trimmed.startsWith("#")) {
      /* Comments keep the indent of the surrounding context. */
      const ctxIndent = indentStack[indentStack.length - 1] ?? 0;
      formatted.push({ indent: ctxIndent, content: trimmed, isBlank: false, isComment: true });
      continue;
    }

    const rawIndent = raw.match(/^(\s*)/)?.[1]?.length ?? 0;
    const isSequence = trimmed.startsWith("-") || trimmed.startsWith("?");

    /*
     * Determine the effective indent. Sequence items at the same raw indent
     * as their parent mapping are actually one level deeper (YAML allows
     * "- key: value" at the parent's indent level).
     */
    let effectiveIndent = rawIndent;
    if (isSequence && rawIndent === (indentStack[indentStack.length - 1] ?? 0)) {
      effectiveIndent = rawIndent + INDENT_SIZE;
    }

    /* Pop indent levels that are deeper than the current line. */
    while (
      indentStack.length > 1 &&
      effectiveIndent < (indentStack[indentStack.length - 1] ?? 0)
    ) {
      indentStack.pop();
    }

    /* Push new indent level. */
    if (effectiveIndent > (indentStack[indentStack.length - 1] ?? 0)) {
      indentStack.push(effectiveIndent);
    }

    /* Normalize colon spacing: "key:value" -> "key: value". */
    const content = normalizeColonSpacing(trimmed);

    formatted.push({
      indent: effectiveIndent,
      content,
      isBlank: false,
      isComment: false,
    });
  }

  return formatted
    .map((line) => {
      if (line.isBlank) return "";
      return " ".repeat(line.indent) + line.content;
    })
    .join("\n");
}

/**
 * Ensure exactly one space after a colon that separates a key from a value.
 * Handles:
 *   "key:value"    -> "key: value"
 *   "key:  value"  -> "key: value"
 *   "key:"         -> unchanged (no value follows)
 *   "url: http://" -> unchanged (colon in value is preserved)
 *   "- item"       -> unchanged (sequence item)
 */
function normalizeColonSpacing(line: string): string {
  /* Skip sequence items and lines without a colon. */
  if (line.startsWith("-") || line.startsWith("?")) {
    return line;
  }

  const colonIdx = findKeyColon(line);
  if (colonIdx < 0) {
    return line;
  }

  const before = line.slice(0, colonIdx + 1);
  const after = line.slice(colonIdx + 1);

  /* If nothing follows the colon, leave it as-is. */
  if (after.trim().length === 0) {
    return before;
  }

  /* Normalize to exactly one space after the colon. */
  return before + " " + after.trimStart();
}

/**
 * Find the colon that separates a YAML key from its value.
 * Returns -1 if no key colon is found.
 * Ignores colons inside quoted strings and inline URLs/protocols.
 */
function findKeyColon(line: string): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && (inSingleQuote || inDoubleQuote)) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (ch === ":") {
      /*
       * A colon followed by a non-space, non-end character is likely part
       * of a value (e.g. "http://", "port:8080" is invalid YAML anyway).
       * A valid key colon is followed by space or end-of-line.
       */
      const next = line[i + 1];
      if (next === undefined || next === " " || next === "\t") {
        return i;
      }
      /*
       * "key:value" (no space) is also a key colon — it will be normalized
       * to "key: value". But only if what follows doesn't look like a URL
       * protocol (e.g. "http:").
       */
      const rest = line.slice(i + 1);
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rest)) {
        /* This is a URL protocol colon, skip it. */
        continue;
      }
      return i;
    }
  }

  return -1;
}
