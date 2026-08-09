// The logo pack: single-colour marks plated in their brand colour, so a
// wordless logo still reads on a light or dark canvas.
import { describe, it, expect } from "vitest";
import { render, iconIds, iconMeta, iconExists, searchIcons } from "../src/index.js";
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

  it("renders marks on a brand-coloured plate, not raw artwork", async () => {
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
    // plate in the brand colour, mark knocked out in plate-text
    expect(r.svg).toContain(`fill="#4169E1"`);
    expect(r.svg).toContain(`href="#sq-logos-postgresql"`);
    // `fill` must be set, not just `color`: vendored marks carry no fill of
    // their own and default to black — GitHub's near-black plate made that
    // an invisible icon rather than an obviously wrong one
    expect(r.svg).toContain(`<g color="#FFFFFF" fill="#FFFFFF">`);
  });

  it("a mark on a dark brand plate is not the same colour as the plate", async () => {
    const r = await render(`pack logos
system s "S" {
 gh = logos/github "GitHub"
}
`, { theme: "light" });
    const plate = /<rect x="\d+" y="\d+" width="40" height="40" rx="4" fill="(#[0-9A-Fa-f]{6})"/.exec(r.svg!)![1];
    const tint = /<g color="(#[0-9A-Fa-f]{6})" fill="#[0-9A-Fa-f]{6}"><use href="#sq-logos-github"/.exec(r.svg!)![1];
    expect(plate.toLowerCase()).toBe("#181717");
    expect(tint.toLowerCase()).not.toBe(plate.toLowerCase());
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
