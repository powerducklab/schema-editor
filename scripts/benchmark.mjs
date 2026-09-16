import { performance } from "node:perf_hooks";
import { buildYamlIndex, resolveSchemas } from "../dist/index.js";
const text = Array.from({ length: 2000 }, (_, i) => `field_${i}: value_${i}`).join("\n");
const coldStart = performance.now();
const first = buildYamlIndex(text);
const coldMs = performance.now() - coldStart;
const warmStart = performance.now();
for (let i = 0; i < 10000; i++) {
  if (buildYamlIndex(text) !== first) throw new Error("YAML index reuse failed");
}
const warmMs = performance.now() - warmStart;
const schema = { anyOf: Array.from({ length: 10000 }, (_, i) => ({ const: i })) };
const resolutionStart = performance.now();
const count = resolveSchemas(schema, schema).length;
console.log(JSON.stringify({ node: process.version, yamlCharacters: text.length, yamlLines: 2000, coldIndexMs: +coldMs.toFixed(3), cachedLookups: 10000, cachedTotalMs: +warmMs.toFixed(3), branchInputCount: 10000, branchOutputCount: count, resolutionMs: +(performance.now() - resolutionStart).toFixed(3) }, null, 2));
