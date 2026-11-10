// The chrome the site's documents share, substituted at build time.
//
// The pages are hand-set static HTML, and until this existed each carried its
// own copy of the head's link/og block, the header nav, the footer's meta and
// the rail's scroll-spy — one of them inside a template string in
// scripts/sync-lookbook.ts. Adding /compare/ meant editing the nav in three
// places, the version reached one footer of four, and the landing still said
// "three dozen" cases at forty-two. Same reasoning as the analytics plugin in
// vite.config.ts: one snippet in N checked-in documents is N chances to drift.
//
// A page opts in per placeholder, so what is particular to it stays in it:
//
//   <!--site-head-->    canonical, icons, the og/twitter card and the fonts.
//                       Title and description are read off the page's own
//                       <title> and <meta name="description">, which stay
//                       where a reader of the file expects them.
//   <!--site-header-->  the header bar; the current page is marked from the
//                       document's own path.
//   <!--foot-meta-->    version · licence, the inside of a footer's
//                       .foot-meta — the CTA beside it is the page's own.
//   <!--rail-spy-->     src/rail.js as an inline script.
//   <!--icon-count-->   marks across every installed pack ("1,358").
//   <!--icon-shelf-->   the landing's icon card: a row per pack with seven
//                       of its marks.
//   <!--case-count-->   lookbook cases.
import type { Plugin } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(import.meta.url);

const ORIGIN = "https://squinch.cc";
const REPO = "https://github.com/jquatier/squinch";
const RAIL = join(here, "src/rail.js");

/** The header's destinations, in order. One line to add another. */
const NAV: [href: string, label: string][] = [
  ["/install/", "Install"],
  ["/lookbook/", "Lookbook"],
  ["/compare/", "Compare"],
  ["/playground/", "Playground"],
  [REPO, "GitHub"],
];

/** Counted off the packs this app depends on rather than off a list: the
 *  manifest's `icons` are the drawn marks, aliases excluded. */
const iconCount = (): string => {
  const deps = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).devDependencies;
  let n = 0;
  for (const pkg of Object.keys(deps))
    if (pkg.startsWith("@squinch/pack-"))
      n += Object.keys(JSON.parse(readFileSync(require.resolve(`${pkg}/pack.json`), "utf8")).icons).length;
  return n.toLocaleString("en-US");
};

/** The landing's icon card: one row per pack — its prefix and seven of its
 *  marks — so the reader sees the artwork rather than a number. Built off
 *  the manifests for the reason `iconCount` is: a renamed icon fails the
 *  build here instead of drawing a broken image. Seven is what fits the
 *  narrowest column (three-up at 1180px) beside the prefix. */
const SHELF: Record<string, string[]> = {
  aws: ["lambda", "simple-storage-service", "dynamodb", "simple-queue-service", "api-gateway", "cloudfront", "rds"],
  azure: ["function-apps", "azure-cosmos-db", "kubernetes-services", "storage-accounts", "app-services", "key-vaults", "event-hubs"],
  gcp: ["bigquery", "gke", "cloud-run", "spanner", "vertex-ai", "cloud-sql", "compute-engine"],
  k8s: ["pod", "deploy", "svc", "ing", "sts", "cm", "secret"],
  logos: ["apachekafka", "postgresql", "datadog", "stripe", "redis", "snowflake", "terraform"],
  sys: ["server", "database", "cpu", "router", "shield", "globe", "smartphone"],
};

const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** A brand colour too dark to read on the site's ground falls back to the
 *  text colour — the same call the renderer makes by plating such marks. */
const legible = (hex: string | undefined): string | undefined => {
  if (!hex) return undefined;
  const n = parseInt(hex.slice(1), 16);
  const l = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l < 0.25 ? undefined : hex;
};

