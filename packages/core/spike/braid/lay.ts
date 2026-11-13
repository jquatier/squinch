// One cell, drawn in its own frame: every item's rectangle, every piece's
// polyline, the cell's size, and where each wire crosses each of its walls.
//
// A cell is laid out once, after the cells inside it (their sizes and wall
// ports are needed) and before the cell that holds it. Nothing is handed
// back down: a container's ports are where its inside put them, and the
// cell outside brings its wires to meet them (place.ts pulls on the ports'
// offsets). So the only thing that crosses a wall in either direction is
// `portAt`, and it crosses once.
//
// The steps, each feeding the next and none going back:
//   place     where every item stands along its row            place.ts
//   ports     where each wire meets a plain box's wall         ports.ts
//   tracks    which wires turn in each channel, and where      tracks.ts
//   stack     how deep each channel is, so where each row is   (here)
//   draw      each piece, as points                            (here)

import { sideMode } from "./count.js";
import { LANE, place } from "./place.js";
import { wallIn, type Cell, type End, type Glued, type Item, type Pt, type Side } from "./plan.js";
import { assignPorts, endAt } from "./ports.js";
import { assignTracks, type Run } from "./tracks.js";

const STUB = 16;   // a wire runs this far straight before it turns
const CORNER = 8;  // and meets a wall at least this far from a corner

