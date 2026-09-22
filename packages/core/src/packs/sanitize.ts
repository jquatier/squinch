// Pack SVGs are third-party content that ends up inside the SPA, VSCode webviews
// and committed files — so every asset is sanitized at load with an allowlist.
// Anything not explicitly permitted is dropped.
import { XMLParser, XMLBuilder } from "fast-xml-parser";

const ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern",
  "text", "tspan",
]);

const ATTRS = new Set([
  "d", "fill", "stroke", "opacity", "transform", "viewBox",
  "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
  "x1", "y1", "x2", "y2", "points", "offset",
  "fill-rule", "clip-rule", "fill-opacity", "stroke-opacity",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "spreadMethod", "clipPathUnits", "maskUnits", "patternUnits",
  "id", "clip-path", "mask", "filter", "font-size", "font-family",
  "text-anchor", "dominant-baseline",
]);

/** Attribute values that reference document ids as `url(#foo)`. */
const REF_ATTRS = new Set(["clip-path", "mask", "filter", "fill", "stroke"]);

/** Attributes whose value is a bare `#id` fragment rather than a colour.
 *
 *  `href`/`xlink:href` are the only SVG attributes shaped that way, and ATTRS
 *  drops both today — so in practice nothing here fires. It stays an explicit
 *  allowlist because the alternative (rewrite any value starting with `#`,
 *  minus a denylist of known colour attributes) is what shipped, and it was
 *  wrong: `stop-color="#5ea0ef"` is a hex colour, not a reference to an element
 *  named `5ea0ef`. Namespacing it produced `#pack-5ea0ef`, an invalid colour
 *  that paints black — which is every gradient in a pack of 597 gradient
 *  icons, rendered as black blobs. A denylist can only ever be as complete as
 *  the last pack to expose it. */
const BARE_REF_ATTRS = new Set(["href", "xlink:href"]);

/** Properties a `<style>` class rule may set on an element. Paint, stroke and
 *  text only — never geometry (`d`, `width`, `transform`), which would move the
 *  artwork — and every one already in ATTRS, so a promoted value cannot bypass
 *  the allowlist. Mirrors the PROMOTE set the k8s fetch script applies to
 *  inline `style=""` at fetch time; this is the same treatment for stylesheets,
 *  applied at load because the packs that need it (Google Cloud, one Azure
 *  icon) have no licence permitting the files themselves to be rewritten. */
const CSS_PROPS = new Set([
  "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity",
  "opacity", "font-size", "font-family", "text-anchor", "dominant-baseline",
  "stop-color", "stop-opacity",
]);

export interface SanitizedIcon {
  /** Inner markup, ids namespaced, safe to inline. */
  body: string;
  /** viewBox of the original asset — placement uses it, never rewrites it. */
  viewBox: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  preserveOrder: true,
  allowBooleanAttributes: true,
  trimValues: false,
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  preserveOrder: true,
  suppressEmptyNode: true,
});

/**
 * Strip everything not on the allowlist and namespace internal ids so several
 * icons can coexist in one document. Does not alter geometry or colour — the
 * asset itself must stay byte-faithful (CC-BY-ND). Paint that arrives as
 * `<style>` class rules is moved, verbatim, onto the elements as presentation
 * attributes: the stylesheet itself cannot be kept (free-text CSS defeats an
 * allowlist, and Illustrator's `.st0`/`.cls-1` names collide across every icon
 * sharing a document), and dropping it leaves the shapes filled black.
 */
