import { describe, it, expect } from "vitest";

import {
  resolveSchemas,
  getSchemaTypes,
  getKnownProperties,
  getPropertySchemas,
  schemaAllowsType,
  isSchemaObject,
} from "../../src/core/schema-resolver";

import type { JsonSchemaObject } from "../../src/types";

describe("schema-resolver", () => {
  describe("resolveSchemas", () => {
    it("resolves a simple object schema", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const resolved = resolveSchemas(schema, schema);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.type).toBe("object");
      expect(resolved[0]?.properties).toBeDefined();
    });

    it("resolves local $ref pointers", () => {
      const root: JsonSchemaObject = {
        type: "object",
        properties: {
          user: { $ref: "#/definitions/User" },
        },
        definitions: {
          User: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
          },
        },
      };

      const resolved = resolveSchemas(root.properties!.user!, root);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.type).toBe("object");
      expect(resolved[0]?.properties?.id).toBeDefined();
    });

    it("flattens allOf", () => {
      const root: JsonSchemaObject = {
        allOf: [
          { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
          { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
        ],
      };

      const resolved = resolveSchemas(root, root);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.properties?.a).toBeDefined();
      expect(resolved[0]?.properties?.b).toBeDefined();
      expect(resolved[0]?.required).toContain("a");
      expect(resolved[0]?.required).toContain("b");
    });

    it("expands oneOf into multiple candidates", () => {
      const root: JsonSchemaObject = {
        oneOf: [
          { type: "string" },
          { type: "number" },
        ],
      };

      const resolved = resolveSchemas(root, root);

      expect(resolved.length).toBeGreaterThanOrEqual(2);
      const types = resolved.map((s) => s.type);
      expect(types).toContain("string");
      expect(types).toContain("number");
    });

    it("resolves true to an empty permissive schema", () => {
      const resolved = resolveSchemas(true, {} as JsonSchemaObject);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toEqual({});
    });

    it("resolves false to nothing", () => {
      const resolved = resolveSchemas(false, {} as JsonSchemaObject);
      expect(resolved).toHaveLength(0);
    });

    it("handles circular references without infinite recursion", () => {
      const root: JsonSchemaObject = {
        type: "object",
        properties: {
          self: { $ref: "#" },
        },
      };

      const resolved = resolveSchemas(root.properties!.self!, root);
      expect(resolved.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getSchemaTypes", () => {
    it("returns declared type", () => {
      expect(getSchemaTypes({ type: "string" })).toEqual(["string"]);
    });

    it("returns multiple types", () => {
      expect(getSchemaTypes({ type: ["string", "null"] })).toEqual(["string", "null"]);
    });

    it("infers object from properties", () => {
      expect(getSchemaTypes({ properties: { a: {} } })).toContain("object");
    });

    it("infers array from items", () => {
      expect(getSchemaTypes({ items: { type: "string" } })).toContain("array");
    });
  });

  describe("getKnownProperties", () => {
    it("enumerates declared properties", () => {
      const root: JsonSchemaObject = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name"],
      };

      const properties = getKnownProperties([root], root);

      expect(properties).toHaveLength(2);
      expect(properties.find((p) => p.name === "name")?.required).toBe(true);
      expect(properties.find((p) => p.name === "age")?.required).toBe(false);
    });
  });

  describe("schemaAllowsType", () => {
    it("allows integer when number is declared", () => {
      expect(schemaAllowsType({ type: "number" }, "integer")).toBe(true);
    });

    it("allows any type when no type is declared", () => {
      expect(schemaAllowsType({}, "string")).toBe(true);
    });

    it("rejects mismatched types", () => {
      expect(schemaAllowsType({ type: "string" }, "number")).toBe(false);
    });
  });

  describe("isSchemaObject", () => {
    it("returns true for objects", () => {
      expect(isSchemaObject({})).toBe(true);
    });

    it("returns false for arrays", () => {
      expect(isSchemaObject([])).toBe(false);
    });

    it("returns false for null", () => {
      expect(isSchemaObject(null)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles circular $ref without infinite loop", () => {
      const schema: JsonSchemaObject = {
        type: "object",
        $defs: {
          node: {
            type: "object",
            properties: {
              child: { $ref: "#/$defs/node" },
            },
          },
        },
        properties: {
          root: { $ref: "#/$defs/node" },
        },
      };

      const resolved = resolveSchemas(schema, schema);
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved[0]?.type).toBe("object");
    });

    it("resolves allOf by merging schemas", () => {
      const schema: JsonSchemaObject = {
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "number" } } },
        ],
      };

      const resolved = resolveSchemas(schema, schema);
      /* allOf is merged into a single schema with combined properties. */
      expect(resolved.length).toBe(1);
      expect(resolved[0]?.properties).toBeDefined();
      expect(resolved[0]?.properties?.a).toBeDefined();
      expect(resolved[0]?.properties?.b).toBeDefined();
    });

    it("resolves anyOf and returns all candidates", () => {
      const schema: JsonSchemaObject = {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "null" },
        ],
      };

      const resolved = resolveSchemas(schema, schema);
      expect(resolved.length).toBe(3);
    });

    it("resolves oneOf and returns all candidates", () => {
      const schema: JsonSchemaObject = {
        oneOf: [
          { type: "string", const: "a" },
          { type: "string", const: "b" },
        ],
      };

      const resolved = resolveSchemas(schema, schema);
      expect(resolved.length).toBe(2);
    });

    it("handles $ref to root", () => {
      const root: JsonSchemaObject = {
        type: "object",
        properties: {
          self: { $ref: "#" },
        },
      };

      const resolved = resolveSchemas({ $ref: "#" }, root);
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved[0]?.type).toBe("object");
    });

    it("handles boolean schema true", () => {
      const resolved = resolveSchemas(true as unknown as JsonSchemaObject, {});
      expect(resolved.length).toBe(1);
    });

    it("handles boolean schema false", () => {
      const resolved = resolveSchemas(false as unknown as JsonSchemaObject, {});
      expect(resolved.length).toBe(0);
    });

    it("getSchemaTypes handles type array", () => {
      const types = getSchemaTypes({ type: ["string", "null"] });
      expect(types).toContain("string");
      expect(types).toContain("null");
      expect(types).toHaveLength(2);
    });

    it("getSchemaTypes handles missing type", () => {
      const types = getSchemaTypes({});
      expect(types).toHaveLength(0);
    });

    it("getKnownProperties handles additionalProperties boolean", () => {
      /* First argument is an array of schemas. */
      const props = getKnownProperties([{ additionalProperties: true }], {});
      expect(props).toBeDefined();
      expect(Array.isArray(props)).toBe(true);
    });
  });
});
