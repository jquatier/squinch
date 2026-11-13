// Where every slot stands along its row (REQUIREMENTS §5.5): balance first.
//
// Each slot has one place it wants, read off its wires, and a weight that
// says who gives way when two wants collide:
//
//   a fan    a slot with two or more wires on its busier side stands over
//            the middle of them — the middle of the span, or the middle one
//            of an odd number. This is the heavy want: nothing lighter
//            moves a box off its balanced place, least of all a wire that
//            would like to be straight.
//   a single a slot with one wire on its busier side takes its place among
//            the others of the fan it belongs to: the boxes one box feeds
//            stand packed and centred under it. A fan of one is a chain,
//            and a chain is a straight line.
//   a chain  one wire in, one out: under whichever end is a fan, so one of
//            eleven wires leaving a hub does not drag its far end; else
//            where it already is nearest.
//   nothing  a slot no forward wire pulls keeps beside its neighbour —
//            no gaps that nothing is holding open. A wire running back
//            against the flow follows its boxes and never leads them.
//
// Rows are solved one at a time, down the sheet and back up, a fixed number
// of times; each solve is exact (`project`). Positions are then rounded to
// the 8-pixel grid, which every gap is a multiple of, so rounding cannot
// break a gap.
import { ceilTo, GRID, snap } from "./frame.js";
import { project, type Gap } from "./project.js";
import type { Link, Sheet, Wall } from "./types.js";

const HEAVY = 100, LIGHT = 1, THIN = 0.1, IDLE = 1e-9, FAR = 1e6;
const SWEEPS = 4;

export interface Placing {
  /** width of each slot along the row, and room past its high side nothing may enter */
  w: number[]; bleed: number[];
  /** clear room wanted between a slot and the next, where a gutter holds more than a gap */
  gutter: Map<number, number>;
  /** where on a slot the wire `key` attaches at wall `wall`, measured from the slot's centre */
  off(slot: number, wall: Wall, key: string): number;
}