export function sanitizeIcon(svg: string, idPrefix: string): SanitizedIcon {
  const tree = parser.parse(svg) as any[];
  const root = findElement(tree, "svg");
  if (!root) throw new Error("pack asset has no <svg> root");
  const viewBox = String(attrOf(root, "viewBox") ?? "0 0 80 80");

  // Collected before `clean()` runs, because `clean()` is what discards
  // `<style>`. With no stylesheet there are no rules, `cssFor` returns nothing,
  // and every element's attribute map is copied in its original order — the
  // output is byte-identical to a file that never had a `class` (Lucide's
  // `class="lucide lucide-server"` is that case, across all of pack-sys).
  const rules = parseClassRules(styleText(root.svg as any[]));
  const cssFor = (classAttr: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!rules.length || typeof classAttr !== "string") return out;
    const classes = new Set(classAttr.split(/\s+/).filter(Boolean));
    // stylesheet order: a later rule wins, as the cascade does at equal specificity
    for (const r of rules) if (classes.has(r.cls)) for (const [p, v] of r.decls) out[p] = v;
    return out;
  };

  const clean = (nodes: any[]): any[] => {
    const out: any[] = [];
    for (const node of nodes) {
      const tag = Object.keys(node).find((k) => k !== ":@" && k !== "#text");
      if (tag === undefined) {
        if (typeof node["#text"] === "string" && node["#text"].trim()) out.push(node);
        continue;
      }
      if (!ELEMENTS.has(tag)) continue; // drops script, foreignObject, image, …
      const attrs: Record<string, unknown> = { ...(node[":@"] ?? {}) };
      // CSS beats a same-name presentation attribute. Assigning into the copy
      // keeps an existing key's position and appends new ones, so attribute
      // order — and therefore the emitted bytes — stays a function of the input.
      // The values then take the same allowlist / id-namespacing path as any
      // attribute, so `fill:url(#g)` from a stylesheet is rewritten exactly as
      // `fill="url(#g)"` is.
      for (const [p, v] of Object.entries(cssFor(attrs["@class"]))) attrs[`@${p}`] = v;
      const kept: Record<string, unknown> = {};
      for (const [rawName, value] of Object.entries(attrs)) {
        const name = rawName.replace(/^@/, "");
        if (!ATTRS.has(name)) continue; // drops on*, xlink:href, style, class, …
        let v = String(value);
        if (name === "id") v = `${idPrefix}-${v}`;
        else if (REF_ATTRS.has(name) && v.includes("url(#"))
          v = v.replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${idPrefix}-${id})`);
        else if (BARE_REF_ATTRS.has(name) && v.startsWith("#"))
          v = `#${idPrefix}-${v.slice(1)}`;
        kept[`@${name}`] = v;
      }
      const children = node[tag];
      out.push({ [tag]: Array.isArray(children) ? clean(children) : children, ":@": kept });
    }
    return out;
  };

  // The root <svg>'s presentation attributes are *inherited* by everything
  // inside it, and the body gets lifted out of that root into a <symbol> — so
  // dropping them silently restyles the artwork. Stroke-only sets are where it
  // shows: Lucide puts `fill="none" stroke="currentColor" stroke-width="2"` on
  // the root and nothing on the paths, so without this the shapes fall back to
  // the SVG defaults — filled black, unstroked — and every icon renders as a
  // solid blob. Hoist them onto a wrapping <g> so inheritance survives the move.
  //
  // Only inheritable paint/stroke/text properties: geometry (`width`, `x`,
  // `viewBox`) describes the root viewport, not its children, and carrying it
  // down would move the artwork.
  const INHERITED = [
    "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-dasharray", "stroke-opacity", "fill-opacity", "fill-rule",
    "clip-rule", "opacity", "font-size", "font-family", "text-anchor",
    "dominant-baseline",
  ];
  const inherited: Record<string, unknown> = {};
  const rootCss = cssFor(attrOf(root, "class"));
  for (const name of INHERITED) {
    const v = rootCss[name] ?? attrOf(root, name);
    if (v !== undefined && v !== null) inherited[`@${name}`] = String(v);
  }

  const children = clean(root.svg as any[]);
  const body = builder.build(
    Object.keys(inherited).length ? [{ g: children, ":@": inherited }] : children,
  );
  return { body, viewBox };
}

function findElement(nodes: any[], tag: string): any | undefined {
  for (const node of nodes) {
    if (node[tag]) return node;
  }
  return undefined;
}

function attrOf(node: any, name: string): string | undefined {
  return node[":@"]?.[`@${name}`];
}

/** The text of every `<style>` element in the tree, in document order. */
function styleText(nodes: any[]): string {
  let css = "";
  for (const node of nodes) {
    const tag = Object.keys(node).find((k) => k !== ":@" && k !== "#text");
    const children = tag === undefined ? undefined : node[tag];
    if (!Array.isArray(children)) continue;
    if (tag === "style") {
      for (const c of children) if (c["#text"] !== undefined) css += `${String(c["#text"])}\n`;
    } else css += styleText(children);
  }
  return css;
}

interface ClassRule { cls: string; decls: [string, string][] }

/** The subset of CSS an icon needs: `selectors { declarations }` blocks, where
 *  a selector is a bare class (`.st1`) and a declaration a CSS_PROPS property.
 *  Anything else — element, id, descendant or pseudo selectors, geometry
 *  properties, `!important` — is ignored rather than approximated: an icon that
 *  depends on it renders as it would have anyway, and nothing here can widen
 *  what the allowlist admits. One entry per selector, so a rule written for a
 *  selector list keeps its place in the cascade. */
function parseClassRules(css: string): ClassRule[] {
  const rules: ClassRule[] = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /([^{}]+)\{([^{}]*)\}/g;
  for (let m: RegExpExecArray | null; (m = block.exec(src)); ) {
    const decls: [string, string][] = [];
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const value = d.slice(i + 1).replace(/\s*!important\s*$/i, "").trim();
      if (CSS_PROPS.has(prop) && value) decls.push([prop, value]);
    }
    if (!decls.length) continue;
    for (const sel of m[1].split(",")) {
      const cls = /^\s*\.([A-Za-z_][\w-]*)\s*$/.exec(sel);
      if (cls) rules.push({ cls: cls[1], decls });
    }
  }
  return rules;
}
