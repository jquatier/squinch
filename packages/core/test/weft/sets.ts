// The diagram sets the engine is held to, and what "legal" means for one view.
//
//   corpus   every `.squinch` file the repo owns, auto views included
//   trial    diagrams written by hand before the engine saw them (`trial/`)
//   round2   more, written after it was accepted (`round2/`)
//   random   a seeded batch nobody wrote (`random.ts`)
//
// Each set is also drawn turned on its side — every view forced to
// `direction right` — which is the same engine working along the other axis.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProject } from "../../src/index.js";
import { layoutView, type Positioned } from "../../src/layout/layout.js";
import { plan } from "../../src/layout/plan.js";
import type { Diagnostic, SView } from "../../src/model/types.js";
import { corpus } from "../helpers/corpus.js";
import { checkLayout, labelsOnWires } from "../invariants.js";
import { measureLayout } from "./metrics.js";
import { randomDiagram } from "./random.js";

const here = dirname(fileURLToPath(import.meta.url));
const folder = (name: string) => readdirSync(join(here, name)).filter((f) => f.endsWith(".squinch")).sort()
  .map((f) => ({ name: `${name}/${f}`, src: readFileSync(join(here, name, f), "utf8") }));

export interface Source { name: string; src: string }
export const SETS = ["corpus", "trial", "round2", "random"] as const;
export type SetName = (typeof SETS)[number];

/** The sources of one set. `random` is the first `n` seeds. */
export function sources(set: SetName, n = 0): Source[] {
  if (set === "corpus") return corpus();
  if (set === "random") return Array.from({ length: n }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) }));
  return folder(set);
}

/** What the quality gate totals: how good a legal layout is (`metrics.ts`),
 *  plus the one rule the layout does not hold everywhere yet. */
export const QUALITY = ["crossings", "bends", "kinks", "nearMiss", "lopsided", "offCentre", "unstraight", "labelOnWire"] as const;
export type Quality = Record<(typeof QUALITY)[number], number>;

/** `checkLayout` does not hold anyone to this one, because it needs to know
 *  which wires are one trunk: how many pairs of wires that are not one bundle
 *  run along the same line. */
function stacked(p: Positioned, bundle: Map<string, string | undefined>): number {
  const segs = p.edges.flatMap((e) => e.points.slice(1).map((b, i) => {
    const a = e.points[i], flat = a.y === b.y;
    return { id: e.id, flat, at: flat ? a.y : a.x, lo: flat ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi: flat ? Math.max(a.x, b.x) : Math.max(a.y, b.y) };
  }));
  const pairs = new Set<string>();
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.id === t.id || s.flat !== t.flat || s.at !== t.at || s.lo >= t.hi || t.lo >= s.hi) continue;
      if (bundle.get(s.id) && bundle.get(s.id) === bundle.get(t.id)) continue;
      pairs.add(s.id < t.id ? `${s.id}|${t.id}` : `${t.id}|${s.id}`);
    }
  return pairs.size;
}

export interface Drawn { view: string; positioned: Positioned; diagnostics: Diagnostic[]; illegal: string[]; quality: Quality }

/**
 * Every view of one source, laid out and judged. `illegal` is every hard rule
 * broken: `checkLayout`, an edge the engine did not draw, and two wires along
 * one line. A source that does not build is skipped — that is another test's
 * failure — unless `mustBuild`.
 */
export async function draw(source: Source, opts: { auto?: boolean; right?: boolean; mustBuild?: boolean } = {}): Promise<Drawn[]> {
  const built = buildProject([{ name: source.name, src: source.src }]);
  const errs = built.diagnostics.filter((d) => d.severity === "error");
  if (errs.length) {
    if (opts.mustBuild) throw new Error(`${source.name}: ${errs[0].message}`);
    return [];
  }
  const zoneMembers = new Map(built.model.zones.map((z) => [z.id, z.members]));
  const out: Drawn[] = [];
  for (const original of built.model.views) {
    if (original.auto && !opts.auto) continue;
    // a view that already flows rightward is counted where it lives
    if (opts.right && original.layout.direction === "right") continue;
    const view: SView = opts.right ? { ...original, layout: { ...original.layout, direction: "right" } } : original;
    const { positioned, diagnostics } = await layoutView(built.model, view);
    const channelTargets = new Set(view.layout.channels.map((c) => c.target));
    const illegal = checkLayout(positioned, { zoneMembers, channelTargets });
    for (const d of diagnostics) if (/is not drawn/.test(d.message)) illegal.push(d.message);
    const bundles = new Map(plan(built.model, view, { metrics: "inter", scale: 1 }).problem.wires.map((w) => [w.id, w.bundle]));
    const lying = stacked(positioned, bundles);
    if (lying) illegal.push(`${lying} pair(s) of wires drawn along one line`);
    const m = measureLayout(positioned);
    out.push({
      view: `${source.name}#${view.name}`, positioned, diagnostics, illegal,
      quality: { crossings: m.crossings, bends: m.bends, kinks: m.kinks, nearMiss: m.nearMiss, lopsided: m.lopsided, offCentre: m.offCentre, unstraight: m.unstraight, labelOnWire: labelsOnWires(positioned).length },
    });
  }
  return out;
}
