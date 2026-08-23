// squinch CLI — check / render / icons / init / skill / watch.
// Exit codes: 0 ok, 1 diagnostics-or-stale, 2 usage error.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  buildProject, renderProject, formatDiagnostics, validateSVG, searchIcons, themes, packInfo,
  diffProjects, formatDiff, formatDiffMarkdown, exportHTML,
  type Diagnostic,
} from "@squinch/core";
import { parseArgs, str } from "./args.js";
import { SKILL_MD } from "./skill.generated.js";
import { loadInput, type Input } from "./project.js";
import { isGitRepo, loadInputAtRef } from "./git.js";
import { toPosix } from "./paths.js";
import { watchPaths } from "./watch.js";
import { createRequire } from "node:module";

/** Read from our own manifest, never retyped. The determinism contract pins
 *  output to a *tool version*, and `squinch.lock` records it — a literal here
 *  would keep claiming 0.0.0 through every release, so a reader could not tell
 *  which renderer produced their SVGs, which is the one thing the lockfile
 *  exists to answer. `src/` and `dist/` both sit one level under the package
 *  root, so this resolves the same whether run through tsx or from the build. */
const VERSION: string = createRequire(import.meta.url)("../package.json").version;
const THEMES = ["light", "dark"] as const;

const USAGE = `squinch ${VERSION} — architecture diagrams as code

Usage
  squinch check <path> [--format json]        parse + lint (dir = project)
  squinch render <path> [options]             render SVG
  squinch icons search <query> [--pack aws]   find icon ids
  squinch init [dir]                          scaffold a starter project
  squinch skill [dir] [options]               install the agent skill (SKILL.md)
  squinch watch <path> [options]              re-render on change
  squinch diff [<old>] [<new>] [options]      what changed in the architecture

Skill options
  --global          install for you (~/.agents/skills) instead of the project
  --claude          also write .claude/skills/ even if no CLAUDE.md is found
  --print           print SKILL.md to stdout and write nothing

Diff options
  --base <ref>      compare against a git ref (default: HEAD)
  --format <fmt>    text | json | markdown (default: text)
  --fail-on <what>  exit 1 on change: structural | any

Render options
  --view <name>     view to render (default: first)
  --theme <name>    ${Object.keys(themes).join(" | ")} (default: the view's, else dark)
  --adaptive        one SVG carrying both palettes, switched by the reader's
                    prefers-color-scheme (svg only)
  -o <file>         output path (default: stdout; .png rasterizes,
                    .html builds the interactive export)
  --format <fmt>    svg | png | html (default: inferred from -o)
  --views <which>   html only: all (default) | declared — 'all' bundles the
                    automatic view every container gets, so every card that
                    zooms in the playground zooms in the export; 'declared'
                    is smaller but leaves those cards dead
  --themes <a,b>    html only: palettes to bundle (default: the theme and its
                    prefers-color-scheme counterpart)
  --no-flow-steps   html only: skip the per-hop frames a 'show flow' view needs
                    for stepping in presentation mode
  --scale <n>       png only: multiply the diagram's natural size
  --width <px>      png only: exact output width (height follows)
  --background <c>  png only: flatten onto a colour. Every theme paints its own
                    canvas, so this only shows through where one does not
  --sync            write every view × theme next to the source, refresh
                    squinch.lock, and print a README <picture> snippet
  --check           verify committed SVGs match the source (CI gate)
`;

/**
 * Semantic diff. Three shapes, in the order people reach for them:
 *   squinch diff                 working tree vs HEAD (or --base <ref>)
 *   squinch diff <path>          that project, working tree vs the ref
 *   squinch diff <old> <new>     two paths on disk
 */
