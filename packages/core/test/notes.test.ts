// Notes never overlap anything, over every diagram the repo owns.
//
// This existed nowhere. `checkLayout` cannot see notes — `Positioned` has no
// note geometry, because notes are placed at render time — and the one
// committed no-overlap assertion (golden.test.ts) matches edge-label pills by
// their `height="18" rx="2"` shape, which a note, drawn at radius 3 with a
// variable height, can never satisfy. So DESIGN §9's "no label collisions" was
// enforced for pills and unenforced for the annotation layer most likely to sit
// on top of something.
//
// Three shipped examples were in fact broken when this was written: the
// `right-of db` note in `microservices`, `storefront` and `landscape` each sat
// on a context card, and the last of those is the golden.
//
// Geometry comes out of the SVG via `data-note`, added for exactly this reason
// — the same identifying surface `data-path` gives nodes. Parsing shape instead
// of identity is what made the pill test able to pass vacuously.
import { describe, it, expect } from "vitest";
import { buildProject, renderProject, render } from "../src/index.js";
import { corpus } from "./helpers/corpus.js";

const N = String.raw`[-0-9.]+`;
interface Box { id: string; x: number; y: number; w: number; h: number }

const notesIn = (svg: string): Box[] =>
  [...svg.matchAll(
    new RegExp(`<g data-note="([^"]+)">(?:(?!</g>).)*?<rect x="(${N})" y="(${N})" width="(${N})" height="(${N})"`, "gs"),
  )].map((m) => ({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));

const nodesIn = (svg: string): Box[] =>
  [...svg.matchAll(
    new RegExp(`<g data-path="([^"]+)"[^>]*>\\s*<rect x="(${N})" y="(${N})" width="(${N})" height="(${N})"`, "g"),
  )].map((m) => ({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));

const pillsIn = (svg: string): Box[] =>
  [...svg.matchAll(new RegExp(`<rect x="(${N})" y="(${N})" width="(${N})" height="18" rx="2"`, "g"))]
    .map((m) => ({ id: "pill", x: +m[1], y: +m[2], w: +m[3], h: 18 }));

/** Strict overlap — no margin. The resolver keeps 4px; the test only asks that
 *  nothing actually touches, so it can never be stricter than the algorithm. */
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("notes never collide, across the corpus", () => {
  it("no note overlaps a node, a pill, or another note", async () => {
    const problems: string[] = [];
    let seen = 0;

    for (const f of corpus()) {
      const built = buildProject([{ name: f.name, src: f.src }]);
      if (built.diagnostics.some((d) => d.severity === "error")) continue;
      for (const view of built.model.views) {
        const r = await renderProject([{ name: f.name, src: f.src }], {
          view: view.name, theme: "light",
        });
        if (!r.ok) continue;
        const notes = notesIn(r.svg!);
        seen += notes.length;
        const others = [...nodesIn(r.svg!), ...pillsIn(r.svg!)];
        const where = `${f.name}#${view.name}`;
        for (const n of notes) {
          for (const o of others)
            if (overlaps(n, o)) problems.push(`${where}: note \`${n.id}\` overlaps ${o.id}`);
          // DESIGN §8 — note widths used to ship as `width="174.224118..."`,
          // because only x/y were rounded and `measure` returns a float
          if (!Number.isInteger(n.w) || !Number.isInteger(n.h))
            problems.push(`${where}: note \`${n.id}\` is ${n.w}×${n.h}, not integer`);
        }
        for (let i = 0; i < notes.length; i++)
          for (let j = i + 1; j < notes.length; j++)
            if (overlaps(notes[i], notes[j]))
              problems.push(`${where}: notes \`${notes[i].id}\` and \`${notes[j].id}\` overlap`);
      }
    }

    // Non-vacuity. Without this the whole sweep passes by finding no notes at
    // all — which is precisely how the pill check in golden.test.ts could have
    // rotted, and the reason this file keys on `data-note` rather than a shape.
    expect(seen, "found no notes — the sweep is not asserting anything").toBeGreaterThanOrEqual(16);
    expect(problems, `${problems.length} note collision(s)`).toEqual([]);
  }, 60_000);
});

describe("the resolver itself", () => {
  const view = (body: string, notes: string) =>
    `pack aws\n${body}\nview v { include *\n${notes} }`;
  const boxes = async (src: string) => {
    const r = await render(src, { theme: "light", view: "v" });
    expect(r.ok, "render failed").toBe(true);
    return { notes: notesIn(r.svg!), nodes: nodesIn(r.svg!), pills: pillsIn(r.svg!) };
  };

  it("separates two notes anchored to the same side of one node", async () => {
    // These produced two exactly coincident boxes: one note drawn on top of
    // another, with the lower one unreadable and no indication anything was
    // wrong.
    const { notes } = await boxes(view(
      `a = aws/lambda "A"\nb = aws/dynamodb "B" datastore\na -> b`,
      ` note right-of b "first"\n note right-of b "second"`,
    ));
    expect(notes.length).toBe(2);
    expect(overlaps(notes[0], notes[1])).toBe(false);
  });

  it("keeps an edge note off its own edge's label pill", async () => {
    // Both are placed at the midpoint of the same edge by construction — the
    // note at `mid.x + 16`, the pill centred on `mid` — so they overlapped
    // whenever the pill was wide enough.
    const { notes, pills } = await boxes(view(
      `a = aws/lambda "A"\nb = aws/dynamodb "B" datastore\na -> b "a nice long edge label"`,
      ` note on a -> b "and a note about it"`,
    ));
    expect(notes.length).toBe(1);
    expect(pills.length).toBeGreaterThan(0);
    for (const p of pills) expect(overlaps(notes[0], p), "note sits on its own pill").toBe(false);
  });

  it("moves a note that would land on a node, and keeps the authored side", async () => {
    const { notes, nodes } = await boxes(view(
      `a = aws/lambda "A"\nb = aws/dynamodb "B" datastore\nc = aws/lambda "C"\n` +
      `a -> b\na -> c\nb -> c`,
      ` note right-of b "kept to the right of b, whatever is already there"`,
    ));
    const b = nodes.find((n) => n.id.endsWith("b"))!;
    expect(notes.length).toBe(1);
    for (const n of nodes) expect(overlaps(notes[0], n), `overlaps ${n.id}`).toBe(false);
    // never flipped to the other side of the anchor — that would contradict
    // what the author wrote
    expect(notes[0].x).toBeGreaterThanOrEqual(b.x + b.w);
  });

  it("lets a corner note keep its corner rather than drifting inward", async () => {
    // The first cut stepped corner notes diagonally toward the middle, and a
    // `bottom-right` note ended up left of a `bottom-left` one. A corner note
    // is chrome: it hugs the frame, and the canvas makes room for it.
    const { notes, nodes } = await boxes(view(
      `a = aws/lambda "A"\nb = aws/lambda "B"\na -> b`,
      ` note top-right "top right"\n note bottom-left "bottom left"`,
    ));
    const tr = notes.find((n) => n.id === "top-right")!;
    const bl = notes.find((n) => n.id === "bottom-left")!;
    expect(tr.x).toBeGreaterThan(bl.x); // right stays right of left
    expect(bl.y).toBeGreaterThan(tr.y); // bottom stays below top
    for (const n of nodes) {
      expect(overlaps(tr, n)).toBe(false);
      expect(overlaps(bl, n)).toBe(false);
    }
  });

  it("is deterministic — same source, byte-identical output", async () => {
    const src = view(
      `a = aws/lambda "A"\nb = aws/dynamodb "B" datastore\na -> b`,
      ` note right-of b "one"\n note right-of b "two"\n note top-left "three"`,
    );
    const [x, y] = await Promise.all([
      render(src, { theme: "light", view: "v" }),
      render(src, { theme: "light", view: "v" }),
    ]);
    expect(x.svg).toBe(y.svg);
  });
});
