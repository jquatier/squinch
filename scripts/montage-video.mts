// The landing page's montage clip: a prompt in, a diagram out, a zoom through
// the system into its database, then a flurry of what else the corpus can draw.
//
// prompt-gif.mts is the README's opening shot (GitHub will not autoplay a
// video, so the README keeps GIFs). This one is for the landing page, so it is
// a movie: H.264 drawn at 1.5× (1410×1170), a poster still beside it, dark and
// light. 1.5× and CRF 30 are a size decision, not a sharpness one: against the 2×/CRF 28
// it replaced they take about half the bytes (~2.8 → ~1.5 MB a theme), and on a slot
// up to ~700 css px wide it is still full resolution on a 2× screen. SCALE=2 CRF=28
// brings the old settings back.
//
// Maintainer-only: needs ffmpeg on PATH and Playwright's Chromium
// (`npx playwright install chromium` on a fresh machine). Never runs in CI —
// see docs/notes/readme-artifacts.md on why a gate that needs ffmpeg is a
// ritual, not a check.
//
//   npx tsx scripts/montage-video.mts                 both themes, 60 fps (~25 min on a laptop-class machine)
//   THEMES=dark npx tsx scripts/montage-video.mts     one theme
//   FPS=30 npx tsx scripts/montage-video.mts          half the frames: half the time, ~20% fewer bytes
//   KEEP_FRAMES=1 …                                   also leave the PNG frames behind (path is printed)
//   PREVIEW=2.5,10.9 THEMES=dark …                    write just those instants as PNGs, encode nothing
//   RANGE=10.5,14.5 FPS=60 THEMES=dark …              encode only that stretch (to the kept temp dir, no assets
//                                                     written) — for weighing FPS / CRF / PRESET on real motion
//
// Generated, never screen-recorded. The page is scripts/montage/reel.html, a pure
// function of time: every CSS animation is paused and *seeked* to k / FPS and the
// viewport screenshotted, so frames never depend on a clock, a machine's speed or
// what else it is doing, and the motion is as smooth as the frame rate allows
// (transforms are sub-pixel; nothing is stepped to the pixel grid).
//
// Three things make "a pure function of time" true, and each was a bug before it was a line:
//   - the headless compositor flags (see `launch` below) — without them a shot taken right after a
//     seek can land before a zoomed layer's tiles are rasterised, leaving a flat rectangle of canvas
//     colour where a diagram should be;
//   - the three shop views are inlined, not <img>s: a squinch SVG animates its async edges (marching
//     dashes, `sq-flow`) on its own document clock, which an <img> hides from the page — every shot
//     caught the dashes at a different phase. Inline, they are seeked with everything else;
//   - the wall's tiles and the montage's boards are too many to inline, so their animation is switched
//     off in a copy (the dashes sit still, identically, in every frame).
// Every frame is shot twice and the two must be byte-identical; a frame that is not is shot again, and
// the count is printed, so a regression in any of the above shows up as a number, not as a flicker.
//
// What is derived, and so cannot go stale:
//   - every diagram is the committed render of its theme (lookbook/out and
//     examples/*), except the shop dive, which is scripts/montage/shop.squinch
//     rendered here by core, so it follows the renderer and the themes;
//   - the two zoom dives and their rings are computed from the rendered shop
//     SVGs themselves: each card carries `data-path`, so the card the camera
//     dives through is *measured* (scripts/montage/dive.mts), never typed in;
//   - the counts the agent "reads" off the repo ("8 systems, 7 Lambdas") come
//     from the built model of that same source.
//
// What is not, and is a claim about the picture: the agent's wording, the
// prompt (`diagram this app`), the twelve boards picked for the montage and the
// timeline. Like prompt-gif.mts's sentence, no test can catch these going out of
// step with the picture — change the shop source and read the clip.
//
// Dark tokens are the playground's (apps/spa/src/tokens.css); the frame's
// background is each theme's own diagram canvas so a render floats on it with
// no visible edge. Fonts are the repo's bundled @fontsource faces loaded from
// disk — never fetched, never the machine's: Inter has no ● in its subset, so
// that bullet is drawn, not typed.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildProject, renderProject } from "../packages/core/dist/index.js";
import { diveCss, installDelays, LOOP, T, timelineCss } from "./montage/dive.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 940, H = 780;
const env = process.env;
/** Pixels per css px. 1.5, not 2: measured on the wall, a dive and the montage cuts, 1.5× is -36% bytes at CRF 28
 *  (SSIM .98–.99 against the 2× frames) and -53% with CRF 32; the wall alone is a third of the file. */
