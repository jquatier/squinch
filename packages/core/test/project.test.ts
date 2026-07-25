import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildProject } from "../src/model/build.js";
import { render, renderProject } from "../src/index.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const landscape = readFileSync(join(pkg, "examples/landscape.squinch"), "utf8");

describe("multi-file projects", () => {
  it("model split across files renders byte-identical to the single file", async () => {
    // split at the first view: model file + views file
    const cut = landscape.indexOf("view landscape");
    const files = [
      { name: "model.squinch", src: landscape.slice(0, cut) },
      { name: "views.squinch", src: landscape.slice(cut) },
    ];
    const single = await render(landscape, { view: "orders-detail", theme: "light" });
    const multi = await renderProject(files, { view: "orders-detail", theme: "light" });
    expect(multi.ok).toBe(true);
    expect(multi.svg).toBe(single.svg);
  });

  it("cross-file references resolve; edges can live in a third file", async () => {
    const r = buildProject([
      { name: "a.squinch", src: `system a "A" {\n x = aws/lambda "X"\n}` },
      { name: "b.squinch", src: `system b "B" {\n y = aws/dynamodb "Y"\n}` },
      { name: "wiring.squinch", src: `a.x -> b.y "writes"` },
    ]);
    expect(r.ok).toBe(true);
    expect(r.model.edges[0]).toMatchObject({ from: "a.x", to: "b.y", label: "writes" });
  });

  it("cross-file duplicate ids error and name the other file", () => {
    const r = buildProject([
      { name: "one.squinch", src: `system s "S" {\n a = aws/lambda "A"\n}` },
      { name: "two.squinch", src: `system s "S again" {\n}` },
    ]);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((d) => d.message.includes("duplicate id"));
    expect(d?.file).toBe("two.squinch");
    expect(d?.fix).toContain("one.squinch");
  });

  it("diagnostics carry their file name", () => {
    const r = buildProject([
      { name: "good.squinch", src: `system s "S" {\n a = aws/lambda "A"\n}` },
      { name: "bad.squinch", src: `s.a -> s.missing` },
    ]);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((d) => d.message.includes("unknown id"));
    expect(d?.file).toBe("bad.squinch");
  });
});
