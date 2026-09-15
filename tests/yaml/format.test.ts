import { describe, expect, it } from "vitest";
import { formatYaml } from "../../src/yaml/format";

describe("formatYaml", () => {
  describe("valid documents (js-yaml round-trip)", () => {
    it("formats a simple key-value document", () => {
      const input = "name:  value\nage:   42\n";
      const result = formatYaml(input);
      expect(result).toContain("name: value");
      expect(result).toContain("age: 42");
    });

    it("formats nested objects", () => {
      const input = "info:\n  title:   API\n  version:  '1.0'\n";
      const result = formatYaml(input);
      expect(result).toContain("title: API");
      expect(result).toContain("1.0");
    });

    it("formats sequences", () => {
      const input = "servers:\n  - url:  a\n  - url:  b\n";
      const result = formatYaml(input);
      expect(result).toContain("- url: a");
      expect(result).toContain("- url: b");
    });

    it("preserves string values with special characters", () => {
      const input = 'url: "https://example.com/path?q=1"\n';
      const result = formatYaml(input);
      expect(result).toContain("https://example.com/path?q=1");
    });

    it("returns empty string for empty input", () => {
      expect(formatYaml("")).toBe("");
    });
  });

  describe("tolerant formatting (invalid documents)", () => {
    /*
     * These inputs contain a deliberate YAML syntax error (trailing colon
     * with unbalanced indent, or a tab character) so js-yaml rejects them
     * and the tolerant line-based formatter is exercised.
     */
    const invalidDoc = "a:\n  b:\n    c:\n\td: value\n";

    it("fixes colon spacing without value (key: stays key:)", () => {
      const input = "openapi:\ninfo:\n  bad:\n\td: x\n";
      const result = formatYaml(input);
      expect(result).toContain("openapi:");
      expect(result).toContain("info:");
    });

    it("fixes key:value (no space) to key: value", () => {
      const input = "name:value\nage:42\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toContain("name: value");
      expect(result).toContain("age: 42");
    });

    it("fixes multiple spaces after colon", () => {
      const input = "name:    value\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toContain("name: value");
    });

    it("does not modify URL protocol colons", () => {
      const input = "url: https://example.com\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toContain("https://example.com");
    });

    it("preserves comments in tolerant mode", () => {
      const input = "# top comment\nname: value\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toContain("# top comment");
    });

    it("preserves blank lines in tolerant mode", () => {
      const input = "a: 1\n\nb: 2\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toMatch(/a: 1\n\nb: 2/);
    });

    it("handles sequence items without crashing", () => {
      const input = "items:\n  - first\n  - second\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toContain("- first");
      expect(result).toContain("- second");
    });

    it("handles deeply nested incomplete documents", () => {
      const input = "a:\n  b:\n    c:\n      d: value\n  bad:\n\td:x\n";
      const result = formatYaml(input);
      expect(result).toContain("d: value");
    });
  });

  describe("edge cases", () => {
    it("handles document with only comments", () => {
      const input = "# just a comment\n# another comment\n";
      const result = formatYaml(input);
      expect(result).toContain("# just a comment");
    });

    it("handles document with only blank lines", () => {
      const input = "\n\n\n";
      const result = formatYaml(input);
      expect(result).toBe("\n\n\n");
    });

    it("handles single-line document", () => {
      const input = "name: value";
      const result = formatYaml(input);
      expect(result).toContain("name: value");
    });

    it("handles keys with special characters", () => {
      const input = '"x-custom-header": value\n';
      const result = formatYaml(input);
      expect(result).toContain("x-custom-header");
    });

    it("handles boolean values", () => {
      const input = "enabled:  true\ndisabled: false\n";
      const result = formatYaml(input);
      expect(result).toContain("enabled: true");
      expect(result).toContain("disabled: false");
    });

    it("handles null values", () => {
      const input = "field:  null\n";
      const result = formatYaml(input);
      expect(result).toContain("field:");
    });

    it("does not throw on deeply nested invalid YAML", () => {
      const input = "a:\n  b:\n    c:\n      d:\n        e:\n          f: value\n            bad indent\n";
      expect(() => formatYaml(input)).not.toThrow();
    });

    it("does not throw on very long lines", () => {
      const longValue = "x".repeat(10000);
      const input = `key: ${longValue}\n`;
      expect(() => formatYaml(input)).not.toThrow();
    });
  });

  describe("idempotency", () => {
    it("formatting already-formatted valid YAML is stable", () => {
      const input = "name: value\nage: 42\n";
      const once = formatYaml(input);
      const twice = formatYaml(once);
      expect(twice).toBe(once);
    });
  });

  describe("empty value preservation", () => {
    it("preserves empty values instead of converting to null", () => {
      const input = "openapi: 3.2.0\ninfo:\nservers:\npaths:\n";
      const result = formatYaml(input);
      expect(result).toContain("info:");
      expect(result).toContain("servers:");
      expect(result).toContain("paths:");
      expect(result).not.toContain("info: null");
      expect(result).not.toContain("servers: null");
      expect(result).not.toContain("paths: null");
    });

    it("preserves empty values with trailing whitespace", () => {
      const input = "key:   \nother: value\n";
      const result = formatYaml(input);
      expect(result).toContain("key:");
      expect(result).not.toContain("key: null");
    });

    it("does not convert intentional null values in strings", () => {
      const input = 'key: "this is null"\nother: value\n';
      const result = formatYaml(input);
      expect(result).toContain("this is null");
    });

    it("preserves empty values in nested objects", () => {
      const input = "root:\n  child:\n  other: value\n";
      const result = formatYaml(input);
      expect(result).toContain("child:");
      expect(result).not.toContain("child: null");
    });
  });
});
