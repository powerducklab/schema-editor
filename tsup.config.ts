import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    core: "src/core/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  injectStyle: true,
  minify: "terser",
  terserOptions: {
    compress: {
      drop_console: false,
      passes: 2,
    },
    mangle: {
      keep_classnames: true,
    },
  },
  external: [
    "react",
    "react-dom",
    "@monaco-editor/react",
    "monaco-editor",
  ],
  noExternal: [
    /*
     * These packages are bundled into both output formats to avoid:
     *   - json-schema-faker 0.6.x being ESM-only (CJS require fails)
     *   - ajv subpath imports missing .js extensions in strict ESM
     *   - jsonc-parser and js-yaml being pure-JS but keeping them bundled
     *     ensures a self-contained package with zero runtime resolution risk
     */
    "json-schema-faker",
    "ajv",
    "ajv-formats",
    "jsonc-parser",
    "js-yaml",
  ],
  banner: {
    js: "/** @powerduck/schema-editor — MIT License */",
  },
});
