// Navigation arithmetic over dotted scope paths. Pure, and the thing that
// decides zoom direction for every move in the playground.

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