const iconShelf = (): string => {
  const rows = Object.entries(SHELF).map(([name, picks]) => {
    const dir = dirname(require.resolve(`@squinch/pack-${name}/pack.json`));
    const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    const marks = picks.map((id) => {
      const icon = manifest.icons[id];
      if (!icon) throw new Error(`site-shell: the icon shelf names ${name}/${id}, which the pack no longer has`);
      const title = esc(icon.title ?? id);
      if (!manifest.monochrome)
        return `<img src="/${name}-icons/${icon.file}" alt="${title}" width="24" height="24" loading="lazy" />`;
      // Monochrome marks carry no paint of their own (currentColor, or none
      // at all), so an <img> would draw them black: inline them and tint.
      // Only the root tag is rewritten: Lucide's <rect>s carry width/height too.
      const svg = readFileSync(join(dir, "icons", icon.file), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<title>[\s\S]*?<\/title>/, "")
        .replace(/<svg\b[^>]*>/, (tag) => {
          const kept = tag.replace(/\s(class|width|height|role)="[^"]*"/g, "");
          const fill = /\sfill="/.test(kept) ? "" : ' fill="currentColor"';
          return kept.replace("<svg", `<svg${fill} role="img" aria-label="${title}"`);
        })
        .replace(/\s+/g, " ")
        .trim();
      const colour = legible(icon.color);
      return `<span class="shelf-mono"${colour ? ` style="color:${colour}"` : ""}>${svg}</span>`;
    });
    return `<li><code>${name}<span>/</span></code><span class="shelf-icons">${marks.join("")}</span></li>`;
  });
  return `<ul class="shelf" aria-label="Icon packs">\n${rows.map((r) => `            ${r}`).join("\n")}\n          </ul>`;
};

const caseCount = (): string =>
  String(readdirSync(join(root, "lookbook/cases")).filter((f) => f.endsWith(".squinch")).length);

const head = (html: string, route: string): string => {
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1];
  if (!title || !description)
    throw new Error(`site-shell: ${route} needs a <title> and a <meta name="description"> for <!--site-head-->`);
  // the card sets the name the way the wordmark does, in lowercase
  const og = description.replaceAll("Squinch", "squinch");
  return `<link rel="canonical" href="${ORIGIN}${route}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="squinch" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${og}" />
    <meta property="og:image" content="${ORIGIN}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="The squinch mark - an S standing on three stacked isometric planes - beside the wordmark and, under it, the lines “diagrams as code” and “for AI agents”" />
    <meta property="og:url" content="${ORIGIN}${route}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />`;
};

const header = (route: string): string => `<header class="site-header">
      <a class="home" href="/"><img src="/favicon.svg" alt="" width="20" height="20" />squinch</a>
      <nav aria-label="Site">
${NAV.map(([href, label]) => `        <a href="${href}"${href === route ? ' aria-current="page"' : ""}>${label}</a>`).join("\n")}
      </nav>
    </header>`;

const footMeta = (version: string): string =>
  `<a class="foot-version" href="${REPO}/releases" title="The version this site was built from">v${version}</a>` +
  `<span aria-hidden="true">·</span>` +
  `<span>Apache-2.0</span>`;

export const siteShell = ({ version }: { version: string }): Plugin => ({
  name: "squinch-site-shell",
  transformIndexHtml: {
    order: "pre",
    handler: (html, ctx) => {
      const route = ctx.path.replace(/index\.html$/, "");
      // Functions, not strings, for the reason given at the mark: a `$` in the
      // replacement would be read as a pattern.
      return html
        .replace("<!--site-head-->", () => head(html, route))
        .replace("<!--site-header-->", () => header(route))
        .replace("<!--foot-meta-->", () => footMeta(version))
        .replace("<!--rail-spy-->", () => `<script>\n${readFileSync(RAIL, "utf8")}    </script>`)
        .replaceAll("<!--icon-count-->", iconCount)
        .replace("<!--icon-shelf-->", iconShelf)
        .replaceAll("<!--case-count-->", caseCount);
    },
  },
  // rail.js is read here, outside Vite's graph — same as the mark
  configureServer(server) {
    server.watcher.add(RAIL);
    server.watcher.on("change", (f) => {
      if (f === RAIL) server.ws.send({ type: "full-reload" });
    });
  },
});
