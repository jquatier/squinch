// `color:` (SPEC §3/§4/§Zones/§5): one hue vocabulary on leaves, containers,
// edges and zones, plus the view-level `color #tag hue` lens. Checked end to
// end — what the model accepts, how a view resolves it, what the renderer
// paints, and that the adaptive merge still holds with every site coloured.
import { describe, it, expect } from "vitest";
import { buildModel, diffModels, render, HUES } from "../src/index.js";
import { resolveView } from "../src/view/resolve.js";
import { validateSVG } from "../src/render/validate.js";
import { mergeAdaptive } from "../src/render/adaptive.js";
import { themes, hueOf } from "../src/themes/index.js";

const BASE = `pack aws
person user "User"
system shop "Shop" {
  api = aws/api-gateway "API"
  db  = aws/dynamodb "Orders" datastore
  api -> db "writes"
}
system pay "Payments" {
  tags: #money
  gw = aws/lambda "Charge"
}
user -> shop.api "browses"
shop.api -> pay.gw "charges" { tags: #money }
`;

const viewOf = (src: string, name: string) => {
  const r = buildModel(src);
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const view = r.model.views.find((v) => v.name === name)!;
  return { model: r.model, view, graph: resolveView(r.model, view) };
};

describe("color: the model", () => {
  it("accepts every hue on a leaf, a container, an edge and a zone", () => {
    for (const hue of HUES) {
      const r = buildModel(`${BASE}
system ops "Ops" { color: ${hue}
  w = aws/lambda "W" { color: ${hue} }
  w -> w2 { color: ${hue} }
  w2 = aws/lambda "W2"
}
zone z "Z" custom { contains ops\n color: ${hue} }
`);
      expect(r.diagnostics.filter((d) => d.severity === "error"), hue).toEqual([]);
      expect(r.model.nodes.get("ops.w")!.color).toBe(hue);
      expect(r.model.containers.get("ops")!.color).toBe(hue);
      expect(r.model.edges.find((e) => e.from === "ops.w")!.color).toBe(hue);
      expect(r.model.zones[0].color).toBe(hue);
    }
  });

  it("refuses hex at every site, with the hue list", () => {
    const sites = [
      `${BASE}\nx = aws/lambda "X" { color: "#ff0000" }`,
      `${BASE}\nsystem ops "Ops" { color: "#ff0000"\n w = aws/lambda "W"\n}`,
      `${BASE}\nshop.db -> pay.gw { color: "#ff0000" }`,
      `${BASE}\nzone z "Z" custom { contains shop\n color: rgb(1,2,3) }`,
    ];
    for (const src of sites) {
      const r = buildModel(src);
      const d = r.diagnostics.find((x) => x.message.includes("never hex"));
      expect(d, src).toBeDefined();
      expect(d!.severity).toBe("error");
      expect(d!.fix).toContain("red | amber | green");
    }
  });

  it("a typo gets a did-you-mean", () => {
    const r = buildModel(`${BASE}\nx = aws/lambda "X" { color: vilet }`);
    const d = r.diagnostics.find((x) => x.message.includes("unknown color"))!;
    expect(d.fix).toContain("did you mean `violet`");
  });

  it("the view statement collects, and a restated tag with another hue warns", () => {
    const r = buildModel(`${BASE}\nview v { include *\n color #money red\n color #money blue\n}`);
    const v = r.model.views.find((x) => x.name === "v")!;
    expect(v.colors.map((c) => [c.tag, c.hue])).toEqual([["money", "red"], ["money", "blue"]]);
    const w = r.diagnostics.find((d) => d.message.includes("stated twice"))!;
    expect(w.severity).toBe("warning");
    expect(w.message).toContain("#money");
  });
});

