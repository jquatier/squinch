// The beauty checklist, run over every diagram the repo owns.
//
// Until now the label-pill overlap check ran on 8 goldens and nothing else in
// DESIGN §9 ran at all. This sweeps 53 files — what ships, what stresses, and
// what cold agents actually wrote — and asserts the geometry directly rather
// than through the renderer's string output.
//
// Two fonts, not five themes: `layoutView` is a pure function of
// `(model, view, font)`, and `themes/index.ts` defines exactly two ThemeFonts —
// `inter` (light/dark/contrast) and `caveat` (sketch/sketch-dark). Sweeping
// themes would do identical work 2.5× over.
import { describe, it, expect } from "vitest";
import { buildProject } from "../src/index.js";
import { layoutView, type Positioned } from "../src/layout/layout.js";
import { corpus } from "./helpers/corpus.js";
import { checkLayout, type Ctx } from "./invariants.js";

const FONTS = [
  { name: "inter", font: { metrics: "inter" as const, scale: 1 } },
  { name: "caveat", font: { metrics: "caveat" as const, scale: 1.3 } },
];

const files = corpus();

describe("geometric invariants over the whole corpus", () => {
  it("finds the corpus, so this cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("every view, in both fonts, is well-formed", async () => {
    const violations: string[] = [];
    let views = 0;

    for (const f of files) {
      const built = buildProject([{ name: f.name, src: f.src }]);
      // A corpus file that does not build is a different test's problem
      // (`gauntlet score`, the lookbook build); skipping keeps this one about
      // geometry rather than re-reporting a parse error four ways.
      if (built.diagnostics.some((d) => d.severity === "error")) continue;

      const ctx: Ctx = {
        zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])),
        channelTargets: new Set(
          built.model.views.flatMap((v) => v.layout.channels.map((c) => c.target)),
        ),
      };

      // auto views included: nothing else in CI lays one out, and the SPA dives
      // into them, so an auto view is a real surface with no other coverage
      for (const view of built.model.views)
        for (const { name, font } of FONTS) {
          const { positioned } = await layoutView(built.model, view, font);
          views++;
          for (const v of checkLayout(positioned, ctx))
            violations.push(`${f.name}#${view.name} [${name}] ${v}`);
        }
    }

    expect(views).toBeGreaterThan(200);
    expect(violations, `${violations.length} geometric violation(s)`).toEqual([]);
  }, 60_000);
});

describe("the invariants themselves", () => {
  // A sweep that passes over a healthy corpus proves nothing on its own — it
  // would pass just as well if `checkLayout` returned `[]` unconditionally.
  // Each rule gets deliberately broken geometry and has to notice.
  const node = (path: string, x: number, y: number, w = 120, h = 64) =>
    ({ path, x, y, w, h, rank: 0, kind: "leaf", label: path, preview: [], tags: [] }) as any;

  const base = (over: Partial<Positioned> = {}): Positioned =>
    ({
      name: "v", width: 500, height: 300, lines: "orthogonal",
      nodes: [node("a", 0, 0), node("b", 200, 0)],
      edges: [], ports: [], frames: [], zones: [],
      ...over,
    }) as Positioned;

  const edge = (points: { x: number; y: number }[]) =>
    ({ id: "e1", from: "a", to: "b", async: false, animate: false, count: 1, tags: [], heads: "one", points }) as any;

  it("catches a non-integer coordinate", () => {
    expect(checkLayout(base({ nodes: [node("a", 10.5, 0)] })).join()).toContain("non-integer");
  });

  it("catches an off-grid node dimension", () => {
    expect(checkLayout(base({ nodes: [node("a", 0, 0, 121, 64)] })).join()).toContain("off the 8px grid");
  });

  it("catches a diagonal segment", () => {
    const p = base({ edges: [edge([{ x: 0, y: 0 }, { x: 40, y: 40 }])] });
    expect(checkLayout(p).join()).toContain("diagonal");
  });

  it("catches a short stub, at either end", () => {
    const short = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 100 }];
    expect(checkLayout(base({ edges: [edge(short)] })).join()).toContain("leaves 10 before turning");
    const shortEnd = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 90 }];
    expect(checkLayout(base({ edges: [edge(shortEnd)] })).join()).toContain("enters after 10");
  });

  it("leaves a two-point edge alone — it never turns", () => {
    const p = base({ edges: [edge([{ x: 0, y: 0 }, { x: 0, y: 4 }])] });
    expect(checkLayout(p)).toEqual([]);
  });

  it("catches overlapping nodes", () => {
    const p = base({ nodes: [node("a", 0, 0), node("b", 40, 0)] });
    expect(checkLayout(p).join()).toContain("overlap");
  });

  it("catches a child escaping its frame", () => {
    const p = base({
      nodes: [{ ...node("a", 400, 0), frame: "f" }],
      frames: [{ path: "f", label: "F", x: 0, y: 0, w: 200, h: 100 }],
    });
    expect(checkLayout(p).join()).toContain("escapes its frame");
  });

  it("catches a member escaping its zone", () => {
    const p = base({
      nodes: [node("a", 400, 0)],
      zones: [{ id: "z", label: "Z", kind: "vpc", labelPos: "top-left", x: 0, y: 0, w: 200, h: 100, depth: 0 }] as any,
    });
    const ctx = { zoneMembers: new Map([["z", ["a"]]]) };
    expect(checkLayout(p, ctx).join()).toContain("escapes its zone");
  });

  it("catches stacked ports — and exempts a channel target", () => {
    const ports = [
      { edge: "e1", node: "b", side: "north", x: 50, y: 0 },
      { edge: "e2", node: "b", side: "north", x: 50, y: 0 },
    ] as any;
    expect(checkLayout(base({ ports })).join()).toContain("stack at b");
    // merging N sources into one entry port is exactly what `channel` does
    expect(checkLayout(base({ ports }), { channelTargets: new Set(["b"]) })).toEqual([]);
  });

  it("passes clean geometry", () => {
    const good = base({
      edges: [edge([{ x: 60, y: 64 }, { x: 60, y: 100 }, { x: 260, y: 100 }, { x: 260, y: 64 }])],
    });
    expect(checkLayout(good)).toEqual([]);
  });
});
