// Which legend entries a view shows (view/legend.ts): the ones its drawing has
// marks for, matched on the laid-out view. An entry with nothing to point at
// is left out without a word — one block is meant for every view.
import { describe, it, expect } from "vitest";
import { buildModel, layoutView } from "../src/index.js";
import { drawnLegendKeys } from "../src/view/legend.js";

const MODEL = `system shop "Shop" #pci {
  api = box "API"
  db = box "DB" datastore
  api -> db
}
system pay "Pay" #ext {
  charge = box "Charge"
  ledger = box "Ledger"
  charge <-> ledger
}
stripe = box "Stripe" external
shop.api -> pay.charge #money
shop.api -> pay.ledger
shop.api ~> stripe { style: dotted }
shop.db -- stripe
`;
const BLOCK = `legend {
    -> "Request"; ~> "Event"; <-> "Both ways"; -- "Related"
    aggregated "Merged"; external "Third-party"; context "Outside"
    #pci "Card data"; #money "Money"; #ext "Partner"
  }`;
const VIEWS = `view v {
  expand shop
  color #pci red
  color #money green
  ${BLOCK}
}
view s {
  scope shop
  color #ext blue
  ${BLOCK}
}
view p {
  expand pay
  ${BLOCK}
}
`;

async function laid(src: string, name: string) {
  const b = buildModel(src);
  expect(b.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const view = b.model.views.find((x) => x.name === name)!;
  const { positioned } = await layoutView(b.model, view);
  return { model: b.model, view, positioned };
}
const shown = async (src: string, name: string) => {
  const { positioned } = await laid(src, name);
  return positioned.legend && "entries" in positioned.legend
    ? positioned.legend.entries.map((e) => e.key) : null;
};

describe("legend matching", () => {
  it("one block in three views shows each view only what it draws, in written order", async () => {
    // v: shop open; pay a card the two API calls merge into (×2)
    expect(await shown(MODEL + VIEWS, "v")).toEqual(["->", "~>", "--", "aggregated", "external", "#pci", "#money"]);
    // s: scoped to shop; pay and stripe are context, and the lens skips context cards
    expect(await shown(MODEL + VIEWS, "s")).toEqual(["->", "~>", "--", "aggregated", "external", "context"]);
    // p: pay open, its two-way edge drawn; no colour lines here, so no tags
    expect(await shown(MODEL + VIEWS, "p")).toEqual(["->", "<->", "aggregated", "external"]);
  });

  it("a ×n edge is its arrow too, and keeps a tag one of its members carries", async () => {
    const { model, view, positioned } = await laid(MODEL + VIEWS, "v");
    const merged = positioned.edges.find((e) => e.to === "pay")!;
    expect(merged.count).toBe(2);
    expect(drawnLegendKeys(model, view, { ...positioned, edges: [merged] }))
      .toEqual(["->", "aggregated", "external", "#pci", "#money"]);
  });

  it("a tag on a context card does not show — the card stays muted", async () => {
    const { positioned } = await laid(MODEL + VIEWS, "s");
    expect(positioned.nodes.find((n) => n.path === "pay")!.kind).toBe("context-card");
    expect(positioned.legend).toEqual({ entries: expect.not.arrayContaining([expect.objectContaining({ key: "#ext" })]) });
  });

  it("swatches are theme-free and follow the drawing", async () => {
    const { positioned } = await laid(MODEL + VIEWS, "v");
    const sw = Object.fromEntries((positioned.legend as { entries: { key: string; swatch: unknown }[] }).entries.map((e) => [e.key, e.swatch]));
    expect(sw).toEqual({
      "->": { kind: "arrow", arrow: "->" },
      // every async edge here is dotted, so the sample is
      "~>": { kind: "arrow", arrow: "~>", style: "dotted" },
      "--": { kind: "arrow", arrow: "--" },
      aggregated: { kind: "aggregated" },
      external: { kind: "external" },
      "#pci": { kind: "tag", hue: "red" },
      "#money": { kind: "tag", hue: "green" },
    });
  });

  it("an arrow's sample keeps its own pattern when its edges differ", async () => {
    const src = `a = box "A"\nb = box "B"\nc = box "C"\na ~> b\nb ~> c { style: dotted }\na -> c { style: dashed }\nview v { legend { ~> "Event"  -> "Call" } }`;
    const { positioned } = await laid(src, "v");
    expect((positioned.legend as { entries: { swatch: unknown }[] }).entries.map((e) => e.swatch)).toEqual([
      { kind: "arrow", arrow: "~>", style: "dashed" },
      // the only sync edge is dashed: that is what the reader sees
      { kind: "arrow", arrow: "->", style: "dashed" },
    ]);
  });

  it("a tag whose hue lost on every element it marks does not show", async () => {
    const src = `a = box "A"\nb = box "B"\na -> b #x #y\nview v {\n  color #x red\n  color #y blue\n  legend { #x "X"  #y "Y" }\n}`;
    expect(await shown(src, "v")).toEqual(["#y"]);
  });

  it("`legend auto` is carried as the retired form; no legend means none", async () => {
    const { positioned } = await laid(`a = box "A"\nb = box "B"\na -> b\nview v { legend auto }`, "v");
    expect(positioned.legend).toEqual({ auto: true });
    const none = await laid(`a = box "A"\nb = box "B"\na -> b\nview v { }`, "v");
    expect(none.positioned.legend).toBeUndefined();
  });

  it("an entry with nothing to match leaves an empty list — and no band", async () => {
    const { positioned } = await laid(`a = box "A"\nb = box "B"\na -> b\nview v { legend { ~> "Event" } }`, "v");
    expect(positioned.legend).toEqual({ entries: [] });
  });
});
