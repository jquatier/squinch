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

/** A view as a zoom target: what it is called, and the container it looks at. */
export interface NavView { name: string; scope?: string; title?: string; auto?: boolean }

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
