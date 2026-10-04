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
//   <!--case-count-->   lookbook cases.
import type { Plugin } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
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
    <meta property="og:image:alt" content="The squinch mark — an S standing on three stacked isometric planes — beside the wordmark and, under it, the line “architecture diagrams as code, for coding agents”" />
    <meta property="og:url" content="${ORIGIN}${route}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />`;
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
