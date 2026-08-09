// Card anatomy (docs/design). The restyle turned a labelled rectangle into an
// object with parts — tile, spine, glyph chip, shelf, sheets — and most of the
// bugs found while building it were geometric relationships between those
// parts, not any one part being wrong. So these assert the relationships.
import { describe, it, expect } from "vitest";
import { render, themes, validateSVG } from "../src/index.js";

const SRC = (extra = "", body = "") => `pack aws
system s "System" {
${extra}
  a = aws/lambda "A"
  b = aws/dynamodb "B" datastore
  c = aws/sqs "C"
  d = aws/s3 "D"
  e = aws/elasticache "E"
${body}
}
t = box "T"
t -> s
view main { include * }`;

const svg = async (extra = "", body = "", theme = "light") => {
  const r = await render(SRC(extra, body), { view: "main", theme });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  expect(validateSVG(r.svg!).ok).toBe(true);
  return r.svg!;
};

/** The markup of one node group, from `data-path` to its closing tag. */
const group = (s: string, path: string) => {
  const at = s.indexOf(`data-path="${path}"`);
  expect(at, `no group for ${path}`).toBeGreaterThan(-1);
  return s.slice(s.lastIndexOf("<g", at), s.indexOf("</g>", at) + 4);
};

describe("the card's icon tile", () => {
  it("sets the pack mark on a neutral tile rather than on the card surface", async () => {
    const s = await svg(`  icon: aws/api-gateway`);
    // 40 of tile, 26 of artwork, centred — the ring of tile is the point:
    // vendor art is drawn on white in its own guidelines and reads as pasted
    // on against a gradient
    const tile = /<rect x="(\d+)" y="(\d+)" width="40" height="40" rx="6" fill="([^"]+)"\/>/.exec(s)!;
    expect(tile[3]).toBe(themes.light.plate);
    const [x, y] = [+tile[1], +tile[2]];
    expect(s).toContain(`x="${x + 7}" y="${y + 7}" width="26" height="26"`);
  });

  it("draws a single-colour mark bare, never a plate inside the plate", async () => {
    // `iconPlate`'s monochrome branch paints a brand-coloured plate with the
    // mark knocked out — right when the mark stands alone, wrong on a tile,
    // where it nests one rounded rect inside another.
    // scoped, so the system's children are drawn rather than summarised
    const src = `${SRC(``, `  m = sys/server "Mono"`)}\nview inner { scope s }`;
    const r = await render(src, { view: "inner", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const g = group(r.svg!, "s.m");
    const rects = [...g.matchAll(/<rect[^>]*width="(\d+)" height="\1"[^>]*\/>/g)].map((r) => r[1]);
    expect(rects, "one square behind the mark, not two").toEqual(["40"]);
  });
});

