// Relationship marks in another spelling (SPEC §4): what a wrong word or a
// single `cardinality:` attribute most likely meant, so the error can write
// the corrected line. Nothing here is accepted as syntax.
import { EDGE_MARKS } from "./types.js";
import type { EdgeMark } from "./types.js";

/** One attribute for both ends — what an agent writes instead of `from:`/`to:`. */
export const RELATION_KEYS = ["cardinality", "multiplicity", "relationship", "relation"];

/** The mark another spelling most likely means: "or-more", a bare `1` or
 *  `n`, and the words themselves. Never accepted — only used to write the fix. */
export function markWord(v: string): EdgeMark | undefined {
  const w = v.trim().toLowerCase();
  if ((EDGE_MARKS as readonly string[]).includes(w)) return w as EdgeMark;
  const known: Record<string, EdgeMark> = {
    "1": "one", "n": "many", "m": "many",
    "zero-or-more": "zero-or-many", "one-or-more": "one-or-many",
    "only-one": "exactly-one", "one-and-only-one": "exactly-one", "optional": "zero-or-one",
  };
  return known[w];
}

/** `many-to-one`, `1:n`, `N-1` — the two ends a single attribute meant. */
export function relationEnds(raw: string): [EdgeMark, EdgeMark] | undefined {
  // `one_to_many`, `OneToMany`, `many to one` are the same thing as `one-to-many`
  const v = raw.replace(/([a-z])To([A-Z])/g, "$1-to-$2").replace(/[_ ]to[_ ]/gi, "-to-");
  for (const sep of ["-to-", ":", "-"]) {
    const at = v.indexOf(sep);
    if (at <= 0) continue;
    const a = markWord(v.slice(0, at)), b = markWord(v.slice(at + sep.length));
    if (a && b) return [a, b];
  }
  return undefined;
}
