// One version for the whole workspace.
//
//   node scripts/version.mjs            # print the current version
//   node scripts/version.mjs 0.1.0      # set it everywhere
//
// The extension, the CLI and the engine are one product cut three ways — the
// extension is mostly the same code behind a different view — so a reader
// comparing "which squinch is this?" across a VSIX, an npm package and a
// squinch.lock should get one answer. Independent versions would make those
// three numbers drift immediately and mean nothing to anyone.
//
// The root package.json holds the truth; every workspace member follows. A
// guardrail test asserts they agree, so a hand-edit to one manifest fails the
// suite rather than shipping a mismatch.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every pnpm workspace member (packages/*, apps/*, gauntlet), plus the root —
 *  and the two plugin manifests, which are not package.jsons but answer the
 *  same "which squinch is this?" question for plugin users. packages/skill is
 *  one directory published as two plugins off one skills/ dir: Claude Code
 *  reads .claude-plugin/plugin.json, Codex and the rest of the Agent Plugins
 *  clients read the root plugin.json. */
export function manifests() {
  const dirs = ["packages", "apps"].flatMap((d) =>
    readdirSync(join(root, d)).map((p) => join(d, p)),
  );
  return [
    ...["", ...dirs, "gauntlet"].map((d) => join(d, "package.json")),
    join("packages", "skill", ".claude-plugin", "plugin.json"),
    join("packages", "skill", "plugin.json"),
  ].filter((p) => existsSync(join(root, p)));
}

const read = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const target = process.argv[2];
if (!target) {
  console.log(read("package.json").version ?? "(unset)");
  process.exit(0);
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(target)) {
  console.error(`not a version: ${target}\nusage: node scripts/version.mjs <major.minor.patch>`);
  process.exit(2);
}

for (const rel of manifests()) {
  const pkg = read(rel);
  if (pkg.version === target) continue;
  // Rewrite the value in place so key order — and the diff — stays minimal.
  const src = readFileSync(join(root, rel), "utf8");
  const next = src.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${target}$2`);
  if (next === src) {
    console.error(`${rel}: no "version" field to set`);
    process.exit(1);
  }
  writeFileSync(join(root, rel), next);
  console.log(`${rel}  ${pkg.version} → ${target}`);
}
