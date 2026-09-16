import type * as Monaco from "monaco-editor";

/** Monaco needs concrete colors; CSS surfaces continue to inherit host tokens. */
export function defineEditorThemes(monaco: typeof Monaco): void {
  for (const dark of [false, true]) {
    const surface = dark ? "#1f2125" : "#ffffff";
    const foreground = dark ? "#edf0f3" : "#26282b";
    const border = dark ? "#3b4149" : "#e0e4e8";
    monaco.editor.defineTheme(dark ? "powerduck-dark" : "powerduck-light", {
      base: dark ? "vs-dark" : "vs", inherit: true, rules: [], colors: {
        "editor.background": surface, "editor.foreground": foreground,
        "editorGutter.background": surface,
        "editorWidget.background": surface, "editorWidget.border": border,
        "editorSuggestWidget.background": surface, "editorSuggestWidget.border": border,
        "editorSuggestWidget.foreground": foreground,
        "editorSuggestWidget.selectedBackground": dark ? "#343941" : "#eef0f2",
        "editorSuggestWidget.highlightForeground": dark ? "#ffc98c" : "#d97818",
        "editorHoverWidget.background": surface, "editorHoverWidget.border": border,
        "editorLineNumber.foreground": dark ? "#89919c" : "#989da5",
        "editor.lineHighlightBackground": dark ? "#2b2f35" : "#f4f5f6",
        "editor.selectionBackground": dark ? "#525a6580" : "#ccd2d880",
        "focusBorder": dark ? "#f4a04a" : "#f28c28",
        "scrollbarSlider.background": dark ? "#89919c50" : "#989da550",
        "scrollbarSlider.hoverBackground": dark ? "#89919c80" : "#989da580",
      },
    });
  }
}
