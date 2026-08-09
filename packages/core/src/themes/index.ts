// Theme tokens — the DESIGN.md §2 color-role contract (v1 subset).
// Dark is designed, not inverted (DESIGN §6).
export interface ThemeFont {
  /** CSS font-family stack; first entry is the embedded face's family name. */
  css: string;
  /** which metrics/embedding family backs this theme */
  metrics: "inter";
  /** Multiplies emitted font sizes AND text measurement, so layout stays
   *  truthful. 1 for every shipping theme; the hook survives the sketch theme
   *  it was built for because a future display face may run small again. */
  scale: number;
}

export interface Theme {
  name: string;
  canvas: string;
  surface: string;
  border: string;
  ink: string;
  muted: string;
  edge: string;
  asyncEdge: string;
  plateText: string;
  accent: string; // card accent bar, highlight ring
  warnTint: string; // warning-styled note chips
  surfaceAlt: string; // container-frame recession (DESIGN §5)
  font: ThemeFont;
  /** The dark counterpart this theme can share one adaptive file with. Only
   *  themes with the same font can pair: type metrics drive layout, so a
   *  cross-font pair would draw two different diagrams. */
  pairsWith?: string;
  /** zone boundary tints by kind group (DESIGN §5: kind-tinted, low opacity) */
  zoneAccount: string;
  zoneNetwork: string;
  zoneCloud: string;
  zoneNeutral: string;
}

const inter: ThemeFont = {
  css: "SquinchInter, Inter, system-ui, sans-serif",
  metrics: "inter",
  scale: 1,
};

export const light: Theme = {
  name: "light",
  font: inter,
  pairsWith: "dark",
  zoneAccount: "#B5544C",
  zoneNetwork: "#3A6EA8",
  zoneCloud: "#6B5FC9",
  zoneNeutral: "#7A776E",
  canvas: "#F7F7F5",
  surface: "#FFFFFF",
  border: "#D8D7D3",
  ink: "#1C1C1A",
  muted: "#6F6E69",
  edge: "#8A897F",
  asyncEdge: "#7C74D9",
  plateText: "#FFFFFF",
  accent: "#5A57C9",
  warnTint: "#FBF3DC",
  surfaceAlt: "#EFEFEC",
};

export const dark: Theme = {
  name: "dark",
  font: inter,
  zoneAccount: "#D08078",
  zoneNetwork: "#6E9CD0",
  zoneCloud: "#9C93E8",
  zoneNeutral: "#8F8C82",
  canvas: "#161618",
  surface: "#212124",
  border: "#3B3B40",
  ink: "#EDEDEA",
  muted: "#9C9B94",
  edge: "#8D8C84",
  asyncEdge: "#968EE8",
  plateText: "#FFFFFF",
  accent: "#8B88E8",
  warnTint: "#3A3423",
  surfaceAlt: "#1D1D20",
};

// Light and dark are the shipping pair. The sketch, sketch-dark and contrast
// themes were retired in the docs/design restyle (2026-08): the restyle's card
// anatomy — gradient ramps, contact shadows, the stacked-sheet affordance, the
// segmented chip grammar — is a designed surface with no hand-drawn or
// pure-black translation, and three unreviewed palettes silently riding every
// geometry change is a cost with no reader. Adding a theme back means designing
// it against docs/design, not swapping a palette.
export const themes: Record<string, Theme> = { light, dark };
