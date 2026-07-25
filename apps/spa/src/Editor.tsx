// CodeMirror pane. Highlighting comes from the same Lezer grammar the compiler
// uses — one grammar, no second syntax definition to drift.
import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { LRLanguage, LanguageSupport, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { setDiagnostics, lintGutter } from "@codemirror/lint";
import { styleTags, tags as t } from "@lezer/highlight";
// @ts-expect-error generated parser ships without types
import { parser } from "@squinch/core/grammar";
import type { Diagnostic as SqDiagnostic } from "@squinch/core/browser";

const squinchLanguage = LRLanguage.define({
  name: "squinch",
  parser: parser.configure({
    props: [
      styleTags({
        "pack system container view person layout": t.definitionKeyword,
        "rows cols place align route from to direction lines density": t.keyword,
        "scope include exclude expand context highlight show note title theme": t.keyword,
        "right-of left-of above below north south east west": t.atom,
        String: t.string,
        Number: t.number,
        Tag: t.meta,
        Comment: t.lineComment,
        Arrow: t.operator,
        IconRef: t.typeName,
        "Attr/Ident": t.propertyName,
        "( )": t.paren,
      }),
    ],
  }),
  languageData: { commentTokens: { line: "//" } },
});

const highlight = HighlightStyle.define([
  { tag: t.definitionKeyword, color: "var(--sq-accent)", fontWeight: "500" },
  { tag: t.keyword, color: "var(--sq-accent)" },
  { tag: t.string, color: "var(--sq-string)" },
  { tag: t.number, color: "var(--sq-string)" },
  { tag: t.meta, color: "var(--sq-tag)" },
  { tag: t.lineComment, color: "var(--sq-muted)", fontStyle: "italic" },
  { tag: t.operator, color: "var(--sq-arrow)", fontWeight: "600" },
  { tag: t.typeName, color: "var(--sq-icon)" },
  { tag: t.propertyName, color: "var(--sq-prop)" },
  { tag: t.atom, color: "var(--sq-prop)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "16px 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--sq-gutter)",
  },
  ".cm-activeLine": { backgroundColor: "var(--sq-active)" },
  "&.cm-focused": { outline: "none" },
});

export interface EditorApi {
  /** Insert text at the cursor (replacing any selection) and refocus. */
  insert: (text: string) => void;
}

export function Editor({
  value,
  diagnostics,
  onChange,
  apiRef,
}: {
  value: string;
  diagnostics: SqDiagnostic[];
  onChange: (v: string) => void;
  apiRef?: { current: EditorApi | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      highlightActiveLine(),
      lintGutter(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      new LanguageSupport(squinchLanguage),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ];
    const v = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current!,
    });
    view.current = v;
    if (apiRef)
      apiRef.current = {
        insert(text) {
          v.dispatch(v.state.replaceSelection(text));
          v.focus();
        },
      };
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push compiler diagnostics into the gutter + underlines.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const max = v.state.doc.length;
    v.dispatch(
      setDiagnostics(
        v.state,
        diagnostics.map((d) => ({
          from: Math.min(d.loc.from, max),
          to: Math.min(Math.max(d.loc.to, d.loc.from + 1), max),
          severity: d.severity,
          message: d.fix ? `${d.message}\n${d.fix}` : d.message,
        })),
      ),
    );
  }, [diagnostics]);

  return <div ref={host} className="h-full overflow-auto" />;
}
