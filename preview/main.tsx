import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import { SchemaEditor } from "../src/react";
import type { EditorLanguage } from "../src/types";
import "./preview.css";
self.MonacoEnvironment = { getWorker(_, label) { return label === "json" ? new JsonWorker() : ["typescript", "javascript"].includes(label) ? new TsWorker() : new EditorWorker(); } };
loader.config({ monaco });
const schema = { type: "object", required: ["name", "settings"], properties: { paths: { type: "object", properties: { "/xxx": { type: "object", properties: { delete: { type: "object", properties: { responses: { type: "object", properties: { "204": { type: "object", properties: { description: { type: "string" } } } } } } } } } } }, name: { type: "string", description: "A friendly project name." }, settings: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" }, region: { enum: ["us-east", "eu-west"] } } } } };
function App() {
  const [dark, setDark] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [language, setLanguage] = useState<EditorLanguage>("json");
  const [value, setValue] = useState('{\n  "name": "My project",\n  "settings": {}\n}');
  return <main data-theme={dark ? "dark" : "light"}><header><div><small>POWERDUCK / COMPONENT REVIEW</small><h1>Schema editor</h1><p>Precise feedback. A quieter workspace.</p></div><div className="controls"><button onClick={() => { setLanguage("yaml"); setValue("servers:\n" + Array.from({ length: 120 }, (_, index) => `  - url: \"https://api.example.com/v${index}\"\n    description: Server ${index}`).join("\n")); }}>Scroll YAML</button><button onClick={() => { setLanguage("yaml"); setValue("paths:\n  /xxx:\n    delete:\n      "); }}>Nested YAML</button><button onClick={() => setDark(!dark)}>{dark ? "Light theme" : "Dark theme"}</button><button onClick={() => setReadOnly(!readOnly)}>{readOnly ? "Enable editing" : "Read only"}</button><select aria-label="Language" value={language} onChange={e => { const lang = e.target.value as EditorLanguage; setLanguage(lang); setValue(lang === "yaml" ? "name: My project\nsettings:\n  region: us-east\n" : lang === "json" ? '{\n  "name": "My project",\n  "settings": {}\n}' : 'const project = "Powerduck";'); }}><option value="json">JSON</option><option value="yaml">YAML</option><option value="javascript">JavaScript</option></select></div></header><section><SchemaEditor options={{ stickyScroll: { enabled: true, defaultModel: "indentationModel" } }} value={value} onChange={setValue} language={language} schema={schema} theme={dark ? "dark" : "light"} readOnly={readOnly} /></section><p className="hint">Open diagnostics to locate an issue or apply a precise fix. Use Escape to return to the editor.</p></main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
