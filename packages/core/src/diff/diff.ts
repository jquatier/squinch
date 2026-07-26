// Semantic diff: what changed in the *architecture*, not in the rendering.
// Compares two built models — no layout, no ELK, no SVG — so it is fast and
// deterministic, and its output is something a human can review in a PR.
//
// The load-bearing distinction is structural vs cosmetic: re-ordering rows is
// not the same event as opening a path into the payment vault, and a reviewer
// must never have to squint to tell them apart.
import type { SModel, SNode, SContainer, SEdge, SZone, SFlow, SView } from "../model/types.js";

export type ChangeKind = "added" | "removed" | "changed";
export type Weight = "structural" | "cosmetic";

export interface Change {
  kind: ChangeKind;
  weight: Weight;
  /** what sort of thing changed — node, edge, zone… */
  subject: "system" | "container" | "node" | "edge" | "zone" | "flow" | "view";
  /** stable identity of the thing (path, edge signature, view name…) */
  id: string;
  /** one-line human summary */
  detail: string;
  /** set on `changed`: what it was, and what it now is */
  before?: string;
  after?: string;
  /** `possible rename of x` — a hint, never an assumption */
  note?: string;
}

export interface DiffResult {
  changes: Change[];
  structural: number;
  cosmetic: number;
  /** true when the two models are semantically identical */
  same: boolean;
}

const edgeId = (e: SEdge) => `${e.from} ${e.arrow} ${e.to}${e.label ? ` "${e.label}"` : ""}`;
/** endpoints only: the pair that decides whether two things talk at all */
const edgePair = (e: SEdge) => `${e.from}|${e.to}`;

function mapBy<T>(items: Iterable<T>, key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(key(it), it);
  return m;
}

