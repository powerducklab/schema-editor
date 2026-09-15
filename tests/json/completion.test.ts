import { describe, it, expect } from "vitest";

import {
  resolveJsonCompletionContext,
  getJsonCompletions,
  getJsonInlineSuggestion,
  clearJsonCompletionCaches,
} from "../../src/json/completion";

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

describe("json/completion", () => {
  beforeEach(() => {
    clearJsonCompletionCaches();
  });

  describe("resolveJsonCompletionContext", () => {
    it("detects empty document", () => {
      const context = resolveJsonCompletionContext("", 0, SIMPLE_SCHEMA);

      expect(context.kind).toBe("empty-document");
    });

    it("detects property key position", () => {
      const text = '{"name": "test"}';
      const offset = text.indexOf('"') + 1;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);

      expect(context.kind).toBe("property-key");
    });

    it("detects property value position", () => {
      const text = '{"name": }';
      const offset = text.indexOf(": ") + 2;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);

      expect(context.kind).toBe("property-value");
    });

    it("detects array item position", () => {
      const text = '{"tags": [ ]}';
      const offset = text.indexOf("[") + 2;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);

      expect(context.kind).toBe("array-item");
    });

    it("tracks existing keys", () => {
      const text = '{"name": "test", "active": true}';
      const offset = text.length - 1;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);

      expect(context.existingKeys).toContain("name");
      expect(context.existingKeys).toContain("active");
    });

    it("handles malformed JSON gracefully", () => {
      const text = '{"name": "test", broken';
      const context = resolveJsonCompletionContext(text, text.length, SIMPLE_SCHEMA);

      /* Should not throw. */
      expect(context.kind).toBeDefined();
    });

    it("resolves nested container schemas", () => {
      const text = '{"metadata": {}}';
      const offset = text.indexOf("{") + 12;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);

      expect(context.containerSchemas.length).toBeGreaterThan(0);
    });

    it("sets insideQuotes flag correctly", () => {
      const text = '{"na"}';
      const offset = text.indexOf("a") + 1;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);

      expect(context.insideQuotes).toBe(true);
    });
  });

  describe("getJsonCompletions", () => {
    it("offers document preview for empty document", () => {
      const context = resolveJsonCompletionContext("", 0, SIMPLE_SCHEMA);
      const suggestions = getJsonCompletions("", context, SIMPLE_SCHEMA);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0]?.kind).toBe("snippet");
    });

    it("offers property keys excluding existing ones", () => {
      const text = '{"name": "test", }';
      const offset = text.indexOf(",") + 2;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);
      const suggestions = getJsonCompletions(text, context, SIMPLE_SCHEMA);

      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("active");
      expect(labels).toContain("count");
      expect(labels).not.toContain("name");
    });

    it("required properties sort before optional", () => {
      const text = "{}";
      const context = resolveJsonCompletionContext(text, 1, SIMPLE_SCHEMA);
      const suggestions = getJsonCompletions(text, context, SIMPLE_SCHEMA);

      const nameIndex = suggestions.findIndex((s) => s.label === "name");
      const activeIndex = suggestions.findIndex((s) => s.label === "active");

      expect(nameIndex).toBeLessThan(activeIndex);
    });

    it("offers enum values at value position", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "pending"] },
        },
      };
      const text = '{"status": }';
      const offset = text.indexOf(": ") + 2;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);

      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain('"active"');
      expect(labels).toContain('"inactive"');
    });

    it("offers default value at value position", () => {
      const text = '{"active": }';
      const offset = text.indexOf(": ") + 2;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);
      const suggestions = getJsonCompletions(text, context, SIMPLE_SCHEMA);

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
      const text = '{"config": }';
      const offset = text.indexOf(": ") + 2;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);

      const sample = suggestions.find((s) => s.kind === "snippet");
      expect(sample).toBeDefined();
      expect(sample?.insertText).toContain("host");
    });

    it("offers empty object placeholder for plain object values", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          data: { type: "object" },
        },
      };
      const text = '{"data": }';
      const offset = text.indexOf(": ") + 2;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);

      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("{}");
    });

    it("adds comma when needed", () => {
      const text = '{"name": "test" }';
      const offset = text.indexOf("}") - 1;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);
      const suggestions = getJsonCompletions(text, context, SIMPLE_SCHEMA);

      if (suggestions.length > 0) {
        expect(suggestions[0]?.insertText.endsWith(",")).toBe(true);
      }
    });

    it("property key insert includes quotes and colon", () => {
      const text = "{}";
      const context = resolveJsonCompletionContext(text, 1, SIMPLE_SCHEMA);
      const suggestions = getJsonCompletions(text, context, SIMPLE_SCHEMA);

      const name = suggestions.find((s) => s.label === "name");
      expect(name).toBeDefined();
      expect(name?.insertText).toContain('"name"');
      expect(name?.insertText).toContain(":");
    });

    it("returns empty for none kind", () => {
      const context = {
        kind: "none" as const,
        containerPath: [],
        valuePath: [],
        containerSchemas: [],
        valueSchemas: [],
        existingKeys: [],
        currentWord: "",
        replaceStart: 0,
        replaceEnd: 0,
        insideQuotes: false,
        hasColonAfter: false,
        hasTerminatorAfter: true,
      };
      const suggestions = getJsonCompletions("", context, SIMPLE_SCHEMA);

      expect(suggestions.length).toBe(0);
    });
  });

  describe("getJsonInlineSuggestion", () => {
    it("returns document preview for empty document", () => {
      const context = resolveJsonCompletionContext("", 0, SIMPLE_SCHEMA);
      const suggestion = getJsonInlineSuggestion("", context, SIMPLE_SCHEMA);

      expect(suggestion).toBeDefined();
      expect(suggestion?.kind).toBe("snippet");
    });

    it("returns suggestion at value position", () => {
      const text = '{"active": }';
      const offset = text.indexOf(": ") + 2;
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);
      const suggestion = getJsonInlineSuggestion(text, context, SIMPLE_SCHEMA);

      expect(suggestion).toBeDefined();
    });

    it("filters out newline-prefixed suggestions", () => {
      const text = '{"name": "test"}';
      const offset = text.indexOf("}");
      const context = resolveJsonCompletionContext(text, offset, SIMPLE_SCHEMA);
      const suggestion = getJsonInlineSuggestion(text, context, SIMPLE_SCHEMA);

      /* Key suggestions at end of object may be newline-prefixed. */
      if (suggestion) {
        expect(suggestion.insertText.startsWith("\n")).toBe(false);
      }
    });

    it("matches suggestion by typed prefix at value position", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"] },
        },
      };
      const text = "{\"status\": \"act\"}";
      const offset = text.length - 1;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestion = getJsonInlineSuggestion(text, context, schema);

      expect(suggestion).toBeDefined();
    });
  });

  describe("placeholder value generation", () => {
    it("generates sample for string with uri format", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
        },
      };
      const text = "{}";
      const offset = 1;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);
      const urlSuggestion = suggestions.find((s) => s.label === "url");

      expect(urlSuggestion).toBeDefined();
      expect(urlSuggestion?.insertText).toContain("https://");
      expect(urlSuggestion?.insertText).not.toBe("\"url\": \"\"");
    });

    it("generates sample for string with email format", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
        },
      };
      const text = "{}";
      const offset = 1;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);
      const emailSuggestion = suggestions.find((s) => s.label === "email");

      expect(emailSuggestion).toBeDefined();
      expect(emailSuggestion?.insertText).toContain("@");
    });

    it("uses examples array first value", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          region: { type: "string", examples: ["us-east-1", "eu-west-1"] },
        },
      };
      const text = "{}";
      const offset = 1;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);
      const regionSuggestion = suggestions.find((s) => s.label === "region");

      expect(regionSuggestion).toBeDefined();
      expect(regionSuggestion?.insertText).toContain("us-east-1");
    });

    it("keeps empty string for plain string without format", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };
      const text = "{}";
      const offset = 1;
      const context = resolveJsonCompletionContext(text, offset, schema);
      const suggestions = getJsonCompletions(text, context, schema);
      const nameSuggestion = suggestions.find((s) => s.label === "name");

      expect(nameSuggestion).toBeDefined();
      /* Insert text includes leading newline + indent when inside {}. */
      expect(nameSuggestion?.insertText).toContain('"name": ""');
      expect(nameSuggestion?.insertText).not.toContain("https://");
    });
  });

  describe("object interior whitespace completion", () => {
    const OAS_SCHEMA: JsonSchemaObject = {
      type: "object",
      required: ["openapi", "info"],
      properties: {
        openapi: { type: "string", enum: ["3.2.0"] },
        info: {
          type: "object",
          properties: {
            title: { type: "string" },
            version: { type: "string" },
            license: {
              type: "object",
              properties: {
                name: { type: "string" },
                url: { type: "string", format: "uri" },
              },
            },
          },
        },
        paths: { type: "object" },
        tags: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
      },
    };

    /** Join lines with newlines. Use explicit spaces for indented blank lines. */
    function doc(...lines: string[]): string {
      return lines.join("\n");
    }

    function offsetAt(text: string, line: number, col: number): number {
      const lines = text.split("\n");
      let offset = 0;
      for (let i = 0; i < line; i += 1) offset += lines[i]!.length + 1;
      return offset + col;
    }

    it("offers property-key on blank line inside root object", () => {
      const text = doc("{", '  "openapi": "3.2.0",', "  ", "}");
      const offset = offsetAt(text, 2, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);

      expect(context.kind).toBe("property-key");
      expect(context.containerPath).toEqual([]);
    });

    it("offers property-key on blank line inside nested object", () => {
      const text = doc("{", '  "info": {', '    "title": "API",', "    ", "  }", "}");
      const offset = offsetAt(text, 3, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);

      expect(context.kind).toBe("property-key");
      expect(context.containerPath).toEqual(["info"]);
    });

    it("offers nested object properties on blank line inside nested object", () => {
      const text = doc("{", '  "info": {', '    "title": "API",', "    ", "  }", "}");
      const offset = offsetAt(text, 3, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);
      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const labels = suggestions.map((s) => s.label);

      expect(labels).toContain("version");
      expect(labels).toContain("license");
      expect(labels).not.toContain("paths");
    });

    it("excludes already-used properties on blank line", () => {
      const text = doc("{", '  "openapi": "3.2.0",', '  "info": {},', "  ", "}");
      const offset = offsetAt(text, 3, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);
      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const labels = suggestions.map((s) => s.label);

      expect(labels).not.toContain("openapi");
      expect(labels).not.toContain("info");
      expect(labels).toContain("paths");
      expect(labels).toContain("tags");
    });

    it("generates correct indent for nested object blank line", () => {
      const text = doc("{", '  "info": {', '    "title": "API",', "    ", "  }", "}");
      const offset = offsetAt(text, 3, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);
      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const version = suggestions.find((s) => s.label === "version");

      expect(version).toBeDefined();
      /* Cursor is already on a new indented line, so no leading newline. */
      expect(version?.insertText).not.toMatch(/^\n/);
      expect(version?.insertText).toContain('"version":');
    });

    it("offers property-key on blank line inside array item object", () => {
      const text = doc("{", '  "tags": [', "    {", "      ", "    }", "  ]", "}");
      const offset = offsetAt(text, 3, 4);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);

      expect(context.kind).toBe("property-key");
      expect(context.containerPath).toEqual(["tags", 0]);
    });

    it("offers array item schema properties on blank line", () => {
      const text = doc("{", '  "tags": [', "    {", "      ", "    }", "  ]", "}");
      const offset = offsetAt(text, 3, 4);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);
      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const labels = suggestions.map((s) => s.label);

      expect(labels).toContain("name");
    });

    it("generates {} for object type completion", () => {
      const text = doc("{", '  "openapi": "3.2.0",', "  ", "}");
      const offset = offsetAt(text, 2, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);
      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const paths = suggestions.find((s) => s.label === "paths");

      expect(paths).toBeDefined();
      expect(paths?.insertText).toContain('"paths": {}');
    });

    it("generates [] for array type completion", () => {
      const text = doc("{", '  "openapi": "3.2.0",', "  ", "}");
      const offset = offsetAt(text, 2, 2);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);
      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const tags = suggestions.find((s) => s.label === "tags");

      expect(tags).toBeDefined();
      expect(tags?.insertText).toContain('"tags": []');
    });

    it("offers property-key after comma on same line", () => {
      const text = doc("{", '  "openapi": "3.2.0",', "}");
      const offset = offsetAt(text, 1, 22);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);

      expect(context.kind).toBe("property-key");
    });

    it("inline suggestion on blank line with single remaining property", () => {
      /* Use a schema with only one unused property so ghost text is unambiguous. */
      const singleSchema: JsonSchemaObject = {
        type: "object",
        properties: {
          openapi: { type: "string" },
          paths: { type: "object" },
        },
      };
      const text = doc("{", '  "openapi": "3.2.0",', "  ", "}");
      const offset = offsetAt(text, 2, 2);
      const context = resolveJsonCompletionContext(text, offset, singleSchema);
      const suggestion = getJsonInlineSuggestion(text, context, singleSchema);

      expect(suggestion).toBeDefined();
      expect(suggestion?.insertText).toContain("paths");
    });

    it("deeply nested object blank line uses correct container", () => {
      const text = doc(
        "{",
        '  "info": {',
        '    "license": {',
        '      "name": "MIT",',
        "      ",
        "    }",
        "  }",
        "}",
      );
      const offset = offsetAt(text, 4, 4);
      const context = resolveJsonCompletionContext(text, offset, OAS_SCHEMA);

      expect(context.kind).toBe("property-key");
      expect(context.containerPath).toEqual(["info", "license"]);

      const suggestions = getJsonCompletions(text, context, OAS_SCHEMA);
      const labels = suggestions.map((s) => s.label);
      expect(labels).toContain("url");
      expect(labels).not.toContain("name");
    });
  });
});
