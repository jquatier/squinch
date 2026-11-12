// A channel is the empty strip between two ranks (or two neighbours on one
// rank — the same thing turned ninety degrees). Every wire that changes lane
// does it here, on a track of its own.
//
// This is the engine's only routing primitive. A cross-rank dog-leg, a
// same-rank wire going round a blocker, a wire leaving through a container's
// side wall: each is a `Run` between two points on the channel's edges, and
// the only question is which track it takes.

/** Where a run meets the channel: on its near (`lo`) or far (`hi`) edge at a
 *  lane position, or out through one end of the strip. */
export type RunEnd = { at: "lo" | "hi"; pos: number } | { at: "start" | "end" };
export interface Run {
  id: string; a: RunEnd; b: RunEnd;
  /** Runs of one net are one wire drawn as a trunk with branches: they share
   *  a track and may lie on top of each other. */
  net?: string;
}

const MARGIN = 8;
const pos = (e: RunEnd) => ("pos" in e ? e.pos : e.at === "start" ? -Infinity : Infinity);
type Stub = { at: "lo" | "hi"; pos: number };
/** One track's worth of wire: a run, or every run of a net. */
interface Trunk { ids: string[]; lo: number; hi: number; stubs: Stub[] }

function trunks(runs: readonly Run[]): Trunk[] {
  const byNet = new Map<string, Trunk>();
  const out: Trunk[] = [];
  for (const r of runs) {
    const ends = [r.a, r.b];
    let t = r.net !== undefined ? byNet.get(r.net) : undefined;
    if (!t) {
      t = { ids: [], lo: Infinity, hi: -Infinity, stubs: [] };
      out.push(t);
      if (r.net !== undefined) byNet.set(r.net, t);
    }
    t.ids.push(r.id);
    t.lo = Math.min(t.lo, ...ends.map(pos));
    t.hi = Math.max(t.hi, ...ends.map(pos));
    for (const e of ends) if ("pos" in e && !t.stubs.some((s) => s.at === e.at && s.pos === e.pos)) t.stubs.push(e);
  }
  return out;
}

/** What it costs to put `upper` on a track nearer the `lo` edge than `lower`:
 *  one per crossing it causes, and a great deal for two wires drawn on top of
 *  each other. */
function cost(upper: Trunk, lower: Trunk): number {
  let c = 0;
  for (const s of upper.stubs) {
    if (s.at !== "hi") continue; // runs down from upper's track, past lower's
    if (s.pos > lower.lo && s.pos < lower.hi) c += 1;
    if (lower.stubs.some((t) => t.at === "lo" && Math.abs(t.pos - s.pos) < MARGIN)) c += 1000;
  }
  for (const s of lower.stubs) {
    if (s.at !== "lo") continue; // runs down to lower's track, past upper's
    if (s.pos > upper.lo && s.pos < upper.hi) c += 1;
  }
  return c;
}

/**
 * A track index for every run, 0 nearest the `lo` edge. Runs whose spans
 * overlap never share a track unless they are one net; among those, the order
 * is the one with the fewest crossings, ties going to the run given first.
 */
export function assignTracks(runs: readonly Run[]): Map<string, number> {
  const ts = trunks(runs);
  const touching = (a: Trunk, b: Trunk) => a.lo <= b.hi + MARGIN && b.lo <= a.hi + MARGIN;
  // prefer[i][j] > 0: trunk i wants to be above trunk j
  const prefer = ts.map((a) => ts.map((b) => (a === b || !touching(a, b) ? 0 : cost(b, a) - cost(a, b))));

  const left = new Set(ts.map((_, i) => i));
  const order: number[] = [];
  while (left.size) {
    let best = -1, bestPull = Infinity;
    for (const i of left) {
      // how strongly the trunks still waiting want to go above this one
      let pull = 0;
      for (const j of left) if (prefer[j][i] > 0) pull += prefer[j][i];
      if (pull < bestPull) { best = i; bestPull = pull; }
    }
    left.delete(best);
    order.push(best);
  }

  const at = new Map<number, number>();
  for (const i of order) {
    let t = 0;
    for (const [j, tj] of at) if (touching(ts[i], ts[j])) t = Math.max(t, tj + 1);
    at.set(i, t);
  }
  return new Map(ts.flatMap((t, i) => t.ids.map((id) => [id, at.get(i)!] as const)));
}
