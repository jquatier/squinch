// CodeMirror pane. Highlighting comes from the same Lezer grammar the compiler
// uses — one grammar, no second syntax definition to drift.
import { useEffect, useRef } from "react";
import {
  Decoration, type DecorationSet, EditorView, GutterMarker, gutterLineClass,
  keymap, lineNumbers, highlightActiveLine, drawSelection,
} from "@codemirror/view";
import { EditorState, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
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
        "scope only include exclude detail expand context highlight color show note title theme": t.keyword,
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

// The error-line treatment (design handoff §4): the whole row tints, a 2px red
// bar sits at the row's left edge, and the line number turns red. The lint
// extension only underlines the offending range, so the row itself is a line
// decoration of our own, fed from the same diagnostics — one StateField holds
// the lines, and provides both the content-row class and the gutter class.
// The bar is an inset shadow on the gutter cell rather than a border on the
// line, so no row's text shifts by 2px relative to its neighbours.
const setErrorLines = StateEffect.define<DecorationSet>();
const errorLine = Decoration.line({ class: "cm-sq-error-line" });
const errorGutter = new (class extends GutterMarker {
  elementClass = "cm-sq-error-gutter";
})();
const errorLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setErrorLines)) deco = e.value;
    return deco;
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    gutterLineClass.compute([f], (state) => {
      const marks = [];
      for (const it = state.field(f).iter(); it.value; it.next()) marks.push(errorGutter.range(it.from));
      return RangeSet.of(marks);
    }),
  ],
});

// Measurements from the design handoff's editor pane: 13px/1.7 Plex Mono, a
// 44px right-aligned gutter in the faintest text tier, errors as a wavy red
// underline under the offending range.
const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "14px 0", caretColor: "var(--fg)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--text-faint)",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "44px", paddingRight: "14px" },
  // Translucent, not the opaque --active token: drawSelection paints the
  // selection in a layer *under* the lines, so an opaque active-line
  // background sat on top of it and hid whatever you had highlighted.
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 4%, transparent)" },
  // CodeMirror's defaults here are a 1px black caret and a pale blue
  // selection — both tuned for paper, both near-invisible on the dark pane
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  // the base theme's focused rule is this exact selector; anything shorter
  // loses on specificity and the paper-lavender default comes back
  ".cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-4)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--err)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warn)",
    textUnderlineOffset: "3px",
  },
  ".cm-gutter-lint .cm-gutterElement": { padding: "0 2px 0 4px" },
  // the lint hover/gutter tooltip ships white-on-white for a dark pane:
  // same surface, hairline and type as the diagnostics footer below it
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "8px",
    color: "var(--muted)",
    boxShadow: "var(--panel-shadow)",
    fontFamily: "var(--font-ui)",
    fontSize: "12.5px",
    lineHeight: "1.5",
  },
  ".cm-tooltip.cm-tooltip-lint": { padding: "4px 0" },
  ".cm-diagnostic": { padding: "4px 10px 4px 9px", borderLeftWidth: "3px", marginLeft: "0" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--err)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--warn)" },
  ".cm-diagnostic-info": { borderLeftColor: "var(--accent)" },
  ".cm-diagnosticText": { color: "var(--fg)" },
  ".cm-sq-error-line": { backgroundColor: "var(--err-bg)" },
  ".cm-gutterElement.cm-sq-error-gutter": {
    backgroundColor: "var(--err-bg)",
    color: "var(--err)",
  },
  // the bar goes on the leftmost gutter (the lint gutter sits first), so it
  // reads as the row's edge rather than a stripe between number and code
  ".cm-gutter:first-child .cm-gutterElement.cm-sq-error-gutter": {
    boxShadow: "inset 2px 0 0 var(--err)",
  },
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
      // CodeMirror draws its own caret and selection with this on; without
      // it the browser's native 1px caret is all there is, and on the dark
      // pane that was too faint to tell which character you were on
      drawSelection({ cursorBlinkRate: 1000 }),
      highlightActiveLine(),
      lintGutter(),
      errorLines,
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

  // Re-sync when the source changes from outside the editor — picking an
  // example, decoding a share link. CodeMirror owns its document after mount,
  // so without this the pane keeps showing the old text until a reload.
  // Typing is unaffected: our own onChange makes value equal the doc, and an
  // equal value dispatches nothing, so there is no echo loop.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: value },
      selection: { anchor: Math.min(v.state.selection.main.anchor, value.length) },
    });
  }, [value]);

  // Push compiler diagnostics into the gutter + underlines.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const max = v.state.doc.length;
    // one row decoration per line with an error, however many errors it has
    const lines = new Set<number>();
    for (const d of diagnostics)
      if (d.severity === "error") lines.add(v.state.doc.lineAt(Math.min(d.loc.from, max)).from);
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
      {
        effects: setErrorLines.of(
          Decoration.set([...lines].sort((a, b) => a - b).map((from) => errorLine.range(from))),
        ),
      },
    );
  }, [diagnostics]);

  return <div ref={host} className="h-full overflow-auto" />;
}
