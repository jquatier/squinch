// One sheet laid out, once its children are: sizes in, rectangles and
// polylines out, all in the sheet's own frame.
//
// Each step is a function of the ones before it, and nothing is revisited:
//
//   rows      how tall each rank is, and where each box sits in it
//   gutters   wires between row-mates, and the room they need      (gutter.ts)
//   place     every slot along its row                             (place.ts)
//   ports     where wires meet the walls of leaves                 (ports.ts)
//   fit       the sheet's width: walls round what was placed
//   channels  between each two rows: what turns there, on which track,
//             the labels, and so how deep the channel is           (tracks.ts)
//   draw      the polyline of every wire's piece in this sheet
import { ceilTo, floorTo, GRID, snap, turn } from "./frame.js";
import { gutters } from "./gutter.js";
import { place } from "./place.js";
import { meetAcross, wallspace, type End, type Wallspace } from "./ports.js";
import { sideWay } from "./sheet.js";
import { pitch, stack, type Net, type Stack } from "./tracks.js";
import type { Flat, Geo, Kid, Link, Sheet, Side, Wall } from "./types.js";

type Pt = { x: number; y: number };
const STUB = 16;

/** Where a container child's own wire meets one of its walls, along that wall. */
const fixedPort = (s: Sheet, kid: Kid, wall: Wall, key: string): number | undefined =>
  kid.sheet?.geo?.ports.get(`${turn(wall, s.dir, kid.sheet.dir)}|${key}`);

/** A label standing on a stub, waiting for its band. */
interface Tag { wire: string; u: number; w: number; h: number; row?: number }
/** What one channel holds, top to bottom: labels on the stubs out of the row
 *  above, the tracks, labels on the stubs into the row below. */
interface Channel { nets: Net[]; stack: Stack; at: number[]; top: Tag[]; bottom: Tag[]; netOf: Map<Link, string>; v0: number; depth: number; trackV: number[]; topV: number[]; bottomV: number[] }

