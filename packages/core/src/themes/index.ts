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
  accent: string; // card accent bar, highlight ring, flow beads
  /** Ink inside a flow bead — dark on the light-on-dark bead, white on the
   *  saturated light one, so the number reads at 10px either way. */
  beadText: string;
  /** Warning-note plate. On its way out: docs/design retires the amber fill
   *  (the only third hue in a two-hue palette, and it read as a sticky note),
   *  and the distinction moves to a glyph. It stays until that glyph exists —
   *  dropping it first would silently erase an authored `style: warning`. */
  warnTint: string;
  surfaceAlt: string; // container-frame recession (DESIGN §5)
  /** The card gradient's two stops, top to bottom: a 4% ramp that reads as a
   *  lit surface rather than a flat fill (docs/design). `surfaceLo` is also
   *  the shelf, so the strip along a card's bottom continues the same surface
   *  instead of reading as a separate block. */
  surfaceHi: string;
  surfaceLo: string;
  /** Hairline between a card's body and its shelf — lighter than `border`,
   *  because it divides one surface rather than bounding two. */
  shelfLine: string;
  /** The neutral chip an icon sits on: card plates, glyph chips, shelf chips.
   *  Doubles as the actor tile's upper tone — an actor is a filled shape, and
   *  this is the quietest fill that still separates from canvas. */
  plate: string;
  /** The actor tile's lower gradient stop, a step under `plate`. */
  actorLo: string;
  /** The plate under a vendor mark. A trademark's contrast was designed
   *  against white and is not ours to re-balance, so when the theme's own tile
   *  cannot carry a dark mark this one does — which is a dark-theme problem
   *  only. In light it *is* `plate`: a white tile there would vanish into the
   *  card's white top, which is exactly what it did when this was one value. */
  brandPlate: string;
  /** The stacked sheets behind a container — "there is more inside". Quieter
   *  than the card's own border and fill: a hint, not a stack of real cards. */
  sheetFill: string;
  sheetBorder: string;
  /** The 1px contact shadow under cards, leaves, actors and notes. rgba, not
   *  hex: the alpha is the whole effect, and it must ride `flood-color` for
   *  the adaptive merge to treat it as colour rather than geometry. */
  shadow: string;
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
  border: "#EAE9E5",
  ink: "#1C1C1A",
  muted: "#6F6E69",
  edge: "#57564F",
  // one purple, not two: the design exploration shipped #7C74D9 for async
  // beside #5A57C9 for flow beads and flagged them as indistinguishable
  asyncEdge: "#5A57C9",
  plateText: "#FFFFFF",
  accent: "#5A57C9",
  beadText: "#FFFFFF",
  warnTint: "#FBF3DC",
  surfaceAlt: "#EFEFEC",
  surfaceHi: "#FFFFFF",
  surfaceLo: "#F2F1ED",
  shelfLine: "#EFEFEC",
  plate: "#EFEFEC",
  actorLo: "#E4E3DE",
  brandPlate: "#EFEFEC",
  sheetFill: "#F2F1ED",
  sheetBorder: "#DEDDD6",
  shadow: "rgba(28,28,26,0.06)",
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
  asyncEdge: "#8B88E8",
  plateText: "#FFFFFF",
  accent: "#8B88E8",
  // the dark bead is a light lavender disc, so its number is ink, not white
  beadText: "#1B1B2E",
  warnTint: "#3A3423",
  surfaceAlt: "#1D1D20",
  surfaceHi: "#26262A",
  surfaceLo: "#1D1D20",
  shelfLine: "#2E2E33",
  plate: "#2F2F34",
  actorLo: "#26262A",
  brandPlate: "#FFFFFF",
  sheetFill: "#1D1D20",
  sheetBorder: "#33333A",
  shadow: "rgba(0,0,0,0.5)",
};

// Light and dark are the shipping pair. The sketch, sketch-dark and contrast
// themes were retired in the docs/design restyle (2026-08): the restyle's card
// anatomy — gradient ramps, contact shadows, the stacked-sheet affordance, the
// segmented chip grammar — is a designed surface with no hand-drawn or
// pure-black translation, and three unreviewed palettes silently riding every
// geometry change is a cost with no reader. Adding a theme back means designing
// it against docs/design, not swapping a palette.
export const themes: Record<string, Theme> = { light, dark };
