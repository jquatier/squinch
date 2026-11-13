// Wires between two neighbours on one rank (REQUIREMENTS §5.3, §5.6).
//
// Such a wire runs straight across the gutter between the two facing walls.
// Each gets its own place on each wall; a leaf's end slides to be level with
// the other end (a table's only within its head), and where both ends are
// fixed — two containers — the wire steps once in the gutter, on a column of
// its own, the gutter being a channel turned on its side. Labels sit on the
// wires, side by side in columns where they would collide.
//
// Everything here is measured from the top of the row and from the first
// box's far wall, so it can be worked out before anything has a position —
// which is what lets placement leave the gutter exactly the room it needs.
import type { Flat, Kid, Sheet } from "./types.js";
import { stack, type Net } from "./tracks.js";

export interface Crossing {
  /** where the wire leaves `a`'s wall and meets `b`'s, from the top of the row */
  va: number; vb: number;
  /** the column it steps on, from `a`'s wall, when the two differ */
  step?: number;
  /** the middle of its label, from `a`'s wall */
  label?: number;
}
export interface Gutters {
  /** flat → how it crosses */
  of: Map<Flat, Crossing>;
  /** slot → clear room it needs before the next slot */
  room: Map<number, number>;
}

const PORT = 16, EDGE = 12;

/** `fixed(kid, wall, key)`: where a container's own wire meets its wall, from its top; `dv`: a box's top within its row. */
export function gutters(s: Sheet, dv: number[], fixed: (kid: Kid, wall: "e" | "w", key: string) => number | undefined): Gutters {
  const of = new Map<Flat, Crossing>(), room = new Map<number, number>();
  const pairs = new Map<string, Flat[]>();
  for (const f of s.flats) if (f.straight) (pairs.get(`${f.a}|${f.b}`) ?? pairs.set(`${f.a}|${f.b}`, []).get(`${f.a}|${f.b}`)!).push(f);

  for (const flats of pairs.values()) {
    const a = s.slots[flats[0].a], b = s.slots[flats[0].b];
    /** The stretch of a leaf's wall a wire may land on. */
    const reach = (slot: typeof a): [number, number] => {
      const k = slot.kid!, lo = dv[slot.i] + 8, hi = dv[slot.i] + Math.min(k.h, k.faceV ?? k.h) - 8;
      return lo <= hi ? [lo, hi] : [dv[slot.i] + k.h / 2, dv[slot.i] + k.h / 2];
    };
    const [ra, rb] = [reach(a), reach(b)];
    const taken = { a: [] as number[], b: [] as number[] };
    /** The free place on a wall nearest `v`, within `[lo, hi]` if there is one. */
    const free = (used: number[], v: number, [lo, hi]: [number, number]): number => {
      const ok = (x: number) => x >= lo && x <= hi && used.every((t) => Math.abs(t - x) >= PORT);
      for (let d = 0; d <= hi - lo + PORT; d += 8) for (const x of [v - d, v + d]) if (ok(x)) return x;
      for (let d = 0; d < 4096; d += 1) for (const x of [v - d, v + d]) if (!used.includes(x) && x >= lo && x <= hi) return x;
      return v;
    };
    const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));

    const ends = flats.map((f) => ({ f, fa: fixed(a.kid!, "e", f.key), fb: fixed(b.kid!, "w", f.key) }));
    // ends a container has fixed come first; a leaf's end then comes level if its wall allows
    for (const e of ends) {
      if (e.fa !== undefined) taken.a.push(dv[a.i] + e.fa);
      if (e.fb !== undefined) taken.b.push(dv[b.i] + e.fb);
    }
    const loose: typeof ends = [];
    for (const e of ends) {
      if (e.fa !== undefined && e.fb !== undefined) of.set(e.f, { va: dv[a.i] + e.fa, vb: dv[b.i] + e.fb });
      else if (e.fa !== undefined) { const va = dv[a.i] + e.fa, vb = free(taken.b, clamp(va, rb), rb); taken.b.push(vb); of.set(e.f, { va, vb }); }
      else if (e.fb !== undefined) { const vb = dv[b.i] + e.fb, va = free(taken.a, clamp(vb, ra), ra); taken.a.push(va); of.set(e.f, { va, vb }); }
      else loose.push(e);
    }
    // two leaves: level, about the middle of what their walls share
    const lo = Math.max(ra[0], rb[0]), hi = Math.min(ra[1], rb[1]);
    const mid = lo <= hi ? Math.round((lo + hi) / 2) : undefined;
    loose.forEach((e, i) => {
      const off = Math.round((i - (loose.length - 1) / 2) * PORT);
      const va = free(taken.a, clamp((mid ?? Math.round((ra[0] + ra[1]) / 2)) + off, ra), ra);
      const vb = free(taken.b, clamp(mid === undefined ? Math.round((rb[0] + rb[1]) / 2) + off : va, rb), rb);
      taken.a.push(va); taken.b.push(vb);
      of.set(e.f, { va, vb });
    });

    // steps, each on its own column; then labels, in columns where they would collide
    const bent: Net[] = flats.flatMap((f) => { const c = of.get(f)!; return c.va === c.vb ? [] : [{ id: f.wire, tops: [c.va], bots: [c.vb], lo: Math.min(c.va, c.vb), hi: Math.max(c.va, c.vb), thick: 0 }]; });
    const cols = stack(bent);
    for (const f of flats) if (cols.track.has(f.wire)) of.get(f)!.step = PORT * (1 + cols.track.get(f.wire)!);
    let width = bent.length ? PORT * (cols.count + 1) : 0;
    const columns: { v: number; h: number }[][] = [], wide: number[] = [];
    for (const f of [...flats].filter((x) => x.label).sort((p, q) => of.get(p)!.vb - of.get(q)!.vb)) {
      const v = of.get(f)!.vb, h = f.label!.v;
      let c = columns.findIndex((col) => col.every((l) => Math.abs(l.v - v) >= (l.h + h) / 2 + 4));
      if (c < 0) { c = columns.length; columns.push([]); wide.push(0); }
      columns[c].push({ v, h });
      wide[c] = Math.max(wide[c], f.label!.u);
    }
    if (columns.length) {
      const start = (bent.length ? width - PORT / 2 : 0) + EDGE;
      const left = wide.map((_, c) => start + wide.slice(0, c).reduce((n, w) => n + w + 8, 0));
      for (const f of flats) if (f.label) {
        const v = of.get(f)!.vb, c = columns.findIndex((col) => col.some((l) => l.v === v && l.h === f.label!.v));
        of.get(f)!.label = left[c] + wide[c] / 2;
      }
      width = left[left.length - 1] + wide[wide.length - 1] + EDGE;
    }
    room.set(a.i, Math.max(room.get(a.i) ?? 0, width));
  }
  return { of, room };
}
