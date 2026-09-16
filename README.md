# @powerduck/schema-editor

> Schema-aware Monaco editor for JSON, YAML, and JavaScript. Driven by any JSON Schema with ghost text, popup completion, enum dropdowns, example auto-fill, schema diagnostics with one-click fixes, and tolerant YAML formatting.

[![npm version](https://img.shields.io/npm/v/@powerduck/schema-editor.svg)](https://www.npmjs.com/package/@powerduck/schema-editor)
[![tests](https://img.shields.io/badge/tests-205%20passing-brightgreen)](https://github.com/powerducklab/schema-editor)
[![license](https://img.shields.io/npm/l/@powerduck/schema-editor.svg)](https://github.com/powerducklab/schema-editor/blob/main/LICENSE)

## Features

- **Schema-driven completion** — property keys, enum values, defaults, examples, and generated samples, all derived from the supplied JSON Schema.
- **Inline ghost text** — Tab to accept the best matching suggestion, rendered as ghost text at the cursor using Monaco's native `InlineCompletionsProvider`.
- **Three languages** — `json`, `yaml`, and `javascript` (snippet-based ghost completion).
- **Schema diagnostics** — Ajv-powered validation (draft-07 and 2020-12; legacy dialect support is partial) with precise line/column locations and human-readable fix suggestions.
- **One-click diagnostics fixes** — Locate jumps to the error position; Fix auto-resolves missing required properties, type mismatches (object/array), and more.
- **Tolerant YAML formatter** — Right-click **Format YAML** normalizes indentation and colon spacing even when the document has syntax errors.
- **Any JSON Schema** — works with the OpenAPI 3.2 schema, your own schemas, or anything in between.
- **Light / dark theme** — via CSS variables, compatible with your design system.
- **Performance** — cached reference indexes, cached sample generation, debounced diagnostics, large-document guard.

## Installation

```bash
npm install @powerduck/schema-editor @monaco-editor/react monaco-editor
```

### Peer dependencies

| Package | Required | Purpose |
|---|---|---|
| `react` | >= 17 | React component |
| `react-dom` | >= 17 | React component |
| `@monaco-editor/react` | >= 4.0 | Monaco React wrapper |
| `monaco-editor` | >= 0.30 | Monaco editor core |

## Quick Start

```tsx
import { useState } from "react";
import { SchemaEditor } from "@powerduck/schema-editor/react";

const userSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    role: { type: "string", enum: ["admin", "editor", "viewer"] },
    active: { type: "boolean", default: true },
  },
  required: ["id", "name"],
};

export function App() {
  const [value, setValue] = useState('{\n  "id": 1\n}');

  return (
    <div style={{ height: 400 }}>
      <SchemaEditor
        value={value}
        onChange={setValue}
        language="json"
        schema={userSchema}
        theme="light"
      />
    </div>
  );
}
```

## Use Cases

### A. OpenAPI 3.2 Authoring with Ghost Completion

Supply the official OpenAPI 3.2 JSON Schema. Users get:

- Ghost text suggestions as they type property names (`paths`, `components`, `schemas`...).
- Tab to accept the full suggestion.
- Dropdown selection for `enum` values (HTTP methods, parameter locations...).
- Auto-fill for properties with `default` or `examples`.
- Schema diagnostics with one-click Locate and Fix.
- Right-click **Format YAML** to normalize indentation and colon spacing.

```tsx
import { SchemaEditor } from "@powerduck/schema-editor/react";
import openapi32Schema from "./openapi-3.2.schema.json";

<SchemaEditor
  value={oasDocument}
  onChange={setOasDocument}
  language="yaml"
  schema={openapi32Schema}
  theme="dark"
/>
```

### B. Pre-test / Test Script Snippet Completion

For JavaScript mode, supply an array of snippet strings. Users get ghost completion matching the first line of each snippet. When a snippet is the unique match, it appears as ghost text directly (no popup); Tab accepts it.

```tsx
const testSnippets = [
  'pm.test("Status code is 200", () => {\n  pm.response.to.have.status(200);\n});',
  'pm.test("Response time < 500ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});',
  'const jsonData = pm.response.json();',
  'pm.environment.set("variable", jsonData.value);',
];

<SchemaEditor
  value={script}
  onChange={setScript}
  language="javascript"
  snippets={testSnippets}
/>
```

### C. Framework-Agnostic Core

The completion, validation, and formatting engines can be used without React:

```ts
import {
  resolveJsonCompletionContext,
  getJsonCompletions,
  getJsonInlineSuggestion,
  validateParsedDocument,
  formatYaml,
} from "@powerduck/schema-editor";

/* JSON completion */
const ctx = resolveJsonCompletionContext(text, cursorOffset, schema);
const completions = getJsonCompletions(text, ctx, schema);
const inline = getJsonInlineSuggestion(text, ctx, schema);

/* Schema validation */
const diagnostics = validateParsedDocument(parsedJson, schema);

/* Tolerant YAML formatting */
const formatted = formatYaml(yamlText);
```

## API Reference

### `<SchemaEditor />` Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | — | Editor content (controlled). |
| `onChange` | `(value: string) => void` | — | Content change callback. |
| `language` | `"json" \| "yaml" \| "javascript"` | — | Content language. |
| `schema` | `JsonSchema` | — | JSON Schema driving completion and diagnostics (json/yaml only). |
| `snippets` | `readonly string[]` | `[]` | Snippet strings for JavaScript ghost completion. |
| `theme` | `"light" \| "dark"` | `"light"` | Visual theme. |
| `readOnly` | `boolean` | `false` | Read-only mode. |
| `placeholder` | `string` | — | Placeholder text when empty. |
| `showDiagnostics` | `boolean` | `true` | Show the diagnostics status bar with Locate/Fix actions. |
| `enableInlineSuggestions` | `boolean` | `true` | Enable inline ghost text. |
| `enableCompletion` | `boolean` | `true` | Enable popup completion. |
| `diagnosticsDebounceMs` | `number` | `250` | Diagnostics debounce delay. |
| `onDiagnostics` | `(diagnostics: SchemaDiagnostic[]) => void` | — | Diagnostics change callback. |
| `editorRef` | `MutableRefObject<IStandaloneCodeEditor \| null>` | — | Ref to the Monaco editor instance (for tree navigation, etc.). |
| `extraOptions` | `IStandaloneEditorConstructionOptions` | — | Extra Monaco editor options (merged with defaults). |
| `style` | `CSSProperties` | — | Container style. |
| `className` | `string` | — | Container class name. |

### Core Exports (`@powerduck/schema-editor`)

#### Schema Resolution

| Export | Description |
|---|---|
| `resolveSchemas(schema, root)` | Resolve `$ref`, `allOf`, `anyOf`, `oneOf` with circular-reference protection. |
| `getSchemaTypes(schema)` | Get array of allowed types. |
| `schemaAllowsType(schema, type)` | Check if schema allows a given type. |
| `getPropertySchemas(schemas, name, root)` | Get property schemas by name. |
| `getItemSchemas(schemas, index, root)` | Get array item schemas. |
| `getKnownProperties(schemas, root)` | Get all known property names. |

#### Sample Generation

| Export | Description |
|---|---|
| `generateSample(schema, root, options?)` | Generate a sample value from a schema (cached). |
| `generateSampleForSchema(schema, root, options?)` | Generate a sample for a schema that may be `undefined`/`boolean`. |
| `clearSampleCache()` | Clear the sample cache. |

#### Diagnostics

| Export | Description |
|---|---|
| `validateParsedDocument(document, schema)` | Validate a parsed document against a schema. Returns `SchemaDiagnostic[]`. |
| `toEditorDiagnostics(diagnostics, index)` | Convert schema diagnostics to editor markers. |

#### JSON

| Export | Description |
|---|---|
| `buildJsonIndex(text)` | Build a fault-tolerant JSON document index. |
| `resolveJsonCompletionContext(text, offset, schema)` | Resolve the completion context at a cursor offset. |
| `getJsonCompletions(text, context, schema)` | Get popup completion suggestions. |
| `getJsonInlineSuggestion(text, context, schema)` | Get the best inline ghost suggestion. |

#### YAML

| Export | Description |
|---|---|
| `buildYamlIndex(text)` | Build a line-based YAML structural index. |
| `resolveYamlCompletionContext(text, line, col, schema)` | Resolve the completion context at a cursor position. |
| `getYamlCompletions(context, schema)` | Get popup completion suggestions. |
| `getYamlInlineSuggestion(context, schema)` | Get the best inline ghost suggestion. |
| `formatYaml(text)` | Tolerant YAML formatter (normalizes indentation + colon spacing). |
| `findYamlColonSpacingIssues(text)` | Find colon spacing issues in YAML. |
| `rangeOfPath(index, path)` | Map a JSON path to a document line range (for tree navigation). |

#### JavaScript

| Export | Description |
|---|---|
| `resolveJavascriptCompletionContext(text, offset)` | Resolve the completion context (prefix + replace range). |
| `getJavascriptCompletions(context, snippets)` | Get popup completion suggestions from snippets. |
| `getJavascriptInlineSuggestion(context, snippets)` | Get the best inline ghost suggestion from snippets. |

### Types

```ts
interface SchemaDiagnostic {
  message: string;
  path: (string | number)[];
  severity: "error" | "warning";
  source: string;
  fix?: string;
}

type JsonSchema = boolean | JsonSchemaObject;

interface JsonSchemaObject {
  type?: string | readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  examples?: readonly unknown[];
  // ... all standard JSON Schema keywords
}
```

## Architecture

```
src/
├── index.ts                    # Main entry (framework-agnostic)
├── types.ts                    # Shared types (JsonSchema, SchemaDiagnostic, etc.)
├── core/
│   ├── schema-resolver.ts      # $ref, allOf, anyOf, oneOf resolution + circular-ref guard
│   ├── sample.ts               # Schema-driven sample generation (WeakMap cache + scalar fast path)
│   └── diagnostics.ts          # Ajv validation and legacy dialect adaptation + error mapping + dedupe
├── json/
│   ├── document-index.ts       # jsonc-parser-based fault-tolerant document index
│   └── completion.ts           # JSON completion engine (4 contexts + bounded cache)
├── yaml/
│   ├── document-index.ts       # Line-based YAML structural index (mapping/sequence/scope tracking)
│   ├── completion.ts           # Schema-driven YAML completion engine
│   └── format.ts               # Tolerant YAML formatter (two-tier: js-yaml + line-based)
├── javascript/
│   └── completion.ts           # Snippet-based completion (prefix matching + unique-match ghost)
└── react/
    ├── SchemaEditor.tsx        # React component (@monaco-editor/react wrapper)
    ├── SchemaEditor.css        # Styles (CSS variables, pde- prefix)
    └── index.ts
```

### Design Principles

1. **Editor isolation** — Each `SchemaEditor` instance gets a unique model URI. Completion and inline-suggestion providers validate the model URI before returning results, preventing cross-editor interference.
2. **Native ghost text** — Uses Monaco's `InlineCompletionsProvider` (not custom `deltaDecorations`) for zero-overhead, flicker-free ghost text.
3. **Fault tolerance** — JSON parsing uses `jsonc-parser` (tolerates syntax errors). YAML indexing is line-based (never throws). Diagnostics are wrapped in try/catch with stale-version guards.
4. **Caching at every layer** — Schema resolution (`WeakMap`), sample generation (`WeakMap` + depth `Map`), completion context (LRU), document index (latest-text), Ajv validators (`WeakMap`).

## Performance

| Optimization | Where |
|---|---|
| Reference index cache | `WeakMap` keyed by root schema identity |
| Sample generation cache | Schema and root identity, plus normalized depth; explicitly clearable |
| Completion context cache | Bounded FIFO (8 entries), checked against full source text and schema |
| Document index cache | Latest-text cache in json/yaml indexers |
| Debounced diagnostics | 250ms default, stale-version guard |
| Large document guard | Diagnostics and completion skipped for documents > 512,000 UTF-16 code units |
| Ajv validator cache | `WeakMap` keyed by schema identity |
| Word-based suggestions disabled | Prevents Monaco document-word completions from interfering with schema completions |

## Tree Navigation (Future-Ready)

The library exposes primitives for building a schema tree navigator that jumps the editor to a specific line:

```ts
import { buildYamlIndex, rangeOfPath } from "@powerduck/schema-editor";

const index = buildYamlIndex(yamlText);
const range = rangeOfPath(index, ["paths", "/users", "get", "responses", "200"]);

// Jump editor to line
editor.setPosition({ lineNumber: range.startLine, column: 1 });
editor.revealLineInCenter(range.startLine);
```

The `editorRef` prop provides direct access to the Monaco `IStandaloneCodeEditor` instance for custom navigation commands.

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Run tests (205 tests across 9 files)
npm test

# Build (ESM + CJS + .d.ts, CSS inlined)
npm run build

# Verify both module formats
npm run verify
```

### Project Scripts

| Script | Description |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest --watch` |
| `npm run build` | `tsup` (ESM + CJS + declarations) |
| `npm run verify` | Verify ESM/CJS outputs load correctly |

## License

MIT © Powerduck limited


## Interaction and validation guarantees

The editor inherits Powerduck `--color-*` tokens for its surfaces and controls, with standalone light and dark defaults. An explicitly different editor theme receives a local Powerduck palette. Editor surfaces, suggestion rows, and syntax tokens are scoped so light and dark editors can be mounted together. Monaco still uses a global theme service for UI elements not overridden by the component.

The diagnostics panel occupies layout space instead of covering code. Its toggle is keyboard accessible, Escape returns focus to the editor, and panel scrollbars appear on hover or keyboard focus. Read-only editors cannot apply automatic fixes or YAML formatting.

Automatic fixes are intentionally conservative. JSON required-property insertion and null-to-object/array replacement use semantic paths, check the current model version, and participate in undo. YAML diagnostics provide locations and textual guidance; ambiguous YAML edits are not automated. Syntax diagnostics work without a schema, and large-document validation is explicitly labeled as paused.

Treat schemas and cached results as immutable. Call `clearSampleCache()` when explicitly invalidating generated samples; replace a schema object to invalidate its compiled validator and reference index. Generated samples are suggestions, not proof of schema validity.

Run `npm run preview:dev` for the local Monaco preview, `npm test` for regression tests, and `npm run build && node scripts/benchmark.mjs` for the reproducible microbenchmark. See [QUALITY.md](./QUALITY.md) for verification evidence and remaining limits.


### YAML completion interaction

Moving the caret to a blank YAML line opens missing-key suggestions for its indentation level. Keys already present in that mapping are excluded. Typing a matching key prefix previews the completion; accepting an object key enters its child indentation. Enum and boolean values use a popup. Ordinary values use schema-driven ghost text, accepted with Tab. Disabling inline suggestions keeps value completions available in the popup.

Value completion replaces only the typed value prefix. It preserves the key, supplies a missing separator space, and quotes string values that YAML would otherwise interpret as booleans, numbers, nulls, or timestamps. An accepted value does not immediately reopen its popup. Automatic triggers honor read-only mode and completion settings and are disposed on language changes or unmount.
