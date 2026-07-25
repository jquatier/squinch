// Deterministically rough: a seeded rough.js generator for the sketch themes.
// The seed derives from hash(source) (CLAUDE.md non-negotiable) plus a
// per-shape counter — render order is deterministic, so every wobble is too,
// and the lockfile model holds. No DOM: we use the generator API and emit
// path data ourselves.
import roughModule from "roughjs";

// roughjs's type surface hides the generator factory behind the default
// export's runtime shape; the cast is contained here.
const rough = roughModule as unknown as {
  generator(): {
    rectangle(x: number, y: number, w: number, h: number, o: object): unknown;
    path(d: string, o: object): unknown;
    toPaths(d: unknown): { d: string }[];
  };
};

export interface Sketcher {
  /** Hand-drawn rectangle outline (stroke only — pair it with a crisp fill). */
  rect(x: number, y: number, w: number, h: number, opts?: { roughness?: number; multi?: boolean }): string;
  /** Hand-drawn version of an arbitrary path (edges). Single-stroke. */
  path(d: string, opts?: { roughness?: number }): string;
}

// keep the output compact and stable: rough emits long floats
const round2 = (d: string) => d.replace(/-?\d+\.\d+(e-?\d+)?/g, (m) => String(Math.round(+m * 100) / 100));

export function makeSketcher(seed: number, roughness: number, bowing: number): Sketcher {
  const g = rough.generator();
  let i = 0;
  // rough.js treats seed 0 as "randomize" — never allow it
  const next = () => {
    i += 1;
    return (((seed >>> 0) + i * 7919) % 2147483646) + 1;
  };
  const toD = (drawable: unknown) =>
    round2(g.toPaths(drawable).map((p) => p.d).join(" "));
  return {
    rect(x, y, w, h, opts = {}) {
      return toD(
        g.rectangle(x, y, w, h, {
          seed: next(),
          roughness: opts.roughness ?? roughness,
          bowing,
          disableMultiStroke: opts.multi === false,
        }),
      );
    },
    path(d, opts = {}) {
      return toD(
        g.path(d, {
          seed: next(),
          roughness: opts.roughness ?? roughness,
          bowing,
          disableMultiStroke: true, // flow lines stay single-stroke: dashes + animation read cleanly
        }),
      );
    },
  };
}
