// End-to-end goldens: examples → SVG, byte-compared. UPDATE_GOLDEN=1 to rebless.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { render } from "../src/index.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

const CASES: { file: string; themes: string[]; view?: string }[] = [
  { file: "examples/orders.squinch", themes: ["light", "dark"] },
  { file: "examples/landscape.squinch", themes: ["light", "dark"], view: "landscape" },
  { file: "examples/landscape.squinch", themes: ["light"], view: "orders" },
  { file: "examples/landscape.squinch", themes: ["light"], view: "orders-pci" },
];

describe("golden renders", () => {
  for (const c of CASES) {
    const src = readFileSync(join(pkg, c.file), "utf8");
    const base = c.file.split("/").pop()!.replace(".squinch", "") + (c.view ? `.${c.view.replace(/\W/g, "_")}` : "");
    for (const theme of c.themes) {
      it(`${base} (${theme})`, async () => {
        const r = await render(src, { theme, view: c.view });
        expect(r.ok).toBe(true);
        expect(r.svg).toBeDefined();
        expect(r.svg!.includes("\r")).toBe(false); // LF only
        // determinism: render twice, byte-identical
        const again = await render(src, { theme, view: c.view });
        expect(again.svg).toBe(r.svg);

        const goldenPath = join(pkg, `test/golden/${base}.${theme}.svg`);
        if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
          mkdirSync(join(pkg, "test/golden"), { recursive: true });
          writeFileSync(goldenPath, r.svg!);
        }
        expect(r.svg).toBe(readFileSync(goldenPath, "utf8"));
      });
    }
  }

  it("layout parity with the Phase-0 spike", async () => {
    const src = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");
    const r = await render(src, { theme: "light" });
    const spike = readFileSync(join(pkg, "../../spike/golden/canonical.svg"), "utf8");
    const coords = (s: string) => s.match(/<rect x="\d+" y="\d+"/g);
    expect(coords(r.svg!)).toEqual(coords(spike));
  });
});
