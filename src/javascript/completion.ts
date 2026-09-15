/**
 * JavaScript snippet completion engine.
 *
 * Driven by a user-supplied array of snippet strings (for example pre-test
 * and test scripts). Each snippet is offered as both a popup completion and
 * an inline ghost suggestion. Matching is case-insensitive prefix matching
 * against the snippet's first line.
 */

import type { CompletionSuggestion } from "../types";

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface JavascriptCompletionOptions {
  /** Maximum number of suggestions to return. */
  maxSuggestions?: number;
}

const DEFAULT_MAX_SUGGESTIONS = 50;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isIdentifierChar(char: string): boolean {
  /*
   * Include dot so that member expressions like `pm.environment` are treated
   * as a single completion prefix. Without this, `pm.en` splits into `pm.`
   * + `en`, and the replacement range covers only `en`, causing the inserted
   * text to produce `pm.pm.environment...`.
   */
  return /[A-Za-z0-9_$.]/.test(char);
}

function snippetLabel(snippet: string): string {
  const firstLine = snippet.split("\n")[0] ?? snippet;
  const trimmed = firstLine.trim();

  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77)}...`;
}

function snippetDetail(snippet: string): string {
  const lines = snippet.split("\n").filter((line) => line.trim().length > 0);
  return `${lines.length} line${lines.length === 1 ? "" : "s"}`;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface JavascriptCompletionContext {
  prefix: string;
  replaceStart: number;
  replaceEnd: number;
}

export function resolveJavascriptCompletionContext(
  text: string,
  offset: number,
): JavascriptCompletionContext {
  const safeOffset = Math.min(Math.max(offset, 0), text.length);
  let start = safeOffset;

  while (start > 0 && isIdentifierChar(text[start - 1]!)) {
    start -= 1;
  }

  return {
    prefix: text.slice(start, safeOffset),
    replaceStart: start,
    replaceEnd: safeOffset,
  };
}

export function getJavascriptCompletions(
  context: JavascriptCompletionContext,
  snippets: string[],
  options: JavascriptCompletionOptions = {},
): CompletionSuggestion[] {
  if (snippets.length === 0) {
    return [];
  }

  const maxSuggestions = options.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
  const typed = context.prefix.toLowerCase();

  const matches: Array<{ snippet: string; score: number }> = [];

  for (const snippet of snippets) {
    const label = snippetLabel(snippet).toLowerCase();

    if (typed.length === 0) {
      matches.push({ snippet, score: 0 });
    } else if (label.startsWith(typed)) {
      matches.push({ snippet, score: 1 });
    } else if (label.includes(typed)) {
      matches.push({ snippet, score: 2 });
    }
  }

  matches.sort((a, b) => a.score - b.score);

  return matches.slice(0, maxSuggestions).map(({ snippet }, index) => ({
    label: snippetLabel(snippet),
    detail: snippetDetail(snippet),
    documentation: snippet,
    insertText: snippet,
    caretOffset: snippet.length,
    filterText: snippetLabel(snippet),
    kind: "snippet",
    sortText: String(index).padStart(4, "0"),
  }));
}

export function getJavascriptInlineSuggestion(
  context: JavascriptCompletionContext,
  snippets: string[],
  options: JavascriptCompletionOptions = {},
): CompletionSuggestion | undefined {
  const suggestions = getJavascriptCompletions(context, snippets, options);

  if (suggestions.length === 0) {
    return undefined;
  }

  return suggestions[0];
}
