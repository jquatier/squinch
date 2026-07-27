// One SVG that carries both palettes and picks one with `prefers-color-scheme`.
//
// Why merge two renders instead of emitting CSS variables from the emitters:
// the artwork in an icon pack is verbatim third-party SVG (AWS ships CC-BY-ND),
// and it shares hex values with the theme — `#FFFFFF` appears in both a light
// card surface and inside the icons, unchanged between themes. A search and
// replace over the colour literals would silently recolour someone else's
// trademark. Rendering the pair and walking their attributes in lockstep tells
// us *positionally* which values are theme-driven: the ones that moved.
//
// The dark palette rides in a `<style>` media query rather than replacing the
// attributes, so the file degrades to exactly today's output. A renderer with
// no CSS support at all — resvg, which is what PNG export uses — still reads
// the presentation attributes and draws the light theme correctly. Nothing
// executes: this is a stylesheet, not script, so the no-JS contract holds.

/** An attribute occurrence in document order. */
interface Attr {
  name: string;
  value: string;
  /** index in the source string of the value's first character */
  at: number;
  /** index of the `<` opening the element this attribute belongs to */
  tag: number;
}

const ATTR = /([a-zA-Z_][\w:.-]*)="([^"]*)"/g;
const TAG = /<[a-zA-Z]/g;

function attrs(svg: string): Attr[] {
  // Tag starts, so each attribute can be attributed to its element. Both
  // strings come straight from our own emitter, which never puts a `<` inside
  // an attribute value, so a scan is enough — no parser needed.
  const tags: number[] = [];
  for (const m of svg.matchAll(TAG)) tags.push(m.index);
  const out: Attr[] = [];
  let ti = 0;
  for (const m of svg.matchAll(ATTR)) {
    const at = m.index + m[1].length + 2;
    while (ti + 1 < tags.length && tags[ti + 1] < m.index) ti++;
    out.push({ name: m[1], value: m[2], at, tag: tags[ti] });
  }
  return out;
}

/** Colour-bearing properties. A differing `d` or `x` would mean the geometry
 *  moved, which is a bug in the pairing rather than something to style. */
const COLOUR = new Set(["fill", "stroke", "stop-color", "color", "flood-color"]);

export class AdaptivePairError extends Error {}

/**
 * Fold a light and a dark render of the same diagram into one file.
 *
 * Both must be the same drawing — same geometry, same text, same icons —
 * differing only in colour. That holds for themes sharing a font (light/dark,
 * sketch/sketch-dark) because nothing in the render path branches on the theme
 * beyond its palette and its sketch settings. It does *not* hold across fonts,
 * since type metrics drive layout, so a mismatched pair is rejected rather
 * than quietly emitting a file whose dark half is misaligned.
 */
export function mergeAdaptive(light: string, dark: string): string {
  const la = attrs(light);
  const da = attrs(dark);

  const skeleton = (s: string) => s.replace(/="[^"]*"/g, '=""');
  if (la.length !== da.length || skeleton(light) !== skeleton(dark))
    throw new AdaptivePairError(
      "the two themes did not draw the same diagram, so they cannot share one file — " +
        "an adaptive pair must differ only in colour (check they use the same font)",
    );

  // Distinct (property, light, dark) triples become one CSS rule each; the
  // class name is the triple's index in sorted order, so the output is a pure
  // function of the input and stays byte-identical across runs.
  const triples = new Map<string, { prop: string; dark: string }>();
  const hits: { tag: number; key: string }[] = [];
  for (let i = 0; i < la.length; i++) {
    if (la[i].value === da[i].value) continue;
    const { name } = la[i];
    if (!COLOUR.has(name))
      throw new AdaptivePairError(
        `the two themes disagree on \`${name}\`, which is geometry rather than colour — ` +
          "an adaptive pair must differ only in colour",
      );
    const key = `${name}|${la[i].value}|${da[i].value}`;
    triples.set(key, { prop: name, dark: da[i].value });
    hits.push({ tag: la[i].tag, key });
  }
  if (!triples.size) return light; // identical palettes: nothing to adapt

  const order = [...triples.keys()].sort();
  const cls = new Map(order.map((k, i) => [k, `sq-t${i}`]));

  // Group by element: one element can have both a themed fill and a themed
  // stroke, and it needs both classes.
  const byTag = new Map<number, string[]>();
  for (const h of hits) {
    const name = cls.get(h.key)!;
    const list = byTag.get(h.tag) ?? [];
    if (!list.includes(name)) list.push(name);
    byTag.set(h.tag, list);
  }

  // Rewrite back-to-front so earlier offsets stay valid.
  let out = light;
  for (const [tag, names] of [...byTag].sort((a, b) => b[0] - a[0])) {
    const close = out.indexOf(">", tag);
    const head = out.slice(tag, close);
    // `class="sq-flow"` already exists on animated edges — extend it, never
    // replace it, or the flow animation stops.
    const existing = /\sclass="([^"]*)"/.exec(head);
    if (existing)
      out =
        out.slice(0, tag + existing.index) +
        ` class="${existing[1]} ${names.join(" ")}"` +
        out.slice(tag + existing.index + existing[0].length);
    else {
      const nameEnd = tag + 1 + /^[a-zA-Z][\w:.-]*/.exec(out.slice(tag + 1))![0].length;
      out = out.slice(0, nameEnd) + ` class="${names.join(" ")}"` + out.slice(nameEnd);
    }
  }

  const rules = order
    .map((k) => `.${cls.get(k)}{${triples.get(k)!.prop}:${triples.get(k)!.dark}}`)
    .join("");
  const style = `<style>@media (prefers-color-scheme: dark){${rules}}</style>`;

  // After the opening tag, alongside the font faces.
  const rootEnd = out.indexOf(">") + 1;
  return out.slice(0, rootEnd) + "\n" + style + out.slice(rootEnd);
}
