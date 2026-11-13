// A handful of boxes, for the unit tests: a `Problem` in a line or two.
import type { Box, Group, Problem, Wire } from "../contract.js";

export const leaf = (id: string, w = 120, h = 64): Box => ({ id, w, h });
export const group = (boxes: Box[], over: Partial<Group> = {}): Group => ({
  dir: "down", pad: { top: 32, right: 32, bottom: 32, left: 32 }, gap: { lane: 48, rank: 56 }, boxes, pins: new Map(), ...over,
});
const FRAME = { top: 44, right: 16, bottom: 16, left: 16 };
/** A container with the padding of an expanded frame. */
export const frame = (id: string, boxes: Box[], over: Partial<Group> = {}, box: Partial<Box> = {}): Box =>
  ({ id, w: 0, h: 0, ...box, group: group(boxes, { pad: FRAME, ...over }) });
/** `"a>b"`, or `"a>b:60"` for a wire carrying a label 60 wide. */
export const wire = (s: string): Wire => {
  const [ends, label] = s.split(":"), [from, to] = ends.split(">");
  return { id: ends, from, to, ...(label ? { label: { w: +label, h: 18 } } : {}) };
};
export const problem = (boxes: Box[], wires: string[], over: Partial<Group> = {}): Problem => ({ root: group(boxes, over), wires: wires.map(wire) });
export const pin = (o: Record<string, number>) => ({ pins: new Map(Object.entries(o)) });
