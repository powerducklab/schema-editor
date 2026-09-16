# Schema editor review — September 16, 2026

Current theme policy: one shared theme per page, using native Monaco `vs` / `vs-dark`. Earlier mixed-theme work below is historical and has been removed.

## Assessment

The existing separation between schema utilities, language services, and React integration is useful. The main risks were lifecycle races and heuristic edits rather than a lack of editor features. The baseline had 225 passing core tests but no React lifecycle coverage. UI colors mixed Monaco defaults with host surfaces, and an absolute diagnostics panel covered the document.

This iteration fixes the highest-impact issues and adds reproducible checks. It does not establish a universal 9.5/10 score: that would require a defined workload, supported dialect matrix, assistive-technology coverage, and sustained performance budgets.

## Changes

- Isolated sample caches by both schema and root identity; made cache clearing effective and normalized depth limits.
- Corrected false-schema validation, numeric object-key paths, inherited-property reference lookup, and empty-key JSON pointers.
- Replaced recursive reference indexing with an iterative traversal. Bounded completion-oriented resolution to 2,048 visits, 64 branches, and 16 intersection candidates. These limits do not change Ajv validation.
- Reused the latest YAML document index, capped cache retention at 512 Ki code units, and removed ambiguous path-map keys. Runtime completion caches now require matching source text.
- Invalidated pending diagnostics on document/schema/language changes; use the latest callback, cancel deferred work on unmount, and check model versions before publishing.
- Preserved syntax checking without a schema and exposed skipped validation for large documents.
- Replaced guessed text edits with semantic JSON edits; check model freshness and read-only state. Removed unsafe YAML automatic insertion. Fixes retain undo boundaries.
- Stopped treating schema documentation as trusted Markdown and generated completion values as snippets.
- Applied coherent light/dark surfaces, subdued borders, matching Monaco widget colors, focus outlines, consistent button heights, responsive messages, and hover/focus scrollbars. The diagnostics panel no longer overlays the editor.
- Added a local, offline-worker Monaco preview and React lifecycle regression tests.

## Verification

- 244 tests passed across 11 files, including 19 new core/lifecycle regression cases.
- TypeScript checking, production ESM/CJS builds, and both module smoke checks passed.
- Real Monaco browser checks: light/dark themes, nested required-property repair, undo, read-only fix protection, JSON/YAML/JavaScript switching, and a 390 × 844 viewport. The narrow layout kept actions within the panel. No captured warning/error logs during the inspected preview session.
- Source, tests, preview, examples, and README were scanned for Han characters; none were found. Comments and UI strings are English.
- Compatible dependency maintenance removed the reported high-severity development dependency advisory. Six audit findings remain in the development toolchain/Monaco dependency tree (two low, four moderate); automatic suggested fixes include major version changes or downgrades and were not applied blindly.

## Reproducible microbenchmark

Command: `npm run build && node scripts/benchmark.mjs`.

One local run on Node 23.10.0:

| Operation | Input | Result |
| --- | --- | --- |
| Cold YAML index | 2,000 lines / 43,779 characters | 4.586 ms |
| Cached YAML lookup | 10,000 repeated lookups | 0.279 ms total |
| Completion branch resolution | 10,000 alternatives | 64 candidates in 0.497 ms |

These are local microbenchmarks, not cross-device latency guarantees. Cached lookup timing measures index reuse, not end-to-end validation.

## Remaining limits

- Ajv validation and sample generation still run on the main thread after debouncing. Schema complexity, regular expressions, or unusually large explicit examples can be expensive even in small documents. Use trusted schemas; worker isolation is a future architectural improvement.
- Draft-04/06 handling is partial. The adapter does not establish full dialect conformance. Draft-07 and 2020-12 are the primary validation paths.
- Sample generation is best effort and does not guarantee that every compound or constrained schema produces a valid sample.
- Completion resolution intentionally approximates intersections and truncates pathological alternatives. It is not a replacement for validation.
- YAML automatic fixes remain disabled until a syntax-preserving edit strategy is available. Formatting and diagnostic navigation remain supported.
- Monaco still has a global theme service. Component surfaces, suggestion rows, and syntax colors are isolated per editor; unrelated Monaco UI elements outside these overrides may still use the global theme.
- React 18.3.1 and Monaco 0.56.0 were exercised here. The declared older peer ranges were not exhaustively retested. Screen-reader validation was limited to browser accessibility semantics.


