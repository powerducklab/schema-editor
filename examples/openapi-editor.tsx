/**
 * Example: Using SchemaEditor React component with OpenAPI 3.2 schema.
 *
 * This shows how to wire up the editor for OAS authoring with ghost
 * completion, enum dropdowns, and schema diagnostics.
 */

import { useState } from "react";
import { SchemaEditor } from "../src/react";

import type { JsonSchemaObject } from "../src/types";

/*
 * The official OpenAPI 3.2 JSON Schema would be loaded here. For this
 * example we use a simplified schema that demonstrates the key features.
 */
const openapiSchema: JsonSchemaObject = {
  type: "object",
  title: "OpenAPI 3.2 Document",
  properties: {
    openapi: {
      type: "string",
      enum: ["3.2.0"],
      description: "The OpenAPI Specification version.",
    },
    info: {
      type: "object",
      properties: {
        title: { type: "string" },
        version: { type: "string" },
        description: { type: "string" },
      },
      required: ["title", "version"],
    },
    paths: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          get: { $ref: "#/definitions/Operation" },
          post: { $ref: "#/definitions/Operation" },
          put: { $ref: "#/definitions/Operation" },
          delete: { $ref: "#/definitions/Operation" },
        },
      },
    },
    components: {
      type: "object",
      properties: {
        schemas: {
          type: "object",
          additionalProperties: { $ref: "#/definitions/Schema" },
        },
      },
    },
  },
  required: ["openapi", "info"],
  definitions: {
    Operation: {
      type: "object",
      properties: {
        summary: { type: "string" },
        description: { type: "string" },
        operationId: { type: "string" },
        parameters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              in: { type: "string", enum: ["query", "header", "path", "cookie"] },
              required: { type: "boolean" },
              schema: { $ref: "#/definitions/Schema" },
            },
            required: ["name", "in"],
          },
        },
        responses: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              description: { type: "string" },
            },
            required: ["description"],
          },
        },
      },
    },
    Schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["object", "array", "string", "number", "integer", "boolean", "null"],
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#/definitions/Schema" },
        },
        items: { $ref: "#/definitions/Schema" },
        required: { type: "array", items: { type: "string" } },
        enum: { type: "array" },
        description: { type: "string" },
      },
    },
  },
};

const initialValue = `{
  "openapi": "3.2.0",
  "info": {
    "title": "My API",
    "version": "1.0.0"
  },
  "paths": {}
}`;

export function OpenApiEditorExample() {
  const [value, setValue] = useState(initialValue);

  return (
    <div style={{ height: "600px", width: "100%" }}>
      <SchemaEditor
        value={value}
        onChange={setValue}
        language="json"
        schema={openapiSchema}
        theme="light"
        placeholder="Start typing your OpenAPI document..."
        onDiagnostics={(diagnostics) => {
          console.log(`Diagnostics: ${diagnostics.length} issues`);
        }}
      />
    </div>
  );
}

/*
 * YAML variant:
 *
 * <SchemaEditor
 *   value={yamlValue}
 *   onChange={setYamlValue}
 *   language="yaml"
 *   schema={openapiSchema}
 * />
 *
 * JavaScript variant (pre-test / test scripts):
 *
 * <SchemaEditor
 *   value={script}
 *   onChange={setScript}
 *   language="javascript"
 *   snippets={[
 *     'pm.test("Status code is 200", function () {',
 *     'pm.response.to.have.status(200);',
 *     'const jsonData = pm.response.json();',
 *   ]}
 * />
 */
