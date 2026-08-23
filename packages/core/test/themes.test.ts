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
  "hueRed", "hueAmber", "hueGreen", "hueTeal", "hueBlue", "hueViolet", "huePink", "hueGray",
];
const HUE_ROLES = ROLES.filter((r) => String(r).startsWith("hue"));

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

  it("every author hue reads as a 1.5px stroke on its own canvas", () => {
    // 3:1 is the floor for graphical objects (WCAG 1.4.11); the hues are
    // strokes, rings and spines, never text, so AA for text would be the
    // wrong bar and would rule out the lifted dark set.
    for (const [name, t] of Object.entries(themes))
      for (const role of HUE_ROLES)
        expect(ratio(String(t[role]), t.canvas), `${name}.${String(role)} on canvas`).toBeGreaterThanOrEqual(3);
  });

  it("the eight hues stay apart from each other in both themes", () => {
    // Two hues that collapse to near-identical strokes make `color:` lie:
    // a reader sees one group where the author drew two. Perceptual distance
    // is approximated by RGB distance — crude, but it catches a copy-paste.
    const dist = (a: string, b: string) =>
      Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
    for (const [name, t] of Object.entries(themes))
      for (let i = 0; i < HUE_ROLES.length; i++)
        for (let j = i + 1; j < HUE_ROLES.length; j++)
          expect(
            dist(String(t[HUE_ROLES[i]]), String(t[HUE_ROLES[j]])),
            `${name}: ${String(HUE_ROLES[i])} vs ${String(HUE_ROLES[j])}`,
          ).toBeGreaterThan(40);
  });
});
