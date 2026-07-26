// Theme tokens — the DESIGN.md §2 color-role contract (v1 subset).
// Dark is designed, not inverted (DESIGN §6).
export interface ThemeFont {
  /** CSS font-family stack; first entry is the embedded face's family name. */
  css: string;
  /** which metrics/embedding family backs this theme */
  metrics: "inter" | "caveat";
  /** Caveat runs small at a given px — sketch scales type up so it reads at
   *  the same optical size. Applied to font sizes AND text measurement, so
   *  layout stays truthful. */
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
  /** present = hand-drawn strokes via the seeded rough generator (DESIGN §6) */
  sketch?: { roughness: number; bowing: number };
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
const caveat: ThemeFont = {
  css: "SquinchCaveat, Caveat, cursive",
  metrics: "caveat",
  scale: 1.3,
};

export const light: Theme = {
  name: "light",
  font: inter,
  zoneAccount: "#B5544C",
  zoneNetwork: "#3A6EA8",
  zoneCloud: "#242F3E",
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
  zoneCloud: "#A9B4C4",
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

// Sketch: warm paper, ink-forward strokes, hand-lettered type. Not a palette
// swap of light — surfaces warm up, borders darken toward pen ink (DESIGN §6).
export const sketch: Theme = {
  name: "sketch",
  font: caveat,
  sketch: { roughness: 1.1, bowing: 1 },
  zoneAccount: "#A34E44",
  zoneNetwork: "#2F6396",
  zoneCloud: "#2A3442",
  zoneNeutral: "#6E675A",
  canvas: "#FAF6EE",
  surface: "#FFFDF7",
  border: "#4A453C",
  ink: "#26221C",
  muted: "#6E675A",
  edge: "#57503F",
  asyncEdge: "#6357C9",
  plateText: "#FFFFFF",
  accent: "#5A57C9",
  warnTint: "#FBF0D2",
  surfaceAlt: "#F3EDDF",
};

// Sketch-dark: chalk on slate — light strokes, deep board, same hand.
export const sketchDark: Theme = {
  name: "sketch-dark",
  font: caveat,
  sketch: { roughness: 1.1, bowing: 1 },
  zoneAccount: "#D89890",
  zoneNetwork: "#88AEDC",
  zoneCloud: "#B9C2CE",
  zoneNeutral: "#A39E8F",
  canvas: "#1E2022",
  surface: "#26292C",
  border: "#C9C4B4",
  ink: "#EFEBDD",
  muted: "#A39E8F",
  edge: "#B5B0A0",
  asyncEdge: "#A79FEF",
  plateText: "#FFFFFF",
  accent: "#8B88E8",
  warnTint: "#3A3423",
  surfaceAlt: "#22252A",
};

export const themes: Record<string, Theme> = {
  light, dark, sketch, "sketch-dark": sketchDark,
};