export function lay(cell: Cell): void {
  const rows = cell.rows, last = rows.length - 1;
  for (const it of cell.boxes.values())
    if (it.inner) {
      const same = it.inner.flip === cell.flip;
      it.w = same ? it.inner.w : it.inner.h;
      it.h = same ? it.inner.h : it.inner.w;
    }

  place(cell);
  // a whole number of grid steps either side of its centre (§5.5)
  cell.w = Math.ceil(cell.w / 16) * 16;
  const ports = assignPorts(cell);
  const at = (end: End, key: string) => endAt(ports, end, key);

  // ── side exits: how each gets to its wall, and the lane a container's steps into ──
  const modes = new Map<Side, "direct" | "over" | "under">();
  const stepX = new Map<Side, number>();
  const stepped = new Map<string, number>();
  for (const s of cell.sides) {
    const mode = sideMode(s);
    modes.set(s, mode);
    s.mode = mode;
    if (mode !== "direct" && s.from.inner) {
      const id = `${s.from.uid}|${s.wall}`, k = (stepped.get(id) ?? 0) + 1;
      stepped.set(id, k);
      stepX.set(s, s.wall === "E" ? s.from.x + s.from.w / 2 + LANE * k : s.from.x - s.from.w / 2 - LANE * k);
    }
  }
  const leaves = (s: Side) => stepX.get(s) ?? at({ item: s.from, wall: modes.get(s) === "under" ? "S" : "N" }, s.key);

  // ── stack: rows and channels, top to bottom ────────────────────────────────
  const bleedBelow = (it: Item) => (cell.flip ? 0 : it.node?.box?.bleed ?? 0);
  const faceDown = (it: Item) => (cell.flip ? undefined : it.node?.box?.face);
  const top: number[] = [], trackY = new Map<number, number>();
  const landing = new Map<number, number>(), landY = new Map<number, number>();
  const height = rows.map((row) => Math.max(0, ...row.items.map((it) => (row.kind === "wall" ? 0 : it.h))));
  let y = 0;
  for (let k = 0; k <= last; k++) {
    const items = rows[k].items;
    top[k] = y;
    // §5.5: top-aligned if the rank holds a container or a table; otherwise centred
    const flush = items.some((it) => it.inner || faceDown(it) !== undefined);
    for (const it of items) it.y = flush && it.kind === "box" ? y : y + Math.floor((height[k] - it.h) / 2);
    y += height[k];
    if (k === last) break;

    // the wires that turn in the channel below this row
    const runs: Run[] = [];
    for (const s of cell.segs[k]) {
      const a = at(s.upper, s.key), b = at(s.lower, s.key);
      if (a !== b) runs.push({ id: s.uid, net: s.key.startsWith("b:") ? s.key : undefined, top: [a], bottom: [b] });
    }
    for (const t of cell.turns) if (t.row === k) runs.push({ id: t.uid, top: [at(t.a, t.key), at(t.b, t.key)], bottom: [], thick: t.label?.h });
    for (const s of cell.sides) {
      const mode = modes.get(s)!;
      if (mode === "under" && s.row === k) runs.push({ id: s.uid, top: [leaves(s)], bottom: [], east: s.wall === "E", west: s.wall === "W" });
      if (mode === "over" && s.row === k + 1) runs.push({ id: s.uid, top: [], bottom: [leaves(s)], east: s.wall === "E", west: s.wall === "W" });
    }
    const { track, count: plain, clashes } = assignTracks(runs, cell.w);
    // Two wires changing places on the very same two lines cannot both turn
    // once: whichever turns first comes down the line the other is still
    // on. The upper one lands a step short instead, and takes its last step
    // below the other's track.
    let count = plain;
    for (const c of clashes) if (!landing.has(c.upper)) landing.set(c.upper, count++);
    // a label riding a track needs the track's width in room: the whole channel is then spaced for it
    const thick = Math.max(0, ...runs.map((r) => r.thick ?? 0)), pitch = thick ? Math.max(LANE, thick + 8) : LANE;
    // the first track clears whatever hangs below the row (and, under the
    // north wall, the title: a wire turning just inside turns below it)
    const hang = Math.max(0, ...items.map((it) => (it.kind === "box" ? it.y + it.h + bleedBelow(it) - y : 0)));
    // (a wire passes straight through a label, so beside a row of labels a
    // track needs no stub's length, only daylight)
    let lead = Math.max(rows[k].kind === "label" ? 8 : STUB, thick ? Math.ceil(thick / 2) + 4 : 0) + hang;
    if (k === 0 && cell.title) lead = Math.max(lead, cell.title.h + 8);
    const tail = Math.max(rows[k + 1].kind === "label" ? 8 : STUB, thick ? Math.ceil(thick / 2) + 4 : 0);
    const need = count ? lead + pitch * (count - 1) + tail : 0;
    const depth = Math.max(baseDepth(cell, k, height), need);
    const slack = Math.floor((depth - need) / 2);
    for (const r of runs) {
      trackY.set(r.id, y + lead + slack + pitch * track.get(r.id)!);
      if (landing.has(r.id)) landY.set(r.id, y + lead + slack + pitch * landing.get(r.id)!);
    }
    y += depth;
  }
  // a transposed cell's `minW` is a least height here: share the extra above and below
  if (y < cell.minH) {
    const extra = Math.floor((cell.minH - y) / 2);
    for (let k = 1; k < last; k++) { top[k] += extra; for (const it of rows[k].items) it.y += extra; }
    for (const [id, ty] of trackY) trackY.set(id, ty + extra);
    for (const [id, ty] of landY) landY.set(id, ty + extra);
    top[last] = y = cell.minH;
  }
  cell.h = y;
  for (const it of rows[last].items) it.y = y;

  // ── where wires meet the east and west walls of boxes ──────────────────────
  const sideY = new Map<string, number>();
  const range = (it: Item): [number, number] => [it.y + CORNER, it.y + Math.min(it.h, faceDown(it) ?? it.h) - CORNER];
  const fixedY = (it: Item, wall: "E" | "W", key: string): number | undefined => {
    const a = it.inner?.portAt.get(`${wallIn(it.inner, cell, wall)}|${key}`);
    return a === undefined ? undefined : it.y + a;
  };
  /** Places on one wall for wires that each would like to stand at a given
   *  level (or, wanting none, about the middle): as near as they can be had,
   *  in that order, a lane apart where the wall has room, inside its corners. */
  const allot = (want: (number | undefined)[], lo: number, hi: number): number[] => {
    const n = want.length, gap = n > 1 ? Math.max(1, Math.min(LANE, Math.floor((hi - lo) / (n - 1)))) : 0;
    const mid = Math.round((lo + hi) / 2), idle = want.filter((w) => w === undefined).length;
    let k = 0;
    const aim = want.map((w) => w ?? mid + (k++ - (idle - 1) / 2) * gap);
    const order = aim.map((_, i) => i).sort((p, q) => aim[p] - aim[q] || p - q);
    const y: number[] = [];
    order.forEach((i, j) => { y[j] = Math.max(Math.round(aim[i]), j ? y[j - 1] + gap : lo); });
    for (let j = n - 1; j >= 0; j--) y[j] = Math.min(y[j], j + 1 < n ? y[j + 1] - gap : hi);
    const out: number[] = [];
    order.forEach((i, j) => { out[i] = y[j]; });
    return out;
  };
  const gutters = new Map<string, Glued[]>();
  for (const g of cell.glues) {
    const id = `${g.a.item.uid}|${g.b.item.uid}`;
    (gutters.get(id) ?? gutters.set(id, []).get(id)!).push(g);
  }
  for (const group of gutters.values()) {
    const a = group[0].a.item, b = group[0].b.item, [alo, ahi] = range(a), [blo, bhi] = range(b);
    const fa = group.map((g) => fixedY(a, "E", g.key)), fb = group.map((g) => fixedY(b, "W", g.key));
    // both ends are ports of containers already drawn: one may still slide
    // along the wall of the box inside to come level with the other
    group.forEach((g, i) => {
      if (fa[i] === undefined || fb[i] === undefined || fa[i] === fb[i]) return;
      if (nudge(b.inner!, wallIn(b.inner!, cell, "W"), g.key, fa[i]! - b.y)) fb[i] = fa[i];
      else if (nudge(a.inner!, wallIn(a.inner!, cell, "E"), g.key, fb[i]! - a.y)) fa[i] = fb[i];
    });
    // §5.4: a wire arrives level with where it left, if the wall allows. The
    // free ends on the left wall aim at fixed ends opposite (or, with none,
    // at the middle of what the two walls share); those on the right wall
    // then aim at where the left ends came to stand.
    const lo = Math.max(alo, blo), hi = Math.min(ahi, bhi), shared = lo <= hi;
    const freeA = group.map((_, i) => i).filter((i) => fa[i] === undefined);
    const ya = [...fa];
    const placedA = allot(freeA.map((i) => fb[i]), shared && freeA.every((i) => fb[i] === undefined) ? lo : alo, shared && freeA.every((i) => fb[i] === undefined) ? hi : ahi);
    freeA.forEach((i, k) => { ya[i] = placedA[k]; });
    const freeB = group.map((_, i) => i).filter((i) => fb[i] === undefined);
    const yb = [...fb];
    const placedB = allot(freeB.map((i) => ya[i]), blo, bhi);
    freeB.forEach((i, k) => { yb[i] = placedB[k]; });
    group.forEach((g, i) => { sideY.set(`${g.uid}|a`, ya[i]!); sideY.set(`${g.uid}|b`, yb[i]!); });
  }
  // a gutter is a channel on its side: wires that change level in it each
  // turn on a track of their own, packed against the far wall so that any
  // labels have the near side to themselves
  const gutterX = new Map<number, number>();
  for (const group of gutters.values()) {
    const stepping = group.filter((g) => sideY.get(`${g.uid}|a`) !== sideY.get(`${g.uid}|b`));
    if (!stepping.length) continue;
    const { track, count } = assignTracks(stepping.map((g) => ({ id: g.uid, top: [sideY.get(`${g.uid}|a`)!], bottom: [sideY.get(`${g.uid}|b`)!] })));
    const a = group[0].a.item, b = group[0].b.item, x0 = a.x + a.w / 2, x1 = b.x - b.w / 2;
    const labelled = group.some((g) => g.label);
    const first = labelled ? x1 - STUB - LANE * (count - 1) : Math.round((x0 + x1 - LANE * (count - 1)) / 2);
    for (const g of stepping) gutterX.set(g.uid, first + LANE * track.get(g.uid)!);
  }
  const directs = cell.sides.filter((s) => modes.get(s) === "direct");
  for (const s of directs) {
    const fixed = fixedY(s.from, s.wall, s.key);
    if (fixed !== undefined) { sideY.set(`${s.uid}`, fixed); continue; }
    const mates = directs.filter((o) => o.from === s.from && o.wall === s.wall && fixedY(o.from, o.wall, o.key) === undefined);
    const [lo, hi] = range(s.from);
    sideY.set(`${s.uid}`, allot(mates.map(() => undefined), lo, hi)[mates.indexOf(s)]);
  }

  // ── draw ───────────────────────────────────────────────────────────────────
  const meets = (end: End): number => {
    const it = end.item;
    if (it.kind === "box") return end.wall === "N" ? it.y : it.y + it.h;
    return end.wall === "N" ? top[it.row] : top[it.row] + height[it.row];
  };
  const jog = (a: Pt, b: Pt, ty: number): Pt[] => (a.x === b.x ? [a, b] : [a, { x: a.x, y: ty }, { x: b.x, y: ty }, b]);
  for (const p of cell.pieces) {
    if (p.kind === "seg") {
      const a = { x: at(p.upper, p.key), y: meets(p.upper) }, b = { x: at(p.lower, p.key), y: meets(p.lower) }, ty = trackY.get(p.uid) ?? 0;
      const land = landY.get(p.uid);
      if (land === undefined) p.pts = jog(a, b, ty);
      else {
        const short = b.x + (a.x < b.x ? -8 : 8);
        p.pts = [a, { x: a.x, y: ty }, { x: short, y: ty }, { x: short, y: land }, { x: b.x, y: land }, b];
      }
    } else if (p.kind === "turn") {
      const ty = trackY.get(p.uid)!, a = { x: at(p.a, p.key), y: meets(p.a) }, b = { x: at(p.b, p.key), y: meets(p.b) };
      p.pts = [a, { x: a.x, y: ty }, { x: b.x, y: ty }, b];
      if (p.label) p.label.at = { x: Math.round((a.x + b.x) / 2), y: ty };
    } else if (p.kind === "side") {
      const mode = modes.get(p)!, wallX = p.wall === "E" ? cell.w : 0, it = p.from;
      const edge = p.wall === "E" ? it.x + it.w / 2 : it.x - it.w / 2;
      if (mode === "direct") {
        const py = sideY.get(`${p.uid}`)!;
        p.pts = [{ x: edge, y: py }, { x: wallX, y: py }];
        cell.portAt.set(`${p.wall}|${p.key}`, py);
      } else {
        const ty = trackY.get(p.uid)!, x = leaves(p);
        const py = fixedY(it, p.wall, p.key);
        // a container lets the wire out of its side: it steps into the gutter and turns there
        p.pts = it.inner
          ? [{ x: edge, y: py ?? it.y + Math.round(it.h / 2) }, { x, y: py ?? it.y + Math.round(it.h / 2) }, { x, y: ty }, { x: wallX, y: ty }]
          : [{ x, y: mode === "under" ? it.y + it.h : it.y }, { x, y: ty }, { x: wallX, y: ty }];
        cell.portAt.set(`${p.wall}|${p.key}`, ty);
      }
    } else {
      const a = p.a.item, b = p.b.item, ya = sideY.get(`${p.uid}|a`)!, yb = sideY.get(`${p.uid}|b`)!;
      const x0 = a.x + a.w / 2, x1 = b.x - b.w / 2;
      // §5.6: labels across one gutter stand in columns, each on its own wire
      const mates = gutters.get(`${a.uid}|${b.uid}`)!.filter((g) => g.label);
      let lx = x0 + 12;
      for (const g of mates) { if (g === p) break; lx += g.label!.w + 8; }
      const turnAt = gutterX.get(p.uid) ?? Math.round((x0 + x1) / 2);
      p.pts = ya === yb ? [{ x: x0, y: ya }, { x: x1, y: yb }] : [{ x: x0, y: ya }, { x: turnAt, y: ya }, { x: turnAt, y: yb }, { x: x1, y: yb }];
      if (p.label) p.label.at = { x: Math.round(lx + p.label.w / 2), y: ya };
    }
  }

  for (const it of rows[0].items) cell.portAt.set(`N|${it.key}`, it.x);
  for (const it of rows[last].items) cell.portAt.set(`S|${it.key}`, it.x);
}

