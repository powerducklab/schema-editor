import type * as Monaco from "monaco-editor";

/** Monaco needs concrete colors; CSS surfaces continue to inherit host tokens. */
export function defineEditorThemes(monaco: typeof Monaco): void {
  for (const dark of [false, true]) {
    const surface = dark ? "#1f2125" : "#ffffff";
    const foreground = dark ? "#edf0f3" : "#26282b";
    const border = dark ? "#3b4149" : "#e0e4e8";
    monaco.editor.defineTheme(dark ? "powerduck-dark" : "powerduck-light", {
      base: dark ? "vs-dark" : "vs", inherit: false,
      // Fixed token IDs let each editor resolve its own syntax palette in CSS.
      encodedTokensColors: ["26282B", "FFFFFF", "6F747C", "A34538", "6C4BB5", "286BA6", "27766B", "C95555"],
      rules: [
        { token: "", foreground: "26282B", background: "FFFFFF" },
        { token: "comment", foreground: "6F747C" },
        { token: "string", foreground: "A34538" },
        { token: "string.key", foreground: "27766B" },
        { token: "keyword", foreground: "6C4BB5" },
        { token: "number", foreground: "286BA6" },
        { token: "type", foreground: "27766B" },
        { token: "tag", foreground: "27766B" },
        { token: "attribute.name", foreground: "27766B" },
        { token: "invalid", foreground: "C95555" },
      ], colors: {
        "editor.background": surface, "editor.foreground": foreground,
        "editorGutter.background": surface,
        "editorWidget.background": surface, "editorWidget.border": border,
        "editorSuggestWidget.background": surface, "editorSuggestWidget.border": border,
        "editorSuggestWidget.foreground": foreground,
        "editorSuggestWidget.selectedForeground": foreground,
        "editorSuggestWidget.selectedIconForeground": foreground,
        "editorSuggestWidget.focusHighlightForeground": dark ? "#ffc98c" : "#d97818",
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

const palettes = {
  light: { surface: "#ffffff", "surface-subtle": "#f8f9fa", "surface-hover": "#f4f5f6", "surface-selected": "#eef0f2", "text-primary": "#26282b", "text-secondary": "#6f747c", "text-tertiary": "#989da5", "text-disabled": "#c2c6cc", "border-default": "#e0e4e8", "border-subtle": "#eceff1", "border-strong": "#ccd2d8", accent: "#f28c28", danger: "#c95555", success: "#428961", info: "#4f79bf" },
  dark: { surface: "#1f2125", "surface-subtle": "#25282d", "surface-hover": "#2b2f35", "surface-selected": "#343941", "text-primary": "#edf0f3", "text-secondary": "#b8bec7", "text-tertiary": "#89919c", "text-disabled": "#69717c", "border-default": "#3b4149", "border-subtle": "#2d3239", "border-strong": "#525a65", accent: "#f4a04a", danger: "#ef7c7c", success: "#67bd89", info: "#82aef2" },
};

/** Isolate an explicitly different editor theme from inherited host colors. */
export function syncEditorPalette(container: HTMLElement, theme: "light" | "dark"): void {
  const host = container.parentElement?.closest("[data-theme]");
  const hostTheme = host?.getAttribute("data-theme") ?? document.documentElement.getAttribute("data-theme") ?? "light";
  for (const [key, value] of Object.entries(palettes[theme])) {
    if (hostTheme === theme) container.style.removeProperty(`--color-${key}`);
    else container.style.setProperty(`--color-${key}`, value);
  }
}
