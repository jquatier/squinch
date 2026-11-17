// Relationship marks written in another notation (SPEC §4).
//
// `from: 0..*`, `orders -> customers from many to one`, Mermaid's
// `orders }o--|| customers` and `route a -> b from: north` have no parse: a
// UML range has no token, a Mermaid operator opens or closes a brace, and the
// parser's recovery then reads the following lines into whatever it thinks it
// is in. Cleaning up after that was tried first — deleting the syntax errors
// near the line — and it could not reach the model errors the misparse caused
// further down (unknown ids, a `fields` block on an edge, a container closed
// early).
//
// So these are repaired *before* the parse. `repairMarks` returns a source of
// exactly the same length, in which each such spelling is replaced by
// something that parses and changes nothing else, plus one note per mistake
// carrying the corrected line. Offsets are unchanged, and the model reads
// text from the original source, so every location stays true and a foreign
// attribute value still reaches the model's own check as the author wrote it.
// A file with none of these spellings comes back identical.
import { EDGE_MARKS, MARKS_ONE } from "./types.js";
import type { EdgeMark } from "./types.js";

/** One attribute for both ends — what an agent writes instead of `from:`/`to:`. */
export const RELATION_KEYS = ["cardinality", "multiplicity", "relationship", "relation"];

/** The mark a foreign spelling most likely means: UML ranges, "or-more", and
 *  the words themselves. Never accepted — only used to write the fix. */
