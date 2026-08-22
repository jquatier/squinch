// Builds the site's /lookbook/ page from the repo's own lookbook/README.md —
// the same file lookbook/build.ts regenerates from the case sources. This
// script only reads it; it never re-renders a diagram, so it stays cheap and
// can never draw something the committed SVGs don't already show.
//
// Both outputs are generated and gitignored, same reasoning as sync-packs.ts:
// committing a second copy of 35 cases' markup is a second thing to forget to
// update, and there is nothing here that isn't already derivable from
// lookbook/README.md and lookbook/out/, both committed at the repo root.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const lookbookDir = join(root, "lookbook");

const publicDir = join(here, "..", "public", "lookbook");
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

const pageDir = join(here, "..", "lookbook");
mkdirSync(pageDir, { recursive: true });

// ── markdown → structured cases ─────────────────────────────────────────────
// The exact shape lookbook/build.ts writes: "## name", an optional description
// (paragraphs separated by a blank line), "Source: `cases/name.squinch`", then
// one or more views, each an optional "**`view`**" label followed by a
// light/dark image table. Parsing that shape directly — rather than a general
// markdown parser — is what lets this stay a few regexes: the format has one
// author (build.ts) and one reader (this file).
interface Shot { view?: string; light: string; dark: string }
// `title` is the "## " heading text — build.ts writes it humanized ("Minimal")
// for GitHub's own rendering of this file. `slug` is what anchors, ids, image
// filenames and the source path key off — pulled from the "Source: `cases/
// x.squinch`" line instead, since it's the real filename and the two must
// never be conflated (linking to "cases/Minimal.squinch" would 404).
interface Case { slug: string; title: string; description: string; shots: Shot[] }

const md = readFileSync(join(lookbookDir, "README.md"), "utf8");
const lines = md.split("\n");
const cases: Case[] = [];

let i = lines.findIndex((l) => l.startsWith("## "));
while (i !== -1 && i < lines.length) {
  const title = lines[i].slice(3).trim();
  i++;
  const block: string[] = [];
  while (i < lines.length && !lines[i].startsWith("## ")) block.push(lines[i++]);

  const sourceAt = block.findIndex((l) => l.startsWith("Source: "));
  const description = (sourceAt === -1 ? block : block.slice(0, sourceAt)).join("\n").trim();
  const rest = (sourceAt === -1 ? [] : block.slice(sourceAt + 1)).join("\n");

  const slugMatch = sourceAt === -1 ? null : /cases\/([^./]+)\.squinch/.exec(block[sourceAt]);
  if (!slugMatch) throw new Error(`lookbook case "${title}" has no parseable Source: line`);
  const slug = slugMatch[1];

  const shots: Shot[] = [];
  const shotRe =
    /(?:\*\*`([^`]+)`\*\*\n\n)?\|[^|\n]*\|[^|\n]*\|\n\|[-\s|]+\|\n\|\s*!\[\]\(out\/([^)\s]+)\)\s*\|\s*!\[\]\(out\/([^)\s]+)\)\s*\|/g;
  for (const m of rest.matchAll(shotRe)) shots.push({ view: m[1], light: m[2], dark: m[3] });

  cases.push({ slug, title, description, shots });
}

// ── copy the images, and read their pixel size off their own <svg> tag ─────
// (so <img> can carry width/height and never cause layout shift while it loads)
const sizeOf = (svg: string): { w: number; h: number } => {
  const m = /<svg[^>]*\swidth="(\d+)" height="(\d+)"/.exec(svg);
  if (!m) throw new Error("lookbook SVG has no width/height on its root — check the renderer");
  return { w: +m[1], h: +m[2] };
};
const sizes = new Map<string, { w: number; h: number }>();
for (const c of cases)
  for (const s of c.shots)
    for (const file of [s.light, s.dark])
      if (!sizes.has(file)) {
        const svg = readFileSync(join(lookbookDir, "out", file), "utf8");
        writeFileSync(join(publicDir, file), svg);
        sizes.set(file, sizeOf(svg));
      }

// ── markdown inline → HTML ──────────────────────────────────────────────────
// The only inline markdown a case description ever carries — verified against
// every current case — is `code`, **bold** and *italic*; no links, no lists
// (list-shaped descriptions exist in the .squinch source grammar but none of
// the 35 cases use one). Bold before italic, so italic's `\*(.+?)\*` cannot
// match half of a already-consumed `**pair**`.
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
const descriptionHtml = (d: string) =>
  d.split(/\n{2,}/).filter(Boolean).map((p) => `<p>${inline(p)}</p>`).join("\n");

// ── the page ─────────────────────────────────────────────────────────────────
const CASE_SRC = (name: string) =>
  `https://github.com/jquatier/squinch/blob/main/lookbook/cases/${name}.squinch`;

// One render per case, dark only — the page is dark-locked, so the light half
// of each pair is never shown here (it is still copied above; the landing's
// teaser and the README both read from the same public/lookbook/ folder).
// Multi-view cases show the view the design names as representative; every
// other case has one shot, which is the representative by construction.
const REPRESENTATIVE: Record<string, string> = {
  "15-densities": "comfortable",
  "16-legend-titleblock": "pay",
  "22-channel": "bussed",
  "25-edge-routing": "curved",
  "34-view-axes": "audit",
};
const representative = (c: Case): Shot =>
  c.shots.find((s) => s.view === REPRESENTATIVE[c.slug]) ?? c.shots[0];