## YAML interaction regression follow-up

The initial hardening removed the blank-line cursor listener, regressing schema-driven key suggestions. Follow-up work restores cursor/focus/content triggers with cleanup and read-only guards, and adds interaction-level coverage rather than relying on core completion tests alone.

Additional fixes: cursor-based blank-line indentation; prefix-only value replacement; quoted-key colon detection; required separator spaces; child indentation after object-key acceptance; enum/boolean popup routing; free-form value ghost text; typed-key previews; suppression of immediate popup reopening after value acceptance; and preservation of scalar string types.

Mixed light/dark editor verification exposed a second issue in Monaco's global syntax palette. Both themes now share explicit token IDs, with component-scoped syntax colors and suggestion foreground/background variables. Browser inspection confirmed separate white and dark surfaces and readable syntax in simultaneously mounted editors.

Follow-up validation: 268 tests, real Monaco missing-key menus, nested-key exclusion, boolean-value acceptance, free-form ghost acceptance with Tab, and object completion entering child indentation. Final production build and ESM/CJS checks were rerun.

## Nested indentation and cursor follow-up

YAML suggestions already carry absolute indentation. Monaco's default suggestion acceptance adjusted that whitespace a second time. YAML completion items now use `KeepWhitespace` without enabling snippet interpretation. A provider-level regression test covers a six-space key insertion and an eight-space child line.

Cursor colors also need direct scoped CSS: Monaco generates concrete global cursor rules, so overriding CSS variables alone is insufficient. Both cursor fill and border now follow each editor's text color, with the block-cursor text following its surface color.

Verification: 269 tests passed. In real Monaco, accepting `responses` and then `"204"` produced indentation widths of 0, 2, 4, 6, 8, and 10 spaces. Simultaneous dark/light editors reported cursor colors of RGB (237, 240, 243) and RGB (38, 40, 43), respectively. The preview includes a Nested YAML fixture for reproducing this sequence.

## Tab acceptance follow-up

Removed the YAML keydown override that always inserted spaces on blank lines. Monaco now owns Tab and Shift+Tab: Tab accepts a focused popup suggestion or visible inline completion and indents normally when neither is available. Implicit tab completion remains disabled so hidden suggestions do not consume indentation.

Verification: 271 tests passed, including Tab/Shift+Tab event ownership regressions. Real Monaco accepted `responses` with Tab, preserved the eight-space child indentation, and indented that line to ten spaces after dismissing the popup. Production build and ESM/CJS checks passed.


## Final theme simplification

The product uses one light/dark theme for the entire page. Removed custom Monaco theme definitions, encoded syntax token IDs, palette synchronization observers, and all CSS overrides targeting Monaco internals. The React wrapper now passes `vs` or `vs-dark` directly. Powerduck variables style only the surrounding component UI. The preview no longer mounts editors with conflicting themes.

This avoids incomplete per-widget overrides and lets Monaco own sticky-scroll backgrounds, gutters, syntax colors, cursors, suggestions, hover surfaces, and find controls together. All editors must receive the same page theme.

Verification: 271 regression tests, production build, and ESM/CJS smoke checks passed. Browser inspection confirmed `vs-dark`, native editor/sticky background `#1e1e1e`, and native find background `#252526`, without component overrides. The sticky widget was not visibly expanded in the long-YAML preview, so verification of that layer is limited to its native resolved theme value rather than a screenshot of the expanded header.
