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

const shotHtml = (c: Case, s: Shot) => {
  const l = sizes.get(s.light)!;
  return `
        <figure class="shot">
          ${s.view ? `<figcaption>${escapeHtml(s.view)}</figcaption>` : ""}
          <picture>
            <source srcset="/lookbook/${s.dark}" media="(prefers-color-scheme: dark)">
            <img src="/lookbook/${s.light}" width="${l.w}" height="${l.h}" loading="lazy"
                 alt="${escapeHtml(c.title)}${s.view ? ` — ${escapeHtml(s.view)}` : ""}, rendered by Squinch">
          </picture>
        </figure>`;
};

const caseHtml = (c: Case) => `
      <section class="lb-case" id="${escapeHtml(c.slug)}" aria-labelledby="${escapeHtml(c.slug)}-h">
        <h2 id="${escapeHtml(c.slug)}-h">${escapeHtml(c.title)}</h2>
${descriptionHtml(c.description)}
        <p class="lb-source"><a href="${CASE_SRC(c.slug)}"><span class="lb-source-badge">Source</span>cases/${escapeHtml(c.slug)}.squinch</a></p>
        <div class="shots">${c.shots.map((s) => shotHtml(c, s)).join("")}
        </div>
      </section>`;

const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lookbook — Squinch</title>
    <meta name="description" content="${cases.length} rendered reference cases — dense meshes, deep nesting, zones, flows, themes — every corner of the renderer, in both palettes." />
    <link rel="canonical" href="https://squinch.cc/lookbook/" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#141416" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Lookbook — Squinch" />
    <meta property="og:description" content="${cases.length} rendered reference cases, in both palettes." />
    <meta property="og:image" content="https://squinch.cc/og.png" />
    <meta property="og:url" content="https://squinch.cc/lookbook/" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="/src/site.css" />
  </head>
  <body>
    <div class="page wide">
      <header class="site-header">
        <a class="home" href="/"><img src="/favicon.svg" alt="" width="20" height="20" /> squinch</a>
        <nav aria-label="Site">
          <a href="/install/">Install</a>
          <a href="/lookbook/" aria-current="page">Lookbook</a>
          <a href="/playground/">Playground</a>
          <a href="https://github.com/jquatier/squinch">GitHub</a>
        </nav>
      </header>
      <main>
        <h1>Lookbook</h1>
        <p class="lede">
          ${cases.length} rendered reference cases, every one a real
          <code>.squinch</code> file and its committed SVG — nothing here is
          hand-drawn, and nothing can quietly stop matching its source.
        </p>
${cases.map(caseHtml).join("\n")}
      </main>
      <footer class="site-footer">
        <a href="https://github.com/jquatier/squinch">GitHub</a>
        <span>Apache-2.0</span>
      </footer>
    </div>
  </body>
</html>
`;

writeFileSync(join(pageDir, "index.html"), html);
console.log(`lookbook page: ${cases.length} cases, ${sizes.size} images → apps/spa/lookbook/`);
