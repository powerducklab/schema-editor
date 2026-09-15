/**
 * SchemaEditor — a schema-aware Monaco editor for JSON, YAML, and JavaScript.
 *
 * Features:
 *   - JSON Schema-driven popup completion (property keys, enum values, defaults,
 *     examples, generated samples).
 *   - Inline ghost text suggestions (Tab to accept).
 *   - Schema diagnostics with fix suggestions.
 *   - Light / dark theme via CSS variables.
 *   - Debounced diagnostics and stale-request protection.
 *
 * Performance:
 *   - Completion providers are registered once per language.
 *   - Diagnostics run on a debounced timer (250ms).
 *   - Schema resolution and sample generation are cached at the core layer.
 *   - Large documents (>500KB) skip diagnostics to keep typing responsive.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";

import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";

import type * as Monaco from "monaco-editor";

import { load as parseYaml } from "js-yaml";

import { isSchemaObject } from "../core/schema-resolver";
import { validateParsedDocument, toEditorDiagnostics } from "../core/diagnostics";

import {
  buildJsonIndex,
  clearJsonIndexCache,
  rangeOfPath as jsonRangeOfPath,
  resolveJsonCompletionContext,
  getJsonCompletions,
  getJsonInlineSuggestion,
  clearJsonCompletionCaches,
} from "../json";

import {
  buildYamlIndex,
  findCurrentLine,
  findYamlColonSpacingIssues,
  rangeOfPath as yamlRangeOfPath,
  resolveYamlCompletionContext,
  getYamlCompletions,
  getYamlInlineSuggestion,
  formatYaml,
} from "../yaml";

import {
  resolveJavascriptCompletionContext,
  getJavascriptCompletions,
} from "../javascript";

import type {
  CompletionSuggestion,
  Diagnostic,
  EditorLanguage,
  EditorTheme,
  JsonSchema,
} from "../types";

import "./SchemaEditor.css";

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface SchemaEditorProps {
  value: string;
  onChange?: (value: string) => void;

  /** Content language. Determines the parser and completion model. */
  language: EditorLanguage;

  /** JSON Schema driving completion and diagnostics (json / yaml only). */
  schema?: JsonSchema;

  /** Snippet strings for JavaScript ghost completion (javascript only). */
  snippets?: string[];

  /** Visual theme. Defaults to "light". */
  theme?: EditorTheme;

  readOnly?: boolean;
  placeholder?: string;

  /** Show the diagnostics status bar at the bottom. Defaults to true. */
  showDiagnostics?: boolean;

  /** Enable inline ghost text suggestions. Defaults to true. */
  enableInlineSuggestions?: boolean;

  /** Enable popup completion. Defaults to true. */
  enableCompletion?: boolean;

  /** Debounce delay for diagnostics in milliseconds. Defaults to 250. */
  diagnosticsDebounceMs?: number;

  /** Called whenever diagnostics change. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;

  /** Ref to the underlying Monaco editor instance. */
  editorRef?: MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;

  /** Extra Monaco editor options. */
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;

  style?: CSSProperties;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const LARGE_DOCUMENT_THRESHOLD = 500 * 1024;
const DEFAULT_DIAGNOSTICS_DEBOUNCE = 250;

const MONACO_LANGUAGE_MAP: Record<EditorLanguage, string> = {
  json: "json",
  yaml: "yaml",
  javascript: "javascript",
};

/**
 * Resolve the editor language from a Monaco model's language id.
 * Used inside completion providers so that they never depend on component
 * instance refs (which can be stale when multiple editors are mounted).
 */
