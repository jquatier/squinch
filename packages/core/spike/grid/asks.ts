// Arrangements, as checks on a picture: what "side by side" or "in a column"
// means in rectangles. Shared by the placement suites.
import type { Positioned } from "../../src/layout/layout.js";

type R = { x: number; y: number; w: number; h: number };
/** The rectangle of a zone (by id), an expanded container or a node (by path). */
export const rectOf = (p: Positioned, id: string): R | undefined =>
  p.zones.find((z) => z.id === id) ?? p.frames.find((f) => f.path === id) ?? p.nodes.find((n) => n.path === id);

/** What the author asked for, as a check on the picture. */
export type Ask = { say: string; holds(p: Positioned): boolean; /** tidiness rather than arrangement */ polish?: boolean };
const all = (p: Positioned, ids: string[]) => ids.map((id) => rectOf(p, id));
const pairs = <T,>(xs: T[]) => xs.slice(1).map((b, i) => [xs[i], b] as const);
/** Left to right, sharing some height: a row. */
export const row = (...ids: string[]): Ask => ({
  say: `${ids.join(" | ")} in a row`,
  holds: (p) => pairs(all(p, ids)).every(([a, b]) => !!a && !!b && a.x + a.w <= b.x && a.y < b.y + b.h && b.y < a.y + a.h),
});
/** Entirely to the left, whatever the heights: a column before a column. */
export const leftOf = (a: string, b: string): Ask => ({
  say: `${a} left of ${b}`,
  holds: (p) => { const [x, y] = all(p, [a, b]); return !!x && !!y && x.x + x.w <= y.x; },
});
/** Top to bottom, nothing overlapping: a stack. */
export const stack = (...ids: string[]): Ask => ({
  say: `${ids.join(" / ")} stacked`,
  holds: (p) => pairs(all(p, ids)).every(([a, b]) => !!a && !!b && a.y + a.h <= b.y),
});
/** Tops on one line — a row that also looks like one. */
export const level = (...ids: string[]): Ask => ({
  polish: true,
  say: `${ids.join(", ")} level`,
  holds: (p) => pairs(all(p, ids)).every(([a, b]) => !!a && !!b && Math.abs(a.y - b.y) <= 2),
});

export const sys = (id: string, label: string, leaves: string[], edges: string[] = []) =>
  `system ${id} "${label}" {\n${leaves.map((l) => `  ${l} = box "${l}"`).join("\n")}\n${edges.map((e) => `  ${e}`).join("\n")}\n}\n`;
export const zone = (id: string, label: string, kind: string, ...members: string[]) => `zone ${id} "${label}" ${kind} { contains ${members.join(", ")} }\n`;
export const view = (body: string) => `view v { include *\n${body}\n}\n`;

/** Top to bottom in one column: stacked, and sharing some width. */
export const column = (...ids: string[]): Ask => ({
  say: `${ids.join(" / ")} in a column`,
  holds: (p) => pairs(all(p, ids)).every(([a, b]) => !!a && !!b && a.y + a.h <= b.y && a.x < b.x + b.w && b.x < a.x + a.w),
});
/** Left edges on one line — a column that also looks like one. */
export const flush = (...ids: string[]): Ask => ({
  polish: true,
  say: `${ids.join(", ")} flush left`,
  holds: (p) => pairs(all(p, ids)).every(([a, b]) => !!a && !!b && Math.abs(a.x - b.x) <= 2),
});
