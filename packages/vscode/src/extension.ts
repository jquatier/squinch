// Extension host: starts the language server and owns the live preview.
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient, TransportKind,
  type LanguageClientOptions, type ServerOptions,
} from "vscode-languageclient/node.js";
import { renderProject, viewIndex } from "@squinch/core";

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  const module = context.asAbsolutePath(path.join("dist", "server.cjs"));
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6011"] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "squinch" }],
  };
  client = new LanguageClient("squinch", "Squinch", serverOptions, clientOptions);
  void client.start();

  context.subscriptions.push(
    vscode.commands.registerCommand("squinch.preview", () => Preview.open(context)),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

/** Live SVG preview, rendered by the same core the CLI uses. */
class Preview {
  private static current: Preview | undefined;
  private view: string | undefined;
  private disposables: vscode.Disposable[] = [];

  static open(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== "squinch") {
      void vscode.window.showInformationMessage("Open a .squinch file first.");
      return;
    }
    if (Preview.current) {
      Preview.current.panel.reveal(vscode.ViewColumn.Beside);
      void Preview.current.refresh();
      return;
    }
    Preview.current = new Preview(context);
  }

  private constructor(
    private context: vscode.ExtensionContext,
    private panel = vscode.window.createWebviewPanel(
      "squinch.preview", "Squinch Preview", vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    ),
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg: { type: string; view?: string }) => {
      if (msg.type === "view" && msg.view) { this.view = msg.view; void this.refresh(); }
    }, null, this.disposables);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "squinch") void this.refresh();
      }),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e?.document.languageId === "squinch") { this.view = undefined; void this.refresh(); }
      }),
    );
    void this.refresh();
  }

  private doc(): vscode.TextDocument | undefined {
    const active = vscode.window.activeTextEditor?.document;
    if (active?.languageId === "squinch") return active;
    return vscode.workspace.textDocuments.find((d) => d.languageId === "squinch");
  }

  async refresh() {
    const doc = this.doc();
    if (!doc) return;
    const src = doc.getText();
    const name = path.basename(doc.fileName);
    const theme = vscode.workspace.getConfiguration("squinch").get<string>("preview.theme", "light");
    const views = viewIndex(src);
    const view = this.view && views.some((v) => v.name === this.view) ? this.view : views[0]?.name;

    const result = await renderProject([{ name, src }], { view, theme });
    this.panel.title = `Preview — ${name}`;
    this.panel.webview.html = result.ok
      ? this.html(result.svg!, views.map((v) => v.name), view)
      : this.errorHtml(result.diagnostics.map((d) => `${d.loc.line}:${d.loc.col}  ${d.message}`));
  }

  private html(svg: string, views: string[], active: string | undefined): string {
    const options = views
      .map((v) => `<option value="${v}"${v === active ? " selected" : ""}>${v}</option>`)
      .join("");
    return /* html */ `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { margin: 0; padding: 12px; background: var(--vscode-editor-background); }
  .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px;
         font: 12px var(--vscode-font-family); color: var(--vscode-descriptionForeground); }
  select { font: inherit; }
  .canvas { overflow: auto; }
  svg { max-width: 100%; height: auto; }
</style></head><body>
<div class="bar">${views.length > 1 ? `<label>view <select id="v">${options}</select></label>` : ""}</div>
<div class="canvas">${svg}</div>
<script>
  const api = acquireVsCodeApi();
  const sel = document.getElementById("v");
  if (sel) sel.addEventListener("change", () => api.postMessage({ type: "view", view: sel.value }));
</script>
</body></html>`;
  }

  private errorHtml(lines: string[]): string {
    return /* html */ `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { margin: 0; padding: 16px; font: 12px var(--vscode-editor-font-family);
         color: var(--vscode-errorForeground); background: var(--vscode-editor-background); }
  pre { white-space: pre-wrap; }
</style></head><body><pre>${lines.map((l) => l.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))).join("\n")}</pre></body></html>`;
  }

  private dispose() {
    Preview.current = undefined;
    for (const d of this.disposables) d.dispose();
  }
}