function languageFromModel(model: Monaco.editor.ITextModel): EditorLanguage {
  const id = model.getLanguageId();
  if (id === "json") return "json";
  if (id === "yaml") return "yaml";
  return "javascript";
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toMonacoCompletionItem(
  suggestion: CompletionSuggestion,
  monaco: typeof Monaco,
  range: Monaco.IRange,
): Monaco.languages.CompletionItem {
  return {
    label: suggestion.label,
    detail: suggestion.detail,
    documentation: suggestion.documentation
      ? { value: suggestion.documentation, isTrusted: true }
      : undefined,
    insertText: suggestion.insertText,
    filterText: suggestion.filterText,
    sortText: suggestion.sortText,
    range,
    kind:
      suggestion.kind === "property"
        ? monaco.languages.CompletionItemKind.Property
        : suggestion.kind === "value"
          ? monaco.languages.CompletionItemKind.Value
          : monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    tags: suggestion.deprecated
      ? [monaco.languages.CompletionItemTag.Deprecated]
      : undefined,
  };
}

function toMonacoMarker(
  diagnostic: Diagnostic,
  monaco: typeof Monaco,
): Monaco.editor.IMarkerData {
  return {
    message: diagnostic.message,
    severity:
      diagnostic.severity === "error"
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.column,
    endLineNumber: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    source: diagnostic.source,
  };
}

/* -------------------------------------------------------------------------- */
/* YAML smart enter                                                            */
/* -------------------------------------------------------------------------- */

const SMART_ENTER_SOURCE = "schema-editor-smart-enter";

function isBlockScalarIndicator(value: string | undefined): boolean {
  return (
    value !== undefined && /^[|>][+-]?\d?$|^[|>]\d?[+-]?$/.test(value.trim())
  );
}

/**
 * Compute the indentation of the line created by pressing Enter at the end of
 * `lineNumber`. Returns undefined when the default editor behavior should be
 * used instead.
 *
 * Rules (derived from the YAML index so that they match completion):
 *   - name: id          -> aligned with `name`
 *   - schema:           -> `schema` column + 2
 *   -                   -> dash column + 2
 *   - value             -> dash column
 *   key:                -> key column + 2
 *   key: value          -> key column
 */
function getPreferredNewLineIndentation(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): number | undefined {
  const rawLine = model.getLineContent(position.lineNumber);

  if (!rawLine.trim()) {
    return undefined;
  }

  /* Only handle Enter at the logical end of the line. */
  const afterCursor = rawLine.slice(position.column - 1);

  if (afterCursor.trim().length > 0) {
    return undefined;
  }

  const index = buildYamlIndex(model.getValue());
  const line = findCurrentLine(index, position.lineNumber);

  if (line.isBlank) {
    return undefined;
  }

  let indent: number;

  if (line.isSequence) {
    if (line.hasColon) {
      indent = line.childIndent;
    } else if (line.value === undefined) {
      indent = line.indent + 2;
    } else {
      indent = line.indent;
    }
  } else if (line.hasColon) {
    indent =
      line.value === undefined || isBlockScalarIndicator(line.value)
        ? line.indent + 2
        : line.indent;
  } else {
    indent = line.indent;
  }

  return Math.max(0, indent);
}

function installSmartEnterIndentation(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
): Monaco.IDisposable {
  /*
   * Use onKeyDown instead of editor.addCommand for Enter handling.
   *
   * editor.addCommand registers into Monaco's global command dispatcher, which
   * can misfire across multiple editor instances (the Enter key may reach the
   * wrong editor when several editors are mounted side by side). onKeyDown is
   * bound directly to this editor instance and can never fire for another editor.
   */
  return editor.onKeyDown((event: Monaco.IKeyboardEvent) => {
    /*
     * Tab on an empty (whitespace-only) line must indent, never accept a
     * suggest-widget item. The suggest popup is auto-opened after smart Enter,
     * and without this guard Monaco may route Tab into the widget and insert
     * the first completion (e.g. "delete") instead of indentation.
     */
    if (event.keyCode === monaco.KeyCode.Tab) {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (model && position) {
        const lineContent = model.getLineContent(position.lineNumber);
        if (lineContent.trim().length === 0) {
          event.preventDefault();
          event.stopPropagation();

          /*
           * Insert indentation directly via executeEdits. editor.action.tab
           * is unreliable here because preventDefault() disrupts Monaco's
           * internal command state. We use the model's tabSize (default 2)
           * and insert spaces (YAML convention).
           */
          const tabSize = model.getOptions().tabSize ?? 2;
          const insertText = " ".repeat(tabSize);
          const lineMaxCol = model.getLineMaxColumn(position.lineNumber);

          editor.executeEdits(SMART_ENTER_SOURCE, [
            {
              range: new monaco.Range(
                position.lineNumber,
                lineMaxCol,
                position.lineNumber,
                lineMaxCol,
              ),
              text: insertText,
              forceMoveMarkers: true,
            },
          ]);

          editor.setPosition(
            new monaco.Position(position.lineNumber, lineMaxCol + tabSize),
          );
          return;
        }
      }
    }

    if (event.keyCode !== monaco.KeyCode.Enter) {
      return;
    }

    /* Let Monaco handle Enter when a suggest widget or inline ghost is active. */
    if (editor.hasWidgetFocus()) {
      return;
    }

    const model = editor.getModel();
    const position = editor.getPosition();
    const selection = editor.getSelection();

    if (!model || !position) {
      return;
    }

    if (selection && !selection.isEmpty()) {
      return;
    }

    const indentation = getPreferredNewLineIndentation(model, position);

    if (indentation === undefined) {
      /* Default editor behavior. */
      return;
    }

    /*
     * Prevent Monaco's default Enter handling so we can insert the smart
     * indentation ourselves.
     */
    event.preventDefault();
    event.stopPropagation();

    const lineMaxColumn = model.getLineMaxColumn(position.lineNumber);

    editor.pushUndoStop();

    editor.executeEdits(SMART_ENTER_SOURCE, [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          lineMaxColumn,
        ),
        text: `\n${" ".repeat(indentation)}`,
        forceMoveMarkers: true,
      },
    ]);

    editor.setPosition(
      new monaco.Position(position.lineNumber + 1, indentation + 1),
    );

    editor.pushUndoStop();

    /* Trigger suggest on the new line for the next property. */
    setTimeout(() => {
      if (editor.hasTextFocus()) {
        editor.trigger(SMART_ENTER_SOURCE, "editor.action.triggerSuggest", {});
      }
    }, 0);
  });
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SchemaEditor(props: SchemaEditorProps): JSX.Element {
  const {
    value,
    onChange,
    language,
    schema,
    snippets = [],
    theme = "light",
    readOnly = false,
    placeholder,
    showDiagnostics = true,
    enableInlineSuggestions = true,
    enableCompletion = true,
    diagnosticsDebounceMs = DEFAULT_DIAGNOSTICS_DEBOUNCE,
    onDiagnostics,
    editorRef: externalEditorRef,
    options: extraOptions,
    style,
    className,
  } = props;

  const internalEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const modelUriRef = useRef<Monaco.Uri | null>(null);
  const mountedRef = useRef(true);
  const [editorReady, setEditorReady] = useRefState(false);

  /*
   * Unique model URI per instance. Ensures each editor has its own Monaco
   * model so typing, ghost text, and markers never leak across editors.
   * Generated once per instance and stable across re-renders.
   */
  const modelPath = useMemo(
    () => `inmemory://schema-editor/${Math.random().toString(36).slice(2, 10)}`,
    [],
  );
  const modelPathRef = useRef(modelPath);
  const diagnosticsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticsVersionRef = useRef(0);
  const completionProviderRef = useRef<Monaco.IDisposable | null>(null);
  const inlineProviderRef = useRef<Monaco.IDisposable | null>(null);
  const smartEnterDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const formatActionDisposableRef = useRef<Monaco.IDisposable | null>(null);

  const schemaRef = useRef(schema);
  const snippetsRef = useRef(snippets);
  const languageRef = useRef(language);

  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  useEffect(() => {
    snippetsRef.current = snippets;
  }, [snippets]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const setEditorRef = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor | null) => {
      internalEditorRef.current = editor;

      if (externalEditorRef) {
        externalEditorRef.current = editor;
      }
    },
    [externalEditorRef],
  );

  /* ------------------------------------------------------------------------ */
  /* Diagnostics                                                              */
  /* ------------------------------------------------------------------------ */

  const runDiagnostics = useCallback(() => {
    const editor = internalEditorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) {
      return;
    }

    const model = editor.getModel();

    if (!model) {
      return;
    }

    const text = model.getValue();
    const currentLanguage = languageRef.current;

    if (currentLanguage === "javascript") {
      monaco.editor.setModelMarkers(model, "schema-editor", []);
      onDiagnostics?.([]);
      return;
    }

    if (text.length > LARGE_DOCUMENT_THRESHOLD) {
      monaco.editor.setModelMarkers(model, "schema-editor", []);
      onDiagnostics?.([]);
      return;
    }

    const version = ++diagnosticsVersionRef.current;

    /* Parse and validate asynchronously to avoid blocking typing. */
    setTimeout(() => {
      /* Guard against unmount or stale request. */
      if (!mountedRef.current || version !== diagnosticsVersionRef.current) {
        return;
      }

      const currentEditor = internalEditorRef.current;

      if (!currentEditor || currentEditor !== editor) {
        return;
      }

      const currentModel = currentEditor.getModel();

      if (!currentModel || currentModel !== model) {
        return;
      }

      const root = isSchemaObject(schemaRef.current) ? schemaRef.current : undefined;

      if (!root) {
        monaco.editor.setModelMarkers(model, "schema-editor", []);
        onDiagnostics?.([]);
        return;
      }

      let document: unknown;
      let syntaxError: string | null = null;
      let syntaxLine = 1;
      let syntaxColumn = 1;

      try {
        if (currentLanguage === "json") {
          document = JSON.parse(text);
        } else {
          document = parseYaml(text);
        }
      } catch (error) {
        syntaxError = error instanceof Error ? error.message : "Syntax error.";

        /*
         * js-yaml attaches a `mark` object with 0-based line/column.
         * JSON.parse does not provide position info, so we fall back to
         * line 1 for JSON syntax errors.
         */
        const mark = (error as { mark?: { line?: number; column?: number } })?.mark;

        if (mark && typeof mark.line === "number" && typeof mark.column === "number") {
          syntaxLine = mark.line + 1;
          syntaxColumn = mark.column + 1;
        }
      }

      if (syntaxError) {
        const markers: Monaco.editor.IMarkerData[] = [
          {
            message: syntaxError,
            severity: monaco.MarkerSeverity.Error,
            startLineNumber: syntaxLine,
            startColumn: syntaxColumn,
            endLineNumber: syntaxLine,
            endColumn: syntaxColumn + 1,
            source: currentLanguage,
          },
        ];

        const diagnosticsList: Diagnostic[] = [
          {
            message: syntaxError,
            path: [],
            line: syntaxLine,
            column: syntaxColumn,
            endLine: syntaxLine,
            endColumn: syntaxColumn + 1,
            severity: "error",
            source: currentLanguage,
          },
        ];

        /* Colon spacing warnings are still useful even when parsing fails. */
        if (currentLanguage === "yaml") {
          for (const issue of findYamlColonSpacingIssues(text)) {
            markers.push({
              message: issue.message,
              severity: monaco.MarkerSeverity.Warning,
              startLineNumber: issue.line,
              startColumn: issue.column,
              endLineNumber: issue.line,
              endColumn: issue.column + 1,
              source: "yaml",
            });

            diagnosticsList.push({
              message: issue.message,
              path: [],
              line: issue.line,
              column: issue.column,
              endLine: issue.line,
              endColumn: issue.column + 1,
              severity: "warning",
              source: "yaml",
              fix: issue.fix,
            });
          }
        }

        monaco.editor.setModelMarkers(model, "schema-editor", markers);
        onDiagnostics?.(diagnosticsList);
        return;
      }

      let schemaDiagnostics: ReturnType<typeof validateParsedDocument> = [];

      try {
        schemaDiagnostics = validateParsedDocument(document, root);
      } catch {
        /*
         * validateParsedDocument should never throw, but if it does (e.g. a
         * malformed schema with circular references), we must not crash the
         * diagnostics pipeline. Clear any stale markers and continue.
         */
        monaco.editor.setModelMarkers(model, "schema-editor", []);
        onDiagnostics?.([]);
        return;
      }

      /* Clamp a range to the document bounds so markers never land outside. */
      const totalLines = text.split("\n").length;

      const normalizeRange = (
        range: { line: number; column: number; endLine: number; endColumn: number },
      ) => {
        const safeLine = Math.max(1, Math.min(range.line, totalLines));
        const safeColumn = Math.max(1, range.column);
        const safeEndLine = Math.max(safeLine, Math.min(range.endLine, totalLines));
        const safeEndColumn =
          safeEndLine === safeLine
            ? Math.max(safeColumn + 1, range.endColumn)
            : Math.max(1, range.endColumn);

        return {
          line: safeLine,
          column: safeColumn,
          endLine: safeEndLine,
          endColumn: safeEndColumn,
        };
      };

      const locate = (path: Array<string | number>) => {
        /*
         * Root-level errors (missing required properties at the document root)
         * should not be pinned to line 1 col 1. Place the marker at the end
         * of the document so the user sees where the missing content belongs.
         */
        if (path.length === 0) {
          const lines = text.split("\n");
          const lastLineNumber = Math.max(1, lines.length);
          const lastLine = lines[lastLineNumber - 1] ?? "";
          const lastColumn = Math.max(1, lastLine.length + 1);

          return {
            line: lastLineNumber,
            column: lastColumn,
            endLine: lastLineNumber,
            endColumn: lastColumn + 1,
          };
        }

        let range: { line: number; column: number; endLine: number; endColumn: number };

        if (currentLanguage === "json") {
          const index = buildJsonIndex(text);
          range = jsonRangeOfPath(index, path);
        } else {
          const index = buildYamlIndex(text);
          range = yamlRangeOfPath(index, path);
        }

        return normalizeRange(range);
      };

      const editorDiagnostics = toEditorDiagnostics(schemaDiagnostics, locate);

      /* Append YAML colon spacing warnings. */
      if (currentLanguage === "yaml") {
        for (const issue of findYamlColonSpacingIssues(text)) {
          editorDiagnostics.push({
            message: issue.message,
            path: [],
            line: issue.line,
            column: issue.column,
            endLine: issue.line,
            endColumn: issue.column + 1,
            severity: "warning",
            source: "yaml",
            fix: issue.fix,
          });
        }
      }

      const markers = editorDiagnostics.map((d) => toMonacoMarker(d, monaco));

      monaco.editor.setModelMarkers(model, "schema-editor", markers);
      onDiagnostics?.(editorDiagnostics);
    }, 0);
  }, [onDiagnostics]);

  const scheduleDiagnostics = useCallback(() => {
    if (diagnosticsTimerRef.current) {
      clearTimeout(diagnosticsTimerRef.current);
    }

    diagnosticsTimerRef.current = setTimeout(runDiagnostics, diagnosticsDebounceMs);
  }, [runDiagnostics, diagnosticsDebounceMs]);

  /* ------------------------------------------------------------------------ */
  /* Native inline completions (ghost text)                                   */
  /* ------------------------------------------------------------------------ */

  const registerInlineCompletionsProvider = useCallback(
    (monaco: typeof Monaco): Monaco.IDisposable | null => {
      if (!enableInlineSuggestions) {
        return null;
      }

      const provider: Monaco.languages.InlineCompletionsProvider = {
        provideInlineCompletions: (
          model: Monaco.editor.ITextModel,
          position: Monaco.Position,
        ): Monaco.languages.InlineCompletions<Monaco.languages.InlineCompletion> => {
          /* Only serve this editor's own model — prevents cross-editor leaks. */
          if (model.uri.toString() !== modelPathRef.current) {
            return { items: [] };
          }

          const text = model.getValue();
          const offset = model.getOffsetAt(position);
          const currentLanguage = languageFromModel(model);
          const root = isSchemaObject(schemaRef.current) ? schemaRef.current : undefined;

          let suggestion: CompletionSuggestion | undefined;
          let replaceStart = offset;
          let replaceEnd = offset;

          if (currentLanguage === "json") {
            const context = resolveJsonCompletionContext(text, offset, root);
            suggestion = getJsonInlineSuggestion(text, context, root);
            replaceStart = Math.min(context.replaceStart, offset);
            replaceEnd = Math.max(offset, context.replaceEnd);

            const typed = text.slice(replaceStart, offset);
            if (typed.length > 0 && suggestion && !suggestion.insertText.startsWith(typed)) {
              return { items: [] };
            }
          } else if (currentLanguage === "yaml") {
            const context = resolveYamlCompletionContext(
              text,
              position.lineNumber,
              position.column,
              root,
            );
            suggestion = getYamlInlineSuggestion(context, root);

            const prefixLen = context.prefix.length;
            const startCol = Math.max(1, position.column - prefixLen);
            replaceStart = model.getOffsetAt({
              lineNumber: position.lineNumber,
              column: startCol,
            });
            replaceEnd = offset;
          } else {
            const context = resolveJavascriptCompletionContext(text, offset);

            if (context.prefix.length === 0) {
              return { items: [] };
            }

            const allSuggestions = getJavascriptCompletions(context, snippetsRef.current);

            if (allSuggestions.length === 0) {
              return { items: [] };
            }

            /*
             * When there is exactly one match, show it as ghost text immediately.
             * The "already typed" filter below is only meaningful when multiple
             * snippets compete — it prevents re-offering a snippet that was just
             * accepted. With one match, filtering it out would leave the user
             * with no ghost text at all.
             */
            if (allSuggestions.length === 1) {
              suggestion = allSuggestions[0];
            } else {
              const currentLine = model.getLineContent(position.lineNumber);

              for (const candidate of allSuggestions) {
                const firstLine = candidate.insertText.split("\n")[0] ?? candidate.insertText;
                if (!currentLine.includes(firstLine.trim())) {
                  suggestion = candidate;
                  break;
                }
              }
            }

            replaceStart = context.replaceStart;
            replaceEnd = context.replaceEnd;

            /*
             * Monaco renders inline ghost text starting from the cursor position
             * and does NOT subtract the already-typed prefix from insertText.
             * If we pass the full snippet (e.g. "pm.test(...)") while the user
             * has typed "pm", the ghost shows "pm.test(...)" right after "pm",
             * producing "pm.pm.test(...)" on acceptance.
             *
             * Fix: strip the typed prefix from insertText so the ghost shows only
             * the remaining portion (".test(...)"). The range stays empty so the
             * remaining text is simply appended at the cursor.
             */
            if (suggestion) {
              const typed = text.slice(replaceStart, replaceEnd);
              if (typed.length > 0 && suggestion.insertText.startsWith(typed)) {
                suggestion = {
                  ...suggestion,
                  insertText: suggestion.insertText.slice(typed.length),
                };
                replaceStart = offset;
                replaceEnd = offset;
              }
            }
          }

          if (!suggestion || suggestion.insertText.length === 0) {
            return { items: [] };
          }

          const startPos = model.getPositionAt(replaceStart);
          const endPos = model.getPositionAt(replaceEnd);
          const range = new monaco.Range(
            startPos.lineNumber,
            startPos.column,
            endPos.lineNumber,
            endPos.column,
          );

          return {
            items: [
              {
                insertText: suggestion.insertText,
                range,
              },
            ],
          };
        },

        disposeInlineCompletions() {
          /* Nothing to dispose. */
        },
      };

      return monaco.languages.registerInlineCompletionsProvider(
        MONACO_LANGUAGE_MAP[languageRef.current],
        provider,
      );
    },
    [enableInlineSuggestions],
  );

  /* ------------------------------------------------------------------------ */
  /* Completion provider registration                                         */
  /* ------------------------------------------------------------------------ */

  const registerCompletionProvider = useCallback(
    (monaco: typeof Monaco) => {
      if (!enableCompletion) {
        return;
      }

      const provider: Monaco.languages.CompletionItemProvider = {
        triggerCharacters: [".", ":", '"', "'", " ", "/"],

        provideCompletionItems: (
          model: Monaco.editor.ITextModel,
          position: Monaco.Position,
        ) => {
          /* Only serve this editor's own model — prevents cross-editor leaks. */
          if (model.uri.toString() !== modelPathRef.current) {
            return { suggestions: [] };
          }

          const text = model.getValue();
          const offset = model.getOffsetAt(position);
          const currentLanguage = languageFromModel(model);
          const root = isSchemaObject(schemaRef.current) ? schemaRef.current : undefined;

          let suggestions: CompletionSuggestion[] = [];
          let replaceStart = offset;
          let replaceEnd = offset;

          if (currentLanguage === "json") {
            const context = resolveJsonCompletionContext(text, offset, root);
            suggestions = getJsonCompletions(text, context, root);
            replaceStart = context.replaceStart;
            replaceEnd = context.replaceEnd;
          } else if (currentLanguage === "yaml") {
            const context = resolveYamlCompletionContext(
              text,
              position.lineNumber,
              position.column,
              root,
            );
            suggestions = getYamlCompletions(context, root);
            replaceStart = model.getOffsetAt({
              lineNumber: position.lineNumber,
              column: context.line.indent + 1,
            });
            replaceEnd = offset;
          } else {
            const context = resolveJavascriptCompletionContext(text, offset);
            suggestions = getJavascriptCompletions(context, snippetsRef.current);
            replaceStart = context.replaceStart;
            replaceEnd = context.replaceEnd;

            /*
             * For JavaScript snippets, when there is exactly one match and
             * inline ghost text is enabled, let the ghost provider take over
             * instead of opening a popup with a single item.
             */
            if (suggestions.length === 1 && enableInlineSuggestions) {
              return { suggestions: [] };
            }
          }

          if (suggestions.length === 0) {
            return { suggestions: [] };
          }

          const startPos = model.getPositionAt(replaceStart);
          const endPos = model.getPositionAt(replaceEnd);

          const range = new monaco.Range(
            startPos.lineNumber,
            startPos.column,
            endPos.lineNumber,
            endPos.column,
          );

          return {
            suggestions: suggestions.map((suggestion) =>
              toMonacoCompletionItem(suggestion, monaco, range),
            ),
          };
        },
      };

      return monaco.languages.registerCompletionItemProvider(
        MONACO_LANGUAGE_MAP[languageRef.current],
        provider,
      );
    },
    [enableCompletion, enableInlineSuggestions],
  );

  /* ------------------------------------------------------------------------ */
  /* Monaco lifecycle                                                         */
  /* ------------------------------------------------------------------------ */

  const beforeMount: BeforeMount = useCallback((monaco: typeof Monaco) => {
    monacoRef.current = monaco;
  }, []);

  const onMount: OnMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      setEditorRef(editor);
      monacoRef.current = monaco;
      setEditorReady(true);

      const model = editor.getModel();

      if (model) {
        modelUriRef.current = model.uri;
      }

      /*
       * Force a layout pass after the browser has computed flex/grid sizes.
       * Without this, Monaco can initialise at 0px height when the parent
       * container gets its height from a flex layout that has not settled yet.
       */
      requestAnimationFrame(() => {
        editor.layout();
      });
      setTimeout(() => editor.layout(), 100);

      /*
       * Dispose any previously registered providers before registering new
       * ones. This guards against duplicate registration when onMount is
       * invoked more than once (for example, during React StrictMode or
       * hot-module reloading).
       */
      completionProviderRef.current?.dispose();
      inlineProviderRef.current?.dispose();

      /* Register popup completion and native inline (ghost text) providers. */
      completionProviderRef.current = registerCompletionProvider(monaco) ?? null;
      inlineProviderRef.current = registerInlineCompletionsProvider(monaco) ?? null;

      /* YAML smart enter: auto-indent and trigger suggest on new line. */
      if (languageRef.current === "yaml") {
        smartEnterDisposableRef.current?.dispose();
        smartEnterDisposableRef.current = installSmartEnterIndentation(editor, monaco);

        /*
         * Register "Format YAML" in the editor context menu (right-click).
         * Uses the tolerant formatter: fixes indentation and colon spacing
         * even when the document has syntax errors.
         */
        formatActionDisposableRef.current?.dispose();
        formatActionDisposableRef.current = editor.addAction({
          id: "schema-editor-format-yaml",
          label: "Format YAML",
          contextMenuGroupId: "1_modification",
          contextMenuOrder: 1,
          run: (ed) => {
            const model = ed.getModel();
            if (!model) return;

            const original = model.getValue();
            const formatted = formatYaml(original);

            if (formatted === original) {
              return;
            }

            ed.pushUndoStop();
            ed.executeEdits("schema-editor-format", [
              {
                range: model.getFullModelRange(),
                text: formatted,
                forceMoveMarkers: false,
              },
            ]);
            ed.pushUndoStop();
          },
        });
      }

      /*
       * Trigger completion automatically when the cursor lands on an empty
       * line in YAML or JSON. Monaco does not invoke quick-suggest on lines
       * with zero word characters, so we trigger it manually for the common
       * case of navigating to a blank line to add a new property.
       */
      if (languageRef.current === "yaml" || languageRef.current === "json") {
        editor.onDidChangeCursorPosition((event) => {
          const model = editor.getModel();

          if (!model) {
            return;
          }

          const lineContent = model.getLineContent(event.position.lineNumber);

          if (lineContent.trim().length === 0) {
            /* Small delay so the cursor settles before the popup opens. */
            setTimeout(() => {
              if (editor.hasTextFocus()) {
                editor.trigger("schema-editor", "editor.action.triggerSuggest", {});
              }
            }, 50);
          }
        });
      }

      /* Run diagnostics on content change. */
      editor.onDidChangeModelContent(() => {
        scheduleDiagnostics();
      });

      /* Initial diagnostics. */
      scheduleDiagnostics();

      /* Cleanup on dispose. */
      editor.onDidDispose(() => {
        completionProviderRef.current?.dispose();
        completionProviderRef.current = null;

        inlineProviderRef.current?.dispose();
        inlineProviderRef.current = null;

        smartEnterDisposableRef.current?.dispose();
        smartEnterDisposableRef.current = null;

        formatActionDisposableRef.current?.dispose();
        formatActionDisposableRef.current = null;

        if (diagnosticsTimerRef.current) {
          clearTimeout(diagnosticsTimerRef.current);
        }

        clearJsonIndexCache();
        clearJsonCompletionCaches();
      });
    },
    [
      setEditorRef,
      registerCompletionProvider,
      registerInlineCompletionsProvider,
      scheduleDiagnostics,
    ],
  );

  /* ------------------------------------------------------------------------ */
  /* Re-register providers when language changes                              */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    const editor = internalEditorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) {
      return;
    }

    completionProviderRef.current?.dispose();
    inlineProviderRef.current?.dispose();

    completionProviderRef.current = registerCompletionProvider(monaco) ?? null;
    inlineProviderRef.current = registerInlineCompletionsProvider(monaco) ?? null;

    return () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
      inlineProviderRef.current?.dispose();
      inlineProviderRef.current = null;
    };
  }, [language, registerCompletionProvider, registerInlineCompletionsProvider]);

  /* ------------------------------------------------------------------------ */
  /* Cleanup                                                                  */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (diagnosticsTimerRef.current) {
        clearTimeout(diagnosticsTimerRef.current);
        diagnosticsTimerRef.current = null;
      }
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Editor options                                                           */
  /* ------------------------------------------------------------------------ */

  const editorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      renderLineHighlight: "all",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on",
      wrappingIndent: "indent",
      smoothScrolling: false,
      cursorBlinking: "blink",
      cursorSmoothCaretAnimation: "off",
      /*
       * Render overflow widgets (suggestion popup, find dialog, etc.) in a
       * fixed-position layer so they are never clipped by parent containers
       * with overflow:hidden (for example, the editor wrapper or a grid cell).
       */
      fixedOverflowWidgets: true,
      renderWhitespace: "selection",
      guides: {
        indentation: true,
      },
      /* Native inline ghost text + popup completion. */
      suggestOnTriggerCharacters: enableCompletion,
      quickSuggestions: {
        other: enableCompletion,
        comments: false,
        strings: enableCompletion,
      },
      /*
       * Disable word-based suggestions. Monaco's default word completer scans
       * the document for existing words and offers them as completions (the
       * "abc" items in the popup). These interfere with schema-driven
       * completion — for example, offering already-present property names or
       * random document words on an empty line. Schema completions are always
       * more relevant and should be the sole source.
       */
      wordBasedSuggestions: "off",
      inlineSuggest: {
        enabled: enableInlineSuggestions,
        mode: "subwordSmart",
      },
      /*
       * tabCompletion off means Tab always indents (or accepts inline ghost
       * text when visible). Popup suggestions are accepted with Enter. This
       * prevents Tab from accidentally inserting a property name when the
       * user just wants to indent on an empty line.
       */
      tabCompletion: "off",
      acceptSuggestionOnEnter: enableCompletion ? "on" : "off",
      ...extraOptions,
    }),
    [readOnly, extraOptions, enableCompletion, enableInlineSuggestions],
  );

  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";

  const containerClassName = ["pde-container", className].filter(Boolean).join(" ");

  const showPlaceholder = !!placeholder && value.length === 0 && !readOnly;

  return (
    <div className={containerClassName} style={style} data-theme={theme}>
      <div className="pde-editor-wrapper">
        <Editor
          height="100%"
          width="100%"
          path={modelPath}
          language={MONACO_LANGUAGE_MAP[language]}
          theme={monacoTheme}
          value={value}
          onChange={(newValue: string | undefined) => onChange?.(newValue ?? "")}
          beforeMount={beforeMount}
          onMount={onMount}
          options={editorOptions}
          loading={null}
        />
      </div>

      {showPlaceholder && <div className="pde-placeholder">{placeholder}</div>}

      {showDiagnostics && (
        <DiagnosticsBar
          editorRef={internalEditorRef}
          monaco={monacoRef}
          language={language}
          editorReady={editorReady}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Diagnostics bar                                                            */
/* -------------------------------------------------------------------------- */

interface DiagnosticsBarProps {
  editorRef: MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  monaco: MutableRefObject<typeof Monaco | null>;
  language: EditorLanguage;
  editorReady: boolean;
}

function DiagnosticsBar({ editorRef, monaco: monacoRef, language, editorReady }: DiagnosticsBarProps): JSX.Element {
  const [markers, setMarkers] = useRefState<Monaco.editor.IMarker[]>([]);
  const [expanded, setExpanded] = useRefState(false);

  useEffect(() => {
    if (!editorReady) {
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) {
      return;
    }

    const update = (): void => {
      const model = editor.getModel();

      if (!model) {
        setMarkers([]);
        return;
      }

      const all = monaco.editor.getModelMarkers({ resource: model.uri });
      const sorted = [...all].sort((a, b) => {
        if (a.startLineNumber !== b.startLineNumber) {
          return a.startLineNumber - b.startLineNumber;
        }
        return a.startColumn - b.startColumn;
      });
      setMarkers(sorted);
    };

    update();

    const disposable = monaco.editor.onDidChangeMarkers(() => update());

    return () => {
      disposable.dispose();
    };
  }, [editorRef, monacoRef, setMarkers, editorReady]);

  const errorCount = markers.filter(
    (m) => m.severity === monacoRef.current?.MarkerSeverity.Error,
  ).length;
  const warningCount = markers.filter(
    (m) => m.severity === monacoRef.current?.MarkerSeverity.Warning,
  ).length;

  const jumpTo = (marker: Monaco.editor.IMarker): void => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setPosition({
      lineNumber: marker.startLineNumber,
      column: marker.startColumn,
    });
    editor.revealLineInCenter(marker.startLineNumber);
    editor.focus();
  };

  /*
   * Attempt to auto-fix a diagnostic. Handles:
   *   - "Missing required property 'X'" → inserts the property key
   *   - "Value must be of type object."  → YAML: add indented newline; JSON: {}
   *   - "Value must be of type array."   → YAML: add "- " item; JSON: []
   */
  const fixIssue = (marker: Monaco.editor.IMarker): void => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const isYaml = model.getLanguageId() === "yaml";

    /* --- Missing required property --- */
    const missingMatch = marker.message.match(/Missing required property ["'](.+?)["']/);

    if (missingMatch) {
      const propertyName = missingMatch[1]!;
      const lineCount = model.getLineCount();

      editor.pushUndoStop();

      if (isYaml) {
        const markerLineContent = model.getLineContent(marker.startLineNumber);
        const indentMatch = markerLineContent.match(/^(\s*)/);
        const indent = indentMatch?.[1]?.length ?? 0;
        const insertText = `\n${" ".repeat(indent)}${propertyName}:`;
        const lastLineLength = model.getLineLength(lineCount);

        editor.executeEdits("schema-editor-fix", [
          {
            range: new monaco.Range(lineCount, lastLineLength + 1, lineCount, lastLineLength + 1),
            text: insertText,
            forceMoveMarkers: true,
          },
        ]);
      } else {
        /*
         * For JSON, insert the property before the root-level closing brace.
         * Strategy:
         *   1. Track brace depth to find the outermost '}' (root close).
         *   2. Find the last non-whitespace character before that '}'.
         *   3. Insert right after that character: add ',' if needed, then
         *      newline + indented new property + newline (so '}' stays on its
         *      own line).
         * This avoids the naive "insert before last }" trap which either
         * matches an inner brace or leaves the comma on the wrong line.
         */
        const fullText = model.getValue();
        let depth = 0;
        let rootCloseOffset = -1;
        let inString = false;
        let stringChar = "";
        let escaped = false;

        for (let i = 0; i < fullText.length; i += 1) {
          const ch = fullText[i]!;

          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (ch === "\\") {
              escaped = true;
            } else if (ch === stringChar) {
              inString = false;
            }
            continue;
          }

          if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
          }

          if (ch === "{" || ch === "[") {
            depth += 1;
          } else if (ch === "}" || ch === "]") {
            depth -= 1;
            if (depth === 0 && ch === "}") {
              rootCloseOffset = i;
            }
          }
        }

        if (rootCloseOffset < 0) {
          /* Fallback: append at end of document. */
          const lastLineLength = model.getLineLength(lineCount);
          editor.executeEdits("schema-editor-fix", [
            {
              range: new monaco.Range(lineCount, lastLineLength + 1, lineCount, lastLineLength + 1),
              text: `,\n  "${propertyName}": `,
              forceMoveMarkers: true,
            },
          ]);
        } else {
          /* Find the last non-whitespace character before the root '}'. */
          const beforeBrace = fullText.slice(0, rootCloseOffset);
          const lastNonWsMatch = beforeBrace.match(/\S(?=\s*$)/);

          if (!lastNonWsMatch) {
            /* Empty object: insert inside the braces. */
            const pos = model.getPositionAt(rootCloseOffset);
            editor.executeEdits("schema-editor-fix", [
              {
                range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                text: `\n  "${propertyName}": \n`,
                forceMoveMarkers: true,
              },
            ]);
          } else {
            const lastNonWsChar = lastNonWsMatch[0]!;
            const lastNonWsOffset = beforeBrace.lastIndexOf(lastNonWsChar);
            const insertOffset = lastNonWsOffset + 1;
            const insertPos = model.getPositionAt(insertOffset);
            const needsComma = lastNonWsChar !== "," && lastNonWsChar !== "{";

            const prefix = needsComma ? "," : "";
            const insertText = `${prefix}\n  "${propertyName}": \n`;

            editor.executeEdits("schema-editor-fix", [
              {
                range: new monaco.Range(
                  insertPos.lineNumber,
                  insertPos.column,
                  insertPos.lineNumber,
                  insertPos.column,
                ),
                text: insertText,
                forceMoveMarkers: true,
              },
            ]);
          }
        }
      }

      editor.pushUndoStop();
      editor.focus();
      return;
    }

    /* --- Value must be of type object/array --- */
    const typeObjectMatch = marker.message.match(/must be of type object/i);
    const typeArrayMatch = marker.message.match(/must be of type array/i);

    if (typeObjectMatch || typeArrayMatch) {
      editor.pushUndoStop();

      if (isYaml) {
        /*
         * For YAML, a null value (e.g. "get:") needs a child block.
         * object → newline + child indent
         * array  → newline + child indent + "- "
         */
        const lineContent = model.getLineContent(marker.startLineNumber);
        const indentMatch = lineContent.match(/^(\s*)/);
        const indent = indentMatch?.[1]?.length ?? 0;
        const childIndent = indent + 2;
        const suffix = typeArrayMatch ? "- " : "";
        const insertText = `\n${" ".repeat(childIndent)}${suffix}`;
        const lineMaxCol = model.getLineMaxColumn(marker.startLineNumber);

        editor.executeEdits("schema-editor-fix", [
          {
            range: new monaco.Range(
              marker.startLineNumber,
              lineMaxCol,
              marker.startLineNumber,
              lineMaxCol,
            ),
            text: insertText,
            forceMoveMarkers: true,
          },
        ]);

        editor.setPosition(
          new monaco.Position(marker.startLineNumber + 1, childIndent + suffix.length + 1),
        );
      } else {
        /*
         * For JSON, replace the null value with {} or [].
         * The marker points at the value position.
         */
        const lineContent = model.getLineContent(marker.startLineNumber);
        const replacement = typeObjectMatch ? "{}" : "[]";

        /* Find "null" at or after the marker column. */
        const nullIdx = lineContent.indexOf("null", marker.startColumn - 1);
        if (nullIdx >= 0) {
          editor.executeEdits("schema-editor-fix", [
            {
              range: new monaco.Range(
                marker.startLineNumber,
                nullIdx + 1,
                marker.startLineNumber,
                nullIdx + 5,
              ),
              text: replacement,
              forceMoveMarkers: true,
            },
          ]);
        }
      }

      editor.pushUndoStop();
      editor.focus();
      return;
    }

    /* No auto-fix available for this diagnostic type. */
  };

  const canFix = (marker: Monaco.editor.IMarker): boolean => {
    return (
      /Missing required property/.test(marker.message) ||
      /must be of type object/i.test(marker.message) ||
      /must be of type array/i.test(marker.message)
    );
  };

  return (
    <>
      {expanded && markers.length > 0 && (
        <div className="pde-diagnostics-panel">
          <ul className="pde-diagnostics-list">
            {markers.map((marker, index) => (
              <li
                key={`${marker.startLineNumber}-${marker.startColumn}-${index}`}
                className="pde-diagnostics-item"
              >
                <span className="pde-diagnostics-item-icon" onClick={() => jumpTo(marker)}>
                  {marker.severity === monacoRef.current?.MarkerSeverity.Error ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="var(--color-danger, #c95555)">
                      <circle cx="6" cy="6" r="5" />
                      <rect x="5.5" y="3" width="1" height="4" fill="white" />
                      <rect x="5.5" y="8" width="1" height="1" fill="white" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="var(--color-warning, #d98a22)">
                      <path d="M6 1L11 10H1L6 1Z" />
                      <rect x="5.5" y="5" width="1" height="3" fill="white" />
                      <rect x="5.5" y="8.5" width="1" height="1" fill="white" />
                    </svg>
                  )}
                </span>
                <span className="pde-diagnostics-item-text" onClick={() => jumpTo(marker)}>{marker.message}</span>
                <span className="pde-diagnostics-item-location" onClick={() => jumpTo(marker)}>
                  Ln {marker.startLineNumber}, Col {marker.startColumn}
                </span>
                <span className="pde-diagnostics-item-actions">
                  <button
                    type="button"
                    className="pde-diagnostics-btn pde-diagnostics-btn-locate"
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpTo(marker);
                    }}
                  >
                    Locate
                  </button>
                  <button
                    type="button"
                    className={`pde-diagnostics-btn pde-diagnostics-btn-fix ${canFix(marker) ? "" : "disabled"}`}
                    disabled={!canFix(marker)}
                    onClick={(e) => {
                      e.stopPropagation();
                      fixIssue(marker);
                    }}
                  >
                    Fix
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="pde-diagnostics-bar" onClick={() => setExpanded(!expanded)}>
        {errorCount > 0 && (
          <span className="pde-diagnostics-error">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="6" cy="6" r="5" />
              <rect x="5.5" y="3" width="1" height="4" fill="white" />
              <rect x="5.5" y="8" width="1" height="1" fill="white" />
            </svg>
            {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="pde-diagnostics-warning">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1L11 10H1L6 1Z" />
              <rect x="5.5" y="5" width="1" height="3" fill="white" />
              <rect x="5.5" y="8.5" width="1" height="1" fill="white" />
            </svg>
            {warningCount}
          </span>
        )}
        {errorCount === 0 && warningCount === 0 && (
          <span className="pde-diagnostics-ok">No issues</span>
        )}
        <span className="pde-diagnostics-spacer" />
        {markers.length > 0 && (
          <span className={`pde-diagnostics-chevron ${expanded ? "open" : ""}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
        <span className="pde-language-badge">{language}</span>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* useRefState — a tiny state hook that avoids re-render storms              */
/* -------------------------------------------------------------------------- */

function useRefState<T>(initial: T): [T, (value: T) => void] {
  const ref = useRef(initial);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const setValue = useCallback(
    (value: T) => {
      if (ref.current !== value) {
        ref.current = value;
        forceUpdate();
      }
    },
    [],
  );

  return [ref.current, setValue];
}
