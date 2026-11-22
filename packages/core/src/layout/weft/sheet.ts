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
//     child then stays last;
//   · a wire asked to use a side (`Wire.fromSide`, `toSide`) uses that
//     side of the box it names and of every container it leaves on the way
//     out — by a hook, a lane right beside the box, where the side is not
//     the one facing where the wire goes.
//
// So the set of slots is fixed, a container knows which of its walls each
// wire uses before its inside is looked at, and the ordering stage can count
// crossings over the whole tree without anything appearing or vanishing.
import type { Group, Refusal, Side as ScreenSide, Wire } from "./contract.js";
import { framed, real, turn } from "./frame.js";
import { rankGroup, type Edge } from "./rank.js";
import type { Tree } from "./tree.js";
import type { Cell, Flat, Hook, Kid, Link, Path, Sheet, Side, Slot, Step, Wall } from "./types.js";

/** A wire on its way through a container's wall, as the sheet outside decided
 *  it. It takes its place among the container's wires when it is handed on,
 *  with the wall it would use unasked; `wall` is final once the sheet outside
 *  is built — a hook given there (`hookFor`) turns it to the wall asked. */
interface Thru { path: Path; side: "from" | "to"; depth: number; wall: Wall }
/** One end of a `Vert` that was asked for a wall. `named`: the box at this
 *  end is the one the wire names — a leaf, or the container it ends at — so
 *  a wall it cannot be given is reported; a container the wire only passes
 *  through keeps its natural wall and says nothing. `thru`: the wire as it
 *  was handed to the container at this end, whose wall a hook turns. */
interface Ask { wall: Wall; end: "from" | "to"; named: boolean; thru?: Thru; /** is the run clear to that wall: `clear`, asked only where it matters */ clear: () => boolean }
/** Is this end of the wire the box it names — a leaf, or the container it
 *  ends at — and not a container the wire goes on into? `step` is that box's
 *  step of the path, if it is a container. */
const named = (step: Step | undefined): boolean => !step || step.kid === null;
/** A wall of a `dir` sheet as a side of the screen, which is how a caller is told of it. */
const SIDE: Record<Wall, ScreenSide> = { n: "north", s: "south", e: "east", w: "west" };
const screen = (wall: Wall, dir: "down" | "right"): ScreenSide => SIDE[real(wall, dir)];
/** A wire between two rows of one sheet, before it has lanes. */
interface Vert { wire: Wire; key: string; top: number; bottom: number; down: boolean; trunk?: { id: string; fans: "out" | "in" }; labelled: boolean; ask?: { top?: Ask; bottom?: Ask } }
/** A screen side as a wall of a `dir` sheet. */
const wallOf = (side: "north" | "south" | "east" | "west", dir: "down" | "right"): Wall => turn(side[0] as Wall, "down", dir);

/** A container's ranks, the order its boxes first stand in and the wires
 *  whose ends part in it: what its own sheet is built from, and what the
 *  sheets outside it read before it has one (`clear`) — one order for both.
 *  A box no wire touches stands after its row-mates that have one, unless
 *  the author placed it (§5.2). Each worked out once. */
interface Ranked { rank: Map<string, number>; R: number; boxes: Group["boxes"]; paths: Path[] }
type Ranks = (cell: Cell) => Ranked;
function rankings(tree: Tree): Ranks {
  const made = new Map<Cell, Ranked>();
  return (cell) => {
    const had = made.get(cell);
    if (had) return had;
    const g = cell.group, held = new Set(g.held ?? []), paths = tree.paths.filter((p) => p.lca === cell);
    const rank = rankGroup(g.boxes.map((b) => b.id), paths.map((p): Edge => [p.a, p.b]), g.pins);
    const aside = (id: string) => (!tree.wired.has(id) && !held.has(id) ? 1 : 0);
    const ranked: Ranked = { rank, R: g.boxes.length ? Math.max(...rank.values()) + 1 : 0, boxes: [...g.boxes].sort((p, q) => aside(p.id) - aside(q.id)), paths };
    made.set(cell, ranked);
    return ranked;
  };
}

