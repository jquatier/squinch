// Tidy: the last few pixels, once every slot has a lane.
//
// Settling splits a disagreement evenly, which leaves both sides a little
// bent. Four passes clean that up without undoing it:
//
//   straighten  a wire with both its walls to itself runs dead straight, if
//               a box can move the whole way without bending another
//   snap        every box's centre line goes onto the design lattice
//   centre      …except a box over exactly two wires, which stands between them
//   nudge       a jog too short to draw is slid straight, or opened up
//
// The author's alignments (`align`, `cols`) are never moved.

import type { Ports } from "./ports.js";
import type { Rows } from "./rows.js";
import type { Sheet } from "./sheet.js";
import { LATTICE, type Slot, type Wire } from "./types.js";

const NEAR = 15; // a jog shorter than two corner radii is slid straight rather than drawn

/** One wire between two neighbouring layers. */
interface Hop { u: Slot; v: Slot; wire: Wire }

export function tidy(sh: Sheet, ports: Ports, rows: Rows): void {
  const { chains, g } = sh;
  const hops: Hop[] = chains.flatMap((c) => c.path.slice(1).map((v, i) => ({ u: c.path[i], v, wire: c.wire })));
  const hopsOf = new Map<Slot, Hop[]>();
  for (const hop of hops) for (const s of [hop.u, hop.v]) (hopsOf.get(s) ?? hopsOf.set(s, []).get(s)!).push(hop);
  /** How far off straight a hop is. */
  const off = (h: Hop) => ports.lane(h.u, h.wire, "end") - ports.lane(h.v, h.wire, "start");
  const onAxis = new Set([...(g.aligned ?? []), ...(g.columns ?? [])].flat().map((id) => sh.slotOf(id)));
  const anchored = (s: Slot, except?: Hop) => onAxis.has(s) || (hopsOf.get(s) ?? []).some((h) => h !== except && off(h) === 0);

  /** Move `s` by `d`, pushing row-mates ahead of it. Refused — false — if
   *  that would bend a straight wire, or if the wires of everything that
   *  moves do not come out shorter in sum: dragging a whole row along to
   *  straighten one wire, while a row-mate's grows by as much, trades
   *  centring for nothing. */
  const carry = (s: Slot, d: number, hop: Hop): boolean => {
    const row = rows.of(s), step = d > 0 ? 1 : -1;
    const moves: [Slot, number][] = [[s, d]];
    for (let i = row.indexOf(s), by = d; row[i + step]; i += step) {
      const [a, b] = step > 0 ? [row[i], row[i + step]] : [row[i + step], row[i]];
      const slack = b.pos - (a.pos + a.lsize + rows.gapAfter(a, b));
      by = step * Math.max(0, Math.abs(by) - slack);
      if (!by) break;
      moves.push([row[i + step], by]);
    }
    if (anchored(s, hop) || moves.slice(1).some(([m]) => anchored(m))) return false;
    const strain = () => moves.reduce((sum, [m]) => sum + (hopsOf.get(m) ?? []).reduce((a, h) => a + Math.abs(off(h)), 0), 0);
    const before = strain();
    for (const [m, by] of moves) m.pos += by;
    if (strain() < before) return true;
    for (const [m, by] of moves) m.pos -= by;
    return false;
  };

  /** Box-to-box wires first: they are the lines the eye follows. Only a wire
   *  that has both its walls to itself — a parent stays centred over its
   *  children, and they stay spread beneath it. */
  const straighten = () => {
    for (const boxesOnly of [true, false])
      for (const hop of hops) {
        if (boxesOnly !== (hop.u.kind === "box" && hop.v.kind === "box")) continue;
        if (ports.crowd(hop.u, "end") > 1 || ports.crowd(hop.v, "start") > 1) continue;
        const d = off(hop);
        if (d) carry(hop.v, d, hop) || carry(hop.u, -d, hop);
      }
  };

  /** Nothing almost-aligned, by construction: every box's centre line sits
   *  on a lattice, so two of them are on one line or a clear step apart —
   *  never a few pixels. A box moves at most half a step; its ports then go
   *  to meet their wires again, which is what they are for. */
  const snap = () => {
    const onLattice = (v: number, least: number) => {
      let at = Math.round(v / LATTICE) * LATTICE;
      while (at < least) at += LATTICE;
      return at;
    };
    // boxes the author aligned go to the lattice together, or not at all
    for (const set of g.aligned ?? []) {
      const members = set.map((id) => sh.slotOf(id));
      const centre = Math.round((members[0].pos + members[0].lsize / 2) / LATTICE) * LATTICE;
      const at = (s: Slot) => Math.round(centre - s.lsize / 2);
      if (members.every((s) => rows.fits(s, at(s)))) for (const s of members) s.pos = at(s);
    }
    for (const { slots: row } of sh.layers)
      row.forEach((s, i) => {
        const prev = row[i - 1];
        const least = prev ? prev.pos + prev.lsize + rows.gapAfter(prev, s) : -Infinity;
        // a wall port stands on the lattice too: it is where this container's
        // wire is, seen from outside, and two containers joined by a straight
        // wire must round the same way
        if (s.kind === "port") s.pos = onLattice(s.pos, Math.max(least, s.least ?? -Infinity));
        else if (s.kind !== "box" || onAxis.has(s)) s.pos = Math.max(s.pos, least);
        else s.pos = Math.round(onLattice(s.pos + s.lsize / 2, least + s.lsize / 2) - s.lsize / 2);
      });
    rows.settleWall();
    ports.meet();
  };

  /** A box over exactly two wires stands exactly between them. The lattice
   *  can leave it half a step to one side — two children 168 apart have
   *  their midpoint between two lines — and a fan that is almost symmetric
   *  is the one place half a step shows. */
  const centre = () => {
    for (const s of rows.all) {
      if (s.kind !== "box" || s.box!.group || onAxis.has(s)) continue;
      const mine = hopsOf.get(s) ?? [];
      if (mine.some((h) => off(h) === 0)) continue; // a straight wire is worth more
      for (const fan of [mine.filter((h) => h.u === s), mine.filter((h) => h.v === s)]) {
        if (fan.length !== 2) continue;
        const [a, b] = fan.map((h) => (h.u === s ? ports.lane(h.v, h.wire, "start") : ports.lane(h.u, h.wire, "end")));
        const d = Math.round((a + b) / 2 - (s.pos + s.lsize / 2));
        if (!d || Math.abs(d) > LATTICE / 2 || !rows.fits(s, s.pos + d)) continue;
        s.pos += d;
        ports.meet();
        break;
      }
    }
  };

  /** Slide a pass-through wire or a wall port along its row. */
  const shift = (s: Slot, d: number) => {
    if (s.kind === "box" || !rows.fits(s, s.pos + d)) return false;
    s.pos += d;
    return true;
  };
  /** A wire a few pixels off straight is slid onto the line. A port gives
   *  before a passing wire does: moving the wire only hands the jog to its
   *  other end. `boxesToo`: where neither can give, move a box — if nothing
   *  straight bends for it. Failing everything, the jog is opened up to a
   *  full corner. */
  const nudge = (boxesToo: boolean) => {
    for (let round = 0; round < 3; round++)
      for (const hop of hops) {
        const { u, v, wire } = hop, d = off(hop);
        if (!d || Math.abs(d) > NEAR) continue;
        if (ports.slide(v, wire, "start", d) || ports.slide(u, wire, "end", -d)) continue;
        // Sliding the passing wire hands the jog to its next hop, where a
        // port may take it. The last round does not: a jog still being
        // handed round by then has nowhere to go, and is opened up instead.
        if (round < 2 && (shift(v, d) || shift(u, -d))) continue;
        if (boxesToo && (carry(v, d, hop) || carry(u, -d, hop))) continue;
        const more = Math.sign(d) * (NEAR + 1 - Math.abs(d));
        ports.slide(v, wire, "start", -more) || ports.slide(u, wire, "end", more) || shift(v, -more) || shift(u, more);
      }
  };
  // boxes, then wires; and after the lattice has had its say, wires only —
  // the last word goes to the boxes' lines
  straighten();
  nudge(true);
  snap();
  centre();
  nudge(false);
}
