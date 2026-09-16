import { getSchemaTypes } from "../core/schema-resolver";
import { getYamlCompletions, type YamlCompletionContext } from "../yaml/completion";
import type { JsonSchema } from "../types";

/** Discrete choices belong in a menu; free-form values belong in ghost text. */
export function yamlUsesPopup(context: YamlCompletionContext, inlineEnabled = true): boolean {
  if (!inlineEnabled) return true;
  if (context.kind === "key" || context.kind === "empty-document" || context.kind === "sequence-item") return true;
  return context.valueSchemas.some(schema =>
    Array.isArray(schema.enum) || getSchemaTypes(schema).includes("boolean") ||
    (schema.examples?.length ?? 0) > 1,
  );
}

export function yamlHasPopupItems(context: YamlCompletionContext, schema: JsonSchema | undefined, inlineEnabled: boolean): boolean {
  if (!yamlUsesPopup(context, inlineEnabled)) return false;
  const items = getYamlCompletions(context, schema);
  if (context.kind === "value" && context.prefix && items.some(item => item.insertText === context.prefix)) return false;
  return items.length > 0;
}

/** Values replace only their prefix, never the key or sequence marker. */
export function yamlReplacementColumn(context: YamlCompletionContext): number {
  return Math.max(1, context.cursorColumn - context.prefix.length);
}

/** Supply YAML's mandatory separator when completion starts directly after ':'. */
export function yamlInsertText(context: YamlCompletionContext, text: string): string {
  const before = context.line.raw.slice(0, yamlReplacementColumn(context) - 1);
  return context.kind === "value" && before.endsWith(":") && !text.startsWith("\n") ? ` ${text}` : text;
}
