// Gutters: the gap between two neighbours on one rank, when a wire joins
// them. It is a channel turned on its side — the same track assignment, with
// flow positions where a channel has lane positions.

import { assignTracks, type Run } from "./channel.js";
import type { Sheet } from "./sheet.js";
import { CORNER, STUB, TRACK, type BesideLink, type Slot } from "./types.js";

export interface Gutter {
  left: Slot; right: Slot;
  /** Each wire's flow position on the left wall and on the right, from the
   *  top of the rank. Equal when it runs straight across. */
  runs: { link: BesideLink; fa: number; fb: number }[];
  tracks: Map<string, number>;
  count: number;
  /** The least the gutter may be, lane-wise. */
  width: number;
}

/** Keyed by the left box of each pair. */
export function buildGutters(sh: Sheet): Map<Slot, Gutter> {
  const { ax, g } = sh;
  const index = new Map(sh.layers.flatMap((l) => l.slots.map((s, i) => [s, i] as const)));
  const pairs = new Map<string, BesideLink[]>();
  for (const l of sh.links) {
    if (l.type !== "beside") continue;
    const [x, y] = index.get(sh.slotOf(l.a))! < index.get(sh.slotOf(l.b))! ? [l.a, l.b] : [l.b, l.a];
    const k = `${x}|${y}`;
    (pairs.get(k) ?? pairs.set(k, []).get(k)!).push(l);
  }
  const out = new Map<Slot, Gutter>();
  for (const [k, list] of pairs) {
    const [x, y] = k.split("|");
    const left = sh.slotOf(x), right = sh.slotOf(y);
    // the stretch of flow both walls share; plain boxes split it evenly
    const lo = Math.max(sh.inset(left), sh.inset(right));
    const hi = Math.min(sh.inset(left) + ax.sideFace(left.box!), sh.inset(right) + ax.sideFace(right.box!));
    const clamp = (v: number, s: Slot) => Math.min(Math.max(v, sh.inset(s) + CORNER), sh.inset(s) + ax.sideFace(s.box!) - CORNER);
    const runs = list.map((link, i) => {
      const shared = lo + Math.round(((hi - lo) * (i + 1)) / (list.length + 1));
      const pl = sh.childPort(left.box!, link.wire), pr = sh.childPort(right.box!, link.wire);
      const fl = pl ? sh.inset(left) + ax.flowOf(pl) : undefined;
      const fr = pr ? sh.inset(right) + ax.flowOf(pr) : undefined;
      // a container's port is where its inside put it; a plain box meets it if it can
      const fa = fl ?? (fr !== undefined ? clamp(fr, left) : shared);
      const fb = fr ?? (fl !== undefined ? clamp(fl, right) : shared);
      return { link, fa, fb };
    });
    const bent: Run[] = runs.filter((r) => r.fa !== r.fb).map((r) => ({ id: r.link.wire.id, a: { at: "lo", pos: r.fa }, b: { at: "hi", pos: r.fb } }));
    const tracks = assignTracks(bent);
    const count = Math.max(0, ...[...tracks.values()].map((t) => t + 1));
    const widest = Math.max(0, ...runs.filter((r) => r.link.wire.label).map((r) => ax.labelL(r.link.wire)));
    const width = Math.max(g.gap.lane, widest ? widest + 2 * STUB : 0, count ? 2 * STUB + (count - 1) * TRACK : 0);
    out.set(left, { left, right, runs, tracks, count, width });
  }
  return out;
}
