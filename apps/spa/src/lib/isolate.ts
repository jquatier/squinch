// Id isolation for the two-layer transition.

/**
 * Two copies of one diagram are on screen during a transition, and SVG ids are
 * not scoped to a document subtree: the live layer's `<use href="#i-lambda">`
 * would resolve against whichever `<symbol>` comes first in document order.
 * Renaming the ghost's ids keeps each layer referring to its own artwork.
 *
 * This is string surgery over the renderer's own output, so it is coupled to
 * core's id scheme — which is exactly why it is worth testing here rather than
 * inside a component nothing can reach.
 *
 * Idempotent by construction: an already-prefixed id must not gain a second
 * prefix, because the ghost is re-isolated whenever the source changes under a
 * transition that has not finished.
 */
export function isolateIds(svg: string): string {
  const pre = (id: string) => (id.startsWith("ghost-") ? id : `ghost-${id}`);
  return svg
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${pre(id)}"`)
    .replace(/href="#([^"]+)"/g, (_m, id: string) => `href="#${pre(id)}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${pre(id)})`);
}
