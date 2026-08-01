// Every arm of every enum the grammar accepts, asserted to be *distinguishable*
// rather than to look a particular way.
//
// A sweep of squinch.grammar against all 48 corpus files and 23 test files found
// the gap is overwhelmingly in the non-default arms: `right-of` was used and
// worked, the other three note positions had never been executed; `orthogonal`
// was used, `curved` and `straight` were not; two of four arrow kinds appeared
// nowhere at all. That is the `place`-direction bug — where all four directions
// silently meant `right-of` — waiting to happen in three more places, and
// writing these found it in one of them.
//
// Distinguishability is the right assertion because it is the property that
// actually broke: a construct parsed, validated, documented, and then rendered
// identically to its neighbour.
import { describe, it, expect } from "vitest";
import { buildModel, buildProject, render } from "../src/index.js";
import { layoutView } from "../src/layout/layout.js";
import { validateSVG } from "../src/render/validate.js";

const svgOf = async (src: string, view?: string) => {
  const r = await render(src, { theme: "light", ...(view ? { view } : {}) });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(r.ok, `render failed: ${src}`).toBe(true);
  expect(validateSVG(r.svg!).ok).toBe(true);
  return r.svg!;
};

/** Render each variant and require every one to differ from every other. */
async function allDistinct(label: string, variants: Record<string, string>, view?: string) {
  const names = Object.keys(variants);
  const svgs = await Promise.all(names.map((n) => svgOf(variants[n], view)));
  const dupes: string[] = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      if (svgs[i] === svgs[j]) dupes.push(`${names[i]} === ${names[j]}`);
  expect(dupes, `${label}: identical renders — ${dupes.join(", ")}`).toEqual([]);
  return svgs;
}