const num = (i: number) => String(i + 1).padStart(2, "0");

const caseHtml = (c: Case, i: number) => {
  const s = representative(c);
  const l = sizes.get(s.light)!;
  return `
        <section class="lb-case panel" id="${escapeHtml(c.slug)}" aria-labelledby="${escapeHtml(c.slug)}-h">
          <div class="card-head">
            <span class="n">${num(i)}</span>
            <h2 id="${escapeHtml(c.slug)}-h">${escapeHtml(c.title)}</h2>
            <a class="lb-src" href="${CASE_SRC(c.slug)}"><span class="lb-source-badge">Source</span>cases/${escapeHtml(c.slug)}.squinch</a>
          </div>
          <div class="lb-desc">
${descriptionHtml(c.description)}
          </div>
          <figure class="shot">
            <div class="shot-center">
              <img src="/lookbook/${s.dark}" width="${l.w}" height="${l.h}" loading="lazy"
                   alt="${escapeHtml(c.title)}${s.view ? ` — ${escapeHtml(s.view)}` : ""}, rendered by Squinch">
            </div>
          </figure>
        </section>`;
};

const railHtml = (c: Case, i: number) =>
  `        <a href="#${escapeHtml(c.slug)}"${i === 0 ? ' class="is-active"' : ""}><span class="n">${num(i)}</span>${escapeHtml(c.title)}</a>`;

const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lookbook — Squinch</title>
    <meta name="description" content="${cases.length} rendered reference cases — dense meshes, deep nesting, zones, flows, themes — every corner of the renderer, each tied to its source." />
    <link rel="canonical" href="https://squinch.cc/lookbook/" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#141416" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Lookbook — Squinch" />
    <meta property="og:description" content="${cases.length} rendered reference cases, each tied to its source." />
    <meta property="og:image" content="https://squinch.cc/og.png" />
    <meta property="og:url" content="https://squinch.cc/lookbook/" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/src/site.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="home" href="/"><img src="/favicon.svg" alt="" width="20" height="20" />squinch</a>
      <nav aria-label="Site">
        <a href="/install/">Install</a>
        <a href="/lookbook/" aria-current="page">Lookbook</a>
        <a href="/playground/">Playground</a>
        <a href="https://github.com/jquatier/squinch">GitHub</a>
      </nav>
    </header>

    <div class="wrap lb sub-hero lb">
      <span class="eyebrow">Lookbook</span>
      <h1>Thirty-five systems,<br /><span class="grad-text">drawn properly.</span></h1>
      <p>
        Fan-outs and dense meshes, deployment boundaries, numbered request
        flows, legends and titleblocks — the shapes real systems take, and how
        each one is written. Copy any case into the playground and take it
        apart.
      </p>
      <div class="stat-row">
        <span>${cases.length} cases</span><span class="sep">·</span>
        <span>1,302 vendor icons</span><span class="sep">·</span>
        <span>light &amp; dark</span><span class="sep">·</span>
        <span>every one editable in the playground</span>
      </div>
    </div>

    <div class="wrap lb sub-body lb">
      <nav class="rail" aria-label="All cases">
        <div class="rail-label">All cases</div>
${cases.map(railHtml).join("\n")}
      </nav>
      <main>
${cases.map(caseHtml).join("\n")}
      </main>
    </div>

    <footer class="site-foot">
      <span>Apache-2.0 · icon artwork under its packs' own terms</span>
      <a class="btn-grad" href="/playground/">Try it in the playground</a>
    </footer>

    <script>
      // Scroll-spy for the rail (same shape as the install page's): the
      // active entry is the first case, in page order, whose card overlaps
      // the upper part of the viewport. The rail scrolls its own content so
      // the active entry also gets scrolled into view inside it.
      if ("IntersectionObserver" in window) {
        const links = [...document.querySelectorAll(".rail a[href^='#']")];
        const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
        const visible = new Set();
        const pick = () => {
          const first = [...byId.keys()].find((id) => visible.has(id));
          if (!first) return;
          for (const [id, a] of byId) {
            const on = id === first;
            a.classList.toggle("is-active", on);
            // keep the active entry inside the rail's own scroll window —
            // done by hand rather than scrollIntoView, which would also
            // scroll the page to it and fight the reader's own scrolling
            const rail = on && a.closest(".rail");
            if (rail) {
              const top = a.offsetTop, bottom = top + a.offsetHeight;
              if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight)
                rail.scrollTop = top - rail.clientHeight / 2;
            }
          }
        };
        const io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
            pick();
          },
          { rootMargin: "-15% 0px -70% 0px" },
        );
        for (const id of byId.keys()) {
          const el = document.getElementById(id);
          if (el) io.observe(el);
        }
      }
    </script>
  </body>
</html>
`;

writeFileSync(join(pageDir, "index.html"), html);
console.log(`lookbook page: ${cases.length} cases, ${sizes.size} images → apps/spa/lookbook/`);
