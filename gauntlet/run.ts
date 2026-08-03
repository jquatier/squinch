// The gauntlet as a command: N cold agents, one per prompt, each given nothing
// but SKILL.md and a working `squinch`, each in a sandbox that cannot see this
// repo. Answers the two questions the corpus alone cannot:
//
//   1. Does the skill still work? A fresh agent, no context, no examples to
//      copy, produces a correct diagram with zero human fixes.
//   2. Does the renderer still work? Twenty diverse real diagrams through every
//      theme, resvg, and a determinism compare (that part is `score.ts --deep`).
//
//   npx tsx gauntlet/run.ts                 # all 20
//   npx tsx gauntlet/run.ts 03 17           # a subset, by id prefix
//   npx tsx gauntlet/run.ts --model opus --concurrency 4 --keep
//
// macOS/Linux only, deliberately: the sandbox hands each agent a `squinch` on
// PATH as an extensionless `#!/usr/bin/env node` shim, spawns `claude` and
// `pnpm` directly (both are .cmd shims on Windows), and reads $HOME. Porting it
// buys nothing — this is a maintainer command that spends real money, and the
// half CI runs (score.ts) is pure Node and does work everywhere.
//
// Maintainer-only, never CI: it costs real money and agents are not
// deterministic. The script makes the *conditions* repeatable, not the outcome.
// CI keeps scoring whatever corpus the last reviewed run committed.
//
// ## The protocol (this file is its only specification)
//
// Each prompt gets `<tmp>/box/<id>/` holding exactly three things: `SKILL.md`,
// `PROMPT.md`, and `bin/squinch`. cwd is that box and the repo is not reachable
// from it — not by relative path, and not by any path printed anywhere the
// agent can look. That last part is why the CLI is **bundled** rather than
// shimmed to `packages/cli/bin/squinch.js`: a shim would hand the agent a repo
// path, and two `cd ..`s from there sits `gauntlet/solutions/` — the answers.
//
// Three things survive bundling only if planted beside it, and each fails in a
// way that reads as *agent* failure rather than harness failure:
//   - the four pack dirs   (`packs/node-fs.ts` walks up from `import.meta.url`)
//   - `@squinch/core/fonts/*.ttf` (`raster.ts` does a real `require.resolve`)
//   - `@resvg/resvg-js` + its platform binary (or `-o out.png` dies)
//
// `bin/squinch` is not a passthrough. It records every invocation — argv, exit
// code, output — to a log **outside** the box, so iteration count and the first
// failing diagnostic come from the harness rather than from asking the agent to
// self-report. Outside because inside the agent could read it, and a stray
// `render --sync` could clobber it.
//
// ## What "passed with no fixes" means
//
// Not exit code: `squinch check` exits 0 on warnings. Success is **one `check`
// call, exit 0, zero warnings**. A second call means the agent needed a fix,
// which is the signal worth reporting even when the prompt ultimately passes —
// rounds 2 and 3 found sixteen defects that way, four of them silent.
//
// ## The honest limit
//
// The read leak is measured, not prevented. No permission mode both allows free
// Bash and blocks `cat /Users/…/gauntlet/solutions/01-….squinch`; only an OS
// sandbox would, and that is not worth building. A narrow `Bash(squinch:*)`
// allowlist is worse than useless — denials burn turns and look like tool
// friction, corrupting the measurement being taken. So: no signpost in the box,
// and every tool input scanned for paths escaping it, reported per prompt.
// Zero means the round is trustworthy; one tells you which prompt to discard.
//
// Related: never start a round with uncommitted work. The agent runs shell with
// your rights while you are away.
import { spawn, execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require_ = createRequire(import.meta.url);
/** resvg is a dependency of the CLI, not of this package — resolve it from
 *  there, or pnpm's strict layout hands you a miss and the boxes get a CLI
 *  that cannot start. */
const cliRequire = createRequire(join(root, "packages/cli/package.json"));

interface Prompt { id: string; prompt: string }
const prompts: Prompt[] = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));

