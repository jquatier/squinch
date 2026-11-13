// Gutters: the gap between two neighbours on one rank, when a wire joins
// them. It is a channel turned on its side — the same track assignment, with
// flow positions where a channel has lane positions.

import { assignTracks, type Run } from "./channel.js";
import type { Sheet } from "./sheet.js";
import { CORNER, LABEL_PAD, STUB, TRACK, type BesideLink, type Slot } from "./types.js";

export interface Gutter {
  left: Slot; right: Slot;
  /** Each wire's flow position on the left wall and on the right, from the
   *  top of the rank. Equal when it runs straight across. */
  runs: { link: BesideLink; fa: number; fb: number }[];
  /** The least the gutter may be, lane-wise. */
  width: number;
  /** Where things sit once the gutter's real extent is known: the lane a
   *  bent wire turns on, and the lane its label is centred on. */
  lanes(lo: number, hi: number): { turn(wire: string): number; label(wire: string): { lane: number; onLeft: boolean } };
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

    // Labels stand on their own wire's stub: before the turns, at the height
    // the wire leaves the left box, or after them, at the height it reaches
    // the right one. Each takes the first place where no label is already
    // at that height — a further column only when both sides are taken.
    const labelled = runs.filter((r) => r.link.wire.label);
    const wide = Math.max(0, ...labelled.map((r) => ax.labelL(r.link.wire)));
    const tall = Math.max(0, ...labelled.map((r) => ax.labelF(r.link.wire))) + 4;
    const spot = new Map<string, { onLeft: boolean; col: number; f: number }>();
    for (const r of labelled)
      for (let col = 0; !spot.has(r.link.wire.id); col++)
        for (const onLeft of [true, false]) {
          const f = onLeft ? r.fa : r.fb;
          if ([...spot.values()].some((o) => o.onLeft === onLeft && o.col === col && Math.abs(o.f - f) < tall)) continue;
          spot.set(r.link.wire.id, { onLeft, col, f });
          break;
        }
    const cols = (onLeft: boolean) => Math.max(0, ...[...spot.values()].filter((o) => o.onLeft === onLeft).map((o) => o.col + 1));
    const band = (n: number) => (n ? n * (wide + LABEL_PAD) - LABEL_PAD : 0); // n label columns, side by side
    const turns = count ? (count - 1) * TRACK : 0;
    const joint = (n: number) => (n && count ? STUB : 0);                     // between labels and the turns
    const needed = STUB + band(cols(true)) + joint(cols(true)) + turns + joint(cols(false)) + band(cols(false)) + STUB;
    const width = Math.max(g.gap.lane, needed);
    out.set(left, {
      left, right, runs, width,
      lanes: (lo, hi) => {
        const start = lo + Math.round((hi - lo - needed) / 2) + STUB; // the arrangement, centred in whatever room there is
        const firstTurn = start + band(cols(true)) + joint(cols(true));
        return {
          turn: (wire) => firstTurn + (tracks.get(wire) ?? 0) * TRACK,
          label: (wire) => {
            const at = spot.get(wire)!;
            const from = at.onLeft ? start : firstTurn + turns + joint(cols(false));
            // columns count outward from the turns on the right, toward them on the left
            const col = at.onLeft ? cols(true) - 1 - at.col : at.col;
            return { lane: from + col * (wide + LABEL_PAD) + Math.round(wide / 2), onLeft: at.onLeft };
          },
        };
      },
    });
  }
  return out;
}
