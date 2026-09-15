import { describe, it, expect } from "vitest";

import { buildJsonIndex, getObjectKeys, isPropertyKeyNode } from "../../src/json/document-index";

describe("json/document-index", () => {
  describe("buildJsonIndex", () => {
    it("parses a simple object", () => {
      const index = buildJsonIndex('{"name": "test"}');

      expect(index.root).toBeDefined();
      expect(index.root?.type).toBe("object");
      expect(index.errors).toHaveLength(0);
    });

    it("reports syntax errors", () => {
      const index = buildJsonIndex('{"name": }');

      expect(index.errors.length).toBeGreaterThan(0);
    });

    it("caches identical text", () => {
      const text = '{"a": 1}';
      const first = buildJsonIndex(text);
      const second = buildJsonIndex(text);

      expect(first).toBe(second);
    });

    it("converts offset to position", () => {
      const index = buildJsonIndex('{\n  "name": "test"\n}');

      const position = index.positionAt(5);
      expect(position.line).toBe(2);
      expect(position.column).toBeGreaterThan(0);
    });

    it("finds node at path", () => {
      const index = buildJsonIndex('{"name": "test", "nested": {"value": 42}}');

      const node = index.findNode(["nested", "value"]);
      expect(node).toBeDefined();
      expect(node?.type).toBe("number");
    });

    it("finds node at offset", () => {
      const text = '{"name": "test"}';
      const index = buildJsonIndex(text);

      const node = index.findNodeAtOffset(5);
      expect(node).toBeDefined();
    });
  });

  describe("getObjectKeys", () => {
    it("returns keys of an object node", () => {
      const index = buildJsonIndex('{"a": 1, "b": 2, "c": 3}');
      const keys = getObjectKeys(index.root);

      expect(keys).toEqual(["a", "b", "c"]);
    });

    it("returns empty for non-object", () => {
      const index = buildJsonIndex('[1, 2, 3]');
      expect(getObjectKeys(index.root)).toEqual([]);
    });
  });

  describe("isPropertyKeyNode", () => {
    it("identifies property key nodes", () => {
      const index = buildJsonIndex('{"name": "test"}');

      /* findNode returns the value node; its parent is the property,
         and the property's first child is the key node. */
      const valueNode = index.findNode(["name"]);
      const propertyNode = valueNode?.parent;
      const keyNode = propertyNode?.children?.[0];

      expect(isPropertyKeyNode(keyNode)).toBe(true);
    });
  });
});
