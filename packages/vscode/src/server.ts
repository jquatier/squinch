// The language server: a thin protocol shell over src/features.ts. Anything
// with logic in it belongs there, where it is unit-tested; this file is wiring.
import {
  createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind,
  DiagnosticSeverity, CompletionItemKind, SymbolKind, TextEdit,
  CodeActionKind,
  type InitializeResult, type Diagnostic, type CompletionItem,
  type DocumentSymbol, type CodeAction,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  allDiagnosticsFor, completionsAt, hoverAt, symbolsOf,
  type Completion, type Sym,
} from "./features.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ["/", ">", " ", "#", "."] },
    hoverProvider: true,
    documentSymbolProvider: true,
    codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
  },
}));

// Diagnostics are debounced per document: layout runs on every publish, and a
// fast typist shouldn't queue up a dozen ELK passes.
const timers = new Map<string, NodeJS.Timeout>();
function schedule(uri: string) {
  clearTimeout(timers.get(uri));
  timers.set(uri, setTimeout(() => void publish(uri), 180));
}

async function publish(uri: string) {
  const doc = documents.get(uri);
  if (!doc) return;
  const found = await allDiagnosticsFor(doc.getText());
  const diagnostics: Diagnostic[] = found.map((d) => ({
    range: d.range,
    message: d.fix ? `${d.message}\n${d.fix}` : d.message,
    severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    source: "squinch",
    data: d.replacement,
  }));
  connection.sendDiagnostics({ uri, diagnostics });
}

documents.onDidChangeContent((e) => schedule(e.document.uri));
documents.onDidClose((e) => {
  clearTimeout(timers.get(e.document.uri));
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

const COMPLETION_KIND: Record<Completion["kind"], CompletionItemKind> = {
  icon: CompletionItemKind.Value,
  path: CompletionItemKind.Reference,
  keyword: CompletionItemKind.Keyword,
  value: CompletionItemKind.Module,
};

connection.onCompletion((params): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const offset = doc.offsetAt(params.position);
  return completionsAt(doc.getText(), offset).map((c) => ({
    label: c.label,
    kind: COMPLETION_KIND[c.kind],
    detail: c.detail,
    // insert only the remainder, so `aws/lamb` + `da` reads naturally
    insertText: c.insert ?? c.label,
  }));
});

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const hit = hoverAt(doc.getText(), doc.offsetAt(params.position));
  if (!hit) return null;
  return { contents: { kind: "markdown" as const, value: hit.markdown }, range: hit.range };
});

const SYMBOL_KIND: Record<Sym["kind"], SymbolKind> = {
  system: SymbolKind.Package,
  container: SymbolKind.Namespace,
  node: SymbolKind.Field,
  view: SymbolKind.Interface,
  zone: SymbolKind.Struct,
  flow: SymbolKind.Event,
};

const toDocumentSymbol = (s: Sym): DocumentSymbol => ({
  name: s.name,
  detail: s.detail,
  kind: SYMBOL_KIND[s.kind],
  range: s.range,
  selectionRange: s.range,
  children: s.children?.map(toDocumentSymbol),
});

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? symbolsOf(doc.getText()).map(toDocumentSymbol) : [];
});

// Quick fix: every `did you mean \`x\`?` becomes a one-click replacement.
connection.onCodeAction((params): CodeAction[] =>
  params.context.diagnostics
    .filter((d) => typeof d.data === "string" && d.data)
    .map((d) => ({
      title: `Replace with \`${d.data}\``,
      kind: CodeActionKind.QuickFix,
      diagnostics: [d],
      isPreferred: true,
      edit: {
        changes: {
          [params.textDocument.uri]: [TextEdit.replace(d.range, String(d.data))],
        },
      },
    })),
);

documents.listen(connection);
connection.listen();