export function place(s: Sheet, p: Placing): number[] {
  const n = s.slots.length;
  const ups: Link[][] = Array.from({ length: n }, () => []), downs: Link[][] = Array.from({ length: n }, () => []);
  for (const links of s.chan) for (const l of links) { downs[l.up].push(l); ups[l.down].push(l); }

  /** Least distance between the centres of two neighbours in a row. */
  const sep = (a: number, b: number): number => {
    const A = s.slots[a], B = s.slots[b];
    const gap = A.kind === "box" && B.kind === "box" ? s.gap.lane : A.kind === "box" || B.kind === "box" ? Math.max(16, s.gap.lane / 2) : 16;
    return ceilTo(p.w[a] / 2 + p.bleed[a] + Math.max(gap, p.gutter.get(a) ?? 0) + p.w[b] / 2, GRID);
  };
  /** Least distance between two slots of one row, whatever stands between them. */
  const apart = (a: number, b: number): number => {
    const row = s.rows[s.slots[a].row];
    let d = 0;
    for (let i = s.at[a]; i < s.at[b]; i++) d += sep(row[i], row[i + 1]);
    return d;
  };

  // ── what never changes: the gaps, the walls ────────────────────────────────
  // variable n is the west wall, held at 0; `aligned` boxes are one variable
  const rep = s.slots.map((x) => x.i);
  for (const set of s.cell.group.aligned ?? []) {
    const members = set.map((id) => s.slots.find((x) => x.kid?.id === id)?.i).filter((i): i is number => i !== undefined);
    for (const m of members) rep[m] = rep[members[0]];
  }
  const WALL = n;
  const gaps: Gap[] = [];
  const titled = s.dir === "down" && s.title ? ceilTo(s.title.u + 8, GRID) : 0;
  s.rows.forEach((row, k) => row.forEach((slot, i) => {
    if (i) gaps.push({ left: rep[row[i - 1]], right: rep[slot], gap: sep(row[i - 1], slot) });
    // a wire that has to turn comes in clear of the title; one that runs
    // straight into a box of the first rank may pass the end of it (§5.7)
    const turns = s.slots[slot].kind === "port" ? !downs[slot].some((l) => s.slots[l.down].kind === "box") : k === 1 && s.slots[slot].kind === "lane";
    const low = k <= 1 && titled && turns ? titled : i ? -Infinity : s.slots[slot].kind === "box" ? s.pad.w + p.w[slot] / 2 : Math.max(16, s.pad.w);
    if (low > -Infinity) gaps.push({ left: WALL, right: rep[slot], gap: ceilTo(low, GRID) });
  }));
  // `columns`: each band wholly before the next, in every rank — through a line between them
  const bands = s.cell.group.columns ?? [];
  let lines = 0;
  bands.slice(1).forEach((band, b) => {
    const line = n + 1 + lines++;
    for (const [ids, before] of [[bands[b], true], [band, false]] as const)
      for (const id of ids) {
        const x = s.slots.find((q) => q.kid?.id === id);
        if (!x) continue;
        const half = ceilTo(p.w[x.i] / 2 + (before ? p.bleed[x.i] : 0) + s.gap.lane / 2, GRID);
        gaps.push(before ? { left: rep[x.i], right: line, gap: half } : { left: line, right: rep[x.i], gap: half });
      }
  });
  const vars = n + 1 + lines;
  const crossRow = lines > 0 || rep.some((r, i) => r !== i);

  // ── a first picture: every row packed, and centred on the widest ───────────
  const u = new Array<number>(n).fill(0);
  let widest = 0;
  const span = s.rows.map((row) => {
    row.forEach((slot, i) => { u[slot] = i ? u[row[i - 1]] + sep(row[i - 1], slot) : 0; });
    const len = row.length ? u[row[row.length - 1]] : 0;
    widest = Math.max(widest, len);
    return len;
  });
  s.rows.forEach((row, k) => row.forEach((slot) => { u[slot] += (widest - span[k]) / 2; }));
  const want = [...u], weight = new Array<number>(n).fill(LIGHT);
  const solve = (rows: number[][]) => {
    if (crossRow) {
      // one variable per aligned set: it stands where the wires of all its members together put it
      const W = new Array<number>(vars).fill(0), T = new Array<number>(vars).fill(0);
      for (let i = 0; i < n; i++) { W[rep[i]] += weight[i]; T[rep[i]] += weight[i] * want[i]; }
      for (let i = 0; i < vars; i++) T[i] = W[i] ? T[i] / W[i] : 0;
      W[WALL] = 1e12; T[WALL] = 0;
      for (let i = n + 1; i < vars; i++) { W[i] = IDLE; T[i] = 0; }
      const at = project(T, W, gaps);
      for (let i = 0; i < n; i++) u[i] = at[rep[i]] - at[WALL];
      return;
    }
    for (const row of rows) {
      if (!row.length) continue;
      const local = new Map(row.map((slot, i) => [slot, i]));
      const g = gaps.filter((x) => local.has(x.right) && (x.left === WALL || local.has(x.left)))
        .map((x) => ({ left: x.left === WALL ? row.length : local.get(x.left)!, right: local.get(x.right)!, gap: x.gap }));
      const at = project([...row.map((slot) => want[slot]), 0], [...row.map((slot) => weight[slot]), 1e12], g);
      row.forEach((slot, i) => { u[slot] = at[i] - at[row.length]; });
    }
  };
  solve(s.rows);

  // ── what a slot wants ──────────────────────────────────────────────────────
  const end = (slot: number, wall: Wall, key: string) => u[slot] + p.off(slot, wall, key);
  /** Middle of a fan: of the span — or of an odd number, the middle one. */
  const middle = (xs: number[]): number => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length % 2 ? v[v.length >> 1] : (v[0] + v[v.length - 1]) / 2;
  };
  /** Where `slot` would stand for the link `l` to run straight. */
  const straight = (slot: number, l: Link): number =>
    l.down === slot ? end(l.up, "s", l.key) - p.off(slot, "n", l.key) : end(l.down, "n", l.key) - p.off(slot, "s", l.key);
  /** `slot`'s place among the slots its neighbour along `l` fans out to:
   *  packed side by side in row order, centred on the neighbour. */
  const among = (slot: number, l: Link, forward: (x: Link) => boolean): number => {
    const below = l.down === slot, hub = below ? l.up : l.down;
    const fan = (below ? downs[hub] : ups[hub]).filter(forward);
    if (fan.length < 2 || s.slots[hub].kid?.sheet) return straight(slot, l);
    const far = (x: Link) => (below ? x.down : x.up), wall: Wall = below ? "n" : "s";
    const sorted = [...fan].sort((a, b) => s.at[far(a)] - s.at[far(b)] || p.off(far(a), wall, a.key) - p.off(far(b), wall, b.key));
    const at: number[] = [];
    sorted.forEach((x, i) => { at.push(i ? at[i - 1] + (far(x) === far(sorted[i - 1]) ? 0 : apart(far(sorted[i - 1]), far(x))) : 0); });
    const tip = sorted.map((x, i) => at[i] + p.off(far(x), wall, x.key));
    // an even fan whose ends are an odd number of grid steps apart stands
    // one step wider, so its middle is on the grid too
    if (tip.length % 2 === 0 && ((tip[tip.length - 1] - tip[0]) / GRID) % 2) for (let i = tip.length >> 1; i < tip.length; i++) { tip[i] += GRID; at[i] += GRID; }
    return end(hub, below ? "s" : "n", l.key) + at[sorted.indexOf(l)] - middle(tip);
  };
  const aim = (slot: number): void => {
    const kind = s.slots[slot].kind;
    let up = ups[slot].filter((l) => !l.back), down = downs[slot].filter((l) => !l.back);
    let forward = (l: Link) => !l.back, scale = kind === "box" ? 1 : THIN;
    if (!up.length && !down.length) { up = ups[slot]; down = downs[slot]; forward = () => true; scale *= 0.05; }
    if (!up.length && !down.length) { want[slot] = s.at[slot] ? -FAR : FAR; weight[slot] = IDLE; return; }
    const side = down.length > up.length || (down.length === up.length && down.length > 1) ? down : up.length > down.length ? up : undefined;
    if (side && side.length > 1) { want[slot] = middle(side.map((l) => straight(slot, l))); weight[slot] = HEAVY * side.length * scale; return; }
    weight[slot] = LIGHT * scale;
    if (side) { want[slot] = among(slot, side[0], forward); return; }
    // one in, one out: stay with the end that is a fan, else with the nearer
    const a = among(slot, up[0], forward), b = among(slot, down[0], forward);
    const fanUp = downs[up[0].up].filter(forward).length > 1, fanDown = ups[down[0].down].filter(forward).length > 1;
    want[slot] = fanUp !== fanDown ? (fanUp ? a : b) : Math.abs(a - u[slot]) <= Math.abs(b - u[slot]) ? a : b;
  };

  for (let sweep = 0; sweep < SWEEPS; sweep++)
    for (const rows of [s.rows, [...s.rows].reverse()])
      for (const row of rows) {
        for (const slot of row) aim(slot);
        solve([row]);
      }
  return u.map(snap);
}
