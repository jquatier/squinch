// End-to-end goldens: examples → SVG, byte-compared. UPDATE_GOLDEN=1 to rebless.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { render } from "../src/index.js";

const CASES = [
  { file: "examples/orders.squinch", themes: ["light", "dark"] },
];

describe("golden renders", () => {
  for (const c of CASES) {
    const src = readFileSync(c.file, "utf8");
    const base = c.file.split("/").pop()!.replace(".squinch", "");
    for (const theme of c.themes) {
      it(`${base} (${theme})`, async () => {
        const r = await render(src, { theme });
        expect(r.ok).toBe(true);
        expect(r.svg).toBeDefined();
        expect(r.svg!.includes("\r")).toBe(false); // LF only
        // determinism: render twice, byte-identical
        const again = await render(src, { theme });
        expect(again.svg).toBe(r.svg);

        const goldenPath = `test/golden/${base}.${theme}.svg`;
        if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
          mkdirSync("test/golden", { recursive: true });
          writeFileSync(goldenPath, r.svg!);
        }
        expect(r.svg).toBe(readFileSync(goldenPath, "utf8"));
      });
    }
  }

  it("layout parity with the Phase-0 spike", async () => {
    const src = readFileSync("examples/orders.squinch", "utf8");
    const r = await render(src, { theme: "light" });
    const spike = readFileSync("../../spike/golden/canonical.svg", "utf8");
    const coords = (s: string) => s.match(/<rect x="\d+" y="\d+"/g);
    expect(coords(r.svg!)).toEqual(coords(spike));
  });
});