/** How deep a channel is before any wire needs room in it: the stated gap
 *  between two ranks, the stated padding at a wall. A row of labels stands
 *  in the middle of its gap, which is only deeper than stated if the label
 *  and the tracks either side of it do not fit (§5.6). */
function baseDepth(cell: Cell, k: number, height: readonly number[]): number {
  const a = cell.rows[k].kind, b = cell.rows[k + 1].kind;
  if (a === "wall" && b === "wall") return cell.pad.top + cell.pad.bottom;
  if (a === "wall") return cell.pad.top;
  if (b === "wall") return cell.pad.bottom;
  if (b === "label") return Math.max(8, Math.floor((cell.gap.rank - height[k + 1]) / 2));
  if (a === "label") return Math.max(8, Math.ceil((cell.gap.rank - height[k]) / 2));
  return cell.gap.rank;
}

/** Slide a wire's port along a side wall of a cell already drawn, to stand
 *  at `to`: possible when the wire runs straight out from a box that has
 *  that wall to itself (or from a container inside, which is asked in turn).
 *  This is §5.4's "a port slides along its wall to meet a wire that could
 *  then run straight", for a port the cell outside finds it needs moved —
 *  the one thing passed back down, and only ever a straight stub's level. */
export function nudge(cell: Cell, wall: string, key: string, to: number): boolean {
  if (wall !== "E" && wall !== "W") return false;
  const p = cell.sides.find((s) => s.key === key && s.wall === wall);
  if (!p || p.mode !== "direct" || cell.sides.filter((s) => s.from === p.from && s.wall === wall).length > 1) return false;
  const it = p.from;
  if (it.inner) {
    if (!it.inner.portAt.has(`${wallIn(it.inner, cell, wall)}|${key}`) || !nudge(it.inner, wallIn(it.inner, cell, wall), key, to - it.y)) return false;
  } else {
    const face = cell.flip ? undefined : it.node?.box?.face;
    if (to < it.y + CORNER || to > it.y + Math.min(it.h, face ?? it.h) - CORNER) return false;
  }
  for (const q of p.pts) q.y = to;
  cell.portAt.set(`${wall}|${key}`, to);
  return true;
}
