import { describe, expect, it } from "vitest";
import { applyEdits } from "jsonc-parser";
import { clearSampleCache, generateSample } from "../../src/core/sample";
import { resolveReference, resolveSchemas } from "../../src/core/schema-resolver";
import { toEditorDiagnostics, validateParsedDocument } from "../../src/core/diagnostics";
import { getDiagnosticEdits } from "../../src/core/diagnostic-fix";
import { buildYamlIndex } from "../../src/yaml/document-index";
import { resolveJsonCompletionContext } from "../../src/json/completion";
import type { JsonSchemaObject } from "../../src/types";
const range = () => ({ line: 1, column: 1, endLine: 1, endColumn: 2 });

describe("cache and reference isolation", () => {
  it("separates samples by root schema", () => {
    const ref = { $ref: "#/$defs/value" };
    expect(generateSample(ref, { $defs: { value: { const: "first" } } })).toBe("first");
    expect(generateSample(ref, { $defs: { value: { const: "second" } } })).toBe("second");
  });
  it("actually clears sample caches", () => {
    const schema = { const: "old" };
    expect(generateSample(schema, schema)).toBe("old");
    schema.const = "new";
    clearSampleCache();
    expect(generateSample(schema, schema)).toBe("new");
  });
  it("does not traverse inherited reference properties", () => {
    expect(resolveReference({}, "#/constructor")).toBeUndefined();
    const schema = { "": { type: "string" } };
    expect(resolveReference(schema, "#/")).toBe(schema[""]);
  });
  it("preserves false references", () => {
    const root = { $defs: { closed: false } };
    expect(resolveReference(root, "#/$defs/closed")).toBe(false);
    expect(resolveSchemas({ $ref: "#/$defs/closed" }, root)).toEqual([]);
  });
  it("indexes deeply nested references without overflowing the call stack", () => {
    const root: JsonSchemaObject = {};
    let current = root;
    for (let i = 0; i < 15000; i++) { const child = {}; current.child = child; current = child; }
    current.$anchor = "end";
    expect(resolveReference(root, "#end")).toBe(current);
  });
  it("bounds completion candidates", () => {
    const root = { anyOf: Array.from({ length: 10000 }, (_, i) => ({ const: i })) };
    expect(resolveSchemas(root, root).length).toBeLessThanOrEqual(64);
  });
  it("rejects a runtime cache from different text", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const old = resolveJsonCompletionContext("{}", 1, schema);
    const fresh = resolveJsonCompletionContext("[]", 1, schema, { versionId: 1, text: "{}", offset: 1, schema, context: old });
    expect(fresh).not.toBe(old);
  });
  it("reuses the YAML index and invalidates on changes", () => {
    expect(buildYamlIndex("a: 1")).toBe(buildYamlIndex("a: 1"));
    expect(buildYamlIndex("a: 2")).not.toBe(buildYamlIndex("a: 1"));
  });
});

describe("precise diagnostics and safe edits", () => {
  it("rejects documents against a false schema", () => {
    expect(validateParsedDocument({}, false)).toHaveLength(1);
  });
  it("distinguishes numeric object keys from array indexes", () => {
    const schema = { type: "object", properties: { "0": { type: "array", items: { type: "string" } } } };
    expect(validateParsedDocument({ "0": [1] }, schema)[0]?.path).toEqual(["0", 0]);
  });
  it("adds an escaped required key to the exact nested object", () => {
    const key = 'a"/b';
    const schema = { type: "object", properties: { nested: { type: "object", required: [key], properties: { [key]: { const: "${secret}" } } } } };
    const text = '{"nested": {}, "other": null}';
    const diagnostic = toEditorDiagnostics(validateParsedDocument(JSON.parse(text), schema), range)[0]!;
    const fixed = applyEdits(text, getDiagnosticEdits(text, schema, diagnostic));
    expect(JSON.parse(fixed)).toEqual({ nested: { [key]: "${secret}" }, other: null });
    expect(getDiagnosticEdits(fixed, schema, diagnostic)).toEqual([]);
  });
  it("never replaces an adjacent null or a non-null value", () => {
    const schema = { type: "object", properties: { a: { type: "array" }, b: { type: "null" } } };
    const text = '{"a": "bad", "b": null}';
    const diagnostic = toEditorDiagnostics(validateParsedDocument(JSON.parse(text), schema), range)[0]!;
    expect(getDiagnosticEdits(text, schema, diagnostic)).toEqual([]);
    const nullText = '{"a": null, "b": null}';
    expect(JSON.parse(applyEdits(nullText, getDiagnosticEdits(nullText, schema, diagnostic)))).toEqual({ a: [], b: null });
  });
});
