import { describe, it, expect } from "vitest";

import { generateSample, generateSampleForSchema } from "../../src/core/sample";

import type { JsonSchemaObject } from "../../src/types";

describe("sample", () => {
  describe("generateSample", () => {
    it("returns const value directly", () => {
      const schema: JsonSchemaObject = { const: "hello" };
      expect(generateSample(schema, schema)).toBe("hello");
    });

    it("returns default value directly", () => {
      const schema: JsonSchemaObject = { type: "string", default: "world" };
      expect(generateSample(schema, schema)).toBe("world");
    });

    it("returns first enum value", () => {
      const schema: JsonSchemaObject = { type: "string", enum: ["a", "b", "c"] };
      expect(generateSample(schema, schema)).toBe("a");
    });

    it("returns first example", () => {
      const schema: JsonSchemaObject = { type: "string", examples: ["first", "second"] };
      expect(generateSample(schema, schema)).toBe("first");
    });

    it("generates a string sample for format", () => {
      const schema: JsonSchemaObject = { type: "string", format: "email" };
      const sample = generateSample(schema, schema);
      expect(typeof sample).toBe("string");
    });

    it("generates an object sample from properties", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
          active: { type: "boolean" },
        },
        required: ["name", "active"],
      };

      const sample = generateSample(schema, schema) as Record<string, unknown>;

      expect(sample).toBeTypeOf("object");
      expect(sample.name).toBeDefined();
      expect(sample.active).toBeDefined();
    });

    it("caches results for the same schema", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
        },
        required: ["id"],
      };

      const first = generateSample(schema, schema);
      const second = generateSample(schema, schema);

      expect(first).toBe(second);
    });
  });

  describe("generateSampleForSchema", () => {
    it("returns undefined for false schema", () => {
      expect(generateSampleForSchema(false, {} as JsonSchemaObject)).toBeUndefined();
    });

    it("returns undefined for undefined schema", () => {
      expect(generateSampleForSchema(undefined, {} as JsonSchemaObject)).toBeUndefined();
    });

    it("returns {} for true schema", () => {
      expect(generateSampleForSchema(true, {} as JsonSchemaObject)).toEqual({});
    });
  });

  describe("edge cases", () => {
    it("const takes priority over default", () => {
      const schema: JsonSchemaObject = { const: "from-const", default: "from-default" };
      expect(generateSample(schema, schema)).toBe("from-const");
    });

    it("default takes priority over enum", () => {
      const schema: JsonSchemaObject = {
        type: "string",
        default: "from-default",
        enum: ["a", "b"],
      };
      expect(generateSample(schema, schema)).toBe("from-default");
    });

    it("examples takes priority over enum when no default", () => {
      const schema: JsonSchemaObject = {
        type: "string",
        examples: ["from-examples"],
        enum: ["a", "b"],
      };
      expect(generateSample(schema, schema)).toBe("from-examples");
    });

    it("generates email format sample", () => {
      const schema: JsonSchemaObject = { type: "string", format: "email" };
      const sample = generateSample(schema, schema);
      expect(typeof sample).toBe("string");
      expect(sample).toContain("@");
    });

    it("generates date-time format sample", () => {
      const schema: JsonSchemaObject = { type: "string", format: "date-time" };
      const sample = generateSample(schema, schema);
      expect(typeof sample).toBe("string");
      expect(sample).toContain("T");
    });

    it("generates uri format sample", () => {
      const schema: JsonSchemaObject = { type: "string", format: "uri" };
      const sample = generateSample(schema, schema);
      expect(typeof sample).toBe("string");
      expect(sample).toContain("http");
    });

    it("generates integer with minimum", () => {
      const schema: JsonSchemaObject = { type: "integer", minimum: 42 };
      expect(generateSample(schema, schema)).toBe(42);
    });

    it("generates boolean as false", () => {
      const schema: JsonSchemaObject = { type: "boolean" };
      expect(generateSample(schema, schema)).toBe(false);
    });

    it("generates null type as null", () => {
      const schema: JsonSchemaObject = { type: "null" };
      expect(generateSample(schema, schema)).toBeNull();
    });

    it("handles empty object schema", () => {
      const sample = generateSample({}, {});
      expect(sample).toBeDefined();
    });

    it("handles array with no items", () => {
      const schema: JsonSchemaObject = { type: "array" };
      const sample = generateSample(schema, schema);
      expect(Array.isArray(sample)).toBe(true);
    });

    it("handles deeply nested object without crashing", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          a: {
            type: "object",
            properties: {
              b: {
                type: "object",
                properties: {
                  c: { type: "string" },
                },
              },
            },
          },
        },
      };
      expect(() => generateSample(schema, schema)).not.toThrow();
    });

    it("respects maxSampleDepth option", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          child: { $ref: "#" },
        },
      };
      const shallow = generateSample(schema, schema, { maxSampleDepth: 2 });
      expect(shallow).toBeDefined();
    });
  });
});
