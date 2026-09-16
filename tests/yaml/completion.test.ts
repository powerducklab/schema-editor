import { describe, it, expect } from "vitest";

import {
  resolveYamlCompletionContext,
  getYamlCompletions,
  getYamlInlineSuggestion,
} from "../../src/yaml/completion";

import type { JsonSchemaObject } from "../../src/types";

const SIMPLE_SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", description: "Item name" },
    active: { type: "boolean", default: true },
    count: { type: "integer", minimum: 0 },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    metadata: {
      type: "object",
      properties: {
        created: { type: "string", format: "date-time" },
        author: { type: "string" },
      },
    },
  },
};

describe("yaml/completion", () => {
  describe("resolveYamlCompletionContext", () => {
    it("detects empty document", () => {
      const context = resolveYamlCompletionContext("", 1, 1, SIMPLE_SCHEMA);

      expect(context.kind).toBe("empty-document");
    });

    it("detects key position on new line after content", () => {
      const text = "name: test\n";
      const context = resolveYamlCompletionContext(text, 2, 1, SIMPLE_SCHEMA);

      expect(context.kind).toBe("key");
      expect(context.path).toEqual([]);
    });

    it("detects value position after colon", () => {
      const text = "name: ";
      const context = resolveYamlCompletionContext(text, 1, 7, SIMPLE_SCHEMA);

      expect(context.kind).toBe("value");
      expect(context.path).toEqual(["name"]);
    });

    it("detects nested key position", () => {
      const text = "metadata:\n  created: 2025-01-01\n  ";
      const context = resolveYamlCompletionContext(text, 3, 3, SIMPLE_SCHEMA);

      expect(context.kind).toBe("key");
      expect(context.containerSchemas.length).toBeGreaterThan(0);
    });

    it("detects sequence item position", () => {
      const text = "tags:\n  - ";
      const context = resolveYamlCompletionContext(text, 2, 5, SIMPLE_SCHEMA);

      expect(context.kind).toBe("sequence-item");
    });

    it("tracks existing keys in scope", () => {
      const text = "name: test\nactive: true\n";
      const context = resolveYamlCompletionContext(text, 3, 1, SIMPLE_SCHEMA);

      expect(context.existingKeys.has("name")).toBe(true);
      expect(context.existingKeys.has("active")).toBe(true);
      expect(context.existingKeys.has("count")).toBe(false);
    });

    it("resolves container schemas for nested position", () => {
      const text = "metadata:\n  ";
      const context = resolveYamlCompletionContext(text, 2, 3, SIMPLE_SCHEMA);

      expect(context.containerSchemas.length).toBeGreaterThan(0);
    });

    it("handles malformed YAML gracefully", () => {
      const text = "key: value\n  bad: indent\n";
      const context = resolveYamlCompletionContext(text, 3, 1, SIMPLE_SCHEMA);

      /* Should not throw; kind may be key or none depending on index. */
      expect(context.kind).toBeDefined();
    });
  });

  describe("getYamlCompletions", () => {
    it("offers document preview for empty document", () => {
      const context = resolveYamlCompletionContext("", 1, 1, SIMPLE_SCHEMA);
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0]?.kind).toBe("snippet");
    });

    it("offers property keys excluding existing ones", () => {
      const text = "name: test\n";
      const context = resolveYamlCompletionContext(text, 2, 1, SIMPLE_SCHEMA);
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("active");
      expect(labels).toContain("count");
      expect(labels).not.toContain("name");
    });

    it("required properties sort before optional", () => {
      const text = "name: test\n";
      const context = resolveYamlCompletionContext(text, 2, 1, SIMPLE_SCHEMA);
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      /* name already exists, so among remaining: active (optional), count (optional), etc.
         Use a fresh document where name is not yet present. */
      const freshContext = resolveYamlCompletionContext("x: y\n", 2, 1, SIMPLE_SCHEMA);
      const freshSuggestions = getYamlCompletions(freshContext, SIMPLE_SCHEMA);

      const nameIndex = freshSuggestions.findIndex((s) => s.label === "name");
      const activeIndex = freshSuggestions.findIndex((s) => s.label === "active");

      if (nameIndex >= 0 && activeIndex >= 0) {
        expect(nameIndex).toBeLessThan(activeIndex);
      }
    });

    it("offers enum values at value position", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "pending"] },
        },
      };
      const text = "status: ";
      const context = resolveYamlCompletionContext(text, 1, 9, schema);
      const suggestions = getYamlCompletions(context, schema);

      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("active");
      expect(labels).toContain("inactive");
      expect(labels).toContain("pending");
    });

    it("offers default value at value position", () => {
      const text = "active: ";
      const context = resolveYamlCompletionContext(text, 1, 9, SIMPLE_SCHEMA);
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("true");
    });

    it("offers sample for object values with required properties", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          config: {
            type: "object",
            required: ["host", "port"],
            properties: {
              host: { type: "string" },
              port: { type: "integer" },
            },
          },
        },
      };
      const text = "config: ";
      const context = resolveYamlCompletionContext(text, 1, 9, schema);
      const suggestions = getYamlCompletions(context, schema);

      const sample = suggestions.find((s) => s.kind === "snippet");
      expect(sample).toBeDefined();
      expect(sample?.insertText).toContain("host");
    });

    it("offers enum values for sequence items", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string", enum: ["alpha", "beta", "gamma"] },
          },
        },
      };
      const text = "tags:\n  - ";
      const context = resolveYamlCompletionContext(text, 2, 5, schema);
      const suggestions = getYamlCompletions(context, schema);

      expect(suggestions.length).toBeGreaterThan(0);
      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("alpha");
    });

    it("returns empty for none kind", () => {
      const context = {
        kind: "none" as const,
        line: {
          line: 1,
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
        },
        prefix: "",
        path: [],
        parentPath: [],
        containerSchemas: [],
        valueSchemas: [],
        existingKeys: new Set(),
        indent: 0,
        inSequenceItem: false,
        cursorColumn: 1,
      };
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      expect(suggestions.length).toBe(0);
    });

    it("object keys insert with colon and newline", () => {
      const text = "x: y\n";
      const context = resolveYamlCompletionContext(text, 2, 1, SIMPLE_SCHEMA);
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      const metadata = suggestions.find((s) => s.label === "metadata");
      expect(metadata).toBeDefined();
      expect(metadata?.insertText).toBe("metadata:\n  ");
    });

    it("scalar keys insert with colon and space", () => {
      const text = "x: y\n";
      const context = resolveYamlCompletionContext(text, 2, 1, SIMPLE_SCHEMA);
      const suggestions = getYamlCompletions(context, SIMPLE_SCHEMA);

      const name = suggestions.find((s) => s.label === "name");
      expect(name).toBeDefined();
      expect(name?.insertText).toBe("name: ");
    });
  });

  describe("getYamlInlineSuggestion", () => {
    it("returns suggestion at value position", () => {
      const text = "active: ";
      const context = resolveYamlCompletionContext(text, 1, 9, SIMPLE_SCHEMA);
      const suggestion = getYamlInlineSuggestion(context, SIMPLE_SCHEMA);

      expect(suggestion).toBeDefined();
    });

    it("returns undefined at key position", () => {
      const text = "name: test\n";
      const context = resolveYamlCompletionContext(text, 2, 1, SIMPLE_SCHEMA);
      const suggestion = getYamlInlineSuggestion(context, SIMPLE_SCHEMA);

      expect(suggestion).toBeUndefined();
    });

    it("returns undefined when content exists after cursor", () => {
      const text = "name: test";
      const context = resolveYamlCompletionContext(text, 1, 6, SIMPLE_SCHEMA);
      const suggestion = getYamlInlineSuggestion(context, SIMPLE_SCHEMA);

      expect(suggestion).toBeUndefined();
    });

    it("matches suggestion by prefix", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"] },
        },
      };
      const text = "status: act";
      const context = resolveYamlCompletionContext(text, 1, 13, schema);
      const suggestion = getYamlInlineSuggestion(context, schema);

      expect(suggestion).toBeDefined();
      expect(suggestion?.insertText).toBe("active");
    });
  });
});
