// Theme tokens — the DESIGN.md §2 color-role contract (v1 subset).
// Dark is designed, not inverted (DESIGN §6).
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
}

export const light: Theme = {
  name: "light",
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

export const themes: Record<string, Theme> = { light, dark };
