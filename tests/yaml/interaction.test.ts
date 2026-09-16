import { describe, it, expect } from "vitest";
import { getYamlCompletions, getYamlInlineSuggestion, resolveYamlCompletionContext } from "../../src/yaml/completion";
import { yamlInsertText, yamlReplacementColumn, yamlUsesPopup, yamlHasPopupItems } from "../../src/react/yaml-completion";
import { load } from "js-yaml";
const schema = { type: "object", properties: {
  openapi: { const: "3.2.0" }, info: { type: "object", properties: { title: { type: "string" }, version: { default: "1.0.0" } } },
  status: { enum: ["active", "pending"] }, name: { default: "Example" }, enabled: { type: "boolean" },
} };
const contextAtEnd = (text: string) => { const lines = text.split("\n"); return resolveYamlCompletionContext(text, lines.length, lines.at(-1)!.length + 1, schema); };
describe("YAML completion interaction", () => {
  it("offers missing root keys on an empty line", () => {
    const context = contextAtEnd("openapi: 3.2.0\n");
    expect(yamlUsesPopup(context)).toBe(true);
    const labels = getYamlCompletions(context, schema).map(x => x.label);
    expect(labels).toContain("info"); expect(labels).not.toContain("openapi");
  });
  it("resolves nested keys from indentation and excludes existing siblings", () => {
    const context = contextAtEnd("info:\n  title: Example\n  ");
    expect(context.parentPath).toEqual(["info"]);
    expect(getYamlCompletions(context, schema).map(x => x.label)).toEqual(["version"]);
  });
  it("uses the cursor indentation when it is before trailing blank space", () => {
    const context = resolveYamlCompletionContext("info:\n  title: Example\n    ", 3, 1, schema);
    expect(context.parentPath).toEqual([]);
    expect(getYamlCompletions(context, schema).map(x => x.label)).not.toContain("info");
  });
  it("offers a matching key ghost after typing a prefix", () => {
    const context = contextAtEnd("openapi: 3.2.0\nin");
    expect(context.prefix).toBe("in");
    expect(getYamlInlineSuggestion(context, schema)?.insertText).toBe("info:\n  ");
  });
  it("keeps enumerations and booleans in the popup", () => {
    expect(yamlUsesPopup(contextAtEnd("status: "))).toBe(true);
    expect(yamlUsesPopup(contextAtEnd("enabled: "))).toBe(true);
  });
  it("uses ghost text for a free-form value", () => {
    const context = contextAtEnd("name: ");
    expect(yamlUsesPopup(context)).toBe(false);
    expect(getYamlInlineSuggestion(context, schema)?.insertText).toBe("Example");
    expect(yamlUsesPopup(context, false)).toBe(true);
  });
  it.each(["status: ", "status:", "status: act"])("preserves the key when completing %s", text => {
    const context = contextAtEnd(text);
    const suggestion = getYamlCompletions(context, schema).find(x => x.insertText === "active")!;
    const result = text.slice(0, yamlReplacementColumn(context) - 1) + yamlInsertText(context, suggestion.insertText);
    expect(load(result)).toEqual({ status: "active" });
  });
  it("uses the mapping colon after a quoted key", () => {
    const quotedSchema = { properties: { "x:y": { enum: ["yes", "no"] } } };
    const text = '"x:y": y';
    const context = resolveYamlCompletionContext(text, 1, text.length + 1, quotedSchema);
    expect(context.prefix).toBe("y"); expect(context.valueSchemas[0]?.enum).toEqual(["yes", "no"]);
  });
  it("does not include text after the cursor in the value prefix", () => {
    const context = resolveYamlCompletionContext("status: active", 1, 11, schema);
    expect(context.prefix).toBe("ac"); expect(getYamlInlineSuggestion(context, schema)).toBeUndefined();
  });
});


describe("YAML value acceptance", () => {
  it("does not reopen the menu for an accepted value", () => {
    expect(yamlHasPopupItems(contextAtEnd("status: active"), schema, true)).toBe(false);
  });
  it("leaves enum selection to the value popup", () => {
    const item = getYamlCompletions(contextAtEnd("openapi: 3.2.0\n"), schema).find(item => item.label === "status");
    expect(item?.insertText).toBe("status: ");
  });
  it.each(["true", "null", "123", "2026-09-16", "line\nbreak"])("preserves string type for %s", value => {
    const localSchema = { properties: { value: { enum: [value] } } };
    const context = resolveYamlCompletionContext("value: ", 1, 8, localSchema);
    const item = getYamlCompletions(context, localSchema)[0]!;
    expect(load("value: " + item.insertText)).toEqual({ value });
  });
});
