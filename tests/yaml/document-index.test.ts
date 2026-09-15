import { describe, it, expect } from "vitest";

import {
  buildYamlIndex,
  findCurrentLine,
  getExistingKeysInScope,
  resolveContainerAt,
  findYamlColonSpacingIssues,
} from "../../src/yaml/document-index";

describe("yaml/document-index", () => {
  describe("buildYamlIndex", () => {
    it("parses a simple mapping", () => {
      const index = buildYamlIndex("name: test\nage: 42");

      expect(index.lines).toHaveLength(2);
      expect(index.nodes).toHaveLength(2);
      expect(index.nodes[0]?.key).toBe("name");
      expect(index.nodes[1]?.key).toBe("age");
    });

    it("parses nested mappings", () => {
      const index = buildYamlIndex("user:\n  name: test\n  age: 42");

      expect(index.nodes).toHaveLength(3);
      expect(index.nodes[0]?.key).toBe("user");
      expect(index.nodes[1]?.key).toBe("name");
      expect(index.nodes[1]?.path).toEqual(["user", "name"]);
    });

    it("parses sequences", () => {
      const index = buildYamlIndex("items:\n  - a\n  - b\n  - c");

      expect(index.lines[1]?.isSequence).toBe(true);
      expect(index.lines[1]?.sequenceIndex).toBe(0);
      expect(index.lines[2]?.sequenceIndex).toBe(1);
    });

    it("parses sequence of objects", () => {
      const index = buildYamlIndex("users:\n  - name: alice\n    age: 30\n  - name: bob\n    age: 25");

      expect(index.nodes).toHaveLength(5);
      expect(index.nodes[1]?.path).toEqual(["users", 0, "name"]);
      expect(index.nodes[3]?.path).toEqual(["users", 1, "name"]);
    });

    it("handles comments", () => {
      const index = buildYamlIndex("# comment\nname: test # inline comment");

      expect(index.lines[0]?.isBlank).toBe(true);
      expect(index.lines[1]?.key).toBe("name");
      expect(index.lines[1]?.value).toBe("test");
    });

    it("handles URLs with colons", () => {
      const index = buildYamlIndex("url: https://example.com/path");

      expect(index.lines[0]?.key).toBe("url");
      expect(index.lines[0]?.value).toBe("https://example.com/path");
    });

    it("finds node by path", () => {
      const index = buildYamlIndex("user:\n  name: test");

      const node = index.findNode(["user", "name"]);
      expect(node).toBeDefined();
      expect(node?.key).toBe("name");
    });

    it("finds nearest node", () => {
      const index = buildYamlIndex("user:\n  name: test");

      const node = index.findNearestNode(["user", "nonexistent"]);
      expect(node).toBeDefined();
      expect(node?.key).toBe("user");
    });
  });

  describe("findCurrentLine", () => {
    it("returns existing line", () => {
      const index = buildYamlIndex("a: 1\nb: 2");
      const line = findCurrentLine(index, 2);

      expect(line.key).toBe("b");
    });

    it("returns blank line for out of range", () => {
      const index = buildYamlIndex("a: 1");
      const line = findCurrentLine(index, 99);

      expect(line.isBlank).toBe(true);
    });
  });

  describe("getExistingKeysInScope", () => {
    it("returns keys in a mapping", () => {
      const index = buildYamlIndex("user:\n  name: test\n  age: 42");
      const keys = getExistingKeysInScope(index, ["user"]);

      expect(keys.has("name")).toBe(true);
      expect(keys.has("age")).toBe(true);
    });
  });

  describe("resolveContainerAt", () => {
    it("resolves root container", () => {
      const index = buildYamlIndex("name: test");
      const container = resolveContainerAt(index, 2, 0);

      expect(container.path).toEqual([]);
      expect(container.kind).toBe("object");
    });

    it("resolves nested container after a key", () => {
      const index = buildYamlIndex("user:\n  name: test\n  ");
      const container = resolveContainerAt(index, 3, 2);

      expect(container.path).toEqual(["user"]);
    });
  });

  describe("findYamlColonSpacingIssues", () => {
    it("detects missing space after colon", () => {
      const issues = findYamlColonSpacingIssues("name:test");

      expect(issues).toHaveLength(1);
      expect(issues[0]?.line).toBe(1);
      expect(issues[0]?.message).toContain("Missing space");
    });

    it("does not flag valid key: value pairs", () => {
      const issues = findYamlColonSpacingIssues("name: test\nage: 42");

      expect(issues).toHaveLength(0);
    });

    it("does not flag URLs", () => {
      const issues = findYamlColonSpacingIssues("url: https://example.com");

      expect(issues).toHaveLength(0);
    });

    it("does not flag quoted scalars", () => {
      const issues = findYamlColonSpacingIssues('"key:value": test');

      expect(issues).toHaveLength(0);
    });

    it("detects missing space in sequence items", () => {
      const issues = findYamlColonSpacingIssues("- name:test");

      expect(issues).toHaveLength(1);
      expect(issues[0]?.line).toBe(1);
    });

    it("returns empty for blank input", () => {
      expect(findYamlColonSpacingIssues("")).toHaveLength(0);
      expect(findYamlColonSpacingIssues("\n\n")).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles block scalar (|)", () => {
      const text = "description: |\n  line one\n  line two\nname: test";
      const index = buildYamlIndex(text);
      expect(index.lines.length).toBeGreaterThan(0);
      /* The block scalar lines should not be parsed as keys. */
      const descLine = findCurrentLine(index, 1);
      expect(descLine.key).toBe("description");
    });

    it("handles block scalar (>)", () => {
      const text = "description: >\n  folded text\nname: test";
      const index = buildYamlIndex(text);
      const descLine = findCurrentLine(index, 1);
      expect(descLine.key).toBe("description");
    });

    it("handles full-line comments", () => {
      const text = "# comment\nname: test\n# another\nage: 42";
      const index = buildYamlIndex(text);
      expect(index.nodes).toHaveLength(2);
    });

    it("handles inline comments", () => {
      const text = "name: test # inline comment\nage: 42";
      const index = buildYamlIndex(text);
      const nameLine = findCurrentLine(index, 1);
      expect(nameLine.key).toBe("name");
      expect(nameLine.value).toContain("test");
    });

    it("handles deeply nested mappings", () => {
      const text = "a:\n  b:\n    c:\n      d: value";
      const index = buildYamlIndex(text);
      expect(index.lines).toHaveLength(4);
    });

    it("handles sequence of objects", () => {
      const text = "items:\n  - name: a\n    value: 1\n  - name: b\n    value: 2";
      const index = buildYamlIndex(text);
      expect(index.lines).toHaveLength(5);
    });

    it("handles empty document", () => {
      const index = buildYamlIndex("");
      /* Empty document produces one blank line (line 1). */
      expect(index.lines).toHaveLength(1);
      expect(index.lines[0]?.isBlank).toBe(true);
    });

    it("handles only whitespace", () => {
      const index = buildYamlIndex("   \n  \n ");
      expect(index.lines.length).toBeGreaterThan(0);
    });

    it("handles quoted keys with special characters", () => {
      const text = '"x-custom-header": value\n"@context": test';
      const index = buildYamlIndex(text);
      expect(index.nodes).toHaveLength(2);
    });

    it("handles numeric keys", () => {
      const text = "200: success\n404: not found";
      const index = buildYamlIndex(text);
      expect(index.nodes).toHaveLength(2);
    });

    it("resolveContainerAt handles root level", () => {
      const text = "name: test\nage: 42";
      const index = buildYamlIndex(text);
      const container = resolveContainerAt(index, 1, 1);
      expect(container.path).toHaveLength(0);
    });

    it("getExistingKeysInScope returns keys at current level", () => {
      const text = "a: 1\nb: 2\nc:\n  d: 3";
      const index = buildYamlIndex(text);
      /* Second argument is parentPath (array), not line number. */
      const keys = getExistingKeysInScope(index, []);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).toContain("c");
      expect(keys).not.toContain("d");
    });

    it("handles YAML document markers (---)", () => {
      const text = "---\nname: test\n---";
      const index = buildYamlIndex(text);
      /* Document markers should not be parsed as keys. */
      const nameNodes = index.nodes.filter((n) => n.key === "name");
      expect(nameNodes).toHaveLength(1);
    });
  });
});
