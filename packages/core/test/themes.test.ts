// Theme tokens are a contract (DESIGN §2/§6), so they get checked rather than
// eyeballed: every theme defines every role, and both shipping themes meet the
// contrast bar their palettes claim.
import { describe, it, expect } from "vitest";
import { themes, type Theme } from "../src/index.js";

const ROLES: (keyof Theme)[] = [
  "canvas", "surface", "border", "ink", "muted", "edge", "asyncEdge",
  "plateText", "accent", "beadText", "warnTint", "surfaceAlt",
  "surfaceHi", "surfaceLo", "shelfLine", "plate", "actorLo",
  "sheetFill", "sheetBorder", "faint", "dim",
  "zoneAccount", "zoneNetwork", "zoneCloud", "zoneNeutral",
];

/** WCAG relative luminance + contrast ratio. */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("themes", () => {
  it("every theme defines every colour role, as hex", () => {
    for (const [name, t] of Object.entries(themes))
      for (const role of ROLES)
        expect(String(t[role]), `${name}.${String(role)}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("states its shadow as rgba — the alpha is the effect", () => {
    // Not in ROLES: it is deliberately not a 6-digit hex. It rides
    // `flood-color`, which the adaptive merge treats as colour; expressed as
    // `flood-opacity` the two themes would differ in a non-colour attribute
    // and the merge would refuse the pair outright.
    for (const [name, t] of Object.entries(themes))
      expect(t.shadow, `${name}.shadow`).toMatch(/^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
  });

  it("ships exactly the designed pair — a palette is never added by swap", () => {
    // The sketch/sketch-dark/contrast themes were retired with the docs/design
    // restyle: its card anatomy has no hand-drawn or pure-black translation,
    // and an unreviewed palette riding along on every geometry change is a
    // cost with no reader. A new theme is a design exercise, not a token dump.
    expect(Object.keys(themes).sort()).toEqual(["dark", "light"]);
  });

  it("the flagship light theme keeps AA for its text", () => {
    const t = themes.light;
    expect(ratio(t.ink, t.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.muted, t.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark is designed, not inverted — its canvas is near-black, not grey", () => {
    expect(lum(themes.dark.canvas)).toBeLessThan(0.02);
    expect(ratio(themes.dark.ink, themes.dark.canvas)).toBeGreaterThanOrEqual(7);
  });
});