export function markWord(v: string): EdgeMark | undefined {
  const w = v.trim().toLowerCase();
  if ((EDGE_MARKS as readonly string[]).includes(w)) return w as EdgeMark;
  const known: Record<string, EdgeMark> = {
    "1": "one", "1..1": "exactly-one", "0..1": "zero-or-one",
    "*": "many", "n": "many", "m": "many", "0..*": "zero-or-many", "0..n": "zero-or-many", "0..m": "zero-or-many",
    "1..*": "one-or-many", "1..n": "one-or-many", "1..m": "one-or-many",
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

export interface MarkNote {
  from: number; to: number; message: string; fix: string;
  /** The line still holds an edge, now without the marks it asked for. */
  refused?: true;
}

const P = String.raw`[\w.]+(?:-[\w.]+)*`; // a path; a hyphen is always followed by a word character
const AR = String.raw`->|~>|<->|--`;
const MERMAID = new RegExp(String.raw`^(\s*)(${P})[ \t]*(\|\||\|o|\}o|\}\|)(--|\.\.)(\|\||o\||o\{|\|\{)[ \t]*(${P})(?:[ \t]*:[ \t]*(.*?))?[ \t]*$`, "d");
const UNBRACED = new RegExp(String.raw`^(\s*)(${P})[ \t]*(${AR})[ \t]*(${P}(?:[ \t]*,[ \t]*${P})*)([ \t]*"[^"]*")?((?:[ \t]+#[\w-]+)*)([ \t]+from[ \t]*:?[ \t]*([^\s:;#]+)[ \t]+to[ \t]*:?[ \t]*([^\s:;#]+))((?:[ \t]+#[\w-]+)*)[ \t]*$`, "d");
const ROUTE = new RegExp(String.raw`\broute[ \t]+${P}[ \t]*(?:${AR})[ \t]*${P}(?:[ \t]*"[^"]*")?((?:[ \t]+(?:from|to)[ \t]*:?[ \t]*\w+){1,2})`, "dg");
// A value is only ever replaced when it reads as a mark in another notation —
// a range, a star, a ratio. Anything else (`to: numeric(10,2)` in a fields
// block, `from: many;`) is the grammar's to judge, untouched.
const FOREIGN = /(?<![\w.-])(from|to|cardinality|multiplicity|relationship|relation)([ \t]*:[ \t]*)([^\s,;(){}<>[\]"#]+)/dg;
const FOREIGN_VALUE = /^(?:[\d*][\w.*:+-]*|[A-Za-z]+\.\.[\w*]+|[A-Za-z*]+:[\w*]+)$/;
const MER_L: Record<string, EdgeMark> = { "||": "exactly-one", "|o": "zero-or-one", "}o": "zero-or-many", "}|": "one-or-many" };
const MER_R: Record<string, EdgeMark> = { "||": "exactly-one", "o|": "zero-or-one", "o{": "zero-or-many", "|{": "one-or-many" };

export function repairMarks(src: string): { src: string; notes: MarkNote[] } {
  // cheap exit: nothing below can match a file with none of these
  if (!/\b(?:from|to|cardinality|multiplicity|relationship|relation)\b|[|}][|o](?:--|\.\.)/.test(src)) return { src, notes: [] };
  const notes: MarkNote[] = [];
  const out: string[] = [];
  let at = 0;
  for (const line of src.split("\n")) {
    const start = at;
    at += line.length + 1;
    // strings and the trailing comment, blanked in place: nothing in a label
    // or a comment is ever a statement
    let masked = line.replace(/"[^"]*"/g, (s) => `"${"_".repeat(s.length - 2)}"`);
    const c = masked.indexOf("//");
    if (c !== -1) masked = masked.slice(0, c) + " ".repeat(masked.length - c);
    // patches never overlap and never change a length; applied once, at the end
    const patches: [number, number, string][] = [];
    const put = (a: number, b: number, text: string) => { patches.push([a, b, text]); };
    const done = () => {
      if (!patches.length) return out.push(line);
      let fixed = "", k = 0;
      for (const [a, b, text] of patches.sort((x, y) => x[0] - y[0])) { fixed += line.slice(k, a) + text; k = b; }
      out.push(fixed + line.slice(k));
    };

    const mer = MERMAID.exec(masked);
    if (mer) {
      // Mermaid has no direction; the edge runs from the many side to the one
      // side, as a key column does
      const l = MER_L[mer[3]], r = MER_R[mer[5]];
      const lOne = MARKS_ONE.includes(l), rOne = MARKS_ONE.includes(r);
      const [la, lb] = mer.indices![7] ?? [0, 0];
      const text = line.slice(la, lb).replace(/"/g, "").replace(/\{\s*$/, "").trim();
      const label = text ? ` "${text}"` : "";
      const stmt = lOne === rOne ? `${mer[2]} -- ${mer[6]}${label} { from: ${l} to: ${r} }`
        : rOne ? `${mer[2]} -> ${mer[6]}${label} { from: ${l} to: ${r} }`
        : `${mer[6]} -> ${mer[2]}${label} { from: ${r} to: ${l} }`;
      notes.push({
        from: start + mer[1].length, to: start + line.trimEnd().length,
        message: `\`${mer[3]}${mer[4]}${mer[5]}\` is Mermaid — squinch marks a relationship with \`from:\` and \`to:\` on an edge`,
        fix: `write \`${stmt}\``,
      });
      put(mer[1].length, mer[1].length + 2, "//"); // the line is read as a comment
      done();
      continue;
    }

    const un = UNBRACED.exec(masked);
    if (un) {
      const [a, b] = un.indices![7]!;
      const [la, lb] = un.indices![5] ?? [0, 0];
      const from = markWord(un[8]) ?? un[8], to = markWord(un[9]) ?? un[9];
      notes.push({
        from: start + a + (un[7].length - un[7].trimStart().length), to: start + b,
        message: "relationship marks are attributes — they go in the edge's braces",
        fix: `write \`${un[2]} ${un[3]} ${un[4]}${line.slice(la, lb).trim() ? ` ${line.slice(la, lb).trim()}` : ""} { from: ${from} to: ${to} }${(un[6] + un[10]).replace(/\s+/g, " ")}\``,
        refused: true,
      });
      put(a, b, " ".repeat(b - a)); // the edge itself still parses
      done();
      continue;
    }

    for (const m of masked.matchAll(ROUTE)) {
      if (!m[1].includes(":")) continue;
      const [a, b] = m.indices![1]!;
      notes.push({
        from: start + m.index!, to: start + b,
        message: "`route` names its sides without a colon — `from:` and `to:` are an edge's relationship marks",
        fix: `write \`${line.slice(m.index!, b).replace(/[ \t]*:[ \t]*/g, " ")}\``,
      });
      put(a, b, line.slice(a, b).replace(/:/g, " "));
    }

    // an attribute value the grammar has no token for — `0..*`, `*`, `1:n` —
    // becomes a word of the same length; the model reads the original
    for (const m of masked.matchAll(FOREIGN)) {
      const v = m[3];
      if (!FOREIGN_VALUE.test(v) || /^\d+(?:\.\d+)?$/.test(v)) continue;
      const [a, b] = m.indices![3]!;
      put(a, b, "a".repeat(b - a));
    }
    done();
  }
  return { src: out.join("\n"), notes };
}
