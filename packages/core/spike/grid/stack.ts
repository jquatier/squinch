// Stack: where the layers sit along the flow, and how deep each channel
// between them has to be for the wires that turn in it.

import { assignTracks, type Run } from "./channel.js";
import type { Ports } from "./ports.js";
import type { Sheet } from "./sheet.js";
import { CORNER, LABEL_PAD, STUB, TRACK } from "./types.js";

export interface Channel { f: number; depth: number; trackF: Map<string, number> }
export interface Stacked {
  /** Channel i lies after layer i; channel -1 before the first layer. */
  channels: Map<number, Channel>;
  /** The container's size along the lane and along the flow. */
  L: number; F: number;
}

export function stack(sh: Sheet, ports: Ports, minW: number, title?: { w: number; h: number }): Stacked {
  const { ax, g, layers, chains, links } = sh;

  // ── every run that turns, by channel ──────────────────────────────────────
  const runs = new Map<number, Run[]>();
  const thick = new Map<string, number>(); // run id → room its label needs across the track
  const runsIn = (i: number) => runs.get(i) ?? runs.set(i, []).get(i)!;
  for (const c of chains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const a = ports.lane(c.path[i], c.wire, "end"), b = ports.lane(c.path[i + 1], c.wire, "start");
      if (a !== b) runsIn(c.first + i).push({ id: `${c.wire.id}@${i}`, a: { at: "lo", pos: a }, b: { at: "hi", pos: b }, net: c.wire.bundle });
    }
  for (const l of links) {
    if (l.type === "around") {
      const a = sh.slotOf(l.a), b = sh.slotOf(l.b);
      runsIn(sh.layerOf(a)).push({ id: l.wire.id, a: { at: "lo", pos: ports.lane(a, l.wire, "end") }, b: { at: "lo", pos: ports.lane(b, l.wire, "end") } });
      if (l.wire.label) thick.set(l.wire.id, ax.labelF(l.wire));
    } else if (l.type === "side" && !sh.outermost(l.box, l.wall)) {
      const s = sh.slotOf(l.box), li = sh.layerOf(s);
      const out = { at: l.wall === "low" ? "start" : "end" } as const;
      if (l.outward) runsIn(li).push({ id: l.wire.id, a: { at: "lo", pos: ports.lane(s, l.wire, "end") }, b: out });
      else runsIn(li - 1).push({ id: l.wire.id, a: out, b: { at: "hi", pos: ports.lane(s, l.wire, "start") } });
    }
  }

  // ── flow positions ────────────────────────────────────────────────────────
  const channels = new Map<number, Channel>();
  const halfLabelGap = Math.max(LABEL_PAD, Math.round((g.gap.rank - 18) / 2));
  /** Open channel `i` at `f`, at least `least` deep, its first track at least
   *  `below` in; returns where it ends. */
  const open = (i: number, f: number, least: number, below = 0): number => {
    const here = runs.get(i) ?? [];
    const track = assignTracks(here);
    const count = Math.max(0, ...[...track.values()].map((t) => t + 1));
    // a track carrying a label is as thick as the label, plus a little air
    const half = Array.from({ length: count }, (_, t) =>
      Math.max(0, ...here.filter((r) => track.get(r.id) === t).map((r) => (thick.has(r.id) ? thick.get(r.id)! / 2 + 4 : 0))));
    const centre: number[] = [];
    half.forEach((h, t) => centre.push(t ? centre[t - 1] + half[t - 1] + TRACK + h : h));
    const used = count ? centre[count - 1] + half[count - 1] : 0;
    const depth = Math.ceil(Math.max(least, count ? Math.max(STUB, below) + used + STUB : 0));
    const first = f + Math.max(Math.round((depth - used) / 2), count ? below : 0);
    channels.set(i, { f, depth, trackF: new Map(here.map((r) => [r.id, first + Math.round(centre[track.get(r.id)!])])) });
    return f + depth;
  };
  let f = 0;
  if (layers[0]?.kind !== "wall") {
    f = ax.pad.start;
    if (runs.has(-1)) f = open(-1, f, 0);
  }
  layers.forEach((layer, i) => {
    layer.f = f;
    layer.depth = layer.kind === "rank"
      ? Math.max(0, ...layer.slots.map((s) => sh.inset(s) + s.fsize + (ax.down ? s.box?.bleed ?? 0 : 0)))
      : Math.max(0, ...layer.slots.map((s) => s.fsize));
    f += layer.depth;
    const next = layers[i + 1];
    if (!next) {
      if (layer.kind !== "wall") {
        if (runs.has(i)) f = open(i, f, 0) + 8;
        f += ax.pad.end;
      }
      return;
    }
    const least = layer.kind === "wall" ? ax.pad.start : next.kind === "wall" ? ax.pad.end
      : layer.kind === "label" || next.kind === "label" ? halfLabelGap : g.gap.rank;
    // a wire turning just inside the start wall turns below the title
    f = open(i, f, least, layer.kind === "wall" && i === 0 && title && ax.down ? title.h + CORNER : 0);
  });

  // ── the container's own size ──────────────────────────────────────────────
  const all = layers.flatMap((l) => l.slots);
  let L = Math.max(ax.pad.low, ...all.map((s) => s.pos + s.lsize + s.after)) + ax.pad.high;
  let F = f;
  // a container is at least as wide as its title
  if (ax.down) L = Math.max(L, minW);
  else if (layers[layers.length - 1]?.kind !== "wall") F = Math.max(F, minW);
  return { channels, L, F };
}
