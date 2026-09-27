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

  it("gives a single-colour mark the same shell as vendor art: tile + inset chip", async () => {
    // One anatomy for every mark (2026-08): the neutral tile is the shell,
    // and a monochrome mark becomes a brand-coloured knockout chip inset at
    // ICON_ART — exactly where a Lambda's artwork would sit. The previous
    // treatment drew the mark bare on the tile in its brand colour, which
    // needed a white bed in dark mode (`brandPlate`) and split the design
    // from the shelf chips, which were always knockout.
    // scoped, so the system's children are drawn rather than summarised
    const src = `${SRC(``, `  m = sys/server "Mono"`)}\nview inner { scope s }`;
    const r = await render(src, { view: "inner", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const g = group(r.svg!, "s.m");
    const tile = /<rect x="(\d+)" y="(\d+)" width="40" height="40" rx="6" fill="([^"]+)"\/>/.exec(g)!;
    expect(tile[3]).toBe(themes.light.plate);
    // the chip sits at the same 7px inset as vendor artwork, filled with the
    // mark's colour — sys has none, so `iconMeta` folds in its neutral grey
    // (a pack constant, not a theme token: it matched light's old `muted`)
    const chip = /<rect x="(\d+)" y="(\d+)" width="26" height="26" rx="3" fill="([^"]+)"\/>/.exec(g)!;
    expect(+chip[1]).toBe(+tile[1] + 7);
    expect(+chip[2]).toBe(+tile[2] + 7);
    expect(chip[3]).toBe("#6F6E69");
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

  it("are two, peeking out below, each narrower than the one in front", async () => {
    const s = await svg();
    const outlines = [...s.matchAll(new RegExp(
      `<path d="([^"]*)" fill="none" stroke="${themes.light.sheetBorder}"`, "g",
    ))].map((m) => m[1]);
    const card = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(group(s, "s"))!;
    const [cx, cy, cw, ch] = [+card[1], +card[2], +card[3], +card[4]];
    const top = cy + ch, right = cx + cw;
    // Only the part that peeks out is drawn, from the card's bottom edge down.
    // Back sheet first, so the near one overlaps it: 12 down and 24 in from
    // each side, deeper than the corner radius, so its sides run straight down
    // before turning the corner.
    expect(outlines[0]).toBe(
      `M${cx + 24} ${top} V${top + 4} A8 8 0 0 0 ${cx + 32} ${top + 12} ` +
      `H${right - 32} A8 8 0 0 0 ${right - 24} ${top + 4} V${top}`);
    // the near sheet, 6 down and 12 in, is shallower than the radius: two
    // partial arcs meeting the card's edge 0.25 in from the sheet's sides
    expect(outlines[1]).toBe(
      `M${cx + 12.25} ${top} A8 8 0 0 0 ${cx + 20} ${top + 6} ` +
      `H${right - 20} A8 8 0 0 0 ${right - 12.25} ${top}`);
  });

  it("draw nothing under the card, so a dimmed card has no ghost behind it", async () => {
    const s = await svg();
    const card = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(group(s, "s"))!;
    const bottom = +card[2] + +card[4];
    const before = s.slice(0, s.indexOf(`data-path="s"`));
    // every sheet path — two fills, two outlines — keeps to the card's bottom
    // edge and below; nothing sits under the card to show through when it is dimmed
    const t = themes.light;
    const paths = [...before.matchAll(
      new RegExp(`<path d="([^"]*)" fill="(?:${t.sheetFill}|${t.sheetFillNear}|none)"[^>]*(?:filter|stroke="${t.sheetBorder}")`, "g"),
    )].map((m) => m[1]);
    expect(paths.length).toBe(4);
    for (const d of paths) {
      const ys = [...d.matchAll(/(?:M|A8 8 0 0 0 )[\d.]+ ([\d.]+)|V([\d.]+)/g)].map((m) => +(m[1] ?? m[2]));
      expect(ys.length).toBeGreaterThan(0);
      for (const y of ys) expect(y).toBeGreaterThanOrEqual(bottom);
    }
  });

  it("are never on a leaf", async () => {
    const s = await svg();
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

describe("the detailed card (`preview <path>`)", () => {
  // Five leaves, the first three previewed: three rows and a `+2 more` shelf.
  const view = (extra = "") => `pack aws
system s "System" {
${extra}
  a = aws/lambda "A" { subtitle: "Lambda" }
  b = aws/dynamodb "B" datastore
  c = aws/sqs "C"
  d = aws/s3 "D"
  e = aws/elasticache "E"
}
t = aws/lambda "T"
t -> s
view main { include *\n preview s }`;
  // `group` stops at the first </g>, and a card's clipped parts each close
  // one, so the detailed card is asserted over the whole document: it is the
  // only card in it.
  const draw = async (extra = "", theme = "light") => {
    const r = await render(view(extra), { view: "main", theme });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    return r.svg!;
  };

  it("keeps the head at 66 and hangs 32px rows under it: 66 + 3×32 + 30 = 192", async () => {
    const s = await draw();
    expect(s).toMatch(/<rect x="\d+" y="\d+" width="\d+" height="192" rx="8" fill="url\(#sq-surface\)"/);
    // a hairline opens each row, in the card's own coordinates
    for (const y of [66, 98, 130]) expect(s).toContain(`<line x1="3" y1="${y}" x2=`);
    // the rows name the children; the shelf says how many more, and has no chips
    expect(s).toContain(">A<");
    expect(s).toContain(">+2 more<");
    // 16px marks: one per row, and none on the shelf (the leaf T draws its mark at 26)
    expect((s.match(/<use [^>]*width="16" height="16"/g) ?? []).length).toBe(3);
  });

  it("keeps its shelf even with nothing to put on it, so a rank of detailed cards lines up", async () => {
    // three children, all previewed, no domain: the shelf is a bare base — still 192
    const src = `pack aws\nsystem s "S" {\n a = aws/lambda "A"\n b = aws/sqs "B"\n c = aws/s3 "C"\n}\nt = box "T"\nt -> s\nview main { include *\n preview s }`;
    const r = await render(src, { view: "main", theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg!).toMatch(/height="192" rx="8" fill="url\(#sq-surface\)"/);
    expect(r.svg!).not.toContain(" more<");
  });

  it("stays mergeable across both palettes", async () => {
    const r = await render(view(`  domain: "core"`), { view: "main", theme: "light", adaptive: true });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg).toContain("@media (prefers-color-scheme: dark)");
    expect(validateSVG(r.svg!).ok).toBe(true);
  });
});
