// Navigation arithmetic over dotted scope paths. Pure, and the thing that
// decides zoom direction for every move between altitudes.
//
// Half of this was `apps/spa/src/lib/path.ts` and half was trapped inside
// `App.tsx` as useMemos — fine while the playground was the only surface that
// navigated. The interactive HTML export navigates too, and is built by core,
// so it lives beside `resolve.ts` where the other pure view logic is: same
// category (functions over the view set), same testability.
//
// One semantic to preserve exactly: `viewForPath` and `crumbs` both take the
// FIRST view matching a scope. `examples/microservices` has three views scoped
// to `orders` (`orders`, `orders-pci`, `checkout`), so clicking that card lands
// on `orders` and the breadcrumb labels the hop `orders`. That is
// declaration-order dependent and deliberately not "improved" here.

import type { SModel } from "../model/types.js";

/** A view as a zoom target: what it is called, and the container it looks at.
 *  `flow` is the label of the flow it narrates, when it shows one. */
export interface NavView { name: string; scope?: string; title?: string; auto?: boolean; flow?: string }

/**
 * The one card that stands for `inner` inside a view scoped to `outer` — the
 * element both altitudes have in common, and therefore the thing to anchor a
 * zoom on. Undefined when the two scopes are not nested (a lateral hop), which
 * is what makes the caller fall back to a cut rather than a dive.
 */
export function stepToward(
  outer: string | undefined,
  inner: string | undefined,
): string | undefined {
  if (!inner) return undefined;
  if (!outer) return inner.split(".")[0];
  if (inner === outer || !inner.startsWith(`${outer}.`)) return undefined;
  return `${outer}.${inner.slice(outer.length + 1).split(".")[0]}`;
}

/** A model's views as navigation sees them — `flow` carries the label of the
 *  flow a view narrates, which is what files it under the bar's Flows menu. */
export function navViews(model: Pick<SModel, "views" | "flows">): NavView[] {
  return model.views.map((v) => {
    const f = v.showFlow ? model.flows.find((x) => x.id === v.showFlow) : undefined;
    return {
      name: v.name, scope: v.scope, title: v.title, auto: v.auto,
      ...(v.showFlow ? { flow: f?.label ?? v.showFlow } : {}),
    };
  });
}

