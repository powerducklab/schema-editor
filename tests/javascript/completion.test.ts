import { describe, it, expect } from "vitest";

import {
  resolveJavascriptCompletionContext,
  getJavascriptCompletions,
  getJavascriptInlineSuggestion,
} from "../../src/javascript/completion";

const SNIPPETS = [
  'pm.test("Status is 200", () => {\n  pm.response.to.have.status(200);\n});',
  'pm.test("Response time < 200ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(200);\n});',
  "const json = pm.response.json();",
  "console.log(json);",
  'pm.environment.set("token", json.access_token);',
];

describe("javascript/completion", () => {
  describe("resolveJavascriptCompletionContext", () => {
    it("extracts prefix from identifier characters", () => {
      const text = "pmtest";
      const context = resolveJavascriptCompletionContext(text, text.length);

      expect(context.prefix).toBe("pmtest");
      expect(context.replaceStart).toBe(0);
      expect(context.replaceEnd).toBe(text.length);
    });

    it("includes dot in prefix for member expressions", () => {
      const text = "pm.response";
      const context = resolveJavascriptCompletionContext(text, text.length);

      expect(context.prefix).toBe("pm.response");
      expect(context.replaceStart).toBe(0);
      expect(context.replaceEnd).toBe(text.length);
    });

    it("stops at whitespace even with dots in prefix", () => {
      const text = "const x = pm.response";
      const context = resolveJavascriptCompletionContext(text, text.length);

      expect(context.prefix).toBe("pm.response");
    });

    it("handles empty prefix at whitespace", () => {
      const text = "const x = ";
      const context = resolveJavascriptCompletionContext(text, text.length);

      expect(context.prefix).toBe("");
    });

    it("handles offset at start of document", () => {
      const context = resolveJavascriptCompletionContext("", 0);

      expect(context.prefix).toBe("");
      expect(context.replaceStart).toBe(0);
      expect(context.replaceEnd).toBe(0);
    });

    it("clamps offset beyond text length", () => {
      const text = "abc";
      const context = resolveJavascriptCompletionContext(text, 100);

      expect(context.replaceEnd).toBe(text.length);
    });
  });

  describe("getJavascriptCompletions", () => {
    it("returns all snippets for empty prefix", () => {
      const context = resolveJavascriptCompletionContext("", 0);
      const suggestions = getJavascriptCompletions(context, SNIPPETS);

      expect(suggestions.length).toBe(SNIPPETS.length);
    });

    it("filters by prefix (case-insensitive)", () => {
      const context = resolveJavascriptCompletionContext("pm", 2);
      const suggestions = getJavascriptCompletions(context, SNIPPETS);

      expect(suggestions.length).toBeGreaterThan(0);
      for (const suggestion of suggestions) {
        expect(suggestion.label.toLowerCase()).toContain("pm");
      }
    });

    it("returns empty for no matches", () => {
      const context = resolveJavascriptCompletionContext("zzzzz", 5);
      const suggestions = getJavascriptCompletions(context, SNIPPETS);

      expect(suggestions.length).toBe(0);
    });

    it("returns empty for empty snippets array", () => {
      const context = resolveJavascriptCompletionContext("pm", 2);
      const suggestions = getJavascriptCompletions(context, []);

      expect(suggestions.length).toBe(0);
    });

    it("includes full snippet as insertText", () => {
      const context = resolveJavascriptCompletionContext("const json", 10);
      const suggestions = getJavascriptCompletions(context, SNIPPETS);

      const match = suggestions.find((s) => s.label.includes("pm.response.json"));
      expect(match).toBeDefined();
      expect(match?.insertText).toBe("const json = pm.response.json();");
    });

    it("respects maxSuggestions option", () => {
      const context = resolveJavascriptCompletionContext("", 0);
      const suggestions = getJavascriptCompletions(context, SNIPPETS, { maxSuggestions: 2 });

      expect(suggestions.length).toBe(2);
    });

    it("sets caretOffset to full snippet length", () => {
      const context = resolveJavascriptCompletionContext("console", 7);
      const suggestions = getJavascriptCompletions(context, SNIPPETS);

      const match = suggestions.find((s) => s.label.includes("console.log"));
      expect(match).toBeDefined();
      expect(match?.caretOffset).toBe(match?.insertText.length);
    });

    it("sorts prefix matches before substring matches", () => {
      const context = resolveJavascriptCompletionContext("pm", 2);
      const suggestions = getJavascriptCompletions(context, SNIPPETS);

      /* All pm.* snippets should come before any non-pm matches. */
      let seenNonPrefix = false;
      for (const suggestion of suggestions) {
        const isPrefix = suggestion.label.toLowerCase().startsWith("pm");
        if (!isPrefix) {
          seenNonPrefix = true;
        }
        if (seenNonPrefix && isPrefix) {
          throw new Error("Prefix match appeared after substring match");
        }
      }
    });
  });

  describe("getJavascriptInlineSuggestion", () => {
    it("returns the best match", () => {
      const context = resolveJavascriptCompletionContext("const json", 10);
      const suggestion = getJavascriptInlineSuggestion(context, SNIPPETS);

      expect(suggestion).toBeDefined();
      expect(suggestion?.insertText).toContain("pm.response.json");
    });

    it("returns undefined for no matches", () => {
      const context = resolveJavascriptCompletionContext("zzzzz", 5);
      const suggestion = getJavascriptInlineSuggestion(context, SNIPPETS);

      expect(suggestion).toBeUndefined();
    });

    it("returns undefined for empty snippets", () => {
      const context = resolveJavascriptCompletionContext("pm", 2);
      const suggestion = getJavascriptInlineSuggestion(context, []);

      expect(suggestion).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("handles member expression prefix with dots", () => {
      const text = "pm.environment.set";
      const context = resolveJavascriptCompletionContext(text, text.length);
      expect(context.prefix).toBe("pm.environment.set");
    });

    it("handles prefix at start of line", () => {
      const text = "pm.test";
      const context = resolveJavascriptCompletionContext(text, text.length);
      expect(context.replaceStart).toBe(0);
    });

    it("handles prefix after whitespace", () => {
      const text = "  pm.test";
      const context = resolveJavascriptCompletionContext(text, text.length);
      expect(context.prefix).toBe("pm.test");
      expect(context.replaceStart).toBe(2);
    });

    it("handles prefix after operator", () => {
      const text = "const x = pm.test";
      const context = resolveJavascriptCompletionContext(text, text.length);
      expect(context.prefix).toBe("pm.test");
    });

    it("getJavascriptCompletions handles empty snippets array", () => {
      const context = resolveJavascriptCompletionContext("pm", 2);
      const suggestions = getJavascriptCompletions(context, []);
      expect(suggestions).toHaveLength(0);
    });

    it("getJavascriptCompletions handles readonly snippets", () => {
      const snippets: readonly string[] = ["pm.test()"];
      const context = resolveJavascriptCompletionContext("pm", 2);
      const suggestions = getJavascriptCompletions(context, snippets);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it("getJavascriptCompletions filters case-insensitively", () => {
      const context = resolveJavascriptCompletionContext("PM", 2);
      const suggestions = getJavascriptCompletions(context, ["pm.test()", "other()"]);
      expect(suggestions.length).toBe(1);
      expect(suggestions[0]?.label).toContain("pm.test");
    });

    it("getJavascriptCompletions returns empty for no matching prefix", () => {
      const context = resolveJavascriptCompletionContext("zzz", 3);
      const suggestions = getJavascriptCompletions(context, ["pm.test()"]);
      expect(suggestions).toHaveLength(0);
    });

    it("resolveJavascriptCompletionContext handles offset 0", () => {
      const context = resolveJavascriptCompletionContext("pm.test", 0);
      expect(context.prefix).toBe("");
      expect(context.replaceStart).toBe(0);
      expect(context.replaceEnd).toBe(0);
    });

    it("resolveJavascriptCompletionContext handles negative offset gracefully", () => {
      const context = resolveJavascriptCompletionContext("pm.test", -5);
      expect(context.prefix).toBe("");
    });

    it("getJavascriptInlineSuggestion returns exact match when unique", () => {
      const snippets = ["pm.test(\"status\", () => {})"];
      const context = resolveJavascriptCompletionContext("pm.test", 7);
      const suggestion = getJavascriptInlineSuggestion(context, snippets);
      expect(suggestion).toBeDefined();
      expect(suggestion?.insertText).toBe(snippets[0]);
    });
  });
});