describe("the shelf", () => {
  it("appears only when it has something to hold", async () => {
    // keyed on the hairline element: its colour is `shelfLine`, which in the
    // light palette is the same hex as `plate`, so a colour test would pass on
    // any card that merely has an icon tile
    const line = /<line x1="3"[^>]*stroke="[^"]*" stroke-width="1"\/>/;
    const bare = await render(`system empty "Empty" { }\nx = box "X"\nx -> empty\nview v { include * }`,
      { view: "v", theme: "light" });
    expect(line.test(bare.svg!)).toBe(false);
    expect(line.test(await svg())).toBe(true);
  });

  it("centres a shelf-less card's header instead of leaving the bottom empty", async () => {
    const withShelf = await svg();
    const without = (await render(
      `system empty "Empty" { }\nx = box "X"\nx -> empty\nview v { include * }`,
      { view: "v", theme: "light" },
    )).svg!;
    const titleY = (s: string, label: string) =>
      +/y="(\d+)"[^>]*font-size="15"/.exec(s.slice(s.indexOf(label) - 200, s.indexOf(label)))![1];
    // the shelf-less card's title sits lower in its 96 than the shelved one's,
    // because it centres in the whole card rather than in the body above a shelf
    expect(titleY(without, "Empty")).toBeGreaterThan(titleY(withShelf, "System"));
  });

  it("never lets the domain chip run over the overflow count", async () => {
    // A chip sized against the card rather than against the room left on the
    // shelf slid left over the `+N` it was meant to sit beside.
    const s = await svg(`  domain: "platform-infrastructure"`);
    const more = /<text x="(\d+)"[^>]*font-weight="500" fill="[^"]*">\+(\d+)<\/text>/.exec(s)!;
    const chip = /<rect x="(\d+)"[^>]*height="18" rx="2" fill="[^"]*" stroke="[^"]*"/.exec(s)!;
    expect(+chip[1]).toBeGreaterThan(+more[1]);
  });

  it("drops the chip rather than shrinking it to nothing", async () => {
    // With six icons and a long name on the narrowest tier there is no room
    // worth taking; two letters and an ellipsis name nothing.
    const s = await svg(`  domain: "platform-infrastructure-and-tooling"`, `  f = aws/redshift "F"`);
    const chip = /<rect x="\d+"[^>]*height="18" rx="2" fill="[^"]*" stroke="[^"]*"/.exec(s);
    if (chip) {
      const w = +/width="(\d+)"/.exec(chip[0])![1];
      expect(w).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("stacked sheets", () => {
  it("sit outside the node's own group", async () => {
    // The playground styles the group's first rect on hover and measures the
    // group's bounding box for the dive: sheets inside it would light the back
    // sheet and throw every zoom 8px off centre.
    const s = await svg();
    const g = group(s, "s");
    expect(g).not.toContain(themes.light.sheetBorder);
    expect(s.slice(0, s.indexOf(`data-path="s"`))).toContain(themes.light.sheetBorder);
  });

  it("are two, offset back and down, and never on a leaf or a context card", async () => {
    const s = await svg();
    // `sheetFill` is also the gradient's lower stop and the shelf bed, so the
    // stroke is what identifies a sheet
    const sheets = [...s.matchAll(
      new RegExp(`<rect x="(\\d+)" y="(\\d+)"[^>]*stroke="${themes.light.sheetBorder}"`, "g"),
    )];
    expect(sheets.length).toBe(2);
    const [near, far] = sheets.map((m) => [+m[1], +m[2]]).sort((a, b) => a[0] - b[0]);
    expect(far[0] - near[0]).toBe(4);
    expect(far[1] - near[1]).toBe(4);
    // a leaf has no inside, so it gets none of the affordances that imply one
    expect(group(s, "t")).not.toContain(themes.light.sheetBorder);
  });
});

describe("the actor tile", () => {
  it("is filled and borderless, with a round avatar", async () => {
    const r = await render(
      `person who "Someone"\nx = box "X"\nwho -> x\nview v { include * }`,
      { view: "v", theme: "light" },
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const g = group(r.svg!, "who");
    // the tile: a gradient fill and no stroke at all — shape separates the
    // human who starts the story from the services, before the icon is read
    expect(g).toMatch(/<rect[^>]*fill="url\(#sq-actor\)"[^>]*\/>/);
    expect(/<rect[^>]*fill="url\(#sq-actor\)"[^>]*stroke=/.test(g)).toBe(false);
    expect(g).toMatch(/<circle cx="\d+" cy="\d+" r="17"/);
    expect(validateSVG(r.svg!).ok).toBe(true);
  });
});

describe("both palettes stay mergeable", () => {
  it("differ only in colour, over the whole new anatomy", async () => {
    // The restyle added a gradient, a shadow filter and several tinted beds.
    // Any of them differing in a non-colour attribute would make the adaptive
    // pair unmergeable — this is the cheap check that they do not.
    const r = await render(SRC(`  icon: aws/api-gateway\n  glyph: sys/lock\n  domain: "core"`), {
      view: "main", theme: "light", adaptive: true,
    });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg).toContain("@media (prefers-color-scheme: dark)");
    expect(validateSVG(r.svg!).ok).toBe(true);
  });
});