/** Is nothing above the box a wire names, all the way out to the north wall
 *  of the container `path[side][depth]` (or below it, to the south one)? It
 *  stands in the first (last) rank of every container on the way in.
 *
 *  This matters for one case only. A side carries through every wall — but
 *  where the wall asked is the one *against* the way the wire has to go (the
 *  north, for a wire headed down), the wire has to turn back somewhere, and
 *  it turns beside the innermost box it can: beside the container, if the
 *  box has a clear run to that wall; beside the box itself, if not — it does
 *  not climb past the ranks above it to go round the whole container. */
function clear(ranks: Ranks, path: Path, side: "from" | "to", depth: number, wall: Wall, outer: "down" | "right"): boolean {
  const step = path[side][depth];
  if (named(step)) return true;
  const { rank, R, boxes } = ranks(step.cell), w = turn(wall, outer, step.cell.group.dir), r = rank.get(step.kid!)!;
  // (through a container of the other direction the wall is a side one: nothing of its row beyond it, in the order its sheet first has)
  const row = boxes.filter((b) => rank.get(b.id) === r);
  const open = w === "n" ? r === 0 : w === "s" ? r === R - 1 : w === "e" ? row[row.length - 1].id === step.kid : row[0].id === step.kid;
  return open && clear(ranks, path, side, depth + 1, w, step.cell.group.dir);
}

/** Every sheet of the tree, a parent always before its children. */
export function weave(tree: Tree): Sheet[] {
  const sheets: Sheet[] = [];
  const inbound = new Map<string, Thru[]>(), ranks = rankings(tree);
  const build = (cell: Cell, parent?: Sheet, self?: number) => {
    const sheet = buildSheet(tree, ranks, cell, inbound.get(cell.id) ?? [], inbound, parent, self);
    sheets.push(sheet);
    for (const slot of sheet.slots) if (slot.kid?.box.group) slot.kid.sheet = build(tree.cells.get(slot.kid.id)!, sheet, slot.i);
    return sheet;
  };
  build(tree.root);
  return sheets;
}

/** Give the label on link `l` of sheet `s` room on its wire's own line: the
 *  wires either side of the stub it stands on keep half its width away. Asked
 *  for only once the picture has been drawn and the label found to have no
 *  clear place anywhere along its wire (`engine.ts`).
 *
 *  Which stub carries the label: the one at the less crowded wall. A leaf
 *  with many wires on that wall cannot hold its ports a label's width apart;
 *  the other end may — and a lane or a container's port always can. (A
 *  trunk's wire has only its own stub, chosen when the trunk was made.) */
export function giveRoom(s: Sheet, l: Link): void {
  if (!l.label || l.label.room) return;
  const crowd = (slot: number, n: number) => (s.slots[slot].kind === "box" && !s.slots[slot].kid!.sheet ? n : 0);
  const first = l.net ? l.label.at : crowd(l.up, s.busy.down[l.up]) < crowd(l.down, s.busy.up[l.down]) ? "top" : "bottom";
  l.label.room = true;
  // …and failing that the other: a container of the other direction has no ports to move apart on that wall
  // (a container of the other direction last of all: there the room is a matter of the levels its box's wires leave at)
  for (const across of [false, true])
    for (const at of l.net ? [first] : [first, first === "top" ? "bottom" : "top"] as const)
      if (claim(s, at === "bottom" ? l.down : l.up, at === "bottom" ? "n" : "s", l.key, l.label.u, across)) { l.label.at = at; return; }
}

/** A label stands across its wire on the stub at one end of a link, and is
 *  as wide as it is: the wires either side of that stub must keep half its
 *  width away or they run through it (§5.6). Where the stub ends at a lane
 *  that is the lane's to keep; where it ends at a container, the container's
 *  port keeps it, and so does whatever the wire runs straight on to inside —
 *  port after port, down to the leaf whose wall it finally meets. */
