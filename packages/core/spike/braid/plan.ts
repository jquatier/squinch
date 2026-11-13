// The plan: what there is to arrange, before anything is arranged.
//
// Every container becomes a *cell*: a stack of rows in its own frame, in
// which ranks always advance downward (a `right` container is the same cell,
// transposed on the way out — §5.8). The rows are its north wall, its ranks
// (with a row for labels in each gap that carries one — §5.6), and its south
// wall. A row holds *items*: boxes, and for every wire that passes the row a
// lane; on a wall row, the wire's port.
//
// Every wire becomes a run of *pieces*, each inside one cell:
//
//   seg    between an item of one row and an item of the next
//   turn   between two boxes of one rank with something between them: round,
//          under the row
//   glued  between two neighbours on one rank: straight across the gutter
//   side   from a box to the cell's east or west wall
//
// Which pieces a wire has depends only on the ranks and on which rank-mates
// are glued, both settled here — so the set of items never changes while the
// order is searched, and the search (order.ts) only ever permutes rows.
// What a `side` piece does on its way to the wall (straight out, over the
// row, or under it) *is* read off the order; it has no items of its own.

import type { Dir, Problem } from "../contract.js";
import { rankBoxes, type Edge } from "./rank.js";
import { grow, type Node, type Tree, type Walk } from "./tree.js";

export type Wall = "N" | "S" | "E" | "W";
export interface Pt { x: number; y: number }

export interface Item {
  uid: number;
  cell: Cell;
  row: number;
  /** Index in its row, kept current by `reindex`. */
  pos: number;
  kind: "box" | "lane" | "label" | "port";
  node?: Node;
  /** A box that is a container: its inside. */
  inner?: Cell;
  /** Lanes, labels and ports: the thread they belong to. */
  key?: string;
  /** The wire whose label this item carries, and the label's size in the cell's frame. */
  labelOf?: string;
  // ── what the author said about a box's place ──
  held: boolean;
  band: number;
  idle: boolean;
  /** Its place among the boxes of its rank, as declared. */
  declared: number;
  /** The rank-mates it is glued to, in order, itself included. */
  chain?: Item[];
  /** Threads with a piece ending on this box. */
  keys: Set<string>;
  /** How many segs end on its north and south walls: what a wire passing it sideways would cross. */
  above: number; below: number;
  /** The segs that end on it. */
  touch: Seg[];
  // ── size in the cell's frame; a container's is set when its inside is laid out ──
  w: number; h: number;
  /** A guess at `w` and at its centre (from the middle of its cell), good
   *  enough to judge straightness before anything is placed (estimate.ts). */
  ew: number; ex: number;
  // ── geometry, set by lay.ts: centre along the row, top edge ──
  x: number; y: number;
}

export interface End { item: Item; wall: Wall }
interface PieceBase {
  uid: number; cell: Cell; key: string;
  /** Runs against the flow: it follows its boxes and never leads them (§5.5). */
  back: boolean;
  /** Drawn: in the cell's frame, in the piece's own direction. */
  pts: Pt[];
}
export interface Seg extends PieceBase { kind: "seg"; upper: End; lower: End; ch: number }
export interface Turn extends PieceBase { kind: "turn"; a: End; b: End; row: number; label?: { wire: string; w: number; h: number; at?: Pt } }
export interface Glued extends PieceBase { kind: "glued"; a: End; b: End; row: number; label?: { wire: string; w: number; h: number; at?: Pt } }
export interface Side extends PieceBase { kind: "side"; from: Item; wall: "E" | "W"; row: number; /** How it was drawn (lay.ts). */ mode?: "direct" | "over" | "under" }
export type Piece = Seg | Turn | Glued | Side;

export interface Row { kind: "wall" | "rank" | "label"; rank: number; items: Item[] }

export interface Cell {
  node: Node;
  id: string;
  /** Its frame is the picture's, transposed. */
  flip: boolean;
  parent?: Cell;
  /** The box it is in its parent's row. */
  item?: Item;
  depth: number;
  pad: { top: number; right: number; bottom: number; left: number };
  gap: { lane: number; rank: number };
  /** The corner its title occupies, in its own frame. */
  title?: { w: number; h: number };
  minW: number; minH: number;
  rows: Row[];
  rankRow: number[];
  ranks: Map<string, number>;
  boxes: Map<string, Item>;
  free: Map<string, Item>;
  pieces: Piece[];
  segs: Seg[][];           // by channel
  turns: Turn[]; glues: Glued[]; sides: Side[];
  /** `aligned` and `columns`, as items. */
  aligned: Item[][];
  bands: number;
  // ── set by lay.ts ──
  w: number; h: number;
  ew: number; eh: number;
  portAt: Map<string, number>; // `${wall}|${key}` → distance along that wall
}

