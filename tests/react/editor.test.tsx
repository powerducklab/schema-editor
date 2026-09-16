// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaEditor } from "../../src/react/SchemaEditor";
const state = vi.hoisted(() => ({ keyListeners: [] as Array<(event: any) => void>, popupProvider: null as any, position: null as any, cursorListeners: [] as Array<() => void>, text: "{}", version: 1, language: "json", readOnly: false, listeners: [] as Array<() => void>, markerListeners: [] as Array<(uris: unknown[]) => void>, markers: [] as any[], props: null as any, editor: null as any, monaco: null as any }));
vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  const uri = { toString: () => state.props?.path ?? "model" };
  const model = { uri,
    getOffsetAt: (position: { lineNumber: number; column: number }) => state.text.split("\n").slice(0, position.lineNumber - 1).reduce((total, line) => total + line.length + 1, 0) + position.column - 1,
    getPositionAt: (offset: number) => { const lines = state.text.slice(0, offset).split("\n"); return { lineNumber: lines.length, column: lines[lines.length - 1]!.length + 1 }; }, getValue: () => state.text, getVersionId: () => state.version, getLanguageId: () => state.language, getValueLength: () => state.text.length, getLineCount: () => state.text.split("\n").length };
  const disposable = () => ({ dispose: vi.fn() });
  state.editor = { getModel: () => model, getOption: () => state.readOnly, onDidChangeModelContent: (fn: () => void) => { state.listeners.push(fn); return disposable(); }, onDidChangeCursorPosition: (fn: () => void) => { state.cursorListeners.push(fn); return { dispose() { state.cursorListeners = state.cursorListeners.filter(x => x !== fn); } }; }, onDidFocusEditorText: disposable, getPosition: () => state.position, hasTextFocus: () => true, trigger: vi.fn(), onDidDispose: disposable, onKeyDown: (fn: (event: any) => void) => { state.keyListeners.push(fn); return { dispose() { state.keyListeners = state.keyListeners.filter(x => x !== fn); } }; }, addAction: vi.fn(disposable), focus: vi.fn(), setPosition: vi.fn(), revealLineInCenter: vi.fn() };
  state.monaco = { KeyCode: { Tab: 2, Enter: 3 }, Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} }, editor: { EditorOption: { readOnly: 1 }, defineTheme: vi.fn(), setModelMarkers: (_: unknown, __: string, markers: any[]) => { state.markers = markers; state.markerListeners.forEach(fn => fn([uri])); }, getModelMarkers: () => state.markers, onDidChangeMarkers: (fn: (uris: unknown[]) => void) => { state.markerListeners.push(fn); return { dispose() { state.markerListeners = state.markerListeners.filter(x => x !== fn); } }; } }, languages: { CompletionItemKind: { Property: 9, Value: 12, Snippet: 27 }, CompletionItemInsertTextRule: { KeepWhitespace: 1 }, registerCompletionItemProvider: (_: string, provider: unknown) => { state.popupProvider = provider; return disposable(); }, registerInlineCompletionsProvider: disposable }, MarkerSeverity: { Error: 8, Warning: 4 } };
  return { default: (props: any) => {
    state.props = props; state.language = props.language; state.readOnly = props.options.readOnly;
    if (state.text !== props.value) { state.text = props.value; state.version++; }
    React.useEffect(() => { props.beforeMount(state.monaco); props.onMount(state.editor, state.monaco); }, []);
    return <div data-testid="editor" />;
  } };
});
async function settle() { await act(async () => { await vi.runAllTimersAsync(); }); }
beforeEach(() => { vi.useFakeTimers(); state.keyListeners = []; state.position = null; state.cursorListeners = []; state.editor.trigger.mockClear(); state.listeners = []; state.markers = []; state.markerListeners = []; state.text = "{}"; state.version = 1; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("editor lifecycle", () => {
  it("validates false schemas and supports keyboard-accessible diagnostics", async () => {
    render(<SchemaEditor value="{}" language="json" schema={false} />); await settle();
    expect(state.markers).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "Toggle diagnostics" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Diagnostics" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("region"), { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
  it("uses updated callbacks on edits and schema changes", async () => {
    const oldCallback = vi.fn(), newCallback = vi.fn();
    const view = render(<SchemaEditor value="{}" language="json" onDiagnostics={oldCallback} schema={false} />);
    await settle(); const oldCalls = oldCallback.mock.calls.length;
    view.rerender(<SchemaEditor value="{}" language="json" onDiagnostics={newCallback} schema={{}} />);
    await settle();
    act(() => state.listeners.forEach(fn => fn())); await settle();
    expect(oldCallback).toHaveBeenCalledTimes(oldCalls);
    expect(newCallback).toHaveBeenLastCalledWith([]);
  });
  it("discards a pending diagnostic when language changes", async () => {
    const callback = vi.fn();
    const view = render(<SchemaEditor value="{}" language="json" schema={false} onDiagnostics={callback} />);
    view.rerender(<SchemaEditor value="{}" language="javascript" schema={false} onDiagnostics={callback} />);
    await settle(); expect(state.markers).toEqual([]); expect(callback).toHaveBeenLastCalledWith([]);
  });
  it("does not call consumers after unmount", async () => {
    const callback = vi.fn();
    const view = render(<SchemaEditor value="{}" language="json" schema={false} onDiagnostics={callback} />);
    view.unmount(); await settle(); expect(callback).not.toHaveBeenCalled();
  });
  it("checks syntax without a schema", async () => {
    render(<SchemaEditor value="{" language="json" />); await settle(); expect(state.markers).toHaveLength(1);
  });
  it("disables fixes in read-only mode", async () => {
    render(<SchemaEditor value="{}" language="json" readOnly schema={{ required: ["name"], properties: { name: { type: "string" } } }} />);
    await settle(); fireEvent.click(screen.getByRole("button", { name: "Toggle diagnostics" }));
    expect((screen.getByRole("button", { name: "Fix" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("reports skipped large-document validation", async () => {
    render(<SchemaEditor value={" ".repeat(512001)} language="json" schema={false} />); await settle();
    expect(screen.getByText("Validation paused: large document")).toBeTruthy();
  });
});


describe("automatic YAML suggestions", () => {
  const schema = { properties: { openapi: { const: "3.2.0" }, info: { type: "object" }, name: { default: "Example" }, status: { enum: ["active", "pending"] } } };
  it("opens missing-key suggestions when entering a blank line", async () => {
    state.position = { lineNumber: 2, column: 1 };
    render(<SchemaEditor value="openapi: 3.2.0\n" language="yaml" schema={schema} />);
    await settle();
    expect(state.editor.trigger).toHaveBeenCalledWith("schema-editor", "editor.action.triggerSuggest", {});
  });
  it("switches ordinary values to ghost text", async () => {
    state.position = { lineNumber: 1, column: 7 };
    render(<SchemaEditor value="name: " language="yaml" schema={schema} />);
    await settle();
    expect(state.editor.trigger).toHaveBeenCalledWith("schema-editor", "hideSuggestWidget", {});
    expect(state.editor.trigger).toHaveBeenCalledWith("schema-editor", "editor.action.inlineSuggest.trigger", {});
  });
  it("opens choices for an enum value", async () => {
    state.position = { lineNumber: 1, column: 9 };
    render(<SchemaEditor value="status: " language="yaml" schema={schema} />);
    await settle(); expect(state.editor.trigger).toHaveBeenCalledWith("schema-editor", "editor.action.triggerSuggest", {});
  });
  it("does not open a popup when completion is disabled", async () => {
    state.position = { lineNumber: 2, column: 1 };
    render(<SchemaEditor value="openapi: 3.2.0\n" language="yaml" schema={schema} enableCompletion={false} />);
    await settle(); expect(state.editor.trigger).not.toHaveBeenCalledWith("schema-editor", "editor.action.triggerSuggest", {});
  });
  it("cancels cursor listeners and pending triggers on unmount", async () => {
    state.position = { lineNumber: 2, column: 1 };
    const view = render(<SchemaEditor value="openapi: 3.2.0\n" language="yaml" schema={schema} />);
    view.unmount(); await settle(); expect(state.cursorListeners).toHaveLength(0); expect(state.editor.trigger).not.toHaveBeenCalled();
  });
  it("uses native Monaco themes when the page theme changes", () => {
    const view = render(<SchemaEditor value="" language="yaml" theme="dark" />);
    expect(state.props.theme).toBe("vs-dark");
    view.rerender(<SchemaEditor value="" language="yaml" theme="light" />);
    expect(state.props.theme).toBe("vs");
  });
});


describe("nested YAML insertion", () => {
  it("keeps absolute indentation when accepting a nested key", () => {
    const schema = { properties: { paths: { type: "object", properties: { "/xxx": { type: "object", properties: { delete: { type: "object", properties: { responses: { type: "object" } } } } } } } } };
    const text = "paths:\n  /xxx:\n    delete:\n      ";
    render(<SchemaEditor value={text} language="yaml" schema={schema} />);
    const result = state.popupProvider.provideCompletionItems(state.editor.getModel(), { lineNumber: 4, column: 7 });
    const response = result.suggestions.find((item: any) => item.label === "responses");
    expect(response.insertText).toBe("responses:\n        ");
    expect(response.insertTextRules).toBe(1);
    expect(response.range.startColumn).toBe(7);
  });
});


describe("YAML Tab ownership", () => {
  it.each([false, true])("leaves Tab handling to Monaco (shift=%s)", shiftKey => {
    render(<SchemaEditor value="paths:\n  " language="yaml" schema={{ properties: { paths: { type: "object" } } }} />);
    const event = { keyCode: state.monaco.KeyCode.Tab, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(state.keyListeners).toHaveLength(1);
    act(() => state.keyListeners.forEach(listener => listener(event)));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
