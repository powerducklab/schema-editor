// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaEditor } from "../../src/react/SchemaEditor";
const state = vi.hoisted(() => ({ text: "{}", version: 1, language: "json", readOnly: false, listeners: [] as Array<() => void>, markerListeners: [] as Array<(uris: unknown[]) => void>, markers: [] as any[], props: null as any, editor: null as any, monaco: null as any }));
vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  const uri = { toString: () => "model" };
  const model = { uri, getValue: () => state.text, getVersionId: () => state.version, getLanguageId: () => state.language, getLineCount: () => state.text.split("\n").length };
  const disposable = () => ({ dispose: vi.fn() });
  state.editor = { getModel: () => model, getOption: () => state.readOnly, onDidChangeModelContent: (fn: () => void) => { state.listeners.push(fn); return disposable(); }, onDidDispose: disposable, onKeyDown: disposable, addAction: vi.fn(disposable), focus: vi.fn(), setPosition: vi.fn(), revealLineInCenter: vi.fn() };
  state.monaco = { editor: { EditorOption: { readOnly: 1 }, defineTheme: vi.fn(), setModelMarkers: (_: unknown, __: string, markers: any[]) => { state.markers = markers; state.markerListeners.forEach(fn => fn([uri])); }, getModelMarkers: () => state.markers, onDidChangeMarkers: (fn: (uris: unknown[]) => void) => { state.markerListeners.push(fn); return { dispose() { state.markerListeners = state.markerListeners.filter(x => x !== fn); } }; } }, languages: { registerCompletionItemProvider: disposable, registerInlineCompletionsProvider: disposable }, MarkerSeverity: { Error: 8, Warning: 4 } };
  return { default: (props: any) => {
    state.props = props; state.language = props.language; state.readOnly = props.options.readOnly;
    if (state.text !== props.value) { state.text = props.value; state.version++; }
    React.useEffect(() => { props.beforeMount(state.monaco); props.onMount(state.editor, state.monaco); }, []);
    return <div data-testid="editor" />;
  } };
});
async function settle() { await act(async () => { await vi.runAllTimersAsync(); }); }
beforeEach(() => { vi.useFakeTimers(); state.listeners = []; state.markers = []; state.markerListeners = []; state.text = "{}"; state.version = 1; });
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
