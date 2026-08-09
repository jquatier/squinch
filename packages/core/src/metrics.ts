// Text measurement from the committed metrics table ONLY (non-negotiable:
// layout never asks the environment how wide text is). Browser-safe.
import { METRICS } from "./metrics.generated.js";

/** Families the metrics table carries. `inter` is the document face; `mono`
 *  is IBM Plex Mono, used only where digits must line up in a chip segment. */
export type FontFamily = "inter" | "mono";
/** Weights the table carries. Not every family has every weight — mono ships
 *  400 alone — and asking for a missing one is a programming error, so the
 *  lookup below throws rather than silently measuring the wrong face. */
export type FontWeight = "400" | "500" | "600";

/** Can the bundled subset actually draw this character? `measure` answers a
 *  different question — it falls back to an average advance so layout never
 *  breaks — and the gap between the two is where a glyph goes missing from a
 *  render without anything failing. Space is drawable by definition. */
export function drawable(ch: string): boolean {
  return ch === " " || ch in METRICS.inter["400"]!.advances;
}

export function measure(
  text: string,
  sizePx: number,
  weight: FontWeight = "500",
  family: FontFamily = "inter",
): number {
  const m = METRICS[family]?.[weight];
  if (!m) throw new Error(`no metrics for ${family} ${weight} — regenerate with gen-metrics`);
  let em = 0;
  for (const ch of text) em += m.advances[ch] ?? m.fallback;
  return em * sizePx;
}

export function fit(
  text: string,
  maxPx: number,
  sizePx: number,
  weight: FontWeight = "500",
  family: FontFamily = "inter",
): string {
  if (measure(text, sizePx, weight, family) <= maxPx) return text;
  let s = text;
  while (s.length > 1 && measure(s + "…", sizePx, weight, family) > maxPx) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}

/** Greedy word-wrap against the committed metrics tables, ellipsizing the last
 *  line. Lived in svg.ts as `wrap()` until edge notes became layout citizens:
 *  the layout must reserve exactly the box the renderer will draw, so the two
 *  have to share one wrapping function or the reservation is for a different
 *  note than the one drawn — the same single-source rule as `pillDims`. */
export function wrapText(
  text: string, maxPx: number, sizePx: number, fam: FontFamily, maxLines: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const attempt = cur ? `${cur} ${w}` : w;
    if (measure(attempt, sizePx, "400", fam) <= maxPx) cur = attempt;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines) lines.push(cur);
  const consumed = lines.join(" ").length;
  if (consumed < text.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = fit(`${last}${text.slice(consumed)}`, maxPx, sizePx, "400", fam);
  }
  return lines;
}