// ── args ───────────────────────────────────────────────────────────────────
// Values are consumed by position, never by shape. Prompt ids *are* numbers
// ("01"), so any "is this a flag value?" test on the token itself misreads a
// selector as one and silently widens the round to all twenty — which
// overwrites the whole committed corpus. Unknown flags are fatal for the same
// reason: a typo must not mean "everything".
const VALUED = new Set(["model", "concurrency", "budget"]);
const BOOLS = new Set(["keep", "prune"]);
const opts: Record<string, string> = {};
const bools = new Set<string>();
const only: string[] = [];
for (let i = 0; i < process.argv.length - 2; i++) {
  const a = process.argv[i + 2];
  if (!a.startsWith("--")) { only.push(a); continue; }
  const name = a.slice(2);
  if (VALUED.has(name)) {
    const v = process.argv[i + 3];
    if (!v || v.startsWith("--")) die(`--${name} needs a value`);
    opts[name] = v;
    i++;
  } else if (BOOLS.has(name)) bools.add(name);
  else die(`unknown flag --${name}`);
}
const MODEL = opts.model ?? "sonnet";
const CONCURRENCY = Number(opts.concurrency ?? "4");
const BUDGET = opts.budget ?? "2.00";
const KEEP = bools.has("keep");
const PRUNE = bools.has("prune");
const selected = only.length
  ? prompts.filter((p) => only.some((o) => p.id.startsWith(o)))
  : prompts;
if (!selected.length) die(`no prompt matches ${only.join(", ")}`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const tmp = join(tmpdir(), `squinch-gauntlet-${stamp}`);
const runDir = join(here, ".run", stamp);
const cliDir = join(tmp, "cli");
const bundle = join(cliDir, "squinch.mjs");

// ── guards: each one is cheap and each one prevents paying to measure nothing ─
function die(msg: string): never {
  console.error(`gauntlet: ${msg}`);
  process.exit(1);
}

// A dirty tree is not fatal, but it is worth one line — the agents run shell
// with your rights, and an interrupted round leaves you diffing your own edits
// against theirs.
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim())
  console.warn("gauntlet: repo has uncommitted work — agents run shell with your rights\n");

// A user-level memory that mentions Squinch makes every "cold" agent warm, and
// the round is worthless while looking completely normal.
for (const memo of [join(process.env.HOME ?? "", ".claude/CLAUDE.md")])
  if (existsSync(memo) && /squinch/i.test(readFileSync(memo, "utf8")))
    die(`${memo} mentions Squinch — no agent in this round would be cold. Move it aside.`);

console.log("building packages…");
execFileSync("pnpm", ["-r", "build"], { cwd: root, stdio: "inherit" });

