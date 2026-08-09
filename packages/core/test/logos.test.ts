// The logo pack: single-colour marks drawn in their brand colour, so a
// wordless logo still reads on a light or dark canvas.
//
// The treatment moved with the docs/design restyle. A mark used to get its own
// brand-coloured plate with the glyph knocked out in white; now every node icon
// sits on the same neutral tile and the mark itself carries the brand colour.
// What has to stay true either way is the part that made the old plate exist:
// the mark is never left to default to black, and never matches what is behind
// it — GitHub's near-black on a near-black plate was an invisible icon rather
// than an obviously wrong one.
import { describe, it, expect } from "vitest";
import { render, iconIds, iconMeta, iconExists, searchIcons, themes } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

describe("pack-logos", () => {
  it("registers with brand colours and friendly aliases", () => {
    expect(iconIds("logos").length).toBeGreaterThan(100);
    expect(iconMeta("logos", "postgresql")?.color).toBe("#4169E1");
    // aliases people actually type
    for (const [alias, target] of [["postgres", "postgresql"], ["kafka", "apachekafka"], ["k8s", "kubernetes"]])
      expect(iconMeta("logos", alias)?.color, alias).toBe(iconMeta("logos", target)?.color);
    expect(iconExists("logos", "nope-not-a-brand")).toBe(false);
  });

  it("search finds logos alongside aws, without duplicating aliases", () => {
    const hits = searchIcons("postgres");
    expect(hits).toContain("logos/postgresql");
    expect(hits).not.toContain("logos/postgres"); // alias collapses into canonical
  });

  it("draws marks in their brand colour on the neutral tile", async () => {
    const src = `pack logos
system s "S" {
  db = logos/postgres "PostgreSQL" datastore
  gh = logos/github "GitHub"
  gh -> db
}
`;
    const r = await render(src, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    expect(r.svg).toContain(`href="#sq-logos-postgresql"`);
    // `fill` as well as `color`: vendored marks carry no fill of their own and
    // would default to black
    expect(r.svg).toContain(`<g color="#4169E1" fill="#4169E1">`);
  });

  it("gives a trademark a plate it reads on, in whichever theme", async () => {
    // A brand hue is fixed; the surface under it is what moves. Two ways to
    // get this wrong, and both shipped before this test existed: GitHub's
    // near-black on the dark theme's tile is a 1.4:1 smudge, and a white tile
    // in *light* vanishes into the card's white top. So the assertion is the
    // thing that actually matters — the mark reads against its plate, and the
    // plate reads against the card — rather than any particular hex.
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const name of ["light", "dark"] as const) {
      const t = themes[name];
      const r = await render(`pack logos\nsystem s "S" {\n gh = logos/github "GitHub"\n}\n`, { theme: name });
      const bed = /<rect x="\d+" y="\d+" width="40" height="40" rx="6" fill="(#[0-9A-Fa-f]{6})"/.exec(r.svg!)![1];
      expect(ratio("#181717", bed), `${name}: mark on its plate`).toBeGreaterThan(3);
      // and the plate itself is not invisible against the surface it sits on
      expect(ratio(bed, t.surfaceHi), `${name}: plate on the card`).not.toBe(1);
    }
  });

  it("a near-black mark is not the same colour as the tile under it", async () => {
    const r = await render(`pack logos
system s "S" {
 gh = logos/github "GitHub"
}
`, { theme: "light" });
    const tile = /<rect x="\d+" y="\d+" width="40" height="40" rx="6" fill="(#[0-9A-Fa-f]{6})"/.exec(r.svg!)![1];
    const mark = /<g color="(#[0-9A-Fa-f]{6})" fill="#[0-9A-Fa-f]{6}"><use href="#sq-logos-github"/.exec(r.svg!)![1];
    expect(mark.toLowerCase()).toBe("#181717"); // GitHub's own
    expect(tile.toLowerCase()).not.toBe(mark.toLowerCase());
  });

  it("stays deterministic and valid in every theme", async () => {
    const src = `pack logos\nsystem s "S" {\n k = logos/kafka "Kafka"\n}\n`;
    for (const theme of ["light", "dark"]) {
      const a = await render(src, { theme });
      const b = await render(src, { theme });
      expect(a.ok, theme).toBe(true);
      expect(validateSVG(a.svg!).ok, theme).toBe(true);
      expect(b.svg, theme).toBe(a.svg);
    }
  });
});