const DSF = Number(env.SCALE ?? 1.5);
const THEMES = (env.THEMES ?? "dark,light").split(",").map((t) => t.trim()).filter(Boolean);
/** 60, not 30: a dive's peak is ~22 css px of travel per frame at 30 fps, which judders on a 60 Hz screen.
 *  Measured on dive 1: 60 fps costs +21% bytes (304 vs 252 KB for the same 4 s) for twice the capture time. */
const FPS = Number(env.FPS ?? 60);
const PREVIEW = env.PREVIEW ? env.PREVIEW.split(",").map(Number) : null;
/** RANGE=10.5,14.5 encodes just that stretch into the kept temp dir (no assets written) — for comparing FPS/CRF/preset on real motion. */
const RANGE = env.RANGE ? env.RANGE.split(",").map(Number) : null;
/** The tables view is on screen from the end of dive 2 until the app scene fades at 18.6 s. */
const POSTER_AT = T.appFade - 0.2;
/** x264 at its slowest, tuned for flat vector art — the same settings, and the same reasons, as the
 *  other clips' mp4 (prompt-gif.mts), one notch softer: CRF 28 is indistinguishable from 22 at 2× on this
 *  artwork and 40% smaller; at 1.5× a CRF of 30 lands the clip near 1.5 MB a theme. */