describe("color: resolution", () => {
  it("an element's own colour reaches the view graph, containers included", () => {
    const { graph } = viewOf(`${BASE.replace('gw = aws/lambda "Charge"', 'gw = aws/lambda "Charge" { color: amber }')}
view v { include * }
view inside { scope pay }`, "inside");
    expect(graph.nodes.find((n) => n.path === "pay.gw")!.color).toBe("amber");
  });

  it("the view's `color #tag` wins over an element's own colour, and inherits through containers", () => {
    const src = `${BASE.replace('gw = aws/lambda "Charge"', 'gw = aws/lambda "Charge" { color: amber }')}
view v { scope pay\n color #money teal }`;
    const { graph } = viewOf(src, "v");
    // pay.gw carries #money through its container, and its own amber loses
    expect(graph.nodes.find((n) => n.path === "pay.gw")!.color).toBe("teal");
    // the tagged edge takes it too — at landscape altitude it has lifted to the cards
    const { graph: land } = viewOf(`${BASE}\nview land { include *\n color #money teal }`, "land");
    expect(land.edges.find((e) => e.from === "shop" && e.to === "pay")!.color).toBe("teal");
    expect(land.nodes.find((n) => n.path === "pay")!.color).toBe("teal");
    expect(land.nodes.find((n) => n.path === "shop")!.color).toBeUndefined();
  });

  it("a trunk keeps a hue only when every member agrees", () => {
    const two = `pack aws
system a "A" { x = aws/lambda "X"\n y = aws/lambda "Y" }
system b "B" { z = aws/lambda "Z" }
a.x -> b.z { color: red }
a.y -> b.z { color: red }
view land { include * }`;
    expect(viewOf(two, "land").graph.edges[0].color).toBe("red");
    const mixed = two.replace("a.y -> b.z { color: red }", "a.y -> b.z { color: blue }");
    expect(viewOf(mixed, "land").graph.edges[0].color).toBeUndefined();
  });

  it("warns when the tag matches nothing visible, and when two statements collide on one element", () => {
    // (#money still reaches a `scope shop` view through pay's context card, so
    // the no-match case needs a tag nothing carries)
    const none = viewOf(`${BASE}\nview v { scope shop\n color #nope red }`, "v");
    expect(none.graph.diagnostics.map((d) => d.message)).toContainEqual(
      expect.stringContaining("color #nope: nothing visible here is tagged #nope"),
    );
    const clash = viewOf(
      `${BASE.replace("tags: #money", "tags: #money #eu")}\nview v { include *\n color #money red\n color #eu blue }`,
      "v",
    );
    const w = clash.graph.diagnostics.find((d) => d.message.includes("wins"))!;
    expect(w.severity).toBe("warning");
    expect(w.message).toContain("#eu wins");
    expect(clash.graph.nodes.find((n) => n.path === "pay")!.color).toBe("blue");
  });
});

