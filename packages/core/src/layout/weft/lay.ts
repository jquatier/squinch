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
import type { Flat, Geo, Hook, Kid, Link, Sheet, Side, Wall } from "./types.js";

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
    // Room kept north or south of a box (`Box.room`) is part of the rank's
    // depth and of nothing else: the boxes keep their one top line, or their
    // one centre line, which stands low enough for the deepest room above
    // it; the rank ends below the deepest room under it. So no track, lane
    // or label of the channels either side can enter a room, and the box's
    // own wires cross it straight on their way to the channel.
    const kids = row.flatMap((i) => (s.slots[i].kid ? [s.slots[i]] : []));
    if (!kids.some((x) => x.kid!.room.n || x.kid!.room.s)) return;
    const line = level ? Math.max(...kids.map((x) => x.kid!.room.n)) : Math.max(...kids.map((x) => x.kid!.room.n + x.kid!.h / 2));
    for (const x of kids) dv[x.i] = level ? line : Math.floor(line - x.kid!.h / 2);
    rowH[k] = Math.max(...kids.map((x) => dv[x.i] + x.kid!.h + x.kid!.room.s), ...row.map((i) => (s.slots[i].label ? s.slots[i].label!.v + 16 : 0)));
  });

  // Two neighbouring containers whose facing ports are a few pixels out of
  // level: the higher steps down that much, rather than the wire jogging in
  // the gutter by less than a corner's width.
  for (const f of s.flats) {
    const a = s.slots[f.a].kid!, b = s.slots[f.b].kid!, va = fixedPort(s, a, "e", f.key), vb = fixedPort(s, b, "w", f.key);
    if (!f.straight || va === undefined || vb === undefined) continue;
    const d = dv[f.a] + va - (dv[f.b] + vb);
    // A wire comes in level with where it left the box across the gutter, if
    // the wall allows (§5.4): the box inside either container lets its port
    // slide. Failing that, a step too short to draw is closed by the higher
    // container standing down by it.
    if (!d || slide(s, b, "w", f.key, d) || slide(s, a, "e", f.key, -d)) continue;
    if (Math.abs(d) < STUB) dv[d > 0 ? f.b : f.a] += Math.abs(d);
  }
  // A plain box whose one wire across a gutter meets a container's fixed
  // port stands with its middle on that wire, as far as its rank is deep —
  // a wall's only wire meets it in the middle (§5.4), and here it is the box
  // that can move. Left on the rank's top line it could only bring a port as
  // near as its corner allows, and the wire stepped the rest.
  const across = (i: number) => s.flats.filter((f) => f.a === i || f.b === i);
  for (const f of s.flats) {
    const a = s.slots[f.a].kid!, b = s.slots[f.b].kid!, va = fixedPort(s, a, "e", f.key), vb = fixedPort(s, b, "w", f.key);
    if (!f.straight || (va === undefined) === (vb === undefined)) continue;
    const [leaf, i, at] = va === undefined ? [a, f.a, dv[f.b] + vb!] : [b, f.b, dv[f.a] + va];
    if (leaf.sheet || leaf.faceV || across(i).length !== 1) continue;
    const k = s.rows.findIndex((row) => row.includes(i));
    dv[i] = Math.max(leaf.room.n, Math.min(at - Math.round(leaf.h / 2), rowH[k] - leaf.h - leaf.room.s));
  }
  s.rows.forEach((row, k) => { rowH[k] = Math.max(rowH[k], ...row.map((i) => (s.slots[i].kid ? dv[i] + s.slots[i].kid!.h + s.slots[i].kid!.room.s : 0))); });
  const gut = gutters(s, dv, (kid, wall, key) => fixedPort(s, kid, wall, key));
  const off = (slot: number, wall: Wall, key: string): number => {
    const kid = s.slots[slot].kid;
    if (!kid) return 0;
    const fixed = fixedPort(s, kid, wall, key);
    return fixed !== undefined ? fixed - kid.w / 2 : kid.faceU ? kid.faceU / 2 - kid.w / 2 : 0;
  };
  const { u, off: offLine } = place(s, { w, bleed: s.slots.map((x) => x.kid?.bleedU ?? 0), lead: s.slots.map((x) => x.kid?.room.w ?? 0), gutter: gut.room, off });

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
  /** the hooks of wires asked to use a wall (`types.ts`, `Hook`), each with its wire and port key */
  const hooks = [...s.pieces].flatMap(([wire, piece]) => (piece.kind === "vert" ? [piece.head, piece.tail].flatMap((h) => (h ? [{ ...h, wire, key: keyOf(s, piece.slots, wire) }] : [])) : []));
  const roomAt = new Map<string, number>(); // port → the width of a label given room on its stub
  /** how far out from this slot's wall something is drawn on one of these wires' ends */
  const tipAt = (slot: number, wires: string[]): number => {
    const id = s.slots[slot].kid?.id;
    return id === undefined ? 0 : Math.max(0, ...wires.flatMap((wire) => (s.tips.get(wire) ?? []).filter((t) => t.box === id).map((t) => t.len)));
  };
  // Ports whose wire has something drawn on its end there (`Wire.tips`). It
  // is drawn a little to either side of the wire, so where a port is moved
  // to straighten a wire it keeps a full 16 px from such a neighbour, not
  // the 8 px two bare wires may stand at.
  const tipped = new Set<string>();
  const tipClear = (a: string, b: string) => (tipped.has(a) || tipped.has(b) ? STUB : 0);
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
      if (s.tips.size) { if (a && tipAt(l.up, l.wires)) tipped.add(a.id); if (b && tipAt(l.down, l.wires)) tipped.add(b.id); }
      // a label rides on the stub at one of the two ports; where the wire runs straight, at both
      // a label stands on the stub at one of the two ports, and wants room there — as does a wire that ran in under a label outside
      const tagged = l.label?.room && (l.label.at === "top" ? a : b);
      if (tagged) tagged.label = Math.max(tagged.label ?? 0, l.label!.u);
      if (l.room) for (const e of [a, b]) if (e) e.label = Math.max(e.label ?? 0, l.room);
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
      const fa = add(f.a, "s", f.key, EDGE - span), fb = add(f.b, "s", f.key, -EDGE + span);
      if (fa && tipAt(f.a, [f.wire])) tipped.add(fa.id);
      if (fb && tipAt(f.b, [f.wire])) tipped.add(fb.id);
    }
    for (const side of s.sides) {
      const way = how.get(side)!, row = s.slots[side.x].row;
      if ((way === "over" && row === k + 1) || (way === "under" && row === k)) add(side.x, way === "over" ? "n" : "s", side.key, side.wall === "e" ? EDGE : -EDGE);
    }
    // a hook out of a north or south wall: its port at the end of the wall its lane stands beside
    for (const h of hooks) if ((h.wall === "n" && s.slots[h.box].row === k + 1) || (h.wall === "s" && s.slots[h.box].row === k)) add(h.box, h.wall, h.key, s.slots[h.lane].beside!.after ? EDGE : -EDGE);
    meetAcross(walls);
    for (const wall of walls.values()) for (const e of wall.ends) { port.set(e.id, e.at); if (e.room) roomAt.set(e.id, e.room); }
    // Nothing almost-right (§4.3): a link whose ends are less than 16 px
    // apart would turn twice within a corner's width. A leaf's port comes
    // level with the other end if its wall has the place free — or, if not,
    // steps away until the jog is a full one.
    const move = (slot: number, wall: "n" | "s", key: string, to: number): boolean => {
      if (!isLeaf(slot)) return false;
      const id = `${slot}|${wall}|${key}`, sp = spaceOf(slot), ends = walls.get(`${slot}|${wall}`)!.ends;
      const now = port.get(id)!, mine = ends.find((e) => e.id === id)?.room ?? 0;
      // never past a neighbour, never within 8 px of one — nor into the room a label on either stub has
      const clear = (e: End) => Math.max(8, Math.max(mine, e.room ?? 0) ? Math.max(mine, e.room ?? 0) / 2 + 1 : 0, tipClear(id, e.id));
      if (to < sp.lo || to > sp.hi || ends.some((e) => e.id !== id && (Math.abs(port.get(e.id)! - to) < clear(e) || port.get(e.id)! > now !== port.get(e.id)! > to))) return false;
      port.set(id, to);
      return true;
    };
    // …and a lane or wall port that nothing above has fixed yet may step the same way, where its neighbours leave room
    const shift = (slot: number, to: number): boolean => {
      const x = s.slots[slot];
      if (x.kind === "box" || (x.kind === "lane" && x.row !== k + 1)) return false;
      const row = s.rows[x.row], i = s.at[slot];
      // …nor, once a label given room was found crossed all the same (`Sheet.firm`), into that room (`Slot.room`, as `sep` in place.ts keeps it)
      const off = (o: number) => { const room = s.firm ? Math.max(x.room ?? 0, s.slots[o].room ?? 0) : 0; return Math.max(s.slots[o].kind === "box" ? STUB : GRID, room ? room / 2 + 4 : 0); };
      const clear = [row[i - 1], row[i + 1]].every((o, side) => o === undefined || (side ? u[o] - to : to - u[o]) >= w[o] / 2 + (side ? s.slots[o].kid?.room.w ?? 0 : s.slots[o].kid?.bleedU ?? 0) + w[slot] / 2 + off(o));
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
      // a hook over a box, out of its north wall, or under it, out of its south
      for (const h of hooks) {
        const over = h.wall === "n" && s.slots[h.box].row === k + 1, under = h.wall === "s" && s.slots[h.box].row === k;
        if (!over && !under) continue;
        const a = endU(h.box, h.wall as "n" | "s", h.key), b = u[h.lane];
        nets.push({ id: `hook:${h.wire}:${h.wall}`, tops: under ? [a, b] : [], bots: over ? [a, b] : [], lo: Math.min(a, b), hi: Math.max(a, b), thick: 0 });
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
      const others = [...port].filter(([o]) => o.startsWith(`${slot}|${wall}|`) && o !== id).map(([o, at]) => ({ at, clear: Math.max(8, Math.max(roomAt.get(o) ?? 0, roomAt.get(id) ?? 0) / 2 + 1, tipClear(id, o)) }));
      for (const d of [16, -16, 8, -8, 24, -24, 32, -32]) {
        const to = x + d;
        if (to < lo || to > hi || used.has(to) || others.some((o) => Math.abs(o.at - to) < o.clear)) continue;
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
      const clear = (to: number) => [row[i - 1], row[i + 1]].every((o) => o === undefined || Math.abs(u[o] - to) >= w[o] / 2 + Math.max(s.slots[o].kid?.bleedU ?? 0, s.slots[o].kid?.room.w ?? 0) + w[lane] / 2 + 8);
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
    // a label band keeps off whatever is drawn on a wire's end at either wall (`Wire.tips`)
    const tipUp = Math.max(0, ...s.chan[k].map((l) => tipAt(l.up, l.wires))), tipDown = Math.max(0, ...s.chan[k].map((l) => tipAt(l.down, l.wires)));
    if (tipUp && (tops.length || bottoms.length)) y = Math.max(y, tipUp + 4);
    for (const h of tops) { c.topV.push(y); y += h + 6; }
    if (tops.length && tracks) y += 2;
    const first = y;
    if (tracks) y += c.at[tracks - 1] + Math.ceil(Math.max(0, ...c.nets.filter((x) => c.stack.track.get(x.id) === tracks - 1).map((x) => x.thick)) / 2);
    for (const t of c.at) c.trackV.push(first + t);
    if (bottoms.length && tracks) y += 8;
    for (const h of bottoms) { c.bottomV.push(y); y += h + 6; }
    if (bottoms.length) y += Math.max(2, tipDown && tipDown + 4); else if (tracks) y += STUB;
    else if (tops.length) y += Math.max(2, tipDown && tipDown + 4);
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
  const geo: Geo = { W, H, u, top, ports: new Map(), wires: new Map(), labels: new Map(), stuck: [], spare: new Map(), unaligned: offLine.map((i) => s.slots[i].kid!.id) };
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
    // each a step from the next — or, beside a wire that carries a label just outside the wall, half that label's width
    const gaps = out.slice(1).map((d, i) => Math.max(step, Math.max(d.room ?? 0, out[i].room ?? 0) ? ceilTo(Math.max(d.room ?? 0, out[i].room ?? 0) / 2 + 4, GRID) : 0));
    const wide = gaps.reduce((a, g) => a + g, 0) <= hi - lo ? gaps : gaps.map(() => step), span = wide.reduce((a, g) => a + g, 0);
    let at = mid - span / 2;
    out.forEach((d, i) => { level.set(d, fixedPort(s, kid, wall, d.key) !== undefined ? top[x] + fixedPort(s, kid, wall, d.key)! : Math.round(at)); at += wide[i] ?? 0; });
  }
  const sideLevels = new Map<string, number[]>(); // `box|wall` → the places hooks have taken on a side wall
  for (const [wire, piece] of s.pieces) {
    let pts: Pt[] = [];
    if (piece.kind === "vert") {
      const path = piece.slots, key = keyOf(s, piece.slots, wire);
      if (piece.head) pts.push(...hookOf(piece.head, wire, key));
      else pts.push({ x: endU(path[0], "s", key), y: southOf(path[0]) });
      for (let i = 0; i + 1 < path.length; i++) {
        const k = s.slots[path[i]].row, l = s.chan[k].find((x) => x.up === path[i] && x.down === path[i + 1] && x.key === key)!;
        const a = endU(l.up, "s", key), b = endU(l.down, "n", key), net = channels[k].netOf.get(l)!;
        const mid = twice.get(`${k}|${net}`);
        if (mid !== undefined) pts.push({ x: a, y: trackOf(k, net) }, { x: mid, y: trackOf(k, net) }, { x: mid, y: trackOf(k, `${net}~`) }, { x: b, y: trackOf(k, `${net}~`) });
        else if (channels[k].stack.track.has(net) && a !== b) { const y = trackOf(k, net); pts.push({ x: a, y }, { x: b, y }); }
      }
      const last = path[path.length - 1];
      if (piece.tail) pts.push(...hookOf(piece.tail, wire, key).reverse());
      else pts.push({ x: endU(last, "n", key), y: northOf(last) });
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
  /** A hook, from the wall it was asked to use to its lane: straight across
   *  from a side wall, at the free place nearest the wall's middle; or out
   *  of the north (south) wall, along a track of the channel there, to
   *  above (below) the lane. The wire goes on along the lane. */
  function hookOf(h: Hook, wire: string, key: string): Pt[] {
    const kid = s.slots[h.box].kid!, x = u[h.lane];
    if (h.wall === "n" || h.wall === "s") {
      const k = s.slots[h.box].row - (h.wall === "n" ? 1 : 0), at = endU(h.box, h.wall, key), y = trackOf(k, `hook:${wire}:${h.wall}`);
      return [{ x: at, y: h.wall === "n" ? top[h.box] : top[h.box] + kid.h }, { x: at, y }, { x, y }];
    }
    // a container: the wire crosses its side wall where its inside put it
    const fixed = fixedPort(s, kid, h.wall, key);
    if (fixed !== undefined) return [{ x: h.wall === "e" ? u[h.box] + kid.w / 2 : u[h.box] - kid.w / 2, y: top[h.box] + fixed }, { x, y: top[h.box] + fixed }];
    const taken = sideLevels.get(`${h.box}|${h.wall}`) ?? sideLevels.set(`${h.box}|${h.wall}`, []).get(`${h.box}|${h.wall}`)!;
    const lo = top[h.box] + 8, hi = top[h.box] + Math.min(kid.h, kid.faceV ?? kid.h) - 8, mid = Math.round((lo + hi) / 2);
    let y = mid;
    for (const gap of [STUB, 8, 1]) {
      let found: number | undefined;
      for (let d = 0; d <= hi - lo && found === undefined; d += gap === 1 ? 1 : 8) found = [mid - d, mid + d].find((c) => c >= lo && c <= hi && taken.every((o) => Math.abs(o - c) >= gap));
      if (found !== undefined) { y = found; break; }
    }
    taken.push(y);
    return [{ x: h.wall === "e" ? u[h.box] + kid.w / 2 : u[h.box] - kid.w / 2, y }, { x, y }];
  }
  function drawFlat(f: Flat): Pt[] {
    const a = s.slots[f.a], b = s.slots[f.b], k = a.row;
    if (!f.straight) {
      const ua = endU(f.a, "s", f.key), ub = endU(f.b, "s", f.key), y = trackOf(k, `round:${f.wire}`);
      if (f.label) label(f.wire, (ua + ub) / 2, y, f.label.u, f.label.v);
      return [{ x: ua, y: southOf(f.a) }, { x: ua, y }, { x: ub, y }, { x: ub, y: southOf(f.b) }];
    }
    const c = gut.of.get(f)!, x0 = u[f.a] + a.kid!.w / 2, x1 = u[f.b] - b.kid!.w / 2, ya = rowTop[k] + c.va, yb = rowTop[k] + c.vb;
    // what the gutter holds — a step, a label — stands clear of the room east of `a` (and placement left it clear of the room west of `b`)
    const g0 = x0 + a.kid!.room.e, g1 = x1 - b.kid!.room.w;
    if (f.label) label(f.wire, c.label === undefined ? (g0 + g1) / 2 : g0 + c.label, yb, f.label.u, f.label.v);
    return c.step === undefined ? [{ x: x0, y: ya }, { x: x1, y: yb }] : [{ x: x0, y: ya }, { x: g0 + c.step, y: ya }, { x: g0 + c.step, y: yb }, { x: x1, y: yb }];
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
  // what is drawn on a wire's end where it meets a box: from the wall out
  // along the wire, and a little to either side of it
  const zones: { x: number; y: number; w: number; h: number }[] = [];
  for (const [wire, tips] of s.tips) {
    const pts = geo.wires.get(wire);
    if (!pts || pts.length < 2) continue;
    for (const t of tips) {
      const x = s.slots.find((o) => o.kid?.id === t.box);
      if (!x) continue;
      const x0 = u[x.i] - x.kid!.w / 2, x1 = x0 + x.kid!.w, y0 = top[x.i], y1 = y0 + x.kid!.h;
      for (const [p, q] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y), far = t.len + 2, wide = 7;
        zones.push(dx ? { x: Math.min(p.x, p.x + dx * far), y: p.y - wide, w: far, h: 2 * wide } : { x: p.x - wide, y: Math.min(p.y, p.y + dy * far), w: 2 * wide, h: far });
      }
    }
  }
  clearLabels(s, geo, zones);
  return geo;
}

/** A label is crossed by nothing but its own wire (§5.6). Each label was
 *  given its place with room of its own; where another wire runs through it
 *  all the same — a neighbour's stub, a wire passing — the label moves along
 *  its own wire to the nearest place where nothing does: no other wire, no
 *  box or its room, no other label, inside the sheet. A label that is clear
 *  where it stands is not looked at twice; one with no clear place stays. */
function clearLabels(s: Sheet, geo: Geo, zones: { x: number; y: number; w: number; h: number }[]): void {
  type R = { x: number; y: number; w: number; h: number };
  const boxes: R[] = s.slots.flatMap((x) => {
    const k = x.kid;
    return k ? [{ x: geo.u[x.i] - k.w / 2 - k.room.w, y: geo.top[x.i] - k.room.n, w: k.w + k.room.w + k.bleedU, h: k.h + k.room.n + k.room.s + k.bleedV }] : [];
  });
  const lines = [...geo.wires].flatMap(([wire, pts]) => pts.slice(1).map((b, i) => ({ wire, x0: Math.min(pts[i].x, b.x), x1: Math.max(pts[i].x, b.x), y0: Math.min(pts[i].y, b.y), y1: Math.max(pts[i].y, b.y) })));
  const crossed = (r: R, wire: string) => lines.some((l) => l.wire !== wire && l.x0 < r.x + r.w && l.x1 > r.x && l.y0 < r.y + r.h && l.y1 > r.y);
  const overlaps = (a: R, b: R, by = 0) => a.x < b.x + b.w + by && a.x + a.w + by > b.x && a.y < b.y + b.h + by && a.y + a.h + by > b.y;
  for (const [wire, at] of geo.labels) {
    // …and stands on nothing drawn at a wire's end (`Wire.tips`)
    const onTip = zones.some((z) => overlaps(at, z));
    if (!crossed(at, wire) && !onTip) continue;
    const pts = geo.wires.get(wire);
    if (!pts) continue;
    const mid = { x: at.x + at.w / 2, y: at.y + at.h / 2 };
    const free = (r: R) => r.x >= 4 && r.y >= 4 && r.x + r.w <= geo.W - 4 && r.y + r.h <= geo.H - 4
      && !crossed({ x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 }, wire) && !boxes.some((b) => overlaps(r, b))
      && ![...geo.labels].some(([other, o]) => other !== wire && overlaps(r, o, 4));
    // `best` is clear of everything; `spare` is clear of everything but a
    // tip, kept for a label that is still stuck once room has been tried
    // (`solve`) — a label on a wire's end is said by the caller, a label
    // under another wire is not
    let best: R | undefined, near = Infinity, spare: R | undefined, nearSpare = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], upright = a.x === b.x;
      const lo = (upright ? Math.min(a.y, b.y) + at.h / 2 : Math.min(a.x, b.x) + at.w / 2) + 4, hi = (upright ? Math.max(a.y, b.y) - at.h / 2 : Math.max(a.x, b.x) - at.w / 2) - 4;
      for (let c = Math.ceil(lo / 4) * 4; c <= hi; c += 4) {
        const r = upright ? { x: Math.round(a.x - at.w / 2), y: Math.round(c - at.h / 2), w: at.w, h: at.h } : { x: Math.round(c - at.w / 2), y: Math.round(a.y - at.h / 2), w: at.w, h: at.h };
        const far = Math.abs(r.x + r.w / 2 - mid.x) + Math.abs(r.y + r.h / 2 - mid.y);
        if (!zones.length) { if (far < near && free(r)) { best = r; near = far; } continue; }
        if (far >= near && far >= nearSpare || !free(r)) continue;
        if (zones.some((z) => overlaps(r, z))) { if (far < nearSpare) { spare = r; nearSpare = far; } } else if (far < near) { best = r; near = far; }
      }
    }
    // one that only stands on a tip, with nowhere else to go, stays
    if (best) geo.labels.set(wire, best);
    else if (crossed(at, wire)) { geo.stuck.push(wire); if (spare) geo.spare.set(wire, spare); }
  }
}

/** Move the place where the wire `key` crosses a laid-out container's side
 *  wall by `d`, if the wire runs straight out of a leaf inside whose wall has
 *  that place free. The one thing the outside ever asks of an inside. */
function slide(s: Sheet, kid: Kid, wall: "e" | "w", key: string, d: number): boolean {
  const c = kid.sheet, geo = c?.geo;
  if (!c || !geo || c.dir !== s.dir) return false;
  const mine = c.sides.filter((x) => x.wall === wall && x.key === key);
  if (mine.length !== 1 || sideWay(c, mine[0]) !== "straight") return false;
  const side = mine[0], inner = c.slots[side.x].kid!, at = geo.ports.get(`${wall}|${key}`)!, to = at + d;
  if (inner.sheet) { if (!slide(c, inner, wall, key, d)) return false; }
  else {
    const top = geo.top[side.x], others = c.sides.filter((x) => x !== side && x.x === side.x && x.wall === wall).map((x) => geo.ports.get(`${wall}|${x.key}`)!);
    if (to < top + 8 || to > top + Math.min(inner.h, inner.faceV ?? inner.h) - 8 || others.some((o) => Math.abs(o - to) < STUB)) return false;
  }
  geo.ports.set(`${wall}|${key}`, to);
  for (const p of geo.wires.get(side.wire) ?? []) p.y += d;
  return true;
}

/** The port key a vertical piece's links carry. */
function keyOf(s: Sheet, path: number[], wire: string): string {
  const k = s.slots[path[0]].row;
  return s.chan[k].find((l) => l.up === path[0] && l.down === path[1] && l.wires.includes(wire))!.key;
}
