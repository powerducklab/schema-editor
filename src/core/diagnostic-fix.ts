import { modify, type Edit } from "jsonc-parser";
import { generateSample } from "./sample";
import { getPropertySchemas, getSchemasAtPath, isSchemaObject } from "./schema-resolver";
import type { Diagnostic, JsonSchema } from "../types";

/** Return a targeted JSON edit only when the current value still matches the diagnostic. */
export function getDiagnosticEdits(text: string, schema: JsonSchema | undefined, diagnostic: Diagnostic): Edit[] {
  if (!diagnostic.action || !diagnostic.semanticPath) return [];
  try {
    const path = diagnostic.semanticPath;
    let target: unknown = JSON.parse(text);
    for (const segment of path) {
      if (!target || typeof target !== "object" || !Object.prototype.hasOwnProperty.call(target, segment)) return [];
      target = (target as Record<string | number, unknown>)[segment];
    }
    let value: unknown;
    let editPath = path;
    if (diagnostic.action.kind === "add-required") {
      const property = diagnostic.action.property;
      if (!target || typeof target !== "object" || Array.isArray(target) || Object.prototype.hasOwnProperty.call(target, property)) return [];
      if (!isSchemaObject(schema)) return [];
      const propertySchema = getPropertySchemas(getSchemasAtPath(schema, path), property, schema)[0];
      if (!propertySchema) return [];
      value = generateSample(propertySchema, schema);
      if (value === undefined) return [];
      editPath = [...path, property];
    } else {
      if (target !== null) return [];
      value = diagnostic.action.type === "array" ? [] : {};
    }
    const indent = text.match(/\n([\t ]+)\S/)?.[1];
    return modify(text, editPath, value, { formattingOptions: {
      insertSpaces: !indent?.includes("\t"), tabSize: indent?.length ?? 2,
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    } });
  } catch {
    return [];
  }
}