/** The ancestor trail of a scope, outermost first — `a.b.c` → a, a.b, a.b.c. */
export function ancestors(scope: string | undefined): string[] {
  if (!scope) return [];
  const parts = scope.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

/** The scope one level out, or undefined at the top. */
export function parentScope(scope: string | undefined): string | undefined {
  if (!scope || !scope.includes(".")) return undefined;
  return scope.slice(0, scope.lastIndexOf("."));
}

/** Zoom target for a clicked element: the view scoped to that container. */
export function viewForPath(
  views: NavView[],
  activeView: string | undefined,
  path: string,
): NavView | undefined {
  return views.find((v) => v.scope === path && v.name !== activeView);
}

/**
 * How a move to `target` should be animated, derived from how the two scopes
 * relate — never from which control was clicked, which is what makes the
 * breadcrumb, the view tabs and a click on a card all behave the same. A
 * lateral hop (same altitude, different lens) shares no card, so it comes back
 * with no anchor and the caller cuts instead of diving.
 */
export function hop(
  views: NavView[],
  activeView: string | undefined,
  target: string,
): { dir: "in" | "out"; anchor?: string } {
  const from = views.find((v) => v.name === activeView)?.scope;
  const to = views.find((v) => v.name === target)?.scope;
  const down = stepToward(from, to);
  if (down) return { dir: "in", anchor: down };
  const up = stepToward(to, from);
  if (up) return { dir: "out", anchor: up };
  return { dir: "in" };
}

/** Ancestor trail of the current scope, each hop a view we can jump to. */
export function crumbs(
  views: NavView[],
  activeScope: string | undefined,
): { label: string; view?: string }[] {
  const trail: { label: string; view?: string }[] = [];
  const root = views.find((v) => !v.scope);
  if (root) trail.push({ label: "landscape", view: root.name });
  if (!activeScope) return trail;
  const parts = activeScope.split(".");
  for (const [i, path] of ancestors(activeScope).entries())
    trail.push({ label: parts[i], view: views.find((v) => v.scope === path)?.name });
  return trail;
}

/** One altitude back up: the nearest ancestor that has a view of its own. */
export function upView(
  views: NavView[],
  activeView: string | undefined,
  activeScope: string | undefined,
): string | undefined {
  return [...crumbs(views, activeScope)].reverse().find((c) => c.view && c.view !== activeView)?.view;
}

// ── the view bar ─────────────────────────────────────────────────────────────
//
// The playground, its presenter and the interactive export all draw the same
// navigation: a home button, then the path to where you stand, each hop a menu
// of the views beside it at that altitude, and the flows apart because a story
// belongs to no one altitude. This is the one description of that bar, so the
// three surfaces cannot disagree about what a hop contains.
// `docs/notes/view-bar.md` has the options it beat.

/** One entry in a hop's menu. */
export interface BarItem {
  view: string;
  label: string;
  active: boolean;
  auto?: boolean;
  /** further views looking at the same container — they live in its lens hop */
  lenses?: number;
}

/**
 * One hop of the path. `current` is where you stand, `link` an ancestor or a
 * sibling level you can move within, `ghost` a level you can open but are not
 * on (the lenses of this container, or the containers inside it). A hop with
 * one item is a plain link; with none it is only a label.
 */
export interface BarSegment {
  key: string;
  label: string;
  state: "current" | "link" | "ghost";
  items: BarItem[];
}

export interface ViewBar {
  /** the view the home button goes to — the landscape, else the first view */
  home?: string;
  atHome: boolean;
  segments: BarSegment[];
  flows: BarItem[];
  /** set when the view you are on narrates a flow */
  activeFlow?: BarItem;
}

const labelOf = (v: NavView) => v.title ?? v.name;
/** `title` minus a leading `prefix` and the separator after it — or `title`
 *  whole when it does not start that way, or nothing would be left. */
function afterPrefix(title: string, prefix: string): string {
  if (!title.startsWith(prefix)) return title;
  const rest = title.slice(prefix.length).replace(/^\s*[—–:·|-]\s*/, "");
  return rest && rest !== title.slice(prefix.length) ? rest : title;
}

/** The bar for the view you are on. Pure: views in, description out. */
export function viewBar(views: NavView[], activeView: string | undefined): ViewBar {
  const active = views.find((v) => v.name === activeView) ?? views[0];
  const paths = views.filter((v) => !v.flow);
  const home = (paths.find((v) => !v.scope) ?? views.find((v) => !v.scope) ?? views[0])?.name;
  if (!active) return { home, atHome: false, segments: [], flows: [] };

  // The first-match rule: the first view at a scope stands for that container.
  const scopeView = new Map<string, NavView>();
  const atScope = new Map<string, NavView[]>();
  for (const v of paths) {
    if (!v.scope) continue;
    if (!scopeView.has(v.scope)) scopeView.set(v.scope, v);
    atScope.set(v.scope, [...(atScope.get(v.scope) ?? []), v]);
  }
  const item = (v: NavView, on: boolean, counted = true): BarItem => {
    const n = counted && v.scope ? (atScope.get(v.scope)?.length ?? 1) - 1 : 0;
    return {
      view: v.name, label: labelOf(v), active: on,
      ...(v.auto ? { auto: true } : {}), ...(n > 0 ? { lenses: n } : {}),
    };
  };
  /** the containers one level below `parent` (undefined = the top) that have a view */
  const level = (parent: string | undefined) =>
    [...scopeView.keys()].filter((s) => (parentScope(s) ?? "") === (parent ?? ""));

  const segments: BarSegment[] = [];
  const scope = active.scope;

  // The top. The home button already is the landscape, so this hop only earns
  // its place when there is more than one view up here to choose between.
  const roots = paths.filter((v) => !v.scope);
  if (roots.length > 1) {
    const here = !scope && !active.flow && roots.includes(active);
    segments.push({
      key: "", label: labelOf(here ? active : roots[0]),
      state: here ? "current" : "link",
      items: roots.map((v) => item(v, v === active)),
    });
  }

  // One hop per ancestor, each a menu of its siblings.
  for (const p of ancestors(scope)) {
    const own = scopeView.get(p);
    const here = p === scope && own === active;
    segments.push({
      key: p,
      label: own ? labelOf(own) : p.slice(p.lastIndexOf(".") + 1),
      state: here ? "current" : "link",
      items: level(parentScope(p)).map((s) => item(scopeView.get(s)!, s === p)),
    });
  }

  // The lenses: other views looking at the container you are in. A lens is
  // usually titled after its container ("Order Service — PCI surface"), and
  // the hop before it already says "Order Service", so that much is dropped.
  const lenses = scope ? (atScope.get(scope) ?? []) : [];
  if (lenses.length > 1) {
    const onLens = lenses.indexOf(active) > 0;
    const lensLabel = (v: NavView, i: number) => (i ? afterPrefix(labelOf(v), labelOf(lenses[0])) : labelOf(v));
    segments.push({
      key: `${scope}#lens`,
      label: onLens
        ? lensLabel(active, 1)
        : `${lenses.length - 1} ${lenses.length === 2 ? "lens" : "lenses"}`,
      state: onLens ? "current" : "ghost",
      items: lenses.map((v, i) => ({ ...item(v, v === active, false), label: lensLabel(v, i) })),
    });
  }

  // One level further in, when there is one to open.
  const inside = level(scope);
  if (inside.length)
    segments.push({
      key: `${scope ?? ""}#in`,
      label: `${inside.length} inside`,
      state: "ghost",
      items: inside.map((s) => item(scopeView.get(s)!, false)),
    });

  const flows = views.filter((v) => v.flow).map((v) => item(v, v === active, false));
  return {
    home, atHome: active.name === home, segments, flows,
    ...(active.flow ? { activeFlow: flows.find((f) => f.active) } : {}),
  };
}