// ── the shared CLI: bundled once, read-only, shared by every box ────────────
console.log("bundling the CLI…");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(cliDir, { recursive: true });
await build({
  entryPoints: [join(root, "packages/cli/src/cli.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // native addon — cannot be bundled, so it is planted in node_modules below
  external: ["@resvg/resvg-js"],
  logLevel: "warning",
});

// packs: node-fs.ts walks up from the bundle's own dir, so `<cli>/pack-aws`
// is the candidate that hits (the same trick packages/vscode/scripts/bundle.mjs
// uses for the extension host).
for (const name of ["pack-aws", "pack-azure", "pack-logos", "pack-sys", "pack-k8s"]) {
  const pack = join(root, "packages", name);
  cpSync(join(pack, "pack.json"), join(cliDir, name, "pack.json"));
  cpSync(join(pack, "icons"), join(cliDir, name, "icons"), { recursive: true });
}

// fonts: raster.ts resolves `@squinch/core/fonts/*.ttf` for real, because resvg
// cannot read the @font-face the SVG embeds. Without these a PNG silently picks
// up whatever the machine has — the one thing the project forbids.
const fontPkg = join(cliDir, "node_modules/@squinch/core");
mkdirSync(fontPkg, { recursive: true });
writeFileSync(
  join(fontPkg, "package.json"),
  JSON.stringify({ name: "@squinch/core", version: "0.0.0", exports: { "./fonts/*": "./fonts/*" } }, null, 2),
);
cpSync(join(root, "packages/core/fonts"), join(fontPkg, "fonts"), { recursive: true });

// resvg: the JS wrapper plus this platform's native binary, both by resolved
// path so no pnpm store layout is ever hard-coded. The binary is an optional
// dep *of the wrapper*, so it only resolves from the wrapper's own location.
//
// Not optional and not a warning to scroll past: esbuild hoists the CLI's lazy
// `import("./raster.js")` into a static import, so a missing resvg is a
// link-time failure — the bundled CLI would not start at all.
{
  const plant = (from: string, pkg: string) => {
    cpSync(from, join(cliDir, "node_modules", pkg), { recursive: true, dereference: true });
  };
  let wrapper: string;
  try {
    wrapper = dirname(cliRequire.resolve("@resvg/resvg-js/package.json"));
  } catch (err) {
    die(`@resvg/resvg-js not resolvable (${(err as Error).message.split("\n")[0]})`);
  }
  plant(wrapper, "@resvg/resvg-js");
  const native = `@resvg/resvg-js-${process.platform}-${process.arch}`;
  try {
    plant(dirname(createRequire(join(wrapper, "package.json")).resolve(`${native}/package.json`)), native);
  } catch (err) {
    die(`${native} not resolvable (${(err as Error).message.split("\n")[0]})`);
  }
}

// Smoke test. esbuild silently producing a subtly different CLI is the
// scariest failure here: it would read as twenty agent failures. Ten lines
// turn it into a startup error.
{
  const probe = selected.find((p) => existsSync(join(here, "solutions", `${p.id}.squinch`)));
  if (!probe) die("no committed solution to smoke-test the bundle against");
  const file = join(here, "solutions", `${probe.id}.squinch`);
  // Compare the two CLIs against each other, which is what "faithful" means.
  // Asserting the probe file is *clean* instead was wrong twice over: it tests
  // the corpus rather than the bundle, and the moment a round commits a
  // solution carrying a warning — which is allowed, and is exactly what a
  // round is for — the guard misfires and no round can start again.
  const check = (bin: string[]) => {
    try {
      return execFileSync(process.execPath, [...bin, "check", file, "--format", "json"], {
        encoding: "utf8",
      });
    } catch (err) {
      return String((err as { stdout?: string }).stdout ?? ""); // check exits 1 on errors
    }
  };
  const bundled = check([bundle]);
  const repo = check([join(root, "packages/cli/bin/squinch.js")]);
  if (bundled !== repo)
    die(
      `bundled CLI disagrees with the repo CLI on ${probe.id} — bundle is not faithful\n` +
        `  bundled: ${bundled.slice(0, 400)}\n  repo:    ${repo.slice(0, 400)}`,
    );
  console.log(`bundle ok (agrees with the repo CLI on ${probe.id})\n`);
}

// ── one sandbox per prompt ─────────────────────────────────────────────────
const skill = readFileSync(join(root, "packages/skill/SKILL.md"), "utf8");
mkdirSync(join(tmp, "logs"), { recursive: true });
mkdirSync(join(runDir, "transcripts"), { recursive: true });

/** Paths that would mean the agent looked outside its box. */
const ESCAPES = [/\/Users\//, /~\//, /\.\.\//, /github\/squinch/];

/**
 * The child's environment, built from an allowlist rather than inherited.
 *
 * Inheriting is contamination in the same category as a user-level CLAUDE.md,
 * and it is not theoretical: run this from inside a Claude Code session and the
 * parent's own `CLAUDE_CODE_*` and `ANTHROPIC_BASE_URL` reach the child, which
 * then dies mid-session on `tool_use ids must be unique` — every prompt scoring
 * `no-solution` for a reason that has nothing to do with the skill. An
 * allowlist also makes the boxes identical whoever runs them.
 *
 * Credentials are the deliberate exception: a real API key is how some machines
 * authenticate at all, and it carries no session state.
 */
function childEnv(box: string): Record<string, string> {
  const env: Record<string, string> = { PATH: `${join(box, "bin")}:${process.env.PATH}` };
  for (const k of ["HOME", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER",
                   "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])
    if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

interface Result {
  id: string;
  status: "ok" | "no-solution" | "failed";
  checkCalls: number;
  warnings: number;
  firstFailure?: { argv: string[]; output: string };
  /** the session's own error, when it died rather than finished */
  sessionError?: string;
  /** tool calls the permission layer refused — harness fault, not skill signal */
  denials: number;
  attempts: number;
  escapes: number;
  ms: number;
}

/** One `claude -p` session against a freshly-built box. */
async function session(p: Prompt, box: string, log: string) {
  rmSync(box, { recursive: true, force: true });
  rmSync(log, { force: true });
  mkdirSync(join(box, "bin"), { recursive: true });
  writeFileSync(join(box, "SKILL.md"), skill);
  writeFileSync(join(box, "PROMPT.md"), `${p.prompt}\n`);

  // The shim: tee the real CLI's output through, then record the call. CJS
  // because the file is extensionless and Node reads that as CommonJS.
  writeFileSync(
    join(box, "bin", "squinch"),
    `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const t0 = Date.now();
const child = spawn(process.execPath, [${JSON.stringify(bundle)}, ...args],
  { stdio: ["inherit", "pipe", "pipe"] });
let out = "", err = "";
child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
child.stderr.on("data", (d) => { err += d; process.stderr.write(d); });
child.on("exit", (code) => {
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({
    argv: args, code, ms: Date.now() - t0,
    stdout: out.slice(0, 8000), stderr: err.slice(0, 4000),
  }) + "\\n");
  process.exit(code ?? 1);
});
`,
    { mode: 0o755 },
  );

  const t0 = Date.now();
  const transcript = join(runDir, "transcripts", `${p.id}.jsonl`);
  let escapes = 0;
  let denials = 0;
  let error: string | undefined;

  await new Promise<void>((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "SKILL.md in this directory is the authoring guide for Squinch, a " +
          "diagrams-as-code tool. PROMPT.md is a request from a user. Follow " +
          "SKILL.md to build the diagram PROMPT.md asks for, and save it as " +
          `${p.id}.squinch in this directory. The \`squinch\` CLI is on your PATH.`,
        "--model", MODEL,
        "--output-format", "stream-json", "--verbose",
        // acceptEdits covers Write/Edit but *not* Bash, and `squinch` is the
        // whole point — without the allowlist every call comes back "requires
        // approval" and the agent burns its budget retrying the same command
        // twenty times. Measured: 320s and zero check calls.
        "--permission-mode", "acceptEdits",
        "--allowedTools", "Bash",
        // WebSearch/WebFetch are absent by construction, which structurally
        // closes "the agent googles Squinch" rather than asking it not to.
        "--tools", "Bash,Read,Write,Edit,Glob,Grep,TodoWrite",
        // this machine's MCP servers and user settings stay out of the box
        "--strict-mcp-config",
        "--setting-sources", "project,local",
        "--no-session-persistence",
        "--max-budget-usd", BUDGET,
      ],
      { cwd: box, env: childEnv(box), stdio: ["ignore", "pipe", "pipe"] },
    );
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        appendFileSync(transcript, `${line}\n`);
        if (ESCAPES.some((re) => re.test(line))) escapes++;
        // A permission denial is a harness fault wearing an agent's clothes:
        // the run looks like "the agent never validated its work" when in fact
        // the tool was refused. Counted so it can never be read as a skill
        // result again.
        if (line.includes("requires approval")) denials++;
        // The session reports its own death here. Without this a 429, a budget
        // stop and a genuine "the agent could not do it" all read as the same
        // blank `no-solution`, and only one of the three is about the skill.
        try {
          const ev = JSON.parse(line);
          if (ev.type === "result" && ev.is_error) error = String(ev.result).slice(0, 300);
        } catch { /* not every line is a complete event */ }
      }
    });
    child.stderr.on("data", () => {});
    child.on("close", () => resolve());
  });
  return { escapes, denials, error, ms: Date.now() - t0 };
}

async function runPrompt(p: Prompt): Promise<Result> {
  const box = join(tmp, "box", p.id);
  const log = join(tmp, "logs", `${p.id}.jsonl`);

  // One retry, and only when the session *died* without producing anything.
  // Transient API failures are common enough over twenty sessions that without
  // this a round loses prompts to noise and reads as a skill regression.
  let s = await session(p, box, log);
  let attempts = 1;
  if (s.error && !existsSync(join(box, `${p.id}.squinch`))) {
    console.log(`  ${p.id}: session died (${s.error.split("\n")[0].slice(0, 80)}) — retrying once`);
    const retry = await session(p, box, log);
    s = { ...retry, ms: s.ms + retry.ms };
    attempts = 2;
  }
  const { escapes, denials, error, ms } = s;

  // ── harvest ──────────────────────────────────────────────────────────────
  const produced = join(box, `${p.id}.squinch`);
  const calls: { argv: string[]; code: number; stdout: string; stderr: string }[] = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const checks = calls.filter((c) => c.argv[0] === "check");
  const failure = calls.find((c) => c.code !== 0);
  const base: Omit<Result, "status" | "warnings"> = {
    id: p.id,
    checkCalls: checks.length,
    firstFailure: failure
      ? { argv: failure.argv, output: `${failure.stdout}${failure.stderr}`.trim().slice(0, 600) }
      : undefined,
    sessionError: error,
    attempts,
    escapes,
    denials,
    ms,
  };
  if (!existsSync(produced)) return { ...base, status: "no-solution", warnings: 0 };

  // Non-destructive by default: a 429 or a timeout must not delete a good
  // diagram. That is the worst thing a maintenance script can do.
  cpSync(produced, join(here, "solutions", `${p.id}.squinch`));

  let warnings = 0;
  let ok = false;
  try {
    const out = execFileSync(process.execPath, [bundle, "check", produced, "--format", "json"], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(out);
    ok = parsed.ok === true;
    warnings = parsed.warnings ?? 0; // a count in `--format json`, not a list
  } catch {
    ok = false;
  }
  return { ...base, status: ok ? "ok" : "failed", warnings };
}

// ── the pool ───────────────────────────────────────────────────────────────
// Name them: every id listed here has its committed solution overwritten by
// whatever comes back, so the selection is worth reading before the spend.
console.log(
  `running ${selected.length} prompt(s) on ${MODEL}, ${CONCURRENCY} at a time — ` +
    `overwrites solutions/{${selected.map((p) => p.id).join(", ")}}\n`,
);
const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, selected.length) }, async () => {
    for (let i = next++; i < selected.length; i = next++) {
      const p = selected[i];
      const r = await runPrompt(p);
      results.push(r);
      const mark = r.status === "ok" ? (r.checkCalls === 1 && !r.warnings ? "✓" : "~") : "✗";
      console.log(
        `${mark} ${r.id}  ${r.status}  ${r.checkCalls} check call(s)` +
          `${r.warnings ? `, ${r.warnings} warning(s)` : ""}` +
          `${r.denials ? `, ${r.denials} PERMISSION DENIAL(S)` : ""}` +
          `${r.escapes ? `, ${r.escapes} outside-sandbox read(s)` : ""}` +
          `  ${(r.ms / 1000).toFixed(0)}s`,
      );
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));

