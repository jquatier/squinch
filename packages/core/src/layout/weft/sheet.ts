// A sheet per container: its ranks, the slots in them, and how each wire
// that touches the container is drawn there. Built once, outermost first,
// and never changed afterwards except for the order of slots within a row.
//
// What makes one build possible is that nothing here waits on a position:
//
//   · which rank a box is in is the ranker's answer, for good;
//   · a wire between two ranks passes every rank between as a `lane`, and
//     leaves or enters the sheet by its north or south wall as a `port`;
//   · the two ends of a same-rank wire keep their declared order, so which
//     wall each end uses is known — the facing walls if they are neighbours
//     (and then no box may come between them), the south walls and round
//     under the row if not;
//   · a wire to the sheet's east or west wall leaves a container child
//     straight only if that child is last in its row as declared, and that
//     child then stays last.
//
// So the set of slots is fixed, a container knows which of its walls each
// wire uses before its inside is looked at, and the ordering stage can count
// crossings over the whole tree without anything appearing or vanishing.
import type { Wire } from "./contract.js";
import { framed, turn } from "./frame.js";
import { rankGroup, type Edge } from "./rank.js";
import type { Tree } from "./tree.js";
import type { Cell, Flat, Kid, Link, Path, Sheet, Side, Slot, Wall } from "./types.js";

/** A wire on its way through a container's wall, as the sheet outside decided it. */
interface Thru { path: Path; side: "from" | "to"; depth: number; wall: Wall }
/** A wire between two rows of one sheet, before it has lanes. */
interface Vert { wire: Wire; key: string; top: number; bottom: number; down: boolean; trunk?: { id: string; fans: "out" | "in" }; labelled: boolean }

/** Every sheet of the tree, a parent always before its children. */
export function weave(tree: Tree): Sheet[] {
  const sheets: Sheet[] = [];
  const inbound = new Map<string, Thru[]>();
  const build = (cell: Cell, parent?: Sheet, self?: number) => {
    const sheet = buildSheet(tree, cell, inbound.get(cell.id) ?? [], inbound, parent, self);
    sheets.push(sheet);
    for (const slot of sheet.slots) if (slot.kid?.box.group) slot.kid.sheet = build(tree.cells.get(slot.kid.id)!, sheet, slot.i);
    return sheet;
  };
  build(tree.root);
  return sheets;
}

