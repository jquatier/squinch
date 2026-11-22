// The release command. One interaction, then the machinery takes over:
//
//   pnpm release                # prompts for the new version
//   pnpm release 0.1.0          # same, version given up front
//   pnpm release 0.1.0 --no-edit   # accept the drafted notes as-is
//   pnpm release 0.1.0 --notes "Initial release."   # your notes, no editor
//   pnpm release 0.1.0 --notes-file notes.md        # the same, from a file
//   pnpm release --dry-run      # show everything, write nothing
//
// In Claude Code, `/release` (.claude/skills/release/) writes the notes as
// prose from this draft, checks them with --dry-run, and runs this with
// --notes-file once the maintainer has approved them.
//
// It drafts the CHANGELOG section from the commits since the last tag, the SVG
// of every lookbook case and example project added since then embedded under
// the commit that added it (scripts/release-shots.mjs), opens it in $EDITOR to
// be trimmed into something a reader deserves — the pictures stay with the
// features they show — bumps every
// workspace manifest via scripts/version.mjs, commits, tags vX.Y.Z, and pushes
// branch + tag together. From there .github/workflows/release.yml builds the
// VSIX from that exact commit, re-runs the suite, publishes the GitHub
// Release with this section as its notes, and publishes the npm packages. If
// CI fails, no release exists — fix and run this again with the next number.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { repoUrl, screenshots, shotMarkdown, shotProblems } from "./release-shots.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noEdit = args.includes("--no-edit");
// --notes "text" supplies the section body directly — no draft, no editor.
// This is the non-interactive path (an agent or CI has no $EDITOR), and the
// honest spelling of "I already know what the notes should say".
// --notes-file reads it from a file: written notes are Markdown full of
// backticks, which a shell argument mangles (the /release skill uses this).
const notesAt = args.indexOf("--notes"), fileAt = args.indexOf("--notes-file");
const notesFile = fileAt !== -1 ? args[fileAt + 1] : undefined;
const readable = notesFile && !notesFile.startsWith("--") && existsSync(notesFile);
const givenNotes = notesAt !== -1 ? args[notesAt + 1] : readable ? readFileSync(notesFile, "utf8").trim() : undefined;
// The value after --notes / --notes-file is not the version.
const values = new Set([notesAt, fileAt].filter((i) => i !== -1).map((i) => i + 1));
const givenVersion = args.find((a, i) => !a.startsWith("--") && !values.has(i));

// stderr piped, not inherited: the no-tags-yet probe (`git describe`) fails
// by design on a fresh repo, and its "fatal:" would leak into our output.
const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

// ── preflight rails ─────────────────────────────────────────────────────────
if (notesAt !== -1 && (!givenNotes || givenNotes.startsWith("--")))
  fail("--notes needs a value — a following flag doesn't count");
if (fileAt !== -1 && (!notesFile || notesFile.startsWith("--"))) fail("--notes-file needs a path");
if (fileAt !== -1 && !readable) fail(`no such file: ${notesFile}`);
if (notesAt !== -1 && fileAt !== -1) fail("--notes or --notes-file, not both");
if (fileAt !== -1 && !givenNotes) fail(`${notesFile} is empty`);
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") fail(`on \`${branch}\` — releases cut from main`);
if (git("status", "--porcelain") !== "") fail("working tree is dirty — commit or stash first");
git("fetch", "-q", "origin", "main");
if (git("rev-list", "--count", "HEAD..origin/main") !== "0")
  fail("behind origin/main — pull first");

const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const lastTag = (() => {
  try {
    return git("describe", "--tags", "--abbrev=0");
  } catch {
    return undefined;
  }
})();

// ── the version ─────────────────────────────────────────────────────────────
let version = givenVersion;
if (!version) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`current version: ${current}   (last release: ${lastTag ?? "none"})`);
  version = (await rl.question("new version: ")).trim();
  rl.close();
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) fail(`not a version: \`${version}\``);
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(/[.-]/).map((n) => (/^\d+$/.test(n) ? +n : n)));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return x.length > 3 || y.length <= 3 ? false : true; // 0.1.0 > 0.1.0-rc.1
};
if (!newer(version, current)) fail(`\`${version}\` is not greater than the current ${current}`);
try {
  git("rev-parse", "-q", "--verify", `refs/tags/v${version}`);
  fail(`tag v${version} already exists`);
} catch {
  /* good — it must not */
}

// ── draft the notes ─────────────────────────────────────────────────────────
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const subjects = git("log", "--no-merges", "--format=%s|%h", range)
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const at = l.lastIndexOf("|");
    return { subject: l.slice(0, at), sha: l.slice(at + 1) };
  })
  .filter((c) => !/^release:/.test(c.subject));