if (PRUNE)
  for (const r of results)
    if (r.status === "no-solution") rmSync(join(here, "solutions", `${r.id}.squinch`), { force: true });

// ── report ─────────────────────────────────────────────────────────────────
cpSync(join(tmp, "logs"), join(runDir, "logs"), { recursive: true });
const clean = results.filter((r) => r.status === "ok" && r.checkCalls === 1 && !r.warnings);
console.log(`\n── round ${stamp} ──`);
console.log(`clean first try : ${clean.length}/${results.length}`);
console.log(`produced a file : ${results.filter((r) => r.status !== "no-solution").length}/${results.length}`);
const leaked = results.filter((r) => r.escapes);
console.log(
  `outside-sandbox : ${leaked.length ? `${leaked.map((r) => r.id).join(", ")} — discard these` : "none"}`,
);

// Everything above one check call is the raw material for a skill edit: what
// the agent hit, in its own diagnostics.
const struggled = results.filter((r) => r.checkCalls > 1 || r.status !== "ok");
if (struggled.length) {
  console.log("\nneeded fixes (candidates for a SKILL.md edit):");
  for (const r of struggled) {
    console.log(
      `\n  ${r.id} — ${r.checkCalls} check call(s), ${r.status}` +
        (r.attempts > 1 ? ` (${r.attempts} attempts)` : ""),
    );
    // A dead session is a harness/API story, not a skill story — say so, so it
    // is not mistaken for the agent failing to author a diagram.
    if (r.sessionError) console.log(`    session error: ${r.sessionError.split("\n")[0]}`);
    if (r.denials)
      console.log(
        `    ${r.denials} tool call(s) refused by the permission layer — harness fault, ` +
          "not a skill result; fix the flags and re-run this prompt",
      );
    if (r.firstFailure)
      console.log(
        `    first failure: squinch ${r.firstFailure.argv.join(" ")}\n` +
          r.firstFailure.output.split("\n").map((l) => `      ${l}`).join("\n"),
      );
  }
}

writeFileSync(join(runDir, "report.json"), `${JSON.stringify({ stamp, model: MODEL, results }, null, 2)}\n`);
console.log(`\nlogs + transcripts: ${runDir}`);
if (KEEP) console.log(`sandboxes kept:     ${tmp}`);
else rmSync(tmp, { recursive: true, force: true });

// ── the deterministic half: goal 2 ─────────────────────────────────────────
console.log("\nscoring the corpus (deep)…\n");
const score = spawn(process.execPath, [require_.resolve("tsx/cli"), join(here, "score.ts"), "--deep"], {
  cwd: root,
  stdio: "inherit",
});
score.on("close", (code) => process.exit(code ?? 1));