function buildSheet(tree: Tree, cell: Cell, arriving: Thru[], inbound: Map<string, Thru[]>, parent?: Sheet, self?: number): Sheet {
  const g = cell.group, dir = g.dir, down = dir === "down";
  const mine = tree.paths.filter((p) => p.lca === cell);
  const rank = rankGroup(g.boxes.map((b) => b.id), mine.map((p): Edge => [p.a, p.b]), g.pins);
  const R = g.boxes.length ? Math.max(...rank.values()) + 1 : 0;

  const held = new Set(g.held ?? []);
  const col = new Map<string, number>();
  g.columns?.forEach((band, i) => band.forEach((id) => col.set(id, i)));
  const slots: Slot[] = [];
  const rows: number[][] = Array.from({ length: R + 2 }, () => []);
  const slotOf = new Map<string, number>();
  const kids: Kid[] = [];
  // a box no wire touches stands after its row-mates that have one, unless the author placed it (§5.2)
  const aside = (id: string) => (!tree.wired.has(id) && !held.has(id) ? 1 : 0);
  for (const box of [...g.boxes].sort((p, q) => aside(p.id) - aside(q.id))) {
    const size = framed(dir, box.w, box.h);
    const kid: Kid = {
      id: box.id, box, w: size.u, h: size.v,
      faceU: down ? undefined : box.face, faceV: down ? box.face : undefined,
      bleedU: down ? 0 : box.bleed ?? 0, bleedV: down ? box.bleed ?? 0 : 0,
    };
    kids.push(kid);
    const row = rank.get(box.id)! + 1;
    const slot: Slot = { i: slots.length, kind: "box", row, kid, held: held.has(box.id), col: col.get(box.id) ?? -1, idle: !tree.wired.has(box.id), decl: rows[row].length };
    slots.push(slot);
    rows[row].push(slot.i);
    slotOf.set(box.id, slot.i);
  }
  const thin = (kind: "lane" | "port", row: number, key: string): number => {
    const slot: Slot = { i: slots.length, kind, row, key, held: false, col: -1, idle: false, decl: rows[row].length };
    slots.push(slot);
    rows[row].push(slot.i);
    return slot.i;
  };

  const sheet: Sheet = {
    cell, dir, parent, self, R, kids, slots, rows, at: [], chan: Array.from({ length: R + 1 }, () => []),
    flats: [], sides: [], terms: [], pieces: new Map(), port: new Map(), through: new Map(), before: [], glue: [], last: [],
    pad: down ? { n: g.pad.top, s: g.pad.bottom, w: g.pad.left, e: g.pad.right } : { n: g.pad.left, s: g.pad.right, w: g.pad.top, e: g.pad.bottom },
    gap: g.gap,
    title: cell.box?.title && (down ? { u: cell.box.title.w, v: cell.box.title.h } : { u: cell.box.title.h, v: cell.box.title.w }),
    minW: cell.box?.minW ?? 0, rough: 0, busy: { up: [], down: [] },
  };

  /** Hand a wire on to the child container it continues into, with the wall it uses there. */
  const pass = (path: Path, side: "from" | "to", depth: number, kid: string, wall: Wall) => {
    const next = path[side][depth];
    if (!next || next.cell.id !== kid) return; // the wire ends at this child: a leaf
    const list = inbound.get(kid) ?? inbound.set(kid, []).get(kid)!;
    list.push({ path, side, depth, wall: turn(wall, dir, next.cell.group.dir) });
  };
  const portFor = (wall: "n" | "s", key: string): number => {
    const k = `${wall}|${key}`;
    return sheet.port.get(k) ?? sheet.port.set(k, thin("port", wall === "n" ? 0 : R + 1, key)).get(k)!;
  };
  const boxesBetween = (a: number, b: number): boolean => {
    const row = rows[slots[a].row], i = row.indexOf(a), j = row.indexOf(b);
    return row.slice(Math.min(i, j) + 1, Math.max(i, j)).some((s) => slots[s].kind === "box");
  };
  const labelOf = (wire: Wire) => wire.label && framed(dir, wire.label.w, wire.label.h);

  // ── wires whose ends part here ─────────────────────────────────────────────
  const verts: Vert[] = [];
  for (const path of mine) {
    const key = path.wire.bundle ?? path.wire.id;
    const a = slotOf.get(path.a)!, b = slotOf.get(path.b)!;
    if (slots[a].row !== slots[b].row) {
      const aboveA = slots[a].row < slots[b].row;
      verts.push({ wire: path.wire, key, top: aboveA ? a : b, bottom: aboveA ? b : a, down: aboveA, labelled: true });
      pass(path, "from", 0, path.a, aboveA ? "s" : "n");
      pass(path, "to", 0, path.b, aboveA ? "n" : "s");
      continue;
    }
    const first = rows[slots[a].row].indexOf(a) < rows[slots[b].row].indexOf(b);
    const flat: Flat = { a: first ? a : b, b: first ? b : a, key, wire: path.wire.id, straight: !boxesBetween(a, b), fwd: first, label: labelOf(path.wire) && { u: labelOf(path.wire)!.u, v: labelOf(path.wire)!.v } };
    sheet.flats.push(flat);
    sheet.pieces.set(path.wire.id, { kind: "flat", flat });
    sheet.before.push([flat.a, flat.b]);
    if (flat.straight) sheet.glue.push([flat.a, flat.b]);
    pass(path, "from", 0, path.a, !flat.straight ? "s" : first ? "e" : "w");
    pass(path, "to", 0, path.b, !flat.straight ? "s" : first ? "w" : "e");
  }

  // ── wires on their way through a wall ──────────────────────────────────────
  const sideways: { t: Thru; kid: string }[] = [];
  for (const t of arriving) {
    const { path, side, depth, wall } = t;
    const key = path.wire.bundle ?? path.wire.id, kid = path[side][depth].kid;
    if (wall === "n" || wall === "s") {
      const port = portFor(wall, key);
      if (kid === null) { sheet.pieces.set(path.wire.id, { kind: "term", wall, key }); continue; }
      const x = slotOf.get(kid)!;
      // through the north wall: in if the wire is arriving, out (against the flow) if it is leaving
      verts.push({ wire: path.wire, key, top: wall === "n" ? port : x, bottom: wall === "n" ? x : port, down: (wall === "n") === (side === "to"), labelled: false });
      pass(path, side, depth + 1, kid, wall);
    } else if (kid === null) {
      sheet.terms.push({ wall, key, wire: path.wire.id });
      sheet.through.set(`${wall}|${key}`, sheet.terms[sheet.terms.length - 1]);
      sheet.pieces.set(path.wire.id, { kind: "term", wall, key });
    } else sideways.push({ t, kid });
  }
  // how busy each side of a box already is, for a container's choice of over or under
  const ends = { up: new Map<number, number>(), down: new Map<number, number>() };
  for (const v of verts) { ends.down.set(v.top, (ends.down.get(v.top) ?? 0) + 1); ends.up.set(v.bottom, (ends.up.get(v.bottom) ?? 0) + 1); }
  for (const { t, kid } of sideways) {
    const wall = t.wall as "e" | "w", x = slotOf.get(kid)!, key = t.path.wire.bundle ?? t.path.wire.id;
    const row = rows[slots[x].row], i = row.indexOf(x);
    const beyond = (wall === "e" ? row.slice(i + 1) : row.slice(0, i)).filter((s) => slots[s].kind === "box");
    let via: Side["via"] = "auto";
    if (slots[x].kid!.box.group) {
      const over = beyond.reduce((n, s) => n + (ends.up.get(s) ?? 0), 0), under = beyond.reduce((n, s) => n + (ends.down.get(s) ?? 0), 0);
      via = !beyond.length ? "straight" : over < under || (over === under && slots[x].row > 1) ? "over" : "under";
      if (via === "straight") sheet.last.push({ x, wall });
      pass(t.path, t.side, t.depth + 1, kid, via === "straight" ? wall : via === "over" ? "n" : "s");
    }
    const piece: Side = { x, wall, key, wire: t.path.wire.id, via, out: t.side === "from" };
    sheet.sides.push(piece);
    sheet.through.set(`${wall}|${key}`, piece);
    sheet.pieces.set(t.path.wire.id, { kind: "side", side: piece });
  }

  // ── lanes and links ────────────────────────────────────────────────────────
  // Wires of one bundle that share an end here are one trunk (§5.6): one port
  // on the shared box, one lane through each rank they pass together, one
  // track where they part.
  const trunks = (end: "top" | "bottom", fans: "out" | "in") => {
    const sets = new Map<string, Vert[]>();
    for (const v of verts) if (v.wire.bundle && !v.trunk) (sets.get(`${v.wire.bundle}|${end}${v[end]}`) ?? sets.set(`${v.wire.bundle}|${end}${v[end]}`, []).get(`${v.wire.bundle}|${end}${v[end]}`)!).push(v);
    for (const [id, set] of sets) if (set.length > 1) for (const v of set) v.trunk = { id, fans };
  };
  trunks("top", "out");
  trunks("bottom", "in");
  const shared = new Map<string, number>();
  for (const v of verts) {
    const path = [v.top];
    for (let row = slots[v.top].row + 1; row < slots[v.bottom].row; row++) {
      const k = v.trunk && `${v.trunk.id}|${row}`;
      path.push(k ? shared.get(k) ?? shared.set(k, thin("lane", row, v.key)).get(k)! : thin("lane", row, v.key));
    }
    path.push(v.bottom);
    const links = path.slice(1).map((lower, i) => {
      const k = slots[path[i]].row, same = sheet.chan[k].find((l) => l.up === path[i] && l.down === lower && l.key === v.key);
      if (same) { same.wires.push(v.wire.id); return same; }
      const link: Link = { up: path[i], down: lower, key: v.key, wires: [v.wire.id], back: !v.down, net: v.trunk?.id };
      sheet.chan[k].push(link);
      return link;
    });
    sheet.pieces.set(v.wire.id, { kind: "vert", slots: path, down: v.down });

    // the label: half-way along — in the middle gap, or on the lane in the
    // middle row — but a trunk's wire carries it on its own last stub
    const label = v.labelled ? labelOf(v.wire) : undefined;
    if (!label) continue;
    const gaps = links.length, tag = { ...label, wire: v.wire.id };
    if (v.trunk) (v.trunk.fans === "out" ? links[gaps - 1] : links[0]).label ??= { ...tag, at: v.trunk.fans === "out" ? "bottom" : "top" };
    else if (gaps % 2) links[(gaps - 1) / 2].label ??= { ...tag, at: "bottom" };
    else slots[path[gaps / 2]].label = tag;
  }

  rows.forEach((row) => row.forEach((s, i) => { sheet.at[s] = i; }));
  sheet.busy = { up: slots.map(() => 0), down: slots.map(() => 0) };
  for (const links of sheet.chan) for (const l of links) { sheet.busy.down[l.up]++; sheet.busy.up[l.down]++; }
  for (const f of sheet.flats) if (!f.straight) { sheet.busy.down[f.a]++; sheet.busy.down[f.b]++; }
  return sheet;
}

/** The slots between a box and the side wall its wire is headed for. */
export function beyond(s: Sheet, side: Side): number[] {
  const row = s.rows[s.slots[side.x].row], i = s.at[side.x];
  return side.wall === "e" ? row.slice(i + 1) : row.slice(0, i);
}

/** How a wire to a side wall gets there, on the order as it stands (§5.3):
 *  straight if its box is last in the row; else along whichever channel —
 *  over the row or under it — fewer wires already use on that stretch. A tie
 *  goes over, except in the first rank, where over is where the title is. */
export function sideWay(s: Sheet, side: Side): "straight" | "over" | "under" {
  if (side.via !== "auto") return side.via;
  const past = beyond(s, side);
  if (!past.some((b) => s.slots[b].kind === "box")) return "straight";
  const over = past.reduce((n, b) => n + s.busy.up[b], 0), under = past.reduce((n, b) => n + s.busy.down[b], 0);
  return over < under || (over === under && s.slots[side.x].row > 1) ? "over" : "under";
}

/** The slot in `sheet` a box stands in. */
export const slotOfKid = (sheet: Sheet, id: string): Slot | undefined => sheet.slots.find((s) => s.kid?.id === id);
