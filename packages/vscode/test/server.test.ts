// Integration: speak real LSP to the bundled server over stdio. Unit tests
// cover the logic; this covers the wiring — capabilities, publishDiagnostics,
// quick fixes, and that a bundled host still finds the icon packs on disk.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(pkg, "dist", "server.cjs");
// `pnpm -r build` runs before tests in CI; skip locally when it hasn't.
//
// But a *silent* skip means the only test proving packs resolve inside an
// esbuild bundle can disappear the day the build path moves, and it disappears
// as a pass. In CI the build has definitely run, so absence there is a fault.
if (process.env.CI && !existsSync(bundle))
  throw new Error(
    `dist/server.cjs is missing — the bundled-server suite would silently skip. ` +
      `CI runs \`pnpm -r build\` before tests; if that changed, fix it rather than losing this suite.`,
  );
const suite = existsSync(bundle) ? describe : describe.skip;

suite("language server (bundled)", () => {
  let srv: ChildProcessWithoutNullStreams;
  const inbox: any[] = [];

  const send = (o: unknown) => {
    const s = JSON.stringify(o);
    srv.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  };
  const wait = async (pred: (m: any) => boolean, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error("timed out waiting for an LSP message");
      await new Promise((r) => setTimeout(r, 30));
    }
  };

  beforeAll(async () => {
    srv = spawn("node", [bundle, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = Buffer.alloc(0);
    srv.stdout.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) return;
        const len = Number(/Content-Length: (\d+)/.exec(buf.subarray(0, sep).toString())![1]);
        if (buf.length < sep + 4 + len) return;
        inbox.push(JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString()));
        buf = buf.subarray(sep + 4 + len);
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
    await wait((m) => m.id === 1);
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
  });

  afterAll(() => srv?.kill());

  const uri = "file:///tmp/lsp-test.squinch";

  it("advertises the features the editor needs", async () => {
    const init = await wait((m) => m.id === 1);
    const caps = init.result.capabilities;
    expect(caps.completionProvider).toBeTruthy();
    expect(caps.hoverProvider).toBe(true);
    expect(caps.documentSymbolProvider).toBe(true);
    expect(caps.codeActionProvider).toBeTruthy();
  });

  it("publishes diagnostics with a quick fix, and packs resolve inside the bundle", async () => {
    const text = `pack aws
system shop "Shop" {
  api = aws/api-gatewy "API"
  db  = aws/dynamodb "Orders"
  api -> db
}
`;
    send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "squinch", version: 1, text } } });
    const note = await wait((m) => m.method === "textDocument/publishDiagnostics" && m.params.diagnostics.length);
    const d = note.params.diagnostics[0];
    // `pack aws` resolving proves the bundled server found the pack on disk
    expect(d.message).toContain("unknown icon `aws/api-gatewy`");
    expect(d.data).toBe("aws/api-gateway");

    send({ jsonrpc: "2.0", id: 2, method: "textDocument/codeAction", params: { textDocument: { uri }, range: d.range, context: { diagnostics: [d] } } });
    const ca = await wait((m) => m.id === 2);
    expect(ca.result[0].title).toContain("aws/api-gateway");
    expect(ca.result[0].edit.changes[uri][0].newText).toBe("aws/api-gateway");
  });

  it("answers completion, symbols and hover", async () => {
    send({ jsonrpc: "2.0", id: 3, method: "textDocument/completion", params: { textDocument: { uri }, position: { line: 2, character: 21 } } });
    const comp = await wait((m) => m.id === 3);
    expect(comp.result.map((c: any) => c.label)).toContain("aws/api-gateway");

    send({ jsonrpc: "2.0", id: 4, method: "textDocument/documentSymbol", params: { textDocument: { uri } } });
    const syms = await wait((m) => m.id === 4);
    expect(syms.result[0].name).toBe("shop");
    expect(syms.result[0].children).toHaveLength(2);

    send({ jsonrpc: "2.0", id: 5, method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 3, character: 10 } } });
    const hov = await wait((m) => m.id === 5);
    expect(hov.result.contents.value).toContain("DynamoDB");
  });
});