function cmdDiff(positionals: string[], flags: Record<string, string | boolean>): number {
  const format = str(flags["format"]) ?? "text";
  if (!["text", "json", "markdown"].includes(format))
    throw new Error(`unknown --format \`${format}\` — use text | json | markdown`);
  const failOn = str(flags["fail-on"]);
  if (failOn && !["structural", "any"].includes(failOn))
    throw new Error(`unknown --fail-on \`${failOn}\` — use structural | any`);

  let before, after, subject: string;
  if (positionals.length >= 2) {
    before = loadInput(positionals[0]).files;
    after = loadInput(positionals[1]).files;
    subject = `${positionals[0]} → ${positionals[1]}`;
  } else {
    const path = positionals[0] ?? ".";
    const ref = str(flags["base"]) ?? "HEAD";
    if (!isGitRepo(process.cwd()))
      throw new Error("not a git repository — pass two paths instead: squinch diff <old> <new>");
    const at = loadInputAtRef(path, ref);
    if (!at) throw new Error(`\`${path}\` does not exist at ${ref} — it looks new`);
    before = at;
    after = loadInput(path).files;
    subject = `${ref} → working tree`;
  }

  const result = diffProjects(before, after);
  if (format === "json") console.log(JSON.stringify({ subject, ...result }, null, 2));
  else if (format === "markdown") console.log(formatDiffMarkdown(result));
  else console.log(formatDiff(result));

  if (failOn === "any" && !result.same) return 1;
  if (failOn === "structural" && result.structural > 0) return 1;
  return 0;
}

interface ViewInfo { name: string; scope?: string; auto?: boolean }

