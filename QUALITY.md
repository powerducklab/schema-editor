# Schema editor review — September 16, 2026

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
- Monaco themes are global. Coordinate themes across simultaneous editors; host CSS tokens control component surfaces, while Monaco widget colors use matching concrete defaults.
- React 18.3.1 and Monaco 0.56.0 were exercised here. The declared older peer ranges were not exhaustively retested. Screen-reader validation was limited to browser accessibility semantics.
