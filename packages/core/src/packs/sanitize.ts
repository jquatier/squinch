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

/** Attribute values that reference document ids, e.g. url(#foo) or #foo. */
const REF_ATTRS = new Set(["clip-path", "mask", "filter", "fill", "stroke"]);

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
 * asset itself must stay byte-faithful (CC-BY-ND).
 */
export function sanitizeIcon(svg: string, idPrefix: string): SanitizedIcon {
  const tree = parser.parse(svg) as any[];
  const root = findElement(tree, "svg");
  if (!root) throw new Error("pack asset has no <svg> root");
  const viewBox = String(attrOf(root, "viewBox") ?? "0 0 80 80");

  const clean = (nodes: any[]): any[] => {
    const out: any[] = [];
    for (const node of nodes) {
      const tag = Object.keys(node).find((k) => k !== ":@" && k !== "#text");
      if (tag === undefined) {
        if (typeof node["#text"] === "string" && node["#text"].trim()) out.push(node);
        continue;
      }
      if (!ELEMENTS.has(tag)) continue; // drops script, foreignObject, image, …
      const attrs = node[":@"] ?? {};
      const kept: Record<string, unknown> = {};
      for (const [rawName, value] of Object.entries(attrs)) {
        const name = rawName.replace(/^@/, "");
        if (!ATTRS.has(name)) continue; // drops on*, xlink:href, style, class, …
        let v = String(value);
        if (name === "id") v = `${idPrefix}-${v}`;
        else if (REF_ATTRS.has(name) && v.includes("url(#"))
          v = v.replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${idPrefix}-${id})`);
        else if (v.startsWith("#") && name !== "fill" && name !== "stroke")
          v = `#${idPrefix}-${v.slice(1)}`;
        kept[`@${name}`] = v;
      }
      const children = node[tag];
      out.push({ [tag]: Array.isArray(children) ? clean(children) : children, ":@": kept });
    }
    return out;
  };

  const body = builder.build(clean(root.svg as any[]));
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