const X264 = ["-c:v", "libx264", "-preset", env.PRESET ?? "veryslow", "-tune", "animation", "-crf", env.CRF ?? "30",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

// ---- tokens: the playground's own (apps/spa/src/tokens.css) plus the few the reel derives
const TOKENS: Record<string, Record<string, string>> = {
  dark: {
    canvas: "#161618", surface: "#1A1A1D", control: "#1F1F23", line: "#2C2C30", "line-strong": "#46464C",
    "text-3": "#6C6B66", ghost: "#6C6B66", muted: "#9C9B94", fg: "#EDEDEA", accent: "#8B88E8", ok: "#3FBF8F",
    pill: "rgba(26,26,29,.92)", "accent-25": "rgba(139,136,232,.25)", "accent-55": "rgba(139,136,232,.55)",
    shadow: "rgba(0,0,0,.5)", tile: "#1A1A1D", "tile-edge": "#2C2C30", "tile-shadow": "0 0 0 0 transparent",
  },
  light: {
    canvas: "#E3E3E1", surface: "#FFFFFF", control: "#F0EFEC", line: "#E4E3DF", "line-strong": "#CFCEC9",
    // Text on this theme's canvas (#E3E3E1, darker than the white surfaces tokens.css pairs its text with) and on
    // the pill needs darker ink than the playground's own: --muted #6F6E69 is 3.98:1 on the canvas, --accent
    // #5A57C9 4.49:1, and --text-3 #8A8983 under 3:1 on the pill. These three are the nearest values that
    // pass 4.5:1 (4.83 / 4.86 / 4.77). --ghost is the italic "N inside" hops.
    "text-3": "#8A8983", ghost: "#72716B", muted: "#62615C", fg: "#1C1C1A", accent: "#5551C4", ok: "#1F8A66",
    pill: "rgba(255,255,255,.92)", "accent-25": "rgba(85,81,196,.25)", "accent-55": "rgba(85,81,196,.45)",
    // light tiles take the diagrams' own canvas so letterboxing never shows as a white mat
    shadow: "rgba(0,0,0,.14)", tile: "#E3E3E1", "tile-edge": "#CFCEC9", "tile-shadow": "0 2px 8px rgba(0,0,0,.12)",
  },
};

// ---- fonts: core's bundled @fontsource sources, from disk
const coreRequire = createRequire(join(root, "packages/core/package.json"));
const faces = ([
  ["Inter", 400, "@fontsource/inter/files/inter-latin-400-normal.woff2"],
  ["Inter", 500, "@fontsource/inter/files/inter-latin-500-normal.woff2"],
  ["Inter", 600, "@fontsource/inter/files/inter-latin-600-normal.woff2"],
  ["IBM Plex Mono", 500, "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2"],
  ["IBM Plex Mono", 600, "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2"],
] as const).map(([family, weight, spec]) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url('${pathToFileURL(coreRequire.resolve(spec))}') format('woff2')}`,
).join("\n");

// ---- the diagrams: the committed renders, in a fixed order (lookbook sorted, then the examples sorted)
const lookbook = join(root, "lookbook/out");
const examples = join(root, "examples");
const stems = [
  ...readdirSync(lookbook).filter((f) => f.endsWith(".dark.svg")).sort(),
  ...readdirSync(examples).sort().flatMap((d) => statSync(join(examples, d)).isDirectory()
    ? readdirSync(join(examples, d)).filter((f) => f.endsWith(".dark.svg")).sort() : []),
].map((f) => f.replace(/\.dark\.svg$/, ""));
if (stems.length !== 74) throw new Error(`expected 74 committed views, found ${stems.length} — the wall's tiling assumes it; check lookbook/out and examples/`);

function svgFor(stem: string, theme: string): string {
  for (const p of [join(lookbook, `${stem}.${theme}.svg`), join(examples, stem.split(".")[0], `${stem}.${theme}.svg`)]) {
    if (existsSync(p)) return p;
  }
  throw new Error(`no ${theme} render for ${stem}`);
}

// ---- the shop: scripts/montage/shop.squinch, rendered by core
const shopSrc = readFileSync(join(root, "scripts/montage/shop.squinch"), "utf8");
const shopFiles = [{ name: "shop.squinch", src: shopSrc }];

/** "8 systems, 7 Lambdas, Postgres" — read off the model, so it cannot disagree with the picture. */
function counts(): string {
  const built = buildProject(shopFiles);
  if (!built.ok) throw new Error("shop.squinch does not build");
  const m = built.model;
  const systems = [...m.containers.values()].filter((c) => c.kind === "system" && !c.path.includes(".")).length;
  const lambdas = [...m.nodes.values()].filter((n) => n.icon?.pack === "aws" && n.icon.id === "lambda").length;
  const postgres = [...m.containers.values()].some((c) => /postgres/i.test(c.attrs.icon ?? ""));
  if (!postgres) throw new Error("the clip says Postgres, but shop.squinch has no postgres container");
  return `${systems} systems, ${lambdas} Lambdas, Postgres`;
}

async function shopSvg(view: string, theme: string): Promise<string> {
  const r = await renderProject(shopFiles, { view, theme });
  if (!r.ok || !r.svg) throw new Error(`shop view ${view} did not render: ${JSON.stringify(r.diagnostics)}`);
  return r.svg;
}

const SHOP_ALT: Record<string, string> = {
  landscape: "Landscape: storefront, gateway, accounts, orders, catalog and payments",
  service: "Inside the Orders service: API, queue, worker and a Postgres card",
  database: "Inside the Postgres database: orders, order_items and shipments with their fields",
};

/** The shop views go into the page *inline* rather than as <img>: a squinch SVG animates its async edges
 *  (`sq-flow`, marching dashes) on its own document clock, and an <img> has a clock nobody can seek —
 *  every screenshot would catch the dashes at a different phase. Inline, the animation belongs to the
 *  page's timeline, so it is seeked with everything else and the dashes march in step with the movie.
 *  The SVG's ids are the same in every view of one theme (defs are content-addressed), so three copies
 *  in one document agree about what `url(#sq-surface)` means. */
function inlineSvg(svg: string, label: string): string {
  const tag = svg.match(/^<svg\b[^>]*>/);
  if (!tag) throw new Error("not an svg");
  const open = tag[0].replace(/\swidth="[\d.]+"/, "").replace(/\sheight="[\d.]+"/, "")
    .replace(/>$/, ` role="img" aria-label="${label}" style="position:absolute;inset:0;width:100%;height:100%">`);
  return open + svg.slice(tag[0].length);
}

/** The wall's tiles and the montage's boards are <img>s too, and too many to inline, so their animation
 *  is switched off in a copy (dashes held still at the same phase everywhere): at a tile's size, or a
 *  cut's length, nobody can tell. Returns the copy's file: URL. */
function frozen(src: string, dir: string): string {
  const out = join(dir, "frozen", basename(src));
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, readFileSync(src, "utf8").replace(/animation:[^;}"']*/g, "animation:none"));
  }
  return String(pathToFileURL(out));
}

function loadChromium() {
  for (const from of [import.meta.url, pathToFileURL(join(root, "apps/spa/package.json")).href]) {
    for (const id of ["playwright", "@playwright/test"]) {
      try { return createRequire(from)(id).chromium; } catch { /* try the next */ }
    }
  }
  throw new Error("Playwright is not installed (npm i -D playwright, or `pnpm install` in apps/spa)");
}

type Page = import("playwright").Page;

/** An SVG's own size in px — the picture box contains it, so its aspect is all the dive needs. */
function sizeOf(svg: string) {
  const m = svg.match(/<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/);
  if (!m) throw new Error("svg has no width/height");
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** The card face of `data-path` in an SVG, in that SVG's own px (every card is `<g data-path>` whose
 *  first rect is its face — the shadow and the stacked sheets are not part of it). */
async function measure(page: Page, svg: string, path: string) {
  return page.evaluate(({ svg, path }) => {
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0";
    host.innerHTML = svg;
    document.body.append(host);
    const el = host.querySelector("svg")!;
    const o = el.getBoundingClientRect();
    const face = el.querySelector(`[data-path="${path}"] > rect`) as SVGRectElement | null;
    if (!face) throw new Error(`no card with data-path="${path}"`);
    const r = face.getBoundingClientRect();
    host.remove();
    return { x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height };
  }, { svg, path });
}

async function main() {
  const chromium = loadChromium();
  const work = mkdtempSync(join(tmpdir(), "squinch-montage-"));
  const keep = Boolean(env.KEEP_FRAMES);
  const outDir = join(root, "docs/assets");
  mkdirSync(outDir, { recursive: true });
  const readout = counts();
  // The compositor flags are what make a frame a pure function of time: without them a screenshot taken
  // right after a seek can catch a zoomed layer before its tiles are rasterised, and a flat rectangle of
  // canvas colour shows where a diagram should be (seen on the light tables view, one frame in ~200).
  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--run-all-compositor-stages-before-draw", "--disable-new-content-rendering-timeout",
      "--disable-checker-imaging", "--disable-threaded-animation", "--disable-partial-raster"],
  });
  try {
    for (const theme of THEMES) {
      if (!TOKENS[theme]) throw new Error(`unknown theme ${theme}`);
      const t0 = Date.now();
      const dir = join(work, theme);
      mkdirSync(dir, { recursive: true });

      // the shop, and the geometry of the two cards the camera dives through
      const [landscape, service, database] = await Promise.all(["landscape", "service", "database"].map((v) => shopSvg(v, theme)));
      const shop: Record<string, string> = { landscape, service, database };
      const probe = await browser.newPage({ viewport: { width: W, height: H } });
      await probe.setContent('<body style="margin:0"></body>');
      const orders = await measure(probe, landscape, "orders");
      const pg = await measure(probe, service, "orders.pg");
      await probe.close();
      const size = { landscape: sizeOf(landscape), service: sizeOf(service), database: sizeOf(database) };
      const dive = diveCss({ ...size, orders, pg });
      console.log(`${theme}: orders card ${JSON.stringify(orders)}, postgres card ${JSON.stringify(pg)}`);

      // the page
      let html = readFileSync(join(root, "scripts/montage/reel.html"), "utf8");
      const tokens = Object.entries(TOKENS[theme]).map(([k, v]) => `  --${k}: ${v};`).join("\n");
      html = html.replace("/*{{FONT_FACES}}*/", () => faces).replace("/*{{TOKENS}}*/", () => tokens)
        .replace("/*{{DIVE_KEYFRAMES}}*/", () => dive.css).replace("/*{{TIMELINE_KEYFRAMES}}*/", () => timelineCss())
        .replace(/\{\{LOOP\}\}/g, String(LOOP))
        .replace("{{T_INST_1}}", installDelays().t1).replace("{{T_INST_N1}}", installDelays().n1)
        .replace("{{T_INST_2}}", installDelays().t2).replace("{{T_INST_N2}}", installDelays().n2)
        .replace("{{RING_A}}", dive.ringA).replace("{{RING_B}}", dive.ringB).replace("{{COUNTS}}", readout);
      // the wall: eight rows dealt by index mod 8, brick-offset, alternate rows drifting the other way
      const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((r) => {
        const tiles = stems.filter((_, i) => i % 8 === r).map((stem) =>
          `<img src="${frozen(svgFor(stem, theme), dir)}" alt="" style="flex: none; width: 200px; height: 140px; object-fit: contain; background: var(--tile); border-radius: 8px; box-shadow: 0 0 0 1px var(--tile-edge), var(--tile-shadow)">`);
        return `      <div style="display: flex; gap: 14px; margin-left: ${r % 2 ? 107 : 0}px; animation: ${r % 2 ? "sq-driftB" : "sq-driftA"} ${LOOP}s linear infinite">${tiles.join("")}</div>`;
      }).join("\n");
      html = html.replace("<!--{{WALL}}-->", () => rows)
        .replace(/\{\{board:([^}]+)\}\}/g, (_, stem) => frozen(svgFor(stem, theme), dir))
        .replace(/<!--\{\{shop:([^}]+)\}\}-->/g, (_, v) => inlineSvg(shop[v], SHOP_ALT[v]));
      const left = html.match(/\{\{[^}]*\}\}/);
      if (left) throw new Error(`unfilled placeholder ${left[0]}`);
      const file = join(dir, "reel.html");
      writeFileSync(file, html);

      const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(async () => {
        await Promise.all([...document.fonts].map((f) => f.load()));
        await document.fonts.ready;
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
      });
      // freeze: nothing below reads a clock; each frame seeks every animation to an instant
      await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
      // Seek, let two frames be produced, shoot — then shoot again and compare: a frame whose two shots
      // differ was caught mid-raster, so it is shot again until two agree (and counted, so a regression shows).
      let retried = 0;
      const shoot = async (t: number) => {
        await page.evaluate((ms) => new Promise<void>((done) => {
          document.getAnimations().forEach((a) => { a.currentTime = ms; });
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }), t * 1000);
        let a = await page.screenshot({ type: "png" });
        for (let tries = 0; tries < 5; tries++) {
          const b = await page.screenshot({ type: "png" });
          if (a.equals(b)) return a;
          retried++;
          a = b;
        }
        throw new Error(`frame at ${t.toFixed(3)}s never settled`);
      };

      if (PREVIEW) {
        for (const t of PREVIEW) writeFileSync(join(dir, `t${t.toFixed(2)}.png`), await shoot(t));
        console.log(`${theme}: previews in ${dir}`);
        await page.close();
        continue;
      }

      // the poster: the tables view, the still a reduced-motion or script-off reader gets
      if (!RANGE) {
        const posterPng = join(dir, "poster.png");
        writeFileSync(posterPng, await shoot(POSTER_AT));
        await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", posterPng, "-c:v", "libwebp", "-quality", "90", join(outDir, `montage-${theme}.webp`)]);
      }

      // the movie: frames stream straight into x264, one screenshot at a time
      const first = RANGE ? Math.ceil(RANGE[0] * FPS) : 0;
      const frames = RANGE ? Math.floor(RANGE[1] * FPS) : Math.round(LOOP * FPS);
      const mp4 = RANGE ? join(dir, `range-${FPS}fps.mp4`) : join(outDir, `montage-${theme}.mp4`);
      const ff = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", ...X264, mp4],
        { stdio: ["pipe", "inherit", "inherit"] });
      const exited = new Promise<void>((res, rej) => ff.on("exit", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
      for (let k = first; k < frames; k++) {
        const png = await shoot(k / FPS);
        if (keep) writeFileSync(join(dir, `f${String(k).padStart(5, "0")}.png`), png);
        if (!ff.stdin.write(png)) await once(ff.stdin, "drain");
        if (k % 150 === 0) console.log(`  ${theme} ${k}/${frames}`);
      }
      ff.stdin.end();
      await exited;
      await page.close();
      const kb = (p: string) => `${Math.round(statSync(p).size / 1024)} KB`;
      const secs = Math.round((Date.now() - t0) / 1000);
      if (retried) console.log(`  (${retried} frame shots were caught mid-raster and re-shot)`);
      if (RANGE) console.log(`range ${RANGE} at ${FPS} fps: ${frames - first} frames, ${kb(mp4)}, ${secs}s — ${mp4}`);
      else console.log(`wrote ${mp4} — ${frames} frames, ${LOOP}s at ${FPS} fps, ${kb(mp4)} (+ montage-${theme}.webp ${kb(join(outDir, `montage-${theme}.webp`))}) in ${secs}s`);
    }
  } finally {
    await browser.close();
    if (keep || PREVIEW || RANGE) console.log(`kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
  });
}

await main();