describe("arrow kinds", () => {
  const src = (a: string) =>
    `system s "S" {\n x = aws/lambda "X"\n y = aws/lambda "Y"\n x ${a} y\n}`;

  it("all four are distinguishable", async () => {
    // `<->` and `--` used to render as a plain one-way arrow: the view graph
    // reduced every arrow to `async: boolean`, so the other two kinds fell
    // through the gap while SKILL.md documented both.
    await allDistinct("arrows", {
      "->": src("->"), "~>": src("~>"), "<->": src("<->"), "--": src("--"),
    });
  });

  const filled = (svg: string) =>
    (svg.match(/<path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ Z"/g) ?? []).length;

  it("points the way each one claims", async () => {
    expect(filled(await svgOf(src("->")))).toBe(1); // one way
    expect(filled(await svgOf(src("<->")))).toBe(2); // both ways
    expect(filled(await svgOf(src("--")))).toBe(0); // neither
  });

  it("async draws an open chevron, not a filled one", async () => {
    const svg = await svgOf(src("~>"));
    expect(filled(svg)).toBe(0);
    expect(svg).toContain("stroke-linejoin=\"round\"");
  });
});

describe("note anchors", () => {
  const src = (anchor: string) =>
    `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b\n}\n` +
    `view v { scope s\n note ${anchor} "a note" }`;

  it("all eight positions are distinguishable", async () => {
    // Only `right-of` and `top-right` had ever been rendered anywhere in the
    // repo; the other six were untouched by any test, example or lookbook case.
    await allDistinct("note anchors", Object.fromEntries(
      ["right-of b", "left-of b", "above b", "below b",
       "top-left", "top-right", "bottom-left", "bottom-right"].map((a) => [a, src(a)]),
    ), "v");
  });

  it("an edge-anchored note renders and differs from a node-anchored one", async () => {
    const onEdge = await svgOf(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b\n}\n` +
      `view v { scope s\n note on a -> b "why" }`, "v");
    expect(onEdge).toContain("why");
    expect(onEdge).not.toBe(await svgOf(src("right-of b"), "v"));
  });

  it("the warn style differs from the default", async () => {
    const plain = await svgOf(src("top-right"), "v");
    const warn = await svgOf(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b\n}\n` +
      `view v { scope s\n note top-right "a note" { style: warning } }`, "v");
    expect(warn).not.toBe(plain);
  });
});

describe("line styles", () => {
  const src = (l: string) =>
    `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n c = aws/lambda "C"\n` +
    ` a -> b\n a -> c\n}\nview v { scope s\n layout { lines ${l}\n rows [a] [b c] } }`;

  it("all three are distinguishable", async () => {
    // `curved` and `straight` parse at build.ts and branch in svg.ts and had
    // never been executed by anything in the repo — two of three arms of a
    // documented option, dead as far as the tests could prove.
    await allDistinct("lines", {
      orthogonal: src("orthogonal"), curved: src("curved"), straight: src("straight"),
    }, "v");
  });

  it("the arrowhead points along the line, not along the route underneath", async () => {
    // `straight` draws first point to last and throws the route away, but the
    // head took its direction from the route's final segment — and `Math.sign`
    // then collapsed that onto an axis. A head on a shallow diagonal came out
    // pointing straight down, 69° off the line it terminated.
    const svg = await svgOf(src("straight"), "v");
    const lines = [...svg.matchAll(/<path d="M (\d+) (\d+) L (\d+) (\d+)" fill="none"/g)]
      .map((m) => m.slice(1).map(Number));
    const heads = [...svg.matchAll(/<path d="M (\d+) (\d+) L (-?\d+) (-?\d+) L (-?\d+) (-?\d+) Z"/g)]
      .map((m) => m.slice(1).map(Number));
    expect(lines.length).toBeGreaterThan(1);
    expect(heads.length).toBe(lines.length);
    const deg = (ax: number, ay: number, bx: number, by: number) =>
      (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    lines.forEach(([x1, y1, x2, y2], i) => {
      const h = heads[i];
      const line = deg(x1, y1, x2, y2);
      const point = deg((h[2] + h[4]) / 2, (h[3] + h[5]) / 2, h[0], h[1]);
      let off = Math.abs(line - point);
      if (off > 180) off = 360 - off;
      // a few degrees of slack for integer rounding; 69° was the bug
      expect(off, `head ${i} is ${off.toFixed(0)}° off its line`).toBeLessThan(5);
    });
  });

  it("straight really is straight — no orthogonal jogs", async () => {
    const svg = await svgOf(src("straight"), "v");
    // an orthogonal route turns; a straight one is a single segment per edge
    expect(svg).not.toMatch(/<path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L /);
  });

  it("an unknown style is refused with the list", () => {
    const r = buildModel(`system s "S" { a = aws/lambda "A" }\nview v { layout { lines wobbly } }`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.find((d) => d.message.includes("lines"))?.fix).toContain("orthogonal");
  });
});

describe("density", () => {
  const src = (d: string) =>
    `system s "S" {\n a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b\n}\n` +
    `view v { scope s\n layout { density ${d} } }`;

  it("all three are distinguishable", async () => {
    await allDistinct("density", {
      compact: src("compact"), comfortable: src("comfortable"), spacious: src("spacious"),
    }, "v");
  });

  it("orders the way the words promise", async () => {
    // snapshot-pinned by a lookbook case, but nothing asserted the ordering —
    // `spacious` could have been tighter than `compact` and only a human would
    // have noticed.
    const height = (svg: string) => +(/<svg[^>]*height="(\d+)"/.exec(svg)?.[1] ?? 0);
    const [c, m, s] = await Promise.all(
      ["compact", "comfortable", "spacious"].map(async (d) => height(await svgOf(src(d), "v"))),
    );
    expect(c).toBeLessThan(m);
    expect(m).toBeLessThan(s);
  });
});

describe("route sides", () => {
  // Sides only apply to edges that span rows; a same-rank edge is routed by our
  // own coplanar router and warns if you try (see layout.ts).
  const src = (hint: string) =>
    `system s "S" {\n a = aws/lambda "A"\n b = aws/dynamodb "B" datastore\n a -> b\n}\n` +
    `view v { scope s\n layout { rows [a] [b]\n ${hint} } }`;

  it("changes which side the edge leaves and enters", async () => {
    await allDistinct("route sides", {
      none: src(""),
      "from east": src("route a -> b from east"),
      "from west to east": src("route a -> b from west to east"),
    }, "v");
  });

  it("a label picks one of a parallel pair", async () => {
    const two = `system s "S" {\n a = aws/lambda "A"\n b = aws/dynamodb "B" datastore\n` +
      ` a -> b "read"\n a -> b "write"\n}\nview v { scope s\n layout { rows [a] [b]\n`;
    const plain = await svgOf(`${two} } }`, "v");
    const routed = await svgOf(`${two} route a -> b "write" from east to west } }`, "v");
    expect(routed).not.toBe(plain);
  });
});

describe("declaration forms that nothing else exercises", () => {
  it("`pack <name> from \"...\"` parses", () => {
    // `model.packs` is recorded and never read — `pack` is a declaration of
    // intent (CLAUDE.md) — but the from-clause must still parse, since the
    // grammar offers it.
    const r = buildModel(
      `pack aws from "https://example.com/pack.json"\nsystem s "S" { a = aws/lambda "A" }\n`,
    );
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("a file-level `theme` changes the render, and an explicit one still wins", async () => {
    // No theme option here on purpose: passing one is what a caller does to
    // *override* the file's choice, and that precedence is the contract
    // `--theme dark` depends on.
    const bare = async (src: string) => {
      const r = await render(src, {});
      expect(r.ok).toBe(true);
      return r.svg!;
    };
    const plain = await bare(`system s "S" { a = aws/lambda "A" }\n`);
    const declared = await bare(`theme dark\nsystem s "S" { a = aws/lambda "A" }\n`);
    expect(declared).not.toBe(plain);
    // …and asking for light explicitly gets light back, whatever the file says
    expect(await svgOf(`theme dark\nsystem s "S" { a = aws/lambda "A" }\n`)).toBe(plain);
  });

  it("a bad theme name is caught by `check`, not left for `render`", () => {
    // It used to pass the model pass and fail only inside render — and `check`
    // renders every view with an explicit `light`, so a typo'd theme produced
    // "1 file(s) OK" and then a failed render. For a loop that is check-then-
    // render, check has to be the authority.
    for (const src of [
      `theme drak\nsystem s "S" { a = aws/lambda "A" }\n`,
      `system s "S" { a = aws/lambda "A" }\nview v { scope s\n theme drak }\n`,
    ]) {
      const r = buildModel(src);
      expect(r.ok, src).toBe(false);
      const d = r.diagnostics.find((x) => x.message.includes("unknown theme"));
      expect(d?.fix).toContain("dark");
    }
  });

  it("a node can carry a kind and an attr block together", () => {
    // Never shown in SKILL.md until round 4, and two cold agents guessed the
    // order wrong in two separate rounds.
    const r = buildModel(
      `system s "S" {\n db = aws/dynamodb "Vault" datastore {\n  tags: #pci\n }\n}\n`,
    );
    expect(r.ok).toBe(true);
    expect(r.model.nodes.get("s.db")?.kinds).toContain("datastore");
    expect(r.model.nodes.get("s.db")?.tags).toContain("pci");
  });
});

describe("shapes that parse but that nothing exercised", () => {
  it("takes the kind and the attr block in either order", () => {
    // `"L" { tags: #x } datastore` used to die as a cascade of syntax errors
    // pointing at the brace, with no fix text — three cold agents across two
    // rounds wrote it. The model builder reads both with getChildren/getChild
    // and never cared about the order; only the grammar did.
    const decl = (d: string) => buildModel(`pack aws\nsystem s "S" {\n ${d}\n}`);
    const a = decl(`db = aws/dynamodb "Orders" datastore {\n  tags: #pci\n }`);
    const b = decl(`db = aws/dynamodb "Orders" {\n  tags: #pci\n } datastore`);
    for (const r of [a, b]) {
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(r.model.nodes.get("s.db")?.kinds).toContain("datastore");
      expect(r.model.nodes.get("s.db")?.tags).toContain("pci");
    }
  });

  it("names a kind put on a system, instead of derailing on it", () => {
    // `system partner "Partner System" external` is C4's external system, and
    // SKILL.md's own gloss for the keyword is "not ours — someone else's
    // system", so it is what an agent reaches for. Kinds go on nodes only, and
    // this came out as a syntax error pointing at the brace.
    const r = buildModel(`pack aws\nsystem partner "Partner System" external {\n description: "x"\n}\n`);
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBe(1); // one mistake, one diagnostic
    expect(errs[0].message).toContain("kinds belong to nodes");
    // the fix has to be copy-pasteable, label and all
    expect(errs[0].fix).toContain(`partner = box "Partner System" external`);
    // a kind on a node is still perfectly fine
    expect(buildModel(`system s "S" {\n a = box "Old" external\n}`)
      .diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("names a top-level `layout` block instead of derailing on it", () => {
    // `layout` inside a `system` had a named diagnostic; one level further out
    // did not, so a block at the top of the file produced three bare `syntax
    // error near` lines and no fix. A cold agent wrote exactly this.
    const body = `pack aws\na = aws/lambda "A"\nb = aws/lambda "B"\na -> b\n`;
    const bare = buildModel(`${body}\nlayout {\n  rows [a] [b]\n}\n`);
    const errs = bare.diagnostics.filter((d) => d.severity === "error");
    // one mistake, one diagnostic — the cascade it explains is dropped
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("top level");
    expect(errs[0].fix).toContain("view main");

    // when the file already has a view, point at that one by name
    const withView = buildModel(`${body}view shop { include * }\nlayout {\n  rows [a] [b]\n}\n`);
    expect(withView.diagnostics.find((d) => d.severity === "error")?.fix)
      .toContain("view shop");

    // and the legal spelling stays legal
    const ok = buildModel(`${body}view v { include *\n layout { rows [a] [b] } }\n`);
    expect(ok.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("declares a person with `= person`, the same node the top-level form builds", () => {
    // `person id "Label"` is a top-level form — `ContainerBody` never accepted
    // it — so the only way to draw a human inside a system was `= box "N"
    // person`. A cold agent wrote `analyst = person "Data Analyst"` and got a
    // bare syntax error with no fix text.
    // everything but `loc`, which legitimately differs — the two spellings are
    // different text — and `description`, which only the attr path defines
    const same = (n: any) => ({ path: n.path, name: n.name, label: n.label, icon: n.icon, kinds: n.kinds, tags: n.tags });
    const top = buildModel(`person analyst "Data Analyst"`).model.nodes.get("analyst")!;
    const eq = buildModel(`analyst = person "Data Analyst"`).model.nodes.get("analyst")!;
    expect(same(eq)).toEqual(same(top));
    // and it works where the top-level form cannot go
    const inner = buildModel(`system s "S" {\n who = person "Operator"\n}`);
    expect(inner.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(inner.model.nodes.get("s.who")?.kinds).toContain("person");
    expect(inner.model.nodes.get("s.who")?.icon).toEqual({ pack: "builtin", id: "person" });
  });

  it("ranks a zone named by its own id", async () => {
    // SPEC §5 says "`rows` can pin a zone by its id" and it was a hard error:
    // `resolve` only knew nodes, so a documented capability cost agents a
    // `check` in three separate rounds. `unitOf` mapped a zone id to itself all
    // along, so the engine could always do it.
    const src = (rows: string) => `pack aws
a = aws/lambda "A"
b = aws/dynamodb "B" datastore
ops = aws/cloudwatch "Ops"
a -> b
zone vpc "VPC" vpc { contains a, b }
view v { include *
  layout { rows ${rows} } }`;
    const where = async (rows: string) => {
      const built = buildProject([{ name: "t.squinch", src: src(rows) }]);
      expect(built.diagnostics.filter((d) => d.severity === "error"), rows).toEqual([]);
      const view = built.model.views.find((v) => v.name === "v")!;
      const { positioned } = await layoutView(built.model, view, {
        metrics: "inter" as const, scale: 1,
      });
      return {
        ops: positioned.nodes.find((n) => n.path === "ops")!.y,
        zone: positioned.zones[0].y,
      };
    };
    // the hint has to move it *both* ways, or it is just describing the default
    const below = await where("[vpc] [ops]");
    expect(below.zone).toBeLessThan(below.ops);
    const above = await where("[ops] [vpc]");
    expect(above.ops).toBeLessThan(above.zone);
  });

  it("still refuses an edge that runs up the bands, naming the zone to move", async () => {
    const built = buildProject([{ name: "t.squinch", src: `pack aws
gw = aws/api-gateway "GW"
a = aws/lambda "A"
b = aws/dynamodb "B" datastore
gw -> a
a -> b
zone vpc "VPC" vpc { contains a, b }
view v { include *
  layout { rows [vpc] [gw] } }` }]);
    const view = built.model.views.find((v) => v.name === "v")!;
    const { diagnostics } = await layoutView(built.model, view, {
      metrics: "inter" as const, scale: 1,
    });
    const d = diagnostics?.find((x) => x.message.includes("runs upward"));
    expect(d).toBeDefined();
    // the endpoint is `a`, but `a` is not something `rows` can hold — the fix
    // has to name the unit the author can actually move
    expect(d!.fix).toContain("`vpc`");
  });
});