describe("color: the picture", () => {
  const svgOf = async (src: string, theme = "light", view?: string) => {
    const r = await render(src, { theme, ...(view ? { view } : {}) });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    return r.svg!;
  };

  it("every hue renders distinctly on an edge, a leaf and a card — and none is the default", async () => {
    // `attr` is the attr block to splice in; "" is the uncoloured baseline
    const sites: Record<string, (attr: string) => string> = {
      // an edge that is drawn natively at the view's altitude (a cross-system
      // one would lift into the existing trunk and, disagreeing, lose its hue)
      edge: (attr) => `${BASE.replace('api -> db "writes"', `api -> db "writes"${attr}`)}\nview v { scope shop }`,
      leaf: (attr) => `${BASE.replace('gw = aws/lambda "Charge"', `gw = aws/lambda "Charge"${attr}`)}\nview v { scope pay }`,
      card: (attr) => `${BASE.replace("tags: #money", `tags: #money${attr.replace(/^ \{ (.*) \}$/, "\n  $1")}`)}\nview v { include * }`,
    };
    for (const [site, src] of Object.entries(sites)) {
      const plain = await svgOf(src(""), "light", "v");
      const svgs = new Map<string, string>();
      for (const hue of HUES) svgs.set(hue, await svgOf(src(` { color: ${hue} }`), "light", "v"));
      const all = [plain, ...svgs.values()];
      expect(new Set(all).size, `${site}: some hues render identically`).toBe(all.length);
      // and the stroke/fill literally is the theme's hue
      expect(svgs.get("teal"), site).toContain(hueOf(themes.light, "teal"));
    }
  });

  it("a coloured edge carries its hue into the arrowhead; a narrated flow hop still wins", async () => {
    const src = `pack aws
system s "S" { a = aws/lambda "A"\n b = aws/lambda "B"\n a -> b "go" { color: pink } }
flow f "F" { s.a -> s.b }
view v { scope s\n show flow f }`;
    const svg = await svgOf(src, "light", "v");
    const pink = hueOf(themes.light, "pink");
    // stroke and the filled chevron
    expect(svg).toMatch(new RegExp(`stroke="${pink}" stroke-width="1.5"`));
    expect(svg).toMatch(new RegExp(`Z" fill="${pink}"`));
    const walked = (await render(src, { theme: "light", view: "v", flowStep: 1 })).svg!;
    expect(walked).not.toContain(`stroke="${pink}"`);
    expect(walked).toContain(`stroke="${themes.light.accent}" stroke-width="2.5"`);
  });

  it("context cards stay muted, whatever the container says", async () => {
    const src = `${BASE.replace("tags: #money", "tags: #money\n  color: red")}\nview v { scope shop }`;
    const svg = await svgOf(src, "light", "v");
    const red = hueOf(themes.light, "red");
    // pay appears as a context card here: muted spine, no red anywhere
    expect(svg).toContain(`data-kind="context-card"`);
    expect(svg).not.toContain(red);
  });

  it("an uncoloured diagram is byte-identical to what it was", async () => {
    // the rings are separate elements emitted only when coloured, and the
    // zone tints are the same hex values under new names — nothing else moved
    const svg = await svgOf(`${BASE}\nzone z "Z" vpc { contains shop }\nview v { include * }`, "light", "v");
    expect(svg).not.toMatch(/fill="none" stroke="#[0-9A-F]{6}" stroke-width="1.5"\/><\/g>/);
    expect(svg).toContain(`stroke="${themes.light.hueBlue}" stroke-width="1.5" stroke-dasharray="8 5"`);
  });

  it("the legend lists the view's tag colours by tag, and nothing for element colours", async () => {
    const tagged = await svgOf(`${BASE}\nview v { include *\n legend auto\n color #money teal }`, "light", "v");
    expect(tagged).toContain(">#money</text>");
    expect(tagged).toContain(`stroke="${hueOf(themes.light, "teal")}" stroke-width="1.5"/>`);
    const element = await svgOf(
      `${BASE.replace("tags: #money", "tags: #money\n  color: teal")}\nview v { include *\n legend auto }`,
      "light", "v",
    );
    expect(element).not.toContain(">#money</text>");
    expect(element).not.toContain(">teal</text>");
  });

  it("survives the adaptive merge with every site coloured", async () => {
    const src = `pack aws
u = person "U" { color: pink }
system a "A" { color: red
  x = aws/lambda "X" { color: amber }
  y = aws/lambda "Y"
  x -> y { color: green }
}
system b "B" { tags: #edge
  z = aws/lambda "Z"
}
u -> a.x
a.y ~> b.z "evt" { color: teal }
zone zz "Zone" vpc { contains a, b\n color: violet }
view v { include *\n expand b\n color #edge blue\n legend auto }`;
    const lr = await render(src, { theme: "light", view: "v" });
    expect(lr.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const light = lr.svg!;
    const dark = (await render(src, { theme: "dark", view: "v" })).svg!;
    const merged = mergeAdaptive(light, dark);
    expect(validateSVG(merged).ok).toBe(true);
    // the dark hue landed as a rule beside the light literal, not in place of
    // it (a's red spine and the teal async edge are both on screen here; x's
    // amber ring is inside a collapsed card and is not)
    for (const h of ["red", "teal", "violet", "blue"] as const) {
      expect(merged, h).toContain(hueOf(themes.light, h));
      expect(merged, h).toContain(hueOf(themes.dark, h));
    }
  });
});

describe("color: the diff", () => {
  const d = (a: string, b: string) => diffModels(buildModel(a).model, buildModel(b).model);
  it("a changed colour is cosmetic, on nodes, containers, edges and views", () => {
    const node = d(BASE, BASE.replace('gw = aws/lambda "Charge"', 'gw = aws/lambda "Charge" { color: red }'));
    expect(node.structural).toBe(0);
    expect(node.changes.map((c) => c.detail)).toContainEqual(expect.stringContaining("pay.gw color"));
    const container = d(BASE, BASE.replace("tags: #money", "tags: #money\n  color: red"));
    expect(container.structural).toBe(0);
    expect(container.changes[0].detail).toContain("pay color");
    const edge = d(BASE, BASE.replace('"charges" { tags: #money }', '"charges" { tags: #money, color: red }'));
    expect(edge.structural).toBe(0);
    expect(edge.changes[0].detail).toContain("color");
    const view = d(`${BASE}\nview v { include * }`, `${BASE}\nview v { include *\n color #money red }`);
    expect(view.structural).toBe(0);
    expect(view.cosmetic).toBe(1);
  });
});