export interface Thread { key: string; items: Item[]; pieces: Piece[] }
export interface Plan {
  tree: Tree;
  root: Cell;
  /** Every cell, each before the cell that holds it. */
  cells: Cell[];
  cellOf: Map<string, Cell>;
  threads: Map<string, Thread>;
  /** Each drawn wire as its pieces from `from` to `to`; `fwd` is false where the wire runs a piece backwards. */
  routes: Map<string, { piece: Piece; fwd: boolean }[]>;
  labels: Map<string, { item?: Item; piece?: Turn | Glued; w: number; h: number }>;
}

const swap: Record<Wall, Wall> = { N: "W", W: "N", S: "E", E: "S" };
/** A wall of a child, named in its parent's frame, as the child's own frame names it. */
export const wallIn = (child: Cell, parent: Cell, wall: Wall): Wall => (child.flip === parent.flip ? wall : swap[wall]);

export function reindex(row: Row): void {
  for (let i = 0; i < row.items.length; i++) row.items[i].pos = i;
}

export function plan(problem: Problem): Plan {
  const tree = grow(problem);
  let uid = 0;
  const cells: Cell[] = [], cellOf = new Map<string, Cell>();
  const threads = new Map<string, Thread>();
  const thread = (key: string) => threads.get(key) ?? threads.set(key, { key, items: [], pieces: [] }).get(key)!;

  // ── bundles: which end the members share ───────────────────────────────────
  const bundles = new Map<string, Walk[]>();
  for (const w of tree.walks) if (w.wire.bundle) (bundles.get(w.wire.bundle) ?? bundles.set(w.wire.bundle, []).get(w.wire.bundle)!).push(w);
  const sharedEnd = new Map<string, "from" | "to">();
  for (const [id, ws] of bundles) {
    if (ws.length < 2) continue;
    if (ws.every((w) => w.wire.from === ws[0].wire.from)) sharedEnd.set(id, "from");
    else if (ws.every((w) => w.wire.to === ws[0].wire.to)) sharedEnd.set(id, "to");
  }
  const bundled = (w: Walk) => (w.wire.bundle && sharedEnd.has(w.wire.bundle) ? w.wire.bundle : undefined);
  const keyOf = (w: Walk) => (bundled(w) ? `b:${bundled(w)}` : `w:${w.wire.id}`);

  // ── cells, ranked ──────────────────────────────────────────────────────────
  const homeWalks = new Map<Node, Walk[]>();
  for (const w of tree.walks) (homeWalks.get(w.home) ?? homeWalks.set(w.home, []).get(w.home)!).push(w);
  const make = (node: Node, parent?: Cell): Cell => {
    const g = node.group!, flip = g.dir === ("right" satisfies Dir);
    const p = g.pad, t = node.box?.title, minW = node.box?.minW ?? 0;
    const edges: Edge[] = (homeWalks.get(node) ?? []).map((w) => [w.up[w.up.length - 1].id, w.down[w.down.length - 1].id]);
    const cell: Cell = {
      node, id: node.id, flip, parent, depth: parent ? parent.depth + 1 : 0,
      pad: flip ? { top: p.left, left: p.top, bottom: p.right, right: p.bottom } : { ...p },
      gap: g.gap,
      title: t ? (flip ? { w: t.h, h: t.w } : { w: t.w, h: t.h }) : undefined,
      minW: flip ? 0 : minW, minH: flip ? minW : 0,
      rows: [], rankRow: [], ranks: rankBoxes(g.boxes.map((b) => b.id), edges, g.pins),
      boxes: new Map(), free: new Map(), pieces: [], segs: [], turns: [], glues: [], sides: [], aligned: [], bands: 0,
      w: 0, h: 0, ew: 0, eh: 0, portAt: new Map(),
    };
    cellOf.set(node.id, cell);
    for (const kid of node.kids) if (kid.group) make(kid, cell);
    cells.push(cell);
    return cell;
  };
  const root = make(tree.root);

  // ── where each label goes (§5.6): half-way along its wire, in the home ─────
  // an odd number of gaps: the middle gap; an even number: the middle rank.
  // A bundled wire's label rides its own last stub instead, next to its own end.
  type Slot = { gap: number } | { rank: number } | "flat";
  const slotOf = new Map<Walk, Slot>();
  for (const w of tree.walks) {
    if (!w.wire.label) continue;
    const home = cellOf.get(w.home.id)!;
    const ra = home.ranks.get(w.up[w.up.length - 1].id)!, rb = home.ranks.get(w.down[w.down.length - 1].id)!;
    const lo = Math.min(ra, rb), span = Math.abs(ra - rb);
    if (!span) slotOf.set(w, "flat");
    else if (bundled(w)) {
      const own = sharedEnd.get(bundled(w)!) === "from" ? rb : ra, other = own === rb ? ra : rb;
      slotOf.set(w, { gap: own > other ? own - 1 : own });
    } else slotOf.set(w, span % 2 ? { gap: lo + (span - 1) / 2 } : { rank: lo + span / 2 });
  }

  // ── rows and boxes ─────────────────────────────────────────────────────────
  const blank = (cell: Cell, row: number, kind: Item["kind"]): Item => ({
    uid: uid++, cell, row, pos: 0, kind, held: false, band: -1, idle: false, declared: 0,
    keys: new Set(), above: 0, below: 0, touch: [], w: 0, h: 0, ew: 0, ex: 0, x: 0, y: 0,
  });
  for (const cell of cells) {
    const g = cell.node.group!;
    const count = Math.max(-1, ...cell.ranks.values()) + 1;
    const labelled = new Set<number>();
    for (const w of homeWalks.get(cell.node) ?? []) { const s = slotOf.get(w); if (s && s !== "flat" && "gap" in s) labelled.add(s.gap); }
    cell.rows.push({ kind: "wall", rank: -1, items: [] });
    for (let r = 0; r < count; r++) {
      cell.rankRow[r] = cell.rows.length;
      cell.rows.push({ kind: "rank", rank: r, items: [] });
      if (labelled.has(r) && r + 1 < count) cell.rows.push({ kind: "label", rank: r, items: [] });
    }
    cell.rows.push({ kind: "wall", rank: count, items: [] });
    cell.segs = cell.rows.map(() => []);

    const held = new Set(g.held ?? []);
    const band = new Map<string, number>();
    g.columns?.forEach((ids, i) => ids.forEach((id) => band.set(id, i)));
    cell.bands = g.columns?.length ?? 0;
    for (const kid of cell.node.kids) {
      const row = cell.rankRow[cell.ranks.get(kid.id)!];
      const it = blank(cell, row, "box");
      it.node = kid; it.inner = cellOf.get(kid.id);
      if (it.inner) it.inner.item = it;
      it.held = held.has(kid.id); it.band = band.get(kid.id) ?? -1;
      it.idle = !tree.wired.has(kid) && !it.held;
      const b = kid.box!;
      if (!it.inner) { it.w = cell.flip ? b.h : b.w; it.h = cell.flip ? b.w : b.h; }
      cell.boxes.set(kid.id, it);
      cell.rows[row].items.push(it);
    }
    // §5.2: a box no wire touches stands after its row-mates that have one
    for (const row of cell.rows) row.items = [...row.items.filter((i) => !i.idle), ...row.items.filter((i) => i.idle)];
    cell.aligned = (g.aligned ?? []).map((set) => set.map((id) => cell.boxes.get(id)).filter((i): i is Item => !!i));
  }

  // ── glue (§5.3): rank-mates a wire joins directly stand side by side ───────
  // Taken in declaration order. A box the author did not place may step next
  // to its partner; one the author placed stays, so two placed boxes are
  // glued only if nothing placed stands between them. Each box has two sides,
  // so a third partner goes round under the row instead.
  const link = new Set<string>();
  const linked = (a: Item, b: Item) => link.has(`${a.uid}|${b.uid}`) || link.has(`${b.uid}|${a.uid}`);
  for (const cell of cells)
    for (const w of homeWalks.get(cell.node) ?? []) {
      const a = cell.boxes.get(w.up[w.up.length - 1].id)!, b = cell.boxes.get(w.down[w.down.length - 1].id)!;
      if (a.row !== b.row || linked(a, b)) continue;
      const items = cell.rows[a.row].items;
      const free = (x: Item, dir: -1 | 1) => { const n = items[items.indexOf(x) + dir]; return !n || !linked(x, n); };
      const fixed = (x: Item) => x.held || x.band >= 0 || items.some((o) => linked(x, o));
      const bring = (mover: Item, to: Item): boolean => {
        if (fixed(mover)) return false;
        const side = items.indexOf(mover) < items.indexOf(to) ? -1 : 1;
        for (const dir of [side, -side] as (-1 | 1)[]) {
          if (!free(to, dir)) continue;
          items.splice(items.indexOf(mover), 1);
          items.splice(items.indexOf(to) + (dir > 0 ? 1 : 0), 0, mover);
          return true;
        }
        return false;
      };
      const beside = () => Math.abs(items.indexOf(a) - items.indexOf(b)) === 1;
      if (beside() || bring(b, a) || bring(a, b)) link.add(`${a.uid}|${b.uid}`);
    }
  for (const cell of cells)
    for (const row of cell.rows) {
      // idle boxes last again, in case glue moved one (it cannot: idle boxes have no wire)
      row.items.forEach((it, i) => { it.declared = i; });
      reindex(row);
      for (let i = 0; i < row.items.length; ) {
        let j = i;
        while (j + 1 < row.items.length && linked(row.items[j], row.items[j + 1])) j++;
        if (j > i) { const chain = row.items.slice(i, j + 1); for (const it of chain) it.chain = chain; }
        i = j + 1;
      }
    }

  // ── pieces ─────────────────────────────────────────────────────────────────
  const lane = (cell: Cell, row: number, key: string, kind: Item["kind"]): Item => {
    const id = `${row}|${key}`;
    let it = cell.free.get(id);
    if (!it) {
      it = blank(cell, row, kind);
      it.key = key;
      cell.free.set(id, it);
      thread(key).items.push(it);
    }
    return it;
  };
  const made = new Map<string, Piece>();
  const once = <P extends Piece>(id: string, build: () => Omit<P, "uid" | "pts">): P => {
    let p = made.get(id) as P | undefined;
    if (!p) {
      p = { ...build(), uid: uid++, pts: [] } as unknown as P;
      made.set(id, p);
      p.cell.pieces.push(p);
      thread(p.key).pieces.push(p);
      if (p.kind === "turn") p.cell.turns.push(p);
      if (p.kind === "glued") p.cell.glues.push(p);
      if (p.kind === "side") p.cell.sides.push(p);
    }
    return p;
  };
  const seg = (cell: Cell, key: string, upper: End, lower: End, back: boolean): Seg => {
    const p = once<Seg>(`seg|${key}|${upper.item.uid}${upper.wall}|${lower.item.uid}${lower.wall}`, () => ({ kind: "seg", cell, key, upper, lower, ch: upper.item.row, back }));
    if (!cell.segs[p.ch].includes(p)) {
      cell.segs[p.ch].push(p);
      upper.item.below++; lower.item.above++;
      upper.item.touch.push(p); lower.item.touch.push(p);
      upper.item.keys.add(key); lower.item.keys.add(key);
    }
    return p;
  };

  const routes: Plan["routes"] = new Map();
  const labels: Plan["labels"] = new Map();
  type Step = { piece: Piece; inward: boolean };
  /** The pieces that carry a wire from a wall of the home's child down to its end, outermost first. */
  const descend = (chain: Node[], home: Cell, wallAtTop: Wall, key: string, back: boolean): Step[] => {
    const out: Step[] = [];
    let outer = home, wall = wallAtTop;
    for (let i = chain.length - 1; i >= 1; i--) {
      const cell = cellOf.get(chain[i].id)!;
      const w = wallIn(cell, outer, wall);
      const y = cell.boxes.get(chain[i - 1].id)!;
      const last = cell.rows.length - 1;
      if (w === "N") {
        let prev: End = { item: lane(cell, 0, key, "port"), wall: "S" };
        for (let r = 1; r < y.row; r++) {
          const l = lane(cell, r, key, "lane");
          out.push({ piece: seg(cell, key, prev, { item: l, wall: "N" }, back), inward: true });
          prev = { item: l, wall: "S" };
        }
        out.push({ piece: seg(cell, key, prev, { item: y, wall: "N" }, back), inward: true });
      } else if (w === "S") {
        const steps: Step[] = [];
        let prev: End = { item: y, wall: "S" };
        for (let r = y.row + 1; r < last; r++) {
          const l = lane(cell, r, key, "lane");
          steps.push({ piece: seg(cell, key, prev, { item: l, wall: "N" }, back), inward: false });
          prev = { item: l, wall: "S" };
        }
        steps.push({ piece: seg(cell, key, prev, { item: lane(cell, last, key, "port"), wall: "N" }, back), inward: false });
        out.push(...steps.reverse());
      } else {
        y.keys.add(key);
        out.push({ piece: once<Side>(`side|${key}|${y.uid}|${w}`, () => ({ kind: "side", cell, key, from: y, wall: w, row: y.row, back })), inward: false });
      }
      outer = cell; wall = w;
    }
    return out;
  };

  for (const w of tree.walks) {
    const home = cellOf.get(w.home.id)!, key = keyOf(w);
    const a = home.boxes.get(w.up[w.up.length - 1].id)!, b = home.boxes.get(w.down[w.down.length - 1].id)!;
    const slot = slotOf.get(w), label = w.wire.label;
    const size = label ? (home.flip ? { w: label.h, h: label.w } : { w: label.w, h: label.h }) : undefined;
    const mid: { piece: Piece; fwd: boolean }[] = [];
    let wa: Wall, wb: Wall;
    const back = a.row > b.row;
    if (a.row !== b.row) {
      const [top, bot] = back ? [b, a] : [a, b];
      let prev: End = { item: top, wall: "S" };
      for (let r = top.row + 1; r < bot.row; r++) {
        const row = home.rows[r];
        const mine = !!slot && slot !== "flat" && ("gap" in slot ? row.kind === "label" && row.rank === slot.gap : row.kind === "rank" && row.rank === slot.rank);
        // a bundled wire's label is on its own stub, so in that row it has an item to itself
        const it = lane(home, r, mine && bundled(w) ? `w:${w.wire.id}` : key, mine ? "label" : "lane");
        if (mine) { it.kind = "label"; it.labelOf = w.wire.id; it.w = size!.w; it.h = size!.h; labels.set(w.wire.id, { item: it, ...size! }); }
        mid.push({ piece: seg(home, key, prev, { item: it, wall: "N" }, back), fwd: !back });
        prev = { item: it, wall: "S" };
      }
      mid.push({ piece: seg(home, key, prev, { item: bot, wall: "N" }, back), fwd: !back });
      if (back) mid.reverse();
      wa = back ? "N" : "S"; wb = back ? "S" : "N";
    } else if (linked(a, b)) {
      const [l, r] = a.pos < b.pos ? [a, b] : [b, a];
      const p = once<Glued>(`glued|${key}|${l.uid}|${r.uid}`, () => ({ kind: "glued", cell: home, key, a: { item: l, wall: "E" }, b: { item: r, wall: "W" }, row: a.row, back: false }));
      if (size && !p.label) { p.label = { wire: w.wire.id, ...size }; labels.set(w.wire.id, { piece: p, ...size }); }
      l.keys.add(key); r.keys.add(key);
      mid.push({ piece: p, fwd: l === a });
      wa = l === a ? "E" : "W"; wb = l === a ? "W" : "E";
    } else {
      const p = once<Turn>(`turn|${key}|${a.uid}|${b.uid}`, () => ({ kind: "turn", cell: home, key, a: { item: a, wall: "S" }, b: { item: b, wall: "S" }, row: a.row, back: false }));
      if (size && !p.label) { p.label = { wire: w.wire.id, ...size }; labels.set(w.wire.id, { piece: p, ...size }); }
      a.keys.add(key); b.keys.add(key);
      mid.push({ piece: p, fwd: true });
      wa = "S"; wb = "S";
    }
    const pre = descend(w.up, home, wa, key, back).reverse().map((s) => ({ piece: s.piece, fwd: !s.inward }));
    const post = descend(w.down, home, wb, key, back).map((s) => ({ piece: s.piece, fwd: s.inward }));
    routes.set(w.wire.id, [...pre, ...mid, ...post]);
  }

  // ── a first guess at sizes, for judging straightness before placement ──────
  for (const cell of cells) {
    let wide = 0, tall = cell.pad.top + cell.pad.bottom;
    for (const row of cell.rows) {
      let w = 0, h = 0;
      for (const it of row.items) {
        if (it.inner) { it.ew = it.inner.flip === cell.flip ? it.inner.ew : it.inner.eh; h = Math.max(h, it.inner.flip === cell.flip ? it.inner.eh : it.inner.ew); }
        else { it.ew = it.kind === "box" || it.kind === "label" ? it.w : 0; h = Math.max(h, it.h); }
        w += it.ew + (it.kind === "box" ? cell.gap.lane : 16);
      }
      wide = Math.max(wide, w);
      if (row.kind !== "wall") tall += h + cell.gap.rank;
    }
    cell.ew = Math.max(cell.minW, wide + cell.pad.left + cell.pad.right);
    cell.eh = Math.max(cell.minH, tall);
  }

  return { tree, root, cells, cellOf, threads, routes, labels };
}
