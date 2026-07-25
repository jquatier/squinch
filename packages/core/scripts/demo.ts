import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { render, formatDiagnostics } from "../src/index.js";
const file = process.argv[2] ?? "examples/orders.squinch";
const src = readFileSync(file, "utf8");
mkdirSync("out", { recursive: true });
for (const theme of ["light", "dark"]) {
  const r = await render(src, { theme });
  if (!r.ok) { console.error(formatDiagnostics(r.diagnostics, file)); process.exit(1); }
  const name = `out/${file.split("/").pop()!.replace(".squinch", "")}.${theme}.svg`;
  writeFileSync(name, r.svg!);
  console.log("wrote", name, `(${r.svg!.length} bytes)`);
  if (r.diagnostics.length) console.log(formatDiagnostics(r.diagnostics, file));
}