function reportDiagnostics(diags: Diagnostic[], json: boolean, views?: ViewInfo[]): void {
  if (json) {
    const errors = diags.filter((d) => d.severity === "error").length;
    console.log(
      JSON.stringify(
        {
          ok: errors === 0,
          errors,
          warnings: diags.length - errors,
          diagnostics: diags,
          // The quality bar asks authors to render every view they declared,
          // and nothing told them what those were: every cold-run agent ended
          // up copying the file elsewhere and running `--sync` to read the
          // filenames back off disk.
          ...(views ? { views } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (diags.length) console.error(formatDiagnostics(diags));
}

/** Shortest readable form: relative when inside cwd, absolute otherwise —
 *  always POSIX, because this is what the Action prints into a pull request. */
function display(file: string): string {
  const rel = relative(process.cwd(), file);
  return toPosix(rel.startsWith("..") || isAbsolute(rel) ? file : rel);
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Views to render. Containers all get an auto view (so the SPA can zoom
 * anywhere), but `--sync` commits only what the author declared — otherwise
 * every container would spawn files nobody asked for. With no explicit views,
 * the auto ones are all we have.
 */
function viewNames(input: Input): string[] {
  const built = buildProject(input.files);
  const explicit = built.model.views.filter((v) => !v.auto).map((v) => v.name);
  if (explicit.length) return explicit;
  return built.model.views.map((v) => v.name); // may be empty — see SOLE
}

/**
 * Filename label for a project that declares no views at all — a diagram of
 * top-level components with no `view` block and no container to auto-generate
 * one. It is a *label*, never a view name: this list used to end in a literal
 * `["default"]`, which every caller then passed to the renderer as if the
 * author had written `view default`. That was harmless while an unknown view
 * silently fell back to the implicit one; once round 3 made an unknown `--view`
 * a hard error (rightly — a typo used to hand you a different diagram at exit
 * 0), the sentinel turned into a landmine. `check` failed on a perfectly valid
 * file with "unknown view `default`, this project declares no views", which is
 * the tool contradicting itself in a single sentence. Five of twenty cold
 * agents hit it.
 */
const SOLE = "default";

/** What to render, as (filename label, view to ask the renderer for). */
function targets(input: Input): { label: string; view: string | undefined }[] {
  const names = viewNames(input);
  return names.length
    ? names.map((label) => ({ label, view: label }))
    : [{ label: SOLE, view: undefined }];
}

async function renderOne(
  input: Input,
  view: string | undefined,
  /** undefined = let the file's own `theme` decide, then core's default.
   *  Passing "light" here unconditionally is what made a declared `theme dark`
   *  a no-op through the CLI: core treats an explicit theme as the *override*
   *  (dsl-coverage.test.ts pins that precedence), so the CLI was overriding on
   *  every render. `--sync` is unaffected — it asks for each theme by name. */
  theme: string | undefined,
  adaptive = false,
): Promise<string> {
  const r = await renderProject(input.files, {
    ...(view ? { view } : {}), ...(theme ? { theme } : {}), adaptive,
  });
  if (!r.ok) {
    reportDiagnostics(r.diagnostics, false);
    throw new Error(`render failed for view \`${view ?? SOLE}\``);
  }
  const valid = validateSVG(r.svg!);
  if (!valid.ok) throw new Error(`internal: produced invalid SVG (${valid.error})`);
  if (r.diagnostics.length) reportDiagnostics(r.diagnostics, false);
  return r.svg!;
}

const outName = (base: string, view: string, theme: string) =>
  `${base}.${view}.${theme}.svg`;

async function cmdCheck(path: string, json: boolean): Promise<number> {
  const input = loadInput(path);
  const built = buildProject(input.files);
  // layout-stage diagnostics too: render every view
  const all: Diagnostic[] = [...built.diagnostics];
  if (built.ok)
    for (const { view } of targets(input))
      for (const theme of ["light"]) {
        const r = await renderProject(input.files, { ...(view ? { view } : {}), theme });
        for (const d of r.diagnostics)
          if (!all.some((x) => x.message === d.message && x.loc.from === d.loc.from)) all.push(d);
      }
  const views: ViewInfo[] = built.ok
    ? built.model.views.map((v) => ({ name: v.name, scope: v.scope, auto: v.auto }))
    : [];
  reportDiagnostics(all, json, views);
  const errors = all.filter((d) => d.severity === "error").length;
  const warnings = all.length - errors;
  if (!json) {
    console.error(
      errors === 0 && warnings === 0
        ? `${input.files.length} file(s) OK`
        : `\n${errors} error(s), ${warnings} warning(s)`,
    );
    if (views.length)
      console.error(
        `views: ${views.map((v) => (v.auto ? `${v.name} (auto)` : v.name)).join(", ")}`,
      );
  }
  return errors ? 1 : 0;
}

async function cmdRender(path: string, flags: Record<string, string | boolean>): Promise<number> {
  const input = loadInput(path);
  const theme = str(flags.theme);
  const view = str(flags.view);

  if (flags.sync || flags.check) {
    const views = targets(input);
    const stale: string[] = [];
    const crlfOnDisk: string[] = [];
    const written: string[] = [];
    const lock: Record<string, string> = {};
    for (const { label, view } of views)
      for (const t of THEMES) {
        const svg = await renderOne(input, view, t);
        const file = join(input.dir, outName(input.base, label, t));
        lock[outName(input.base, label, t)] = hash(svg);
        if (flags.check) {
          // Compare content, not bytes-on-disk. Squinch only ever writes LF
          // (asserted per-golden and across the corpus in core), so normalizing
          // here can mask exactly one difference: one the renderer could not
          // have produced. Comparing raw would make this command unusable on a
          // Windows checkout without .gitattributes — every diagram reads
          // stale, `--sync` rewrites them as LF, git cleans that back to the
          // identical blob, the commit is empty, and the next checkout is CRLF
          // again. The advisory below keeps the byte claim visible instead.
          const onDisk = existsSync(file) ? readFileSync(file, "utf8") : undefined;
          if (onDisk === undefined || onDisk.replace(/\r\n/g, "\n") !== svg) stale.push(display(file));
          else if (onDisk.includes("\r")) crlfOnDisk.push(display(file));
        } else {
          writeFileSync(file, svg);
          written.push(display(file));
        }
      }

    if (flags.check) {
      if (crlfOnDisk.length)
        console.error(
          `note: ${crlfOnDisk.length} committed diagram(s) have CRLF line endings on disk:\n` +
            crlfOnDisk.map((f) => `  ${f}`).join("\n") +
            `\n\nsquinch always writes LF — your checkout is converting them. Add a\n` +
            `.gitattributes with \`*.svg text eol=lf\` and re-clone (or run\n` +
            `\`git add --renormalize .\`) to keep them byte-identical across platforms.\n`,
        );
      if (stale.length) {
        console.error(
          `${stale.length} committed diagram(s) are stale or missing:\n` +
            stale.map((f) => `  ${f}`).join("\n") +
            `\n\nrun \`squinch render ${path} --sync\` and commit the result`,
        );
        return 1;
      }
      console.error(`${views.length * THEMES.length} diagram(s) up to date`);
      return 0;
    }

    writeFileSync(
      join(input.dir, "squinch.lock"),
      JSON.stringify({ version: VERSION, files: lock }, null, 2) + "\n",
    );
    console.error(written.map((f) => `wrote ${f}`).join("\n"));
    console.log(`\n<!-- README snippet -->`);
    for (const { label } of views)
      console.log(
        `<picture>\n` +
          `  <source media="(prefers-color-scheme: dark)" srcset="${outName(input.base, label, "dark")}">\n` +
          `  <img alt="${label}" src="${outName(input.base, label, "light")}">\n` +
          `</picture>`,
      );
    return 0;
  }

  const adaptive = !!flags.adaptive;
  const out = str(flags.o) ?? str(flags.output);
  // the format follows the output extension, so `-o d.png` and `-o d.html`
  // both just work; the explicit --format is for piping, and for saying so
  // when both are present.
  const format =
    str(flags.format) ??
    (out?.endsWith(".png") ? "png" : out?.endsWith(".html") ? "html" : "svg");
  if (format !== "svg" && format !== "png" && format !== "html")
    throw new Error(`unknown --format \`${format}\` — use svg | png | html`);

  if (format === "html") {
    // Every view in one file, with a viewer that dives between them — the
    // altitude experience, portable. Handled before renderOne because that
    // renders exactly one view, and this artifact is the whole set.
    if (!out) throw new Error("html is a document — give it a destination, e.g. -o diagram.html");
    // `--adaptive` folds two palettes into ONE svg using document-global class
    // names (sq-t0…). Inline several of those in one document and the second
    // view's classes repaint the first. The export carries real palettes and a
    // real switch instead, which is strictly more than adaptive buys here.
    if (adaptive)
      throw new Error(
        "--adaptive has no meaning for html — an interactive export already carries " +
        "every palette as a real theme switch, and folding two into one SVG makes its " +
        "class names collide across views. Drop --adaptive, or use --themes",
      );
    const themesFlag = str(flags.themes);
    const viewsFlag = str(flags.views);
    if (viewsFlag && viewsFlag !== "declared" && viewsFlag !== "all")
      throw new Error(`unknown --views \`${viewsFlag}\` — use declared | all`);
    const r = await exportHTML(input.files, {
      ...(view ? { view } : {}),
      ...(theme ? { themes: [theme] } : {}),
      ...(themesFlag ? { themes: themesFlag.split(",").map((t) => t.trim()) } : {}),
      ...(viewsFlag ? { views: viewsFlag as "declared" | "all" } : {}),
      ...(flags["no-flow-steps"] ? { flowSteps: false } : {}),
    });
    if (!r.ok || !r.html) {
      reportDiagnostics(r.diagnostics, false);
      throw new Error("interactive export failed");
    }
    writeFileSync(out, r.html);
    const kb = Math.round(r.manifest.bytes / 1024);
    const walked = Object.entries(r.manifest.flows);
    // stderr, like every other `wrote`, so stdout stays pipeable
    console.error(
      `wrote ${out} — ${r.manifest.views.length} view(s) × ${r.manifest.themes.length} palette(s), ` +
      `${r.manifest.renders} renders, ${kb} KB` +
      (walked.length ? ` (${walked.map(([v, n]) => `${v}: ${n} hops`).join(", ")})` : ""),
    );
    return 0;
  }

  const svg = await renderOne(input, view ?? viewNames(input)[0], theme, adaptive);

  if (format === "png") {
    if (!out) throw new Error("png is binary — give it a destination, e.g. -o diagram.png");
    // A raster has one palette by definition, and resvg would silently bake in
    // the light one. Say so rather than hand back a file that ignored the flag.
    if (adaptive)
      throw new Error("--adaptive has no meaning for png — a raster carries one palette; render two, or drop --adaptive");
    const { svgToPng } = await import("./raster.js");
    const scale = str(flags.scale);
    const width = str(flags.width);
    if (scale && width) throw new Error("--scale and --width both set — pick one");
    const n = (v: string, what: string) => {
      const parsed = Number(v);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${what} must be a positive number`);
      return parsed;
    };
    const png = svgToPng(svg, {
      width: width
        ? n(width, "width")
        : scale
          ? Math.round(svgWidth(svg) * n(scale, "scale"))
          : undefined,
      background: str(flags.background),
    });
    writeFileSync(out, png);
    console.error(`wrote ${out}`);
    return 0;
  }

  if (out) {
    writeFileSync(out, svg);
    console.error(`wrote ${out}`);
  } else console.log(svg.trimEnd());
  return 0;
}

/** The root <svg width="…">, which the renderer always emits in px. */
function svgWidth(svg: string): number {
  const m = svg.match(/<svg[^>]*\swidth="(\d+)"/);
  if (!m) throw new Error("could not read the diagram's width");
  return Number(m[1]);
}

async function cmdIcons(positionals: string[], flags: Record<string, string | boolean>): Promise<number> {
  const [sub, ...rest] = positionals;
  if (sub !== "search") {
    console.error("usage: squinch icons search <query> [--pack aws]");
    return 2;
  }
  const query = rest.join(" ");
  const hits = searchIcons(query, str(flags.pack));
  if (!hits.length) {
    console.error(`no icons match \`${query}\``);
    return 1;
  }
  // Name the short forms on the row. Search returns one row per icon, so
  // without this an author who was told to write `azure/key-vault` sees only
  // `azure/key-vaults` and concludes the documented name is wrong.
  console.log(
    hits
      .map((hit) => {
        const [pack, id] = [hit.slice(0, hit.indexOf("/")), hit.slice(hit.indexOf("/") + 1)];
        const short = Object.entries(packInfo(pack)?.aliases ?? {})
          .filter(([, target]) => target === id)
          .map(([alias]) => `${pack}/${alias}`);
        return short.length ? `${hit}  (or ${short.join(", ")})` : hit;
      })
      .join("\n"),
  );
  return 0;
}

const STARTER = `pack aws

system app "My Service" {
  api = aws/api-gateway "API Gateway"
  fn  = aws/lambda      "Handler"
  db  = aws/dynamodb    "Table"

  api -> fn
  fn  -> db
}

view app {
  layout {
    rows [api] [fn] [db]
  }
}
`;

function cmdInit(dir: string): number {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "diagram.squinch");
  if (existsSync(file)) {
    console.error(`${file} already exists — not overwriting`);
    return 1;
  }
  writeFileSync(file, STARTER);
  console.error(
    `created ${file}\n\nnext:\n  squinch render ${file} -o diagram.svg\n  squinch render ${file} --sync   # commit-ready SVGs + README snippet\n  squinch skill                   # teach your coding agent the language`,
  );
  return 0;
}

/**
 * Install the bundled SKILL.md where agents discover skills. Unlike `init`,
 * this *overwrites silently*: the installed file is a squinch-owned artifact
 * version-locked to this CLI, and refreshing it after an upgrade is the point —
 * there is nothing of the user's in it to protect.
 *
 * Both modes always write the cross-agent `.agents/skills/` dir (Cursor, Codex,
 * Gemini CLI, Copilot and friends read it — in the project, and under `$HOME`
 * for the user scope). Claude Code is the one agent that doesn't, so its
 * `.claude/skills/` copy is added when the target shows Claude Code markers —
 * or on request via `--claude`, which an agent that knows who it is can pass
 * for itself.
 */
function cmdSkill(positionals: string[], flags: Record<string, string | boolean>): number {
  if (flags.print) {
    console.log(SKILL_MD);
    return 0;
  }
  if (flags.global && positionals[0])
    throw new Error("--global installs to your home directory — drop the path, or drop the flag");

  const install = (dir: string): string => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "SKILL.md");
    writeFileSync(file, SKILL_MD);
    return file;
  };

  // The two scopes differ only in where they root and what announces Claude
  // Code: a `.claude/` dir either way, and a project also has CLAUDE.md — which
  // in a home directory would be a memory file, not a marker that Claude Code
  // is installed.
  const dir = flags.global ? homedir() : (positionals[0] ?? ".");
  const marker =
    existsSync(join(dir, ".claude")) || (!flags.global && existsSync(join(dir, "CLAUDE.md")));

  const wrote = [install(join(dir, ".agents", "skills", "squinch"))];
  if (marker || flags.claude) {
    wrote.push(install(join(dir, ".claude", "skills", "squinch")));
    if (!flags.claude)
      console.error(
        flags.global
          ? "detected Claude Code for your account (~/.claude) — installing there too"
          : "detected Claude Code in this project (CLAUDE.md or .claude/) — installing there too",
      );
  }
  for (const file of wrote) console.error(`wrote ${file} (squinch ${VERSION})`);
  console.error(
    `\nthe skill drives \`squinch check\` and \`squinch render\`, so keep squinch on\nPATH (\`npx squinch\` works too) — and re-run this after upgrading to refresh`,
  );
  return 0;
}

async function cmdWatch(path: string, flags: Record<string, string | boolean>): Promise<number> {
  const run = async () => {
    try {
      await cmdRender(path, flags);
    } catch (e) {
      console.error((e as Error).message);
    }
  };
  await run();
  console.error(`\nwatching ${path} … (ctrl-c to stop)`);
  watchPaths(path, () => void run());
  return new Promise(() => {}); // runs until interrupted
}

export async function main(argv: string[]): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv);
  // Version stands alone, and is answered before the usage branch — behind it,
  // `--version` fell into "no command" and printed the whole 40-line USAGE
  // with exit 2. Alongside a command the flag is ignored rather than honoured:
  // `check -v diagrams/` is somebody reaching for a verbose flag, and printing
  // a version instead of validating would exit 0 on a broken project — the one
  // failure a CI gate must never have.
  if (!command && (flags.version || flags.v)) {
    console.log(VERSION);
    return 0;
  }
  if (!command || flags.help || flags.h) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  try {
    switch (command) {
      case "check":
        if (!positionals[0]) throw new Error("usage: squinch check <path>");
        return await cmdCheck(positionals[0], flags.format === "json");
      case "render":
        if (!positionals[0]) throw new Error("usage: squinch render <path>");
        return await cmdRender(positionals[0], flags);
      case "icons":
        return await cmdIcons(positionals, flags);
      case "init":
        return cmdInit(positionals[0] ?? ".");
      case "skill":
        return cmdSkill(positionals, flags);
      case "watch":
        if (!positionals[0]) throw new Error("usage: squinch watch <path>");
        return await cmdWatch(positionals[0], flags);
      case "diff":
        return cmdDiff(positionals, flags);
      default:
        console.error(`unknown command \`${command}\`\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
}
