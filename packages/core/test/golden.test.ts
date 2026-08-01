// End-to-end goldens: examples → SVG, byte-compared. UPDATE_GOLDEN=1 to rebless.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

const CASES: { file: string; themes: string[]; view?: string }[] = [
  { file: "examples/orders.squinch", themes: ["light", "dark"] },
  { file: "examples/landscape.squinch", themes: ["light", "dark"], view: "landscape" },
  { file: "examples/landscape.squinch", themes: ["light"], view: "orders" },
  { file: "examples/landscape.squinch", themes: ["light"], view: "orders-pci" },
  { file: "examples/landscape.squinch", themes: ["light", "dark"], view: "orders-detail" },
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
        // every render is validated with a real XML parser — non-negotiable
        const valid = validateSVG(r.svg!);
        expect(valid.error, valid.error).toBeUndefined();
        // and no two label pills may overlap (DESIGN: labels never collide)
        const pillRects = [...r.svg!.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="18" rx="2"/g)]
          .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: 18 }));
        for (let i = 0; i < pillRects.length; i++)
          for (let j = i + 1; j < pillRects.length; j++) {
            const a = pillRects[i], b = pillRects[j];
            const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
            expect(overlap, `label pills ${i} and ${j} overlap`).toBe(false);
          }
        // determinism: render twice, byte-identical
        const again = await render(src, { theme, view: c.view });
        expect(again.svg).toBe(r.svg);

        const goldenPath = join(pkg, `test/golden/${base}.${theme}.svg`);
        if (process.env.UPDATE_GOLDEN) {
          mkdirSync(join(pkg, "test/golden"), { recursive: true });
          writeFileSync(goldenPath, r.svg!);
        }
        // A *missing* golden used to be recreated here and then asserted against
        // the file it had just written — so deleting one silently traded a real
        // comparison for a tautology, and the suite stayed green while covering
        // less. Reblessing has to be deliberate.
        expect(
          existsSync(goldenPath),
          `no golden for ${base}.${theme} — if this is intentional, run \`UPDATE_GOLDEN=1 pnpm test\``,
        ).toBe(true);
        expect(r.svg).toBe(readFileSync(goldenPath, "utf8"));
      });
    }
  }

  it("layout parity with the Phase-0 spike", async () => {
    // test/golden/phase0-canonical.svg is the untouched output of the Phase-0
    // hand-built harness (see docs/PLAN.md §3) — a second, independently
    // written implementation of the same layout decisions. Diffing against it
    // catches drift the engine's own goldens can't: those would just get
    // re-blessed alongside a bug. This file is never regenerated.
    const src = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");
    const r = await render(src, { theme: "light" });
    const spike = readFileSync(join(pkg, "test/golden/phase0-canonical.svg"), "utf8");
    // node rects only (leaf h=64) — label pills are placement policy, not layout
    const coords = (s: string) => s.match(/<rect x="\d+" y="\d+" width="\d+" height="64"/g);
    expect(coords(r.svg!)).toEqual(coords(spike));
  });
});
