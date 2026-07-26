// Theme tokens are a contract (DESIGN §2/§6), so they get checked rather than
// eyeballed: every theme defines every role, and `contrast` actually meets the
// WCAG bar it claims.
import { describe, it, expect } from "vitest";
import { themes, type Theme } from "../src/index.js";

const ROLES: (keyof Theme)[] = [
  "canvas", "surface", "border", "ink", "muted", "edge", "asyncEdge",
  "plateText", "accent", "warnTint", "surfaceAlt",
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

  it("the contrast theme clears AAA for text and 3:1 for structure", () => {
    const t = themes.contrast;
    // body and label text: AAA is 7:1
    expect(ratio(t.ink, t.canvas)).toBeGreaterThanOrEqual(7);
    expect(ratio(t.muted, t.canvas)).toBeGreaterThanOrEqual(7);
    expect(ratio(t.ink, t.surface)).toBeGreaterThanOrEqual(7);
    expect(ratio(t.ink, t.surfaceAlt)).toBeGreaterThanOrEqual(7);
    expect(ratio(t.ink, t.warnTint)).toBeGreaterThanOrEqual(7);
    expect(ratio(t.plateText, t.accent)).toBeGreaterThanOrEqual(7);
    // structural strokes: non-text UI needs 3:1
    for (const role of ["border", "edge", "asyncEdge", "accent",
                        "zoneAccount", "zoneNetwork", "zoneCloud", "zoneNeutral"] as const)
      expect(ratio(t[role], t.canvas), role).toBeGreaterThanOrEqual(3);
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
