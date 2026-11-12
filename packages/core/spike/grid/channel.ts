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
export interface Run { id: string; a: RunEnd; b: RunEnd }

const MARGIN = 8;
const pos = (e: RunEnd) => ("pos" in e ? e.pos : e.at === "start" ? -Infinity : Infinity);
const span = (r: Run) => ({ lo: Math.min(pos(r.a), pos(r.b)), hi: Math.max(pos(r.a), pos(r.b)) });
const stubs = (r: Run) => [r.a, r.b].filter((e): e is { at: "lo" | "hi"; pos: number } => "pos" in e);

/** What it costs to put `upper` on a track nearer the `lo` edge than `lower`:
 *  one per crossing it causes, and a great deal for two wires drawn on top of
 *  each other. */
function cost(upper: Run, lower: Run): number {
  const u = span(upper), l = span(lower);
  let c = 0;
  for (const s of stubs(upper)) {
    if (s.at !== "hi") continue; // runs down from upper's track, past lower's
    if (s.pos > l.lo && s.pos < l.hi) c += 1;
    if (stubs(lower).some((t) => t.at === "lo" && Math.abs(t.pos - s.pos) < MARGIN)) c += 1000;
  }
  for (const s of stubs(lower)) {
    if (s.at !== "lo") continue; // runs down to lower's track, past upper's
    if (s.pos > u.lo && s.pos < u.hi) c += 1;
  }
  return c;
}

/**
 * A track index for every run, 0 nearest the `lo` edge. Runs whose spans
 * overlap never share a track; among those, the order is the one with the
 * fewest crossings, ties going to the run given first.
 */
export function assignTracks(runs: readonly Run[]): Map<string, number> {
  const touching = (a: Run, b: Run) => {
    const p = span(a), q = span(b);
    return p.lo <= q.hi + MARGIN && q.lo <= p.hi + MARGIN;
  };
  // prefer[i][j] > 0: run i wants to be above run j
  const prefer = runs.map((a) => runs.map((b) => (a === b || !touching(a, b) ? 0 : cost(b, a) - cost(a, b))));

  const left = new Set(runs.map((_, i) => i));
  const order: number[] = [];
  while (left.size) {
    let best = -1, bestPull = Infinity;
    for (const i of left) {
      // how strongly the runs still waiting want to go above this one
      let pull = 0;
      for (const j of left) if (prefer[j][i] > 0) pull += prefer[j][i];
      if (pull < bestPull) { best = i; bestPull = pull; }
    }
    left.delete(best);
    order.push(best);
  }

  const track = new Map<string, number>();
  const placed: number[] = [];
  for (const i of order) {
    let t = 0;
    for (const j of placed) if (touching(runs[i], runs[j])) t = Math.max(t, track.get(runs[j].id)! + 1);
    track.set(runs[i].id, t);
    placed.push(i);
  }
  return track;
}
