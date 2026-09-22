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

  it("draws a mark as a brand-coloured knockout chip inside the neutral tile", async () => {
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
    // the chip carries the brand colour; the mark is knocked out of it
    expect(r.svg).toContain(`width="26" height="26" rx="3" fill="#4169E1"`);
  });

  it("picks the knockout ink from the chip's lightness, in whichever theme", async () => {
    // A brand hex is fixed, so the ink on top is what moves. White carries a
    // dark chip (GitHub's near-black), but a light chip (JavaScript's yellow)
    // makes white a 1.4:1 ghost — and dark-on-colour is that brand's own
    // usage. The threshold is integer arithmetic on the hex, so the same chip
    // gets the same ink on every platform.
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
      const r = await render(
        `pack logos\nsystem s "S" {\n gh = logos/github "GitHub"\n js = logos/javascript "JS"\n gh -> js\n}\n`,
        { theme: name },
      );
      for (const [id, hex] of [["github", "#181717"], ["javascript", "#F7DF1E"]] as const) {
        const m = new RegExp(
          `rx="3" fill="${hex}"[^/]*/>\\s*<g color="(#[0-9A-Fa-f]{6})" fill="\\1"[^>]*>\\s*<use href="#sq-logos-${id}"`,
        ).exec(r.svg!);
        expect(m, `${name}: ${id} chip + knockout`).not.toBeNull();
        expect(ratio(m![1], hex), `${name}: ${id} ink on its chip`).toBeGreaterThan(3);
      }
    }
  });

  it("draws a badge mark in ink when its brand colour would vanish into the plate", async () => {
    // A `badge:` plate is quiet — surface + border — and the mark carries the
    // brand colour. Kafka's #231F20 on the dark surface's #212124 is 1.02:1,
    // an invisible badge rather than an obviously wrong one; on white it is
    // fine. The mark yields to ink, never the plate.
    const src = `pack logos\nsystem s "S" {\n bus = sys/stream "Event Bus" { badge: logos/apachekafka }\n}\n`;
    const mark = (svg: string) => {
      const m = /<g color="(#[0-9A-Fa-f]{6})" fill="\1"><use href="#sq-logos-apachekafka"[^>]*width="14"/.exec(svg);
      expect(m, "badge mark").not.toBeNull();
      return m![1];
    };
    const light = await render(src, { theme: "light" });
    const dark = await render(src, { theme: "dark" });
    expect(light.ok && dark.ok).toBe(true);
    expect(mark(light.svg!)).toBe("#231F20");
    expect(mark(dark.svg!)).not.toBe("#231F20");
    expect(mark(dark.svg!)).toBe(themes.dark.ink);
    // the plate is the same quiet surface in both — only the mark moved
    for (const [r, t] of [[light, themes.light], [dark, themes.dark]] as const)
      expect(r.svg).toContain(`width="22" height="22" rx="5" fill="${t.surface}" stroke="${t.border}"/>`);
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
