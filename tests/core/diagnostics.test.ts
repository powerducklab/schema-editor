import { describe, it, expect } from "vitest";

import { validateParsedDocument } from "../../src/core/diagnostics";

import type { JsonSchemaObject } from "../../src/types";

describe("diagnostics", () => {
  describe("validateParsedDocument", () => {
    it("returns no errors for valid document", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const document = { name: "test" };
      const diagnostics = validateParsedDocument(document, schema);

      expect(diagnostics).toHaveLength(0);
    });

    it("reports missing required property", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const document = {};
      const diagnostics = validateParsedDocument(document, schema);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]?.message).toContain("name");
      expect(diagnostics[0]?.severity).toBe("error");
    });

    it("reports type mismatch", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          age: { type: "integer" },
        },
      };

      const document = { age: "not-a-number" };
      const diagnostics = validateParsedDocument(document, schema);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]?.message).toContain("integer");
    });

    it("reports additional properties", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: false,
      };

      const document = { name: "test", extra: "value" };
      const diagnostics = validateParsedDocument(document, schema);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]?.message).toContain("extra");
    });

    it("reports enum violation", () => {
      const schema: JsonSchemaObject = {
        type: "string",
        enum: ["a", "b", "c"],
      };

      const document = "d";
      const diagnostics = validateParsedDocument(document, schema);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]?.message).toContain("one of");
    });

    it("returns empty for undefined schema", () => {
      const diagnostics = validateParsedDocument({ name: "test" }, undefined);
      expect(diagnostics).toHaveLength(0);
    });

    it("includes fix suggestions", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const diagnostics = validateParsedDocument({}, schema);

      expect(diagnostics[0]?.fix).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles null document", () => {
      const schema: JsonSchemaObject = { type: "object" };
      expect(() => validateParsedDocument(null, schema)).not.toThrow();
    });

    it("handles array document at root", () => {
      const schema: JsonSchemaObject = { type: "array", items: { type: "string" } };
      const diagnostics = validateParsedDocument(["a", "b"], schema);
      expect(diagnostics).toHaveLength(0);
    });

    it("reports array item type mismatch", () => {
      const schema: JsonSchemaObject = { type: "array", items: { type: "integer" } };
      const diagnostics = validateParsedDocument([1, "two", 3], schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles nested object validation", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
          },
        },
      };
      const diagnostics = validateParsedDocument({ address: {} }, schema);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]?.path).toContain("address");
    });

    it("handles format validation (email)", () => {
      const schema: JsonSchemaObject = { type: "string", format: "email" };
      const diagnostics = validateParsedDocument("not-an-email", schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles minimum validation", () => {
      const schema: JsonSchemaObject = { type: "integer", minimum: 10 };
      const diagnostics = validateParsedDocument(5, schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles maximum validation", () => {
      const schema: JsonSchemaObject = { type: "integer", maximum: 100 };
      const diagnostics = validateParsedDocument(150, schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles minLength validation", () => {
      const schema: JsonSchemaObject = { type: "string", minLength: 5 };
      const diagnostics = validateParsedDocument("ab", schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles maxLength validation", () => {
      const schema: JsonSchemaObject = { type: "string", maxLength: 3 };
      const diagnostics = validateParsedDocument("toolong", schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles pattern validation", () => {
      const schema: JsonSchemaObject = { type: "string", pattern: "^[a-z]+$" };
      const diagnostics = validateParsedDocument("ABC", schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("deduplicates identical errors", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      };
      const diagnostics = validateParsedDocument({}, schema);
      const uniqueMessages = new Set(diagnostics.map((d) => d.message));
      expect(uniqueMessages.size).toBe(diagnostics.length);
    });

    it("handles oneOf validation", () => {
      const schema: JsonSchemaObject = {
        oneOf: [{ type: "string" }, { type: "integer" }],
      };
      const diagnostics = validateParsedDocument(true, schema);
      expect(diagnostics.length).toBeGreaterThan(0);
    });
  });
});
