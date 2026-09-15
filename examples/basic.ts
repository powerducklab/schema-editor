/**
 * Example: Basic usage of @powerduck/schema-editor with a JSON Schema.
 *
 * This example demonstrates the core completion engine without React.
 * It can be run with: npx tsx examples/basic.ts
 */

import {
  resolveJsonCompletionContext,
  getJsonCompletions,
  validateParsedDocument,
} from "../src";

const schema = {
  type: "object",
  title: "User",
  properties: {
    id: { type: "integer", description: "Unique user identifier" },
    name: { type: "string", description: "Full name" },
    email: { type: "string", format: "email" },
    role: { type: "string", enum: ["admin", "editor", "viewer"] },
    active: { type: "boolean", default: true },
  },
  required: ["id", "name"],
} as const;

const document = `{
  "id": 1,
  "name": "`;

console.log("=== JSON Completion Example ===\n");

/* Resolve completion context at the cursor position (after "name": ") */
const offset = document.indexOf('"name": "') + '"name": "'.length;
const context = resolveJsonCompletionContext(document, offset, schema);

console.log(`Completion kind: ${context.kind}`);
console.log(`Current word: "${context.currentWord}"`);
console.log(`Container path: ${JSON.stringify(context.containerPath)}`);
console.log();

/* Get completions */
const completions = getJsonCompletions(document, context, schema);

console.log(`Found ${completions.length} completions:`);
for (const completion of completions.slice(0, 10)) {
  console.log(`  - ${completion.label} (${completion.detail ?? "no detail"})`);
  console.log(`    insert: ${completion.insertText}`);
}

console.log("\n=== Validation Example ===\n");

const validDocument = { id: 1, name: "Alice", role: "admin" };
const invalidDocument = { id: "not-a-number", role: "superuser" };

console.log("Valid document errors:", validateParsedDocument(validDocument, schema).length);
console.log(
  "Invalid document errors:",
  validateParsedDocument(invalidDocument, schema).map((d) => d.message),
);
