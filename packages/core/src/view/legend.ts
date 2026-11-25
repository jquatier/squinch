// What a view's legend shows (SPEC §5). The author writes the entries; this
// decides which of them the drawing has marks for, and how each swatch is
// drawn. An entry with nothing to point at is left out, without a warning:
// one block is meant to be pasted into every view of a diagram.
//
// It reads the *laid-out* view, not the resolved one: layout can leave an
// edge undrawn (one end inside the other), and an entry must match what the
// reader sees. Theme-free — the renderer picks the colours.
import type { LegendKey, SModel, SView } from "../model/types.js";
import { LEGEND_KEYS } from "../model/types.js";
import type { LegendSwatch, PEdge, PFrame, PLegendEntry, PNode } from "../layout/positioned.js";
import { effectiveTagsOf } from "./resolve.js";

type Arrow = "->" | "~>" | "<->" | "--";
type Drawn = { nodes: PNode[]; edges: PEdge[]; frames: PFrame[] };

/** The arrow an edge is drawn as. A ×n edge is its arrow too, so it matches
 *  both `aggregated` and that arrow's key. */
export const arrowOf = (e: PEdge): Arrow =>
  e.async ? "~>" : e.heads === "both" ? "<->" : e.heads === "none" ? "--" : "->";

const isContext = (n: PNode) => n.kind.startsWith("context");

/** Every key this view has marks for, in vocabulary order and then the
 *  view's coloured tags in the order it colours them — the list the
 *  `legend auto` diagnostic names, and what an entry is matched against. */
export function drawnLegendKeys(model: SModel, view: SView, p: Drawn): LegendKey[] {
  return [...swatches(model, view, p).keys()];
}

/** The written entries this drawing has marks for, each with its swatch. */
export function matchLegend(model: SModel, view: SView, p: Drawn): PLegendEntry[] {
  if (!view.legend || !("entries" in view.legend)) return [];
  const drawn = swatches(model, view, p);
  return view.legend.entries.flatMap((e) => {
    const swatch = drawn.get(e.key);
    return swatch ? [{ key: e.key, label: e.label, swatch }] : [];
  });
}

function swatches(model: SModel, view: SView, p: Drawn): Map<LegendKey, LegendSwatch> {
  const out = new Map<LegendKey, LegendSwatch>();
  for (const key of LEGEND_KEYS) {
    if (key === "aggregated") {
      if (p.edges.some((e) => e.count > 1)) out.set(key, { kind: "aggregated" });
    } else if (key === "external") {
      // anything drawn hatched: leaves, cards and context cards alike
      if (p.nodes.some((n) => n.external)) out.set(key, { kind: "external" });
    } else if (key === "context") {
      if (p.nodes.some(isContext)) out.set(key, { kind: "context" });
    } else {
      const es = p.edges.filter((e) => arrowOf(e) === key);
      if (!es.length) continue;
      // the pattern the reader sees: one style shared by every such edge, or
      // the arrow's own when they differ (a `~>` is dashed unless told)
      const styles = new Set(es.map((e) => e.style));
      const style = styles.size === 1 ? es[0].style : key === "~>" ? "dashed" : undefined;
      out.set(key, { kind: "arrow", arrow: key, ...(style ? { style } : {}) });
    }
  }
  // A tag shows where the lens actually painted it: on a drawn edge, a drawn
  // node (context cards stay muted whatever their tags), or an open frame —
  // and only where its hue won, since an element carrying two coloured tags
  // takes the last one's (resolve.ts warns about that).
  const colors = view.colors ?? [];
  const hueOf = new Map(colors.map((c) => [c.tag, c.hue]));
  const painted = (tags: string[], tag: string) => {
    if (!tags.includes(tag)) return false;
    const hits = colors.filter((c) => tags.includes(c.tag));
    return hits[hits.length - 1].hue === hueOf.get(tag);
  };
  for (const tag of hueOf.keys()) {
    const hit = p.edges.some((e) => painted(e.tags, tag))
      || p.nodes.some((n) => !isContext(n) && painted(n.tags, tag))
      || p.frames.some((f) => painted(effectiveTagsOf(model, f.path), tag));
    if (hit) out.set(`#${tag}`, { kind: "tag", hue: hueOf.get(tag)! });
  }
  return out;
}