export function lay(s: Sheet, root: boolean): Geo {
  const n = s.slots.length, R = s.R;
  for (const kid of s.kids) {
    const g = kid.sheet?.geo;
    if (g) { kid.w = kid.sheet!.dir === s.dir ? g.W : g.H; kid.h = kid.sheet!.dir === s.dir ? g.H : g.W; }
  }
  const w = s.slots.map((x) => (x.kid ? x.kid.w : x.label ? x.label.u + 8 : 0));

  // ── rows ───────────────────────────────────────────────────────────────────
  // Boxes of a rank are centred on it — but stand on one top line where the
  // rank holds a container or a table, or the sheet flows rightward (§5.5).
  const rowH = s.rows.map((row) => Math.max(0, ...row.map((i) => s.slots[i].kid?.h ?? (s.slots[i].label ? s.slots[i].label!.v + 16 : 0))));
  const dv = new Array<number>(n).fill(0);
  s.rows.forEach((row, k) => {
    const level = s.dir === "right" || row.some((i) => s.slots[i].kid?.sheet || s.slots[i].kid?.faceV);
    if (!level) for (const i of row) if (s.slots[i].kid) dv[i] = Math.floor((rowH[k] - s.slots[i].kid!.h) / 2);
  });

  // Two neighbouring containers whose facing ports are a few pixels out of
  // level: the higher steps down that much, rather than the wire jogging in
  // the gutter by less than a corner's width.
  for (const f of s.flats) {
    const a = s.slots[f.a].kid!, b = s.slots[f.b].kid!, va = fixedPort(s, a, "e", f.key), vb = fixedPort(s, b, "w", f.key);
    if (!f.straight || va === undefined || vb === undefined) continue;
    const d = dv[f.a] + va - (dv[f.b] + vb);
    if (d && Math.abs(d) < STUB) dv[d > 0 ? f.b : f.a] += Math.abs(d);
  }
  s.rows.forEach((row, k) => { rowH[k] = Math.max(rowH[k], ...row.map((i) => (s.slots[i].kid ? dv[i] + s.slots[i].kid!.h : 0))); });
  const gut = gutters(s, dv, (kid, wall, key) => fixedPort(s, kid, wall, key));
  const off = (slot: number, wall: Wall, key: string): number => {
    const kid = s.slots[slot].kid;
    if (!kid) return 0;
    const fixed = fixedPort(s, kid, wall, key);
    return fixed !== undefined ? fixed - kid.w / 2 : kid.faceU ? kid.faceU / 2 - kid.w / 2 : 0;
  };
  const u = place(s, { w, bleed: s.slots.map((x) => x.kid?.bleedU ?? 0), gutter: gut.room, off });

  // ── ports ──────────────────────────────────────────────────────────────────
  const how = new Map<Side, "straight" | "over" | "under">(s.sides.map((x) => [x, sideWay(s, x)]));
  const port = new Map<string, number>(); // `slot|wall|key` → u, for leaves
  const isLeaf = (slot: number) => !!s.slots[slot].kid && !s.slots[slot].kid!.sheet;
  /** Where the wire `key` meets `slot` at `wall`: a lane is a point, a container says, a leaf was asked. */
  const endU = (slot: number, wall: "n" | "s", key: string): number => {
    const kid = s.slots[slot].kid;
    if (!kid) return u[slot];
    const fixed = fixedPort(s, kid, wall, key);
    return fixed !== undefined ? u[slot] - kid.w / 2 + fixed : port.get(`${slot}|${wall}|${key}`) ?? u[slot];
  };
  const space = new Map<number, Wallspace>();
  const spaceOf = (slot: number) => space.get(slot) ?? space.set(slot, wallspace(s, slot, u[slot], w[slot])).get(slot)!;
  for (let k = 0; k <= R; k++) {
    const walls = new Map<string, { ends: End[]; space: Wallspace }>();
    const add = (slot: number, wall: "n" | "s", key: string, far: number): End | undefined => {
      if (!isLeaf(slot)) return undefined;
      const wk = `${slot}|${wall}`, id = `${wk}|${key}`;
      const set = walls.get(wk) ?? walls.set(wk, { ends: [], space: spaceOf(slot) }).get(wk)!;
      const had = set.ends.find((e) => e.id === id);
      if (had) return had;
      const e: End = { id, slot, wall, far, at: 0 };
      set.ends.push(e);
      return e;
    };
    for (const l of s.chan[k]) {
      const a = add(l.up, "s", l.key, isLeaf(l.down) ? u[l.down] : endU(l.down, "n", l.key));
      const b = add(l.down, "n", l.key, isLeaf(l.up) ? u[l.up] : endU(l.up, "s", l.key));
      if (a && b) { a.mate ??= b; b.mate ??= a; }
      // a lane or a container's port is a point: the leaf's port goes to it, if its wall reaches
      else if (a && a.far >= spaceOf(l.up).lo && a.far <= spaceOf(l.up).hi) a.meet ??= a.far;
      else if (b && b.far >= spaceOf(l.down).lo && b.far <= spaceOf(l.down).hi) b.meet ??= b.far;
    }
    // wires that go along the row instead: a port at the end of the wall they head for,
    // the longer run nearer the middle so that none crosses another's stub
    const EDGE = 1e7;
    for (const f of s.flats) if (!f.straight && s.slots[f.a].row === k) {
      const span = u[f.b] - u[f.a];
      add(f.a, "s", f.key, EDGE - span);
      add(f.b, "s", f.key, -EDGE + span);
    }
    for (const side of s.sides) {
      const way = how.get(side)!, row = s.slots[side.x].row;
      if ((way === "over" && row === k + 1) || (way === "under" && row === k)) add(side.x, way === "over" ? "n" : "s", side.key, side.wall === "e" ? EDGE : -EDGE);
    }
    meetAcross(walls);
    for (const wall of walls.values()) for (const e of wall.ends) port.set(e.id, e.at);
    // Nothing almost-right (§4.3): a link whose ends are less than 16 px
    // apart would turn twice within a corner's width. A leaf's port comes
    // level with the other end if its wall has the place free — or, if not,
    // steps away until the jog is a full one.
    const move = (slot: number, wall: "n" | "s", key: string, to: number): boolean => {
      if (!isLeaf(slot)) return false;
      const id = `${slot}|${wall}|${key}`, sp = spaceOf(slot);
      const now = port.get(id)!;
      // never past a neighbour, never within 8 px of one
      if (to < sp.lo || to > sp.hi || walls.get(`${slot}|${wall}`)!.ends.some((e) => e.id !== id && (Math.abs(port.get(e.id)! - to) < 8 || port.get(e.id)! > now !== port.get(e.id)! > to))) return false;
      port.set(id, to);
      return true;
    };
    // …and a lane or wall port that nothing above has fixed yet may step the same way, where its neighbours leave room
    const shift = (slot: number, to: number): boolean => {
      const x = s.slots[slot];
      if (x.kind === "box" || (x.kind === "lane" && x.row !== k + 1)) return false;
      const row = s.rows[x.row], i = s.at[slot];
      const clear = [row[i - 1], row[i + 1]].every((o, side) => o === undefined || (side ? u[o] - to : to - u[o]) >= w[o] / 2 + (side ? 0 : s.slots[o].kid?.bleedU ?? 0) + w[slot] / 2 + STUB);
      if (!clear || (x.kind === "port" && to < (i ? -Infinity : STUB))) return false;
      u[slot] = to;
      return true;
    };
    for (const l of s.chan[k]) {
      const a = endU(l.up, "s", l.key), b = endU(l.down, "n", l.key), away = b > a ? STUB : -STUB;
      if (a === b || Math.abs(a - b) >= STUB) continue;
      if (move(l.down, "n", l.key, a) || move(l.up, "s", l.key, b) || shift(l.down, a) || shift(l.up, b)) continue;
      if (!(move(l.down, "n", l.key, a + away) || move(l.up, "s", l.key, b - away) || shift(l.down, a + away))) shift(l.up, b - away);
    }
  }

  // ── fit ────────────────────────────────────────────────────────────────────
  // The west wall stands at 0 and placement kept everything clear of it; the
  // east wall goes round what was placed, labels included. A container is a
  // whole number of grid steps either side of its centre (§5.5), so its
  // inside is on its parent's grid.
  const tags = s.chan.map((links) => links.flatMap((l): (Tag & { at: "top" | "bottom" })[] =>
    l.label ? [{ wire: l.label.wire, u: l.label.at === "top" ? endU(l.up, "s", l.key) : endU(l.down, "n", l.key), w: l.label.u, h: l.label.v, at: l.label.at }] : []));
  const boxes = s.slots.filter((x) => x.kind === "box");
  let east = Math.max(0, ...boxes.map((x) => u[x.i] + w[x.i] / 2 + x.kid!.bleedU + s.pad.e), ...s.slots.filter((x) => x.kind !== "box").map((x) => u[x.i] + w[x.i] / 2 + STUB));
  let west = 0;
  const reach = (mid: number, width: number) => { east = Math.max(east, mid + width / 2 + 8); west = Math.min(west, mid - width / 2 - 8); };
  for (const list of tags) for (const t of list) reach(t.u, t.w);
  for (const f of s.flats) if (!f.straight && f.label) reach((endU(f.a, "s", f.key) + endU(f.b, "s", f.key)) / 2, f.label.u);
  let dx = ceilTo(-west, GRID);
  const need = Math.max(east + dx, s.dir === "down" ? s.minW : 0);
  const W = root ? ceilTo(need, GRID) : ceilTo(need, 2 * GRID);
  dx += floorTo((W - (east + dx)) / 2, GRID);
  if (dx) {
    for (let i = 0; i < n; i++) u[i] += dx;
    for (const [id, at] of port) port.set(id, at + dx);
    for (const list of tags) for (const t of list) t.u += dx;
    space.clear();
  }

  // ── channels ───────────────────────────────────────────────────────────────
  const channels: Channel[] = [];
  const twice = new Map<string, number>(); // `channel|net` → the line a twice-stepping wire crosses on
  const netId = (k: number, l: Link, i: number) => l.net ?? `${k}:${i}`;
  for (let k = 0; k <= R; k++) {
    const build = (): { nets: Net[]; netOf: Map<Link, string> } => {
      const byId = new Map<string, Net>(), netOf = new Map<Link, string>();
      s.chan[k].forEach((l, i) => {
        const id = netId(k, l, i), tu = endU(l.up, "s", l.key), bu = endU(l.down, "n", l.key);
        const net = byId.get(id) ?? byId.set(id, { id, tops: [], bots: [], lo: Infinity, hi: -Infinity, thick: 0 }).get(id)!;
        if (!net.tops.includes(tu)) net.tops.push(tu);
        if (!net.bots.includes(bu)) net.bots.push(bu);
        net.lo = Math.min(net.lo, tu, bu); net.hi = Math.max(net.hi, tu, bu);
        netOf.set(l, id);
      });
      const nets = [...byId.values()].filter((x) => x.lo < x.hi).flatMap((x): Net[] => {
        // a straight link needs no track; a wire that had to step twice needs two
        const mid = twice.get(`${k}|${x.id}`);
        return mid === undefined ? [x] : [
          { id: x.id, tops: x.tops, bots: [mid], lo: Math.min(x.tops[0], mid), hi: Math.max(x.tops[0], mid), thick: 0 },
          { id: `${x.id}~`, tops: [mid], bots: x.bots, lo: Math.min(x.bots[0], mid), hi: Math.max(x.bots[0], mid), thick: 0, under: x.id },
        ];
      });
      for (const f of s.flats) if (!f.straight && s.slots[f.a].row === k) {
        const a = endU(f.a, "s", f.key), b = endU(f.b, "s", f.key);
        nets.push({ id: `round:${f.wire}`, tops: [a, b], bots: [], lo: Math.min(a, b), hi: Math.max(a, b), thick: f.label ? f.label.v : 0 });
      }
      for (const side of s.sides) {
        const way = how.get(side)!, row = s.slots[side.x].row;
        if (!((way === "over" && row === k + 1) || (way === "under" && row === k))) continue;
        const x = endU(side.x, way === "over" ? "n" : "s", side.key);
        nets.push({ id: `side:${side.wire}`, tops: way === "under" ? [x] : [], bots: way === "over" ? [x] : [], lo: side.wall === "e" ? x : 0, hi: side.wall === "e" ? W : x, thick: 0 });
      }
      return { nets, netOf };
    };
    let { nets, netOf } = build(), st = stack(nets);
    // One stub cannot lie along another. Where the only way to stack two nets
    // would do that — two wires trading places between the same two lines —
    // one of the ports steps aside and the nets are stacked again. Bounded:
    // each try moves one port one step, and a wall has only so many.
    for (let tries = 0; st.clash && tries < 12; tries++) {
      if (!stepAside(st.clash.at, k)) break;
      ({ nets, netOf } = build());
      st = stack(nets);
    }
    // Where no port can step aside — both wires fixed at both ends, by
    // containers or by lanes already drawn above — one of the two wires
    // steps twice instead: across to a free line between its ends on a
    // track above the other wire, and on from there on a track below it.
    for (let tries = 0; st.clash && tries < 6; tries++) {
      const net = [st.clash.upper, st.clash.lower].find((x) => x.tops.length === 1 && x.bots.length === 1 && !x.under && !twice.has(`${k}|${x.id}`) && Math.abs(x.tops[0] - x.bots[0]) >= 2 * STUB);
      if (!net) break;
      const taken = nets.flatMap((x) => [...x.tops, ...x.bots]), lo = Math.min(net.tops[0], net.bots[0]), hi = Math.max(net.tops[0], net.bots[0]);
      let mid = snap((lo + hi) / 2);
      for (let d = 0; d < hi - lo; d += GRID) { const free = [mid - d, mid + d].find((x) => x >= lo + STUB && x <= hi - STUB && taken.every((o) => Math.abs(o - x) >= GRID)); if (free !== undefined) { mid = free; break; } }
      twice.set(`${k}|${net.id}`, mid);
      ({ nets, netOf } = build());
      st = stack(nets);
    }
    channels.push({ nets, stack: st, at: pitch(nets, st), netOf, top: tags[k].filter((t) => t.at === "top"), bottom: tags[k].filter((t) => t.at === "bottom"), v0: 0, depth: 0, trackV: [], topV: [], bottomV: [] });
  }
  /** Move a leaf's port (or a lane) that stands at `x` on the lower side of
   *  channel `k` — or failing that the upper side — one step along. */
  function stepAside(x: number, k: number): boolean {
    const used = new Set<number>();
    for (const l of s.chan[k]) { used.add(endU(l.up, "s", l.key)); used.add(endU(l.down, "n", l.key)); }
    const tryPort = (slot: number, wall: "n" | "s", key: string): boolean => {
      const id = `${slot}|${wall}|${key}`;
      if (!isLeaf(slot) || port.get(id) === undefined && u[slot] !== x) return false;
      const { lo, hi } = spaceOf(slot);
      const others = [...port].filter(([o]) => o.startsWith(`${slot}|${wall}|`) && o !== id).map(([, at]) => at);
      for (const d of [16, -16, 8, -8, 24, -24, 32, -32]) {
        const to = x + d;
        if (to < lo || to > hi || used.has(to) || others.some((o) => Math.abs(o - to) < 8)) continue;
        port.set(id, to);
        return true;
      }
      return false;
    };
    for (const l of s.chan[k]) if (endU(l.down, "n", l.key) === x && tryPort(l.down, "n", l.key)) return true;
    for (const l of s.chan[k]) if (endU(l.up, "s", l.key) === x && tryPort(l.up, "s", l.key)) return true;
    // a lane in the row below may step aside whole, if its neighbours leave it room
    for (const l of s.chan[k]) {
      const lane = l.down;
      if (s.slots[lane].kind !== "lane" || u[lane] !== x) continue;
      const row = s.rows[s.slots[lane].row], i = s.at[lane];
      const clear = (to: number) => [row[i - 1], row[i + 1]].every((o) => o === undefined || Math.abs(u[o] - to) >= w[o] / 2 + (s.slots[o].kid?.bleedU ?? 0) + w[lane] / 2 + 8);
      for (const d of [8, -8, 16, -16]) if (!used.has(x + d) && clear(x + d)) { u[lane] = x + d; return true; }
    }
    return false;
  }

  // ── depths: how deep each channel is, and where each row therefore stands ──
  const band = (list: Tag[]): number[] => {
    // labels side by side where they fit; rows of them where they would collide
    const rows: Tag[][] = [];
    for (const t of [...list].sort((p, q) => p.u - q.u)) {
      let r = rows.findIndex((row) => row.every((o) => Math.abs(o.u - t.u) >= (o.w + t.w) / 2 + 6));
      if (r < 0) { r = rows.length; rows.push([]); }
      rows[r].push(t);
      t.row = r;
    }
    return rows.map((row) => Math.max(...row.map((t) => t.h)));
  };
  const rowTop: number[] = [0];
  const crosswise = !!s.parent && s.parent.dir !== s.dir;
  let v = 0;
  channels.forEach((c, k) => {
    const upper = k ? s.rows[k] : [], bleed = Math.max(0, ...upper.map((i) => s.slots[i].kid?.bleedV ?? 0));
    const tops = band(c.top), bottoms = band(c.bottom), tracks = c.stack.count;
    const titled = k === 0 && s.dir === "down" && s.title ? s.title.v + 8 : 0;
    let y = 0;
    if (tops.length || bottoms.length || tracks) y = tops.length || !tracks ? Math.max(8, bleed + 4) : Math.max(STUB, titled);
    for (const h of tops) { c.topV.push(y); y += h + 6; }
    if (tops.length && tracks) y += 2;
    const first = y;
    if (tracks) y += c.at[tracks - 1] + Math.ceil(Math.max(0, ...c.nets.filter((x) => c.stack.track.get(x.id) === tracks - 1).map((x) => x.thick)) / 2);
    for (const t of c.at) c.trackV.push(first + t);
    if (bottoms.length && tracks) y += 8;
    for (const h of bottoms) { c.bottomV.push(y); y += h + 6; }
    if (bottoms.length) y += 2; else if (tracks) y += STUB;
    else if (tops.length) y += 2;
    const base = k === 0 ? s.pad.n : k === R ? s.pad.s : s.gap.rank;
    c.depth = Math.max(base, y);
    // Under a parent of the other direction this sheet's ranks lie along the
    // parent's rows: each rank's centre line goes on the parent's grid, so a
    // box outside can stand level with it exactly.
    if (crosswise && k < R) c.depth += (2 * GRID - ((v + c.depth + rowH[k + 1] / 2) % GRID)) % GRID;
    // what is left over goes half above and half below
    const slack = Math.floor((c.depth - y) / 2);
    c.v0 = v;
    c.trackV = c.trackV.map((t) => v + slack + t); c.topV = c.topV.map((t) => v + slack + t); c.bottomV = c.bottomV.map((t) => v + slack + t);
    v += c.depth;
    if (k < R) { rowTop[k + 1] = v; v += rowH[k + 1]; }
  });
  let H = v;
  if (s.dir === "right" && H < s.minW) H = s.minW;
  // the side a parent of the other direction measures along its rows
  if (!root && s.parent && s.parent.dir !== s.dir) H = ceilTo(H, 2 * GRID);

  // ── draw ───────────────────────────────────────────────────────────────────
  const top = s.slots.map((x) => (x.kid ? rowTop[x.row] + dv[x.i] : 0));
  const geo: Geo = { W, H, u, top, ports: new Map(), wires: new Map(), labels: new Map() };
  const northOf = (slot: number) => (s.slots[slot].kind === "port" ? (s.slots[slot].row ? H : 0) : top[slot]);
  const southOf = (slot: number) => (s.slots[slot].kind === "port" ? (s.slots[slot].row ? H : 0) : top[slot] + (s.slots[slot].kid?.h ?? 0));
  const trackOf = (k: number, id: string): number => channels[k].trackV[channels[k].stack.track.get(id)!];
  const label = (wire: string, x: number, y: number, lw: number, lh: number) => geo.labels.set(wire, { x: Math.round(x - lw / 2), y: Math.round(y - lh / 2), w: lw, h: lh });

  // wires straight out of a leaf's side wall: about the middle of what the wall offers
  const level = new Map<Side, number>();
  for (const x of new Set(s.sides.map((d) => d.x))) for (const wall of ["e", "w"] as const) {
    const out = s.sides.filter((d) => d.x === x && d.wall === wall && how.get(d) === "straight"), kid = s.slots[x].kid!;
    const lo = top[x] + 8, hi = top[x] + Math.min(kid.h, kid.faceV ?? kid.h) - 8, mid = Math.round((lo + hi) / 2);
    const step = (out.length - 1) * 16 > hi - lo ? (hi - lo) / Math.max(1, out.length - 1) : 16;
    out.forEach((d, i) => level.set(d, fixedPort(s, kid, wall, d.key) !== undefined ? top[x] + fixedPort(s, kid, wall, d.key)! : Math.round(mid + (i - (out.length - 1) / 2) * step)));
  }
  for (const [wire, piece] of s.pieces) {
    let pts: Pt[] = [];
    if (piece.kind === "vert") {
      const path = piece.slots, key = keyOf(s, piece.slots, wire);
      pts.push({ x: endU(path[0], "s", key), y: southOf(path[0]) });
      for (let i = 0; i + 1 < path.length; i++) {
        const k = s.slots[path[i]].row, l = s.chan[k].find((x) => x.up === path[i] && x.down === path[i + 1] && x.key === key)!;
        const a = endU(l.up, "s", key), b = endU(l.down, "n", key), net = channels[k].netOf.get(l)!;
        const mid = twice.get(`${k}|${net}`);
        if (mid !== undefined) pts.push({ x: a, y: trackOf(k, net) }, { x: mid, y: trackOf(k, net) }, { x: mid, y: trackOf(k, `${net}~`) }, { x: b, y: trackOf(k, `${net}~`) });
        else if (channels[k].stack.track.has(net) && a !== b) { const y = trackOf(k, net); pts.push({ x: a, y }, { x: b, y }); }
      }
      const last = path[path.length - 1];
      pts.push({ x: endU(last, "n", key), y: northOf(last) });
      if (!piece.down) pts.reverse();
    } else if (piece.kind === "flat") {
      pts = drawFlat(piece.flat);
      if (!piece.flat.fwd) pts.reverse();
    } else if (piece.kind === "side") {
      pts = drawSide(piece.side);
      if (!piece.side.out) pts.reverse();
    }
    if (pts.length) geo.wires.set(wire, pts);
  }
  function drawFlat(f: Flat): Pt[] {
    const a = s.slots[f.a], b = s.slots[f.b], k = a.row;
    if (!f.straight) {
      const ua = endU(f.a, "s", f.key), ub = endU(f.b, "s", f.key), y = trackOf(k, `round:${f.wire}`);
      if (f.label) label(f.wire, (ua + ub) / 2, y, f.label.u, f.label.v);
      return [{ x: ua, y: southOf(f.a) }, { x: ua, y }, { x: ub, y }, { x: ub, y: southOf(f.b) }];
    }
    const c = gut.of.get(f)!, x0 = u[f.a] + a.kid!.w / 2, x1 = u[f.b] - b.kid!.w / 2, ya = rowTop[k] + c.va, yb = rowTop[k] + c.vb;
    if (f.label) label(f.wire, x0 + (c.label ?? (x1 - x0) / 2), yb, f.label.u, f.label.v);
    return c.step === undefined ? [{ x: x0, y: ya }, { x: x1, y: yb }] : [{ x: x0, y: ya }, { x: x0 + c.step, y: ya }, { x: x0 + c.step, y: yb }, { x: x1, y: yb }];
  }
  function drawSide(d: Side): Pt[] {
    const way = how.get(d)!, k = s.slots[d.x].row, edge = d.wall === "e" ? W : 0, kid = s.slots[d.x].kid!;
    if (way === "straight") {
      const y = level.get(d)!;
      geo.ports.set(`${d.wall}|${d.key}`, y);
      return [{ x: d.wall === "e" ? u[d.x] + kid.w / 2 : u[d.x] - kid.w / 2, y }, { x: edge, y }];
    }
    const x = endU(d.x, way === "over" ? "n" : "s", d.key), y = trackOf(way === "over" ? k - 1 : k, `side:${d.wire}`);
    geo.ports.set(`${d.wall}|${d.key}`, y);
    return [{ x, y: way === "over" ? top[d.x] : top[d.x] + kid.h }, { x, y }, { x: edge, y }];
  }

  // labels: on stubs, in their bands; on lanes, in the middle of the row
  channels.forEach((c) => {
    for (const t of c.top) label(t.wire, t.u, c.topV[t.row!] + t.h / 2, t.w, t.h);
    for (const t of c.bottom) label(t.wire, t.u, c.bottomV[t.row!] + t.h / 2, t.w, t.h);
  });
  for (const x of s.slots) if (x.kind === "lane" && x.label) label(x.label.wire, u[x.i], rowTop[x.row] + rowH[x.row] / 2, x.label.u, x.label.v);

  // where wires cross this sheet's own walls
  for (const [id, slot] of s.port) geo.ports.set(id, u[slot]);
  for (const t of s.terms) {
    // a wire that ends at this container's side wall: the free place nearest the middle
    const used = [...geo.ports].filter(([id]) => id.startsWith(`${t.wall}|`)).map(([, at]) => at);
    let y = snap(H / 2);
    for (let d = 0; d < H; d += 16) { const hit = [y - d, y + d].find((c) => c >= 8 && c <= H - 8 && used.every((o) => Math.abs(o - c) >= 16)); if (hit !== undefined) { y = hit; break; } }
    geo.ports.set(`${t.wall}|${t.key}`, y);
  }
  for (const [wire, piece] of s.pieces) if (piece.kind === "term") {
    const at = geo.ports.get(`${piece.wall}|${piece.key}`)!;
    geo.wires.set(wire, [piece.wall === "n" ? { x: at, y: 0 } : piece.wall === "s" ? { x: at, y: H } : piece.wall === "e" ? { x: W, y: at } : { x: 0, y: at }]);
  }
  return geo;
}

/** The port key a vertical piece's links carry. */
function keyOf(s: Sheet, path: number[], wire: string): string {
  const k = s.slots[path[0]].row;
  return s.chan[k].find((l) => l.up === path[0] && l.down === path[1] && l.wires.includes(wire))!.key;
}