/** Stable ordering: structural first, then by subject, then by id. */
const SUBJECT_ORDER = ["system", "container", "node", "edge", "zone", "flow", "view"] as const;
function sortChanges(changes: Change[]): Change[] {
  return [...changes].sort((a, b) => {
    if (a.weight !== b.weight) return a.weight === "structural" ? -1 : 1;
    const s = SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject);
    if (s !== 0) return s;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
}

export function diffModels(before: SModel, after: SModel): DiffResult {
  const changes: Change[] = [];
  const add = (c: Change) => changes.push(c);

  // ── containers ───────────────────────────────────────────────────────────
  for (const [path, c] of after.containers)
    if (!before.containers.has(path))
      add({
        kind: "added", weight: "structural", subject: c.kind, id: path,
        detail: `${path}${c.label ? ` "${c.label}"` : ""} (${c.children.length} children)`,
      });
  for (const [path, c] of before.containers)
    if (!after.containers.has(path))
      add({ kind: "removed", weight: "structural", subject: c.kind, id: path, detail: path });
  for (const [path, b] of before.containers) {
    const a = after.containers.get(path);
    if (!a) continue;
    if (b.label !== a.label)
      add({
        kind: "changed", weight: "cosmetic", subject: a.kind, id: path,
        detail: `${path} label`, before: b.label, after: a.label,
      });
    const bTags = [...b.tags].sort().join(","), aTags = [...a.tags].sort().join(",");
    if (bTags !== aTags)
      add({
        kind: "changed", weight: "structural", subject: a.kind, id: path,
        detail: `${path} tags`, before: bTags || "(none)", after: aTags || "(none)",
      });
  }

  // ── nodes ────────────────────────────────────────────────────────────────
  const icon = (n?: SNode) => (n?.icon ? `${n.icon.pack}/${n.icon.id}` : "none");
  const addedNodes: SNode[] = [], removedNodes: SNode[] = [];
  for (const [path, n] of after.nodes) if (!before.nodes.has(path)) addedNodes.push(n);
  for (const [path, n] of before.nodes) if (!after.nodes.has(path)) removedNodes.push(n);

  // rename hint: same icon and same neighbours, one in / one out. Reported as
  // a note on the pair — never as a silent rename, because a wrong inference
  // in a security review is worse than a verbose one.
  const neighbours = (model: SModel, path: string) =>
    model.edges
      .filter((e) => e.from === path || e.to === path)
      .map((e) => (e.from === path ? e.to : e.from))
      .sort().join(",");
  const renameOf = new Map<string, string>();
  for (const gone of removedNodes)
    for (const fresh of addedNodes) {
      if (renameOf.has(fresh.path)) continue;
      if (icon(gone) !== icon(fresh)) continue;
      const bn = neighbours(before, gone.path), an = neighbours(after, fresh.path);
      if (bn && bn === an) { renameOf.set(fresh.path, gone.path); break; }
    }

  for (const n of addedNodes)
    add({
      kind: "added", weight: "structural", subject: "node", id: n.path,
      detail: `${n.path}${n.label ? ` "${n.label}"` : ""} (${icon(n)})`,
      note: renameOf.has(n.path) ? `possible rename of ${renameOf.get(n.path)}` : undefined,
    });
  const renamedAway = new Set([...renameOf.values()]);
  for (const n of removedNodes)
    add({
      kind: "removed", weight: "structural", subject: "node", id: n.path,
      detail: n.path,
      note: renamedAway.has(n.path)
        ? `possible rename to ${[...renameOf].find(([, v]) => v === n.path)![0]}`
        : undefined,
    });

  for (const [path, b] of before.nodes) {
    const a = after.nodes.get(path);
    if (!a) continue;
    if (b.label !== a.label)
      add({
        kind: "changed", weight: "cosmetic", subject: "node", id: path,
        detail: `${path} label`, before: b.label, after: a.label,
      });
    if (icon(b) !== icon(a))
      add({
        kind: "changed", weight: "structural", subject: "node", id: path,
        detail: `${path} icon`, before: icon(b), after: icon(a),
      });
    const bk = [...b.kinds].sort().join(","), ak = [...a.kinds].sort().join(",");
    if (bk !== ak)
      add({
        kind: "changed", weight: "structural", subject: "node", id: path,
        detail: `${path} kind`, before: bk || "(none)", after: ak || "(none)",
      });
    const bTags = [...b.tags].sort().join(","), aTags = [...a.tags].sort().join(",");
    if (bTags !== aTags)
      add({
        kind: "changed", weight: "structural", subject: "node", id: path,
        detail: `${path} tags`, before: bTags || "(none)", after: aTags || "(none)",
      });
    if ((b.description ?? "") !== (a.description ?? ""))
      add({
        kind: "changed", weight: "cosmetic", subject: "node", id: path,
        detail: `${path} description`,
        before: b.description ?? "(none)", after: a.description ?? "(none)",
      });
  }

  // ── edges ────────────────────────────────────────────────────────────────
  // Match on the endpoint pair first, so a changed arrow or label reads as a
  // modification of one connection rather than a delete plus an add.
  const beforeByPair = new Map<string, SEdge[]>();
  for (const e of before.edges) (beforeByPair.get(edgePair(e)) ?? beforeByPair.set(edgePair(e), []).get(edgePair(e))!).push(e);
  const afterByPair = new Map<string, SEdge[]>();
  for (const e of after.edges) (afterByPair.get(edgePair(e)) ?? afterByPair.set(edgePair(e), []).get(edgePair(e))!).push(e);

  for (const [pair, afters] of afterByPair) {
    const befores = beforeByPair.get(pair) ?? [];
    for (let i = 0; i < afters.length; i++) {
      const a = afters[i], b = befores[i];
      if (!b) {
        add({
          kind: "added", weight: "structural", subject: "edge", id: edgeId(a),
          detail: edgeId(a),
        });
        continue;
      }
      if (b.arrow !== a.arrow)
        add({
          kind: "changed", weight: "structural", subject: "edge", id: edgeId(a),
          detail: `${a.from} → ${a.to} arrow`,
          before: b.arrow === "~>" ? "async" : b.arrow,
          after: a.arrow === "~>" ? "async" : a.arrow,
        });
      if ((b.label ?? "") !== (a.label ?? ""))
        add({
          kind: "changed", weight: "cosmetic", subject: "edge", id: edgeId(a),
          detail: `${a.from} → ${a.to} label`,
          before: b.label ?? "(none)", after: a.label ?? "(none)",
        });
    }
  }
  for (const [pair, befores] of beforeByPair) {
    const afters = afterByPair.get(pair) ?? [];
    for (let i = afters.length; i < befores.length; i++)
      add({
        kind: "removed", weight: "structural", subject: "edge", id: edgeId(befores[i]),
        detail: edgeId(befores[i]),
      });
  }

  // ── zones ────────────────────────────────────────────────────────────────
  const bz = mapBy(before.zones, (z: SZone) => z.id);
  const az = mapBy(after.zones, (z: SZone) => z.id);
  for (const [id, z] of az)
    if (!bz.has(id))
      add({
        kind: "added", weight: "structural", subject: "zone", id,
        detail: `${id} (${z.kind}) — ${z.members.length} members`,
      });
  for (const [id] of bz)
    if (!az.has(id)) add({ kind: "removed", weight: "structural", subject: "zone", id, detail: id });
  for (const [id, b] of bz) {
    const a = az.get(id);
    if (!a) continue;
    if (b.kind !== a.kind)
      add({
        kind: "changed", weight: "structural", subject: "zone", id,
        detail: `${id} kind`, before: b.kind, after: a.kind,
      });
    const gained = a.members.filter((m) => !b.members.includes(m));
    const lost = b.members.filter((m) => !a.members.includes(m));
    if (gained.length || lost.length)
      add({
        kind: "changed", weight: "structural", subject: "zone", id,
        detail: `${id} members`,
        before: lost.length ? `-${lost.join(" -")}` : "(none removed)",
        after: gained.length ? `+${gained.join(" +")}` : "(none added)",
      });
  }

  // ── flows ────────────────────────────────────────────────────────────────
  const bf = mapBy(before.flows, (f: SFlow) => f.id);
  const af = mapBy(after.flows, (f: SFlow) => f.id);
  const steps = (f: SFlow) => f.steps.map((s) => `${s.from}→${s.to}`).join(", ");
  for (const [id, f] of af)
    if (!bf.has(id))
      add({
        kind: "added", weight: "structural", subject: "flow", id,
        detail: `${id} (${f.steps.length} steps)`,
      });
  for (const [id] of bf)
    if (!af.has(id)) add({ kind: "removed", weight: "structural", subject: "flow", id, detail: id });
  for (const [id, b] of bf) {
    const a = af.get(id);
    if (a && steps(b) !== steps(a))
      add({
        kind: "changed", weight: "structural", subject: "flow", id,
        detail: `${id} steps`, before: steps(b), after: steps(a),
      });
  }

  // ── views ────────────────────────────────────────────────────────────────
  // A view change is cosmetic *unless* it changes what a reader can see:
  // excluding a service hides it from everyone who opens the diagram.
  const explicit = (m: SModel) => m.views.filter((v) => !v.auto);
  const bv = mapBy(explicit(before), (v: SView) => v.name);
  const av = mapBy(explicit(after), (v: SView) => v.name);
  const visibility = (v: SView) =>
    JSON.stringify({
      scope: v.scope, includeStar: v.includeStar,
      include: v.include.map((i) => (typeof i === "string" ? i : `#${i.tag}`)).sort(),
      exclude: v.exclude.map((i) => (typeof i === "string" ? i : `#${i.tag}`)).sort(),
      expand: [...v.expand].sort(), context: v.context,
    });
  // Deliberately loc-free: hints and notes carry source offsets, and every
  // edit above them shifts those. Comparing raw objects would report a
  // "presentation change" for adding a comment — the sort of false positive
  // that teaches people to ignore the tool.
  const presentation = (v: SView) =>
    JSON.stringify({
      title: v.title, theme: v.theme, highlight: [...v.highlight].sort(),
      showDescriptions: v.showDescriptions, showFlow: v.showFlow,
      legend: v.legend, titleblock: v.titleblock,
      notes: v.notes.map((n) => ({ anchor: n.anchor, text: n.text, style: n.style })),
      layout: {
        direction: v.layout.direction,
        density: v.layout.density,
        lines: v.layout.lines,
        rows: v.layout.rows,
        place: v.layout.place.map((p) => ({ node: p.node, relpos: p.relpos, target: p.target })),
        align: v.layout.align.map((a) => a.nodes),
        routes: v.layout.routes.map((r) => ({
          from: r.from, to: r.to, label: r.label, fromSide: r.fromSide, toSide: r.toSide,
        })),
      },
    });
  for (const [name] of av)
    if (!bv.has(name))
      add({ kind: "added", weight: "cosmetic", subject: "view", id: name, detail: `view ${name}` });
  for (const [name] of bv)
    if (!av.has(name))
      add({ kind: "removed", weight: "cosmetic", subject: "view", id: name, detail: `view ${name}` });
  for (const [name, b] of bv) {
    const a = av.get(name);
    if (!a) continue;
    if (visibility(b) !== visibility(a))
      add({
        kind: "changed", weight: "structural", subject: "view", id: name,
        detail: `view ${name} changes what is visible`,
      });
    if (presentation(b) !== presentation(a))
      add({
        kind: "changed", weight: "cosmetic", subject: "view", id: name,
        detail: `view ${name} presentation (title/layout/annotations)`,
      });
  }

  const sorted = sortChanges(changes);
  const structural = sorted.filter((c) => c.weight === "structural").length;
  return {
    changes: sorted,
    structural,
    cosmetic: sorted.length - structural,
    same: sorted.length === 0,
  };
}

const SIGIL: Record<ChangeKind, string> = { added: "+", removed: "-", changed: "~" };

/** Human-readable report, grouped by weight. */
export function formatDiff(d: DiffResult): string {
  if (d.same) return "no semantic changes";
  const lines: string[] = [];
  for (const weight of ["structural", "cosmetic"] as const) {
    const group = d.changes.filter((c) => c.weight === weight);
    if (!group.length) continue;
    lines.push(weight);
    for (const c of group) {
      const change = c.before !== undefined ? `  ${c.before} → ${c.after}` : "";
      lines.push(
        `  ${SIGIL[c.kind]} ${c.subject.padEnd(9)} ${c.detail}${change}` +
          (c.note ? `\n      (${c.note})` : ""),
      );
    }
    lines.push("");
  }
  lines.push(`${d.structural} structural, ${d.cosmetic} cosmetic`);
  return lines.join("\n");
}

/** Markdown for a PR comment. */
export function formatDiffMarkdown(d: DiffResult): string {
  if (d.same) return "**Squinch**: no semantic changes.";
  const lines = [`**Squinch**: ${d.structural} structural, ${d.cosmetic} cosmetic change(s).`, ""];
  for (const weight of ["structural", "cosmetic"] as const) {
    const group = d.changes.filter((c) => c.weight === weight);
    if (!group.length) continue;
    lines.push(`### ${weight}`, "");
    for (const c of group) {
      const change = c.before !== undefined ? ` — \`${c.before}\` → \`${c.after}\`` : "";
      lines.push(`- \`${SIGIL[c.kind]}\` **${c.subject}** ${c.detail}${change}` +
        (c.note ? ` _(${c.note})_` : ""));
    }
    lines.push("");
  }
  return lines.join("\n");
}
