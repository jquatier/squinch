// Text measurement from the committed metrics table ONLY (non-negotiable:
// layout never asks the environment how wide text is). Browser-safe.
import { METRICS } from "./metrics.generated.js";

export function measure(text: string, sizePx: number, weight: "400" | "500" = "500"): number {
  const m = METRICS[weight];
  let em = 0;
  for (const ch of text) em += m.advances[ch] ?? m.fallback;
  return em * sizePx;
}

export function fit(
  text: string,
  maxPx: number,
  sizePx: number,
  weight: "400" | "500" = "500",
): string {
  if (measure(text, sizePx, weight) <= maxPx) return text;
  let s = text;
  while (s.length > 1 && measure(s + "…", sizePx, weight) > maxPx) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}