function claim(s: Sheet, slot: number, wall: "n" | "s", key: string, room: number, across = true): boolean {
  const x = s.slots[slot];
  if (x.kind !== "box") { x.room = Math.max(x.room ?? 0, room); return true; }
  const inner = x.kid!.sheet;
  // a leaf: its ports are spaced when they are placed, and a lane beside it stands off
  if (!inner) { x.stub = Math.max(x.stub ?? 0, room); return true; }
  if (inner.dir !== s.dir) {
    // a container of the other direction: the wire leaves it by a side wall, level with its box
    const out = inner.through.get(`${turn(wall, s.dir, inner.dir)}|${key}`);
    if (!across || !out || !("x" in out)) return false;
    out.room = Math.max(out.room ?? 0, room);
    return true;
  }
  const port = inner.port.get(`${wall}|${key}`);
  if (port === undefined) return false;
  inner.slots[port].room = Math.max(inner.slots[port].room ?? 0, room);
  const link = inner.chan[wall === "n" ? 0 : inner.R].find((l) => (wall === "n" ? l.up : l.down) === port);
  if (!link) return true;
  link.room = Math.max(link.room ?? 0, room);
  claim(inner, wall === "n" ? link.down : link.up, wall, key, room);
  return true;
}

function buildSheet(tree: Tree, ranks: Ranks, cell: Cell, arriving: Thru[], inbound: Map<string, Thru[]>, parent?: Sheet, self?: number): Sheet {
  const g = cell.group, dir = g.dir, down = dir === "down";
  const { rank, R, boxes: declared, paths: mine } = ranks(cell);

  const held = new Set(g.held ?? []);
  const col = new Map<string, number>();
  g.columns?.forEach((band, i) => band.forEach((id) => col.set(id, i)));
  const slots: Slot[] = [];
  const rows: number[][] = Array.from({ length: R + 2 }, () => []);
  const slotOf = new Map<string, number>();
  const kids: Kid[] = [];
  // (a box no wire touches stands after its row-mates that have one: `rankings`)
  for (const box of declared) {
    const size = framed(dir, box.w, box.h);
    const kid: Kid = {
      id: box.id, box, w: size.u, h: size.v,
      faceU: down ? undefined : box.face, faceV: down ? box.face : undefined,
      bleedU: down ? 0 : box.bleed ?? 0, bleedV: down ? box.bleed ?? 0 : 0,
      room: { n: 0, s: 0, e: 0, w: 0 },
    };
    // room beside a leaf, by screen side, turned into this frame
    if (box.room && !box.group) {
      for (const side of ["north", "south", "east", "west"] as const) kid.room[wallOf(side, dir)] = Math.max(0, box.room[side] ?? 0);
      kid.bleedU = Math.max(kid.bleedU, kid.room.e);
      if (kid.room.s) kid.bleedV = Math.max(0, kid.bleedV - kid.room.s);
    }
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
    flats: [], sides: [], terms: [], pieces: new Map(), port: new Map(), through: new Map(), before: [], glue: [], last: [], unhonoured: [], rep: [], unaligned: [],
    pad: down ? { n: g.pad.top, s: g.pad.bottom, w: g.pad.left, e: g.pad.right } : { n: g.pad.left, s: g.pad.right, w: g.pad.top, e: g.pad.bottom },
    gap: g.gap,
    title: cell.box?.title && (down ? { u: cell.box.title.w, v: cell.box.title.h } : { u: cell.box.title.h, v: cell.box.title.w }),
    minW: cell.box?.minW ?? 0, rough: 0, busy: { up: [], down: [] },
    tips: new Map(tree.paths.filter((p) => p.wire.tips).map((p) => [p.wire.id, [
      ...(p.wire.tips!.from ? [{ box: p.wire.from, len: p.wire.tips!.from }] : []),
      ...(p.wire.tips!.to ? [{ box: p.wire.to, len: p.wire.tips!.to }] : []),
    ]])),
  };

  /** Hand a wire on to the child container it continues into, with the wall it uses there. */
  const pass = (path: Path, side: "from" | "to", depth: number, kid: string, wall: Wall): Thru | undefined => {
    const next = path[side][depth];
    if (!next || next.cell.id !== kid) return undefined; // the wire ends at this child: a leaf
    const list = inbound.get(kid) ?? inbound.set(kid, []).get(kid)!;
    const thru: Thru = { path, side, depth, wall: turn(wall, dir, next.cell.group.dir) };
    list.push(thru);
    return thru;
  };
  /** The side asked of one end of a wire, as it applies to the box that end
   *  is, or is in, here: `depth` is the step of `path[side]` that box would
   *  be, if it is a container. The side is asked of the box the wire names
   *  and carries outward: every container around that box is asked for the
   *  same wall. */
  const asked = (path: Path, side: "from" | "to", depth: number, thru?: Thru): Ask | undefined => {
    const hint = side === "from" ? path.wire.fromSide : path.wire.toSide;
    return hint ? { wall: wallOf(hint, dir), end: side, named: named(path[side][depth]), thru, clear: () => clear(ranks, path, side, depth, wallOf(hint, dir), dir) } : undefined;
  };
  /** A lane right beside `box`, on the side of it `wall` faces, for a wire that leaves it by that wall. */
  const beside = (box: number, wall: "e" | "w", key: string): number => {
    const lane = thin("lane", slots[box].row, key);
    slots[lane].beside = { box, wall, after: wall === "e" };
    return lane;
  };
  const refuse = (wire: string, end: "from" | "to", why: Refusal["why"], facts: Omit<Refusal, "wire" | "end" | "why"> = {}) => { sheet.unhonoured.push({ wire, end, why, ...facts }); };
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
      // a side asked of either end (§ sides a wire is asked to use); the wire is handed on by its
      // natural wall now, to keep its place among the container's wires, and turned if a hook is given
      const endA = asked(path, "from", 0, pass(path, "from", 0, path.a, aboveA ? "s" : "n")), endB = asked(path, "to", 0, pass(path, "to", 0, path.b, aboveA ? "n" : "s"));
      verts.push({ wire: path.wire, key, top: aboveA ? a : b, bottom: aboveA ? b : a, down: aboveA, labelled: true, ask: aboveA ? { top: endA, bottom: endB } : { top: endB, bottom: endA } });
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
    // A side asked of a wire along a rank is not given. Between two row-mates
    // of this container that is the contract (ignored; the caller knows). But
    // where the other end lies deeper, in a container that merely stands in
    // this rank, the caller cannot know, so the end is reported — an end that
    // is the box the wire names, leaf or container (`named`).
    const off = (hint: Wire["fromSide"], here: Step | undefined, there: Step | undefined, natural: Wall) => !!hint && named(here) && !named(there) && wallOf(hint, dir) !== natural;
    if (off(path.wire.fromSide, path.from[0], path.to[0], !flat.straight ? "s" : first ? "e" : "w")) refuse(path.wire.id, "from", "row", { mate: path.b });
    if (off(path.wire.toSide, path.to[0], path.from[0], !flat.straight ? "s" : first ? "w" : "e")) refuse(path.wire.id, "to", "row", { mate: path.a });
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
      const ask = asked(path, side, depth + 1, pass(path, side, depth + 1, kid, wall));
      verts.push({ wire: path.wire, key, top: wall === "n" ? port : x, bottom: wall === "n" ? x : port, down: (wall === "n") === (side === "to"), labelled: false, ask: wall === "n" ? { bottom: ask } : { top: ask } });
    } else if (kid === null) {
      sheet.terms.push({ wall, key, wire: path.wire.id });
      sheet.through.set(`${wall}|${key}`, sheet.terms[sheet.terms.length - 1]);
      sheet.pieces.set(path.wire.id, { kind: "term", wall, key });
    } else sideways.push({ t, kid });
  }
  // how busy each side of a box already is, for a container's choice of over or under
  // (as the wires stand unasked: a hook, given further down, may yet take one of them off that side)
  const ends = { up: new Map<number, number>(), down: new Map<number, number>() };
  for (const v of verts) { ends.down.set(v.top, (ends.down.get(v.top) ?? 0) + 1); ends.up.set(v.bottom, (ends.up.get(v.bottom) ?? 0) + 1); }
  for (const { t, kid } of sideways) {
    const wall = t.wall as "e" | "w", x = slotOf.get(kid)!, key = t.path.wire.bundle ?? t.path.wire.id;
    const row = rows[slots[x].row], i = row.indexOf(x);
    const beyond = (wall === "e" ? row.slice(i + 1) : row.slice(0, i)).filter((s) => slots[s].kind === "box");
    const group = !!slots[x].kid!.box.group;
    let via: Side["via"] = "auto", hook: number | undefined;
    if (group) {
      const over = beyond.reduce((n, s) => n + (ends.up.get(s) ?? 0), 0), under = beyond.reduce((n, s) => n + (ends.down.get(s) ?? 0), 0);
      via = !beyond.length ? "straight" : over < under || (over === under && slots[x].row > 1) ? "over" : "under";
    }
    // What the box was asked — itself, if it is the one the wire names; the
    // same wall, if it is a container the wire goes on into. Over or under
    // the row is its north or south wall. The wall facing the sheet's own is
    // the natural one while the box is last in its row, and it is then kept
    // last; with row-mates between, the wire leaves by that wall all the
    // same, to a lane right beside the box, and goes over or under the row
    // from there (`Side.hook`). The far wall is not given.
    const want = asked(t.path, t.side, t.depth + 1);
    // (a wire of a bundle shares its port and its way with the others, so it is given no side of its own)
    if (want && t.path.wire.bundle && want.wall !== wall) { if (want.named) refuse(t.path.wire.id, t.side, "trunk"); }
    else if (want && (want.wall === "n" || want.wall === "s")) via = want.wall === "n" ? "over" : "under";
    else if (want && want.wall !== wall) { if (want.named) refuse(t.path.wire.id, t.side, "far", { by: screen(wall, dir), open: [screen("n", dir), screen("s", dir)] }); }
    else if (want && beyond.length) {
      if (!t.path.wire.bundle) hook = beside(x, wall, key);
      else if (want.named) refuse(t.path.wire.id, t.side, "trunk");
    }
    if (via === "straight" || (want?.wall === wall && !beyond.length)) sheet.last.push({ x, wall });
    if (group) pass(t.path, t.side, t.depth + 1, kid, hook !== undefined || via === "straight" ? wall : via === "over" ? "n" : "s");
    const piece: Side = hook === undefined ? { x, wall, key, wire: t.path.wire.id, via, out: t.side === "from" } : { x, wall, key, wire: t.path.wire.id, via, out: t.side === "from", hook };
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
  // An end asked to use another wall than the one facing where the wire goes
  // gets a hook: a lane right beside the box, in its own rank, that the rest
  // of the wire starts from — so the ordering stage sees the detour as what
  // it is, a wire passing the box — and the short way from the asked wall to
  // that lane. Not given (the end keeps its natural wall, and the wire is
  // reported) to a wire of a bundle, whose port and lanes are shared — and
  // to no other: a wall that already carries a wire straight across that
  // side's gutter, or out to that side's wall, takes the hook beside it.
  // A container is given a hook on the same terms: the wire then crosses
  // that wall of it instead of its north or south one (`Ask.thru`, turned
  // here), where its inside put it. One the wire only passes through says nothing when it
  // keeps its natural wall — the side was asked of the box inside, which is
  // still given it there.
  const hookFor = (v: Vert, box: number, ask: Ask | undefined, natural: Wall): Hook | undefined => {
    if (!ask || ask.wall === natural || slots[box].kind !== "box") return undefined;
    // the wall against the way the wire goes, of a container it only passes through: the wire turns back
    // beside the innermost box it can — this one only if nothing stands above (below) the box inside (`clear`)
    if (!ask.named && (ask.wall === "n" || ask.wall === "s") && !ask.clear()) return undefined;
    if (v.wire.bundle) { if (ask.named) refuse(v.wire.id, ask.end, "trunk"); return undefined; }
    // A side wall takes the hook whatever else it carries: the wall's wires are placed together (`sides.ts`).
    // Out of a north or south wall the hook may go round either side of its box, and the ordering stage
    // chooses (`Search.flip`); it starts on a side nothing runs straight out of — a lane on the other
    // is counted as crossing that wire.
    const straight = (wall: Wall) => sheet.flats.some((f) => f.straight && ((f.a === box && wall === "e") || (f.b === box && wall === "w"))) || sheet.sides.some((d) => d.x === box && d.wall === wall);
    const side = ask.wall === "e" || ask.wall === "w" ? ask.wall : !straight("e") ? "e" : "w";
    const lane = thin("lane", slots[box].row, v.key);
    const free = ask.wall !== "e" && ask.wall !== "w", tail = natural === "n"; // the lower end of the wire's way through the sheet
    slots[lane].beside = free ? { box, wall: ask.wall, after: side === "e", free, tail } : { box, wall: ask.wall, after: side === "e", tail };
    if (ask.thru) ask.thru.wall = turn(ask.wall, dir, slots[box].kid!.box.group!.dir);
    return { box, wall: ask.wall, lane };
  };
  for (const v of verts) {
    const head = hookFor(v, v.top, v.ask?.top, "s"), tail = hookFor(v, v.bottom, v.ask?.bottom, "n");
    const path = [head ? head.lane : v.top];
    for (let row = slots[v.top].row + 1; row < slots[v.bottom].row; row++) {
      const k = v.trunk && `${v.trunk.id}|${row}`;
      path.push(k ? shared.get(k) ?? shared.set(k, thin("lane", row, v.key)).get(k)! : thin("lane", row, v.key));
    }
    path.push(tail ? tail.lane : v.bottom);
    const links = path.slice(1).map((lower, i) => {
      const k = slots[path[i]].row, same = sheet.chan[k].find((l) => l.up === path[i] && l.down === lower && l.key === v.key);
      if (same) { same.wires.push(v.wire.id); return same; }
      const link: Link = { up: path[i], down: lower, key: v.key, wires: [v.wire.id], back: !v.down, net: v.trunk?.id };
      sheet.chan[k].push(link);
      return link;
    });
    sheet.pieces.set(v.wire.id, head || tail ? { kind: "vert", slots: path, down: v.down, head, tail } : { kind: "vert", slots: path, down: v.down });

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

  // ── `aligned`: sets of boxes on one centre line ────────────────────────────
  // Two boxes of one rank stand side by side, so they cannot share a centre
  // line: of each rank a set takes the first member given, and any other is
  // left out (and reported) — placed like any box. Sets that share a member
  // are one set, on the same terms.
  sheet.rep = slots.map((x) => x.i);
  const ranksOf = (rep: number) => slots.filter((x) => sheet.rep[x.i] === rep).map((x) => x.row);
  for (const set of g.aligned ?? []) {
    let first: number | undefined;
    for (const id of new Set(set)) {
      const m = slotOf.get(id);
      if (m === undefined) continue;
      if (first === undefined) { first = m; continue; }
      const a = sheet.rep[first], b = sheet.rep[m];
      if (a === b) continue;
      const taken = new Set(ranksOf(a));
      if (ranksOf(b).some((row) => taken.has(row))) sheet.unaligned.push(id);
      else for (const x of slots) if (sheet.rep[x.i] === b) sheet.rep[x.i] = a;
    }
  }
  sheet.busy = { up: slots.map(() => 0), down: slots.map(() => 0) };
  for (const links of sheet.chan) for (const l of links) { sheet.busy.down[l.up]++; sheet.busy.up[l.down]++; }
  for (const f of sheet.flats) if (!f.straight) { sheet.busy.down[f.a]++; sheet.busy.down[f.b]++; }
  return sheet;
}

/** Which side of its box a hook's lane stands on: after it, or before. Out
 *  of a side wall that is the wall asked. A free hook's is wherever the
 *  ordering stage has it — the rows are the only record of that. */
export const hookAfter = (s: Sheet, lane: number): boolean => {
  const b = s.slots[lane].beside!;
  return b.free ? s.at[lane] > s.at[b.box] : b.after;
};

/** Where a wire hooked round `box`'s north or south wall stands on that wall,
 *  by its lane `lane` (`beside`): at the end the lane is beside — `far` past
 *  every other place — and of several there, the nearer lane's wire nearer
 *  that end, so that they nest. Ascending along the wall. One rule for a
 *  container's ports, read by the ordering stage and by the inside alike. */
export function hookRank(s: Sheet, lane: number, far = 1e9): number {
  const d = Math.abs(s.at[lane] - s.at[s.slots[lane].beside!.box]);
  return hookAfter(s, lane) ? far - d : -far + d;
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