if (subjects.length === 0) fail(`nothing to release — no commits since ${lastTag}`);

const today = new Date().toISOString().slice(0, 10);
const heading = `## ${version} — ${today}`;
// Pictures of what is new: added files only, renames not counted as additions
// so a moved case does not reappear. Each is embedded under the commit that
// added its case or example — the line announcing the feature — indented into
// that bullet so it stays with it when the draft is rewritten into prose.
const added = lastTag
  ? git("diff", "--name-only", "--no-renames", "--diff-filter=A", `${lastTag}..HEAD`, "--", "lookbook/cases", "examples").split("\n").filter(Boolean)
  : [];
const repo = repoUrl(root);
const shots = screenshots(root, added);
const addedBy = (file) => git("log", "--format=%h", "--no-renames", "--diff-filter=A", range, "--", file).split("\n")[0];
const pictured = new Map();
for (const s of shots) {
  const sha = addedBy(s.source);
  const at = subjects.find((c) => sha && (c.sha.startsWith(sha) || sha.startsWith(c.sha))) ?? subjects[0];
  pictured.set(at, [...(pictured.get(at) ?? []), shotMarkdown(repo, version, s)]);
}
let body = givenNotes ??
  subjects.map((c) => `- ${c.subject} (${c.sha})` + (pictured.get(c) ?? []).map((md) => `\n\n  ${md}\n`).join("")).join("\n");
// Notes given whole are placed by their author: name what they show no picture
// of, with the line to paste, rather than gather pictures at the end of them.
const unshown = givenNotes ? shots.filter((s) => !body.includes(s.path)) : [];

console.log(`\n${subjects.length} commit(s) since ${lastTag ?? "the beginning"}` +
  (shots.length ? `, ${shots.length} picture(s) of what is new.\n` : ".\n"));
if (unshown.length)
  console.log(`your notes show no picture of ${unshown.length} new feature(s) — paste each where the notes talk about it:\n` +
    unshown.map((s) => `  ${s.title}: ${shotMarkdown(repo, version, s)}`).join("\n") + "\n");

// ── edit ────────────────────────────────────────────────────────────────────
if (!givenNotes && !noEdit && process.stdout.isTTY) {
  const editor = process.env.EDITOR ?? process.env.VISUAL;
  if (editor) {
    const dir = mkdtempSync(join(tmpdir(), "squinch-release-"));
    const file = join(dir, "notes.md");
    writeFileSync(
      file,
      `${body}\n\n# Edit the release notes for ${version} above. Lines starting\n# with '#' are dropped. An empty file aborts the release.\n`,
    );
    const r = spawnSync(editor, [file], { stdio: "inherit" });
    if (r.status !== 0) fail(`$EDITOR exited ${r.status}`);
    body = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n")
      .trim();
    rmSync(dir, { recursive: true, force: true });
    if (!body) fail("empty notes — aborted");
  }
}

// the release workflow refuses a picture at another version or of a missing
// file (scripts/release-notes.mjs); say so here, before anything is tagged
const broken = shotProblems(root, version, body);
if (broken.length) fail(`the notes link pictures that will not show:\n  ${broken.join("\n  ")}`);

const section = `${heading}\n\n${body}\n`;
console.log(`${"─".repeat(64)}\n${section}${"─".repeat(64)}`);

if (dryRun) {
  console.log("--dry-run: nothing written, nothing tagged.");
  process.exit(0);
}

// ── confirm ─────────────────────────────────────────────────────────────────
{
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const yes = (await rl.question(`tag v${version} and push? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (yes !== "y" && yes !== "yes") fail("aborted");
}

// ── write, bump, commit, tag, push ──────────────────────────────────────────
const logPath = join(root, "CHANGELOG.md");
const log = readFileSync(logPath, "utf8");
const insertAt = log.search(/^## /m);
const next =
  insertAt === -1
    ? log.replace(/\n(No releases yet\.\n)?$/, `\n${section}`)
    : log.slice(0, insertAt) + section + "\n" + log.slice(insertAt);
writeFileSync(logPath, next.replace(/\nNo releases yet\.\n/, "\n"));

execFileSync(process.execPath, [join(root, "scripts", "version.mjs"), version], {
  cwd: root,
  stdio: "inherit",
});

git("add", "-A");
git("commit", "-m", `release: ${version}`);
git("tag", `v${version}`);
git("push", "origin", "main", `v${version}`);

const remote = git("remote", "get-url", "origin").replace(/\.git$/, "");
console.log(
  `\nv${version} pushed — watch ${remote}/actions (release.yml builds, releases, and publishes to npm).`,
);
