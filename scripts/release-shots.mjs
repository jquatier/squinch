// Pictures in the release notes: the SVG of every feature a release adds,
// embedded where the notes talk about it, so the GitHub Release shows what is
// new rather than only listing it.
//
// What counts as new is what the repository already uses to show a feature:
// a lookbook case (`lookbook/cases/*.squinch`) or an example project
// (`examples/<dir>/`) added since the last tag. Both have their renders
// committed beside them, so a picture is a link to a file in the tagged tree —
// `blob/v<version>/…svg?raw=true`, the form 0.21.0's notes were written in by
// hand — and nothing new has to be produced or uploaded.
//
// `release.mjs` embeds each one in the draft under the commit that added its
// case or example — the line that announces the feature, so a picture is where
// the notes talk about it, not gathered at the end — and, for notes given with
// --notes, names the features they show no picture of. `release-notes.mjs`,
// which the release workflow runs, refuses notes whose pictures point at
// another version or at a file that does not exist, so a release cannot ship a
// broken image.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The GitHub repository, from the CLI's manifest — the one the registry and
 *  the extension already point at, and not the git remote, whose URL depends
 *  on how a clone was made. */
export function repoUrl(root) {
  const url = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).repository.url;
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

/** The first sentence of a `.squinch` file's leading comment: what the
 *  picture shows, as its alt text. */
function caption(file) {
  const lines = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("//")) break;
    lines.push(line.replace(/^\/\/ ?/, "").trim());
  }
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  return (/^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text).replace(/[[\]`]/g, "");
}

// The lookbook's own titling (lookbook/build.ts): the ordinal dropped,
// the words title-cased.
const titleize = (name) =>
  name.replace(/^\d+-/, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** Every picture of what `files` (added since the last tag) brought: one per
 *  light render of each new lookbook case and each new example project, with
 *  the file whose adding commit announces it (`source`). */
export function screenshots(root, files) {
  const shots = [];
  const lightIn = (dir, prefix) =>
    readdirSync(join(root, dir)).filter((f) => f.startsWith(prefix) && f.endsWith(".light.svg")).sort().map((f) => `${dir}/${f}`);
  const cases = files.filter((f) => /^lookbook\/cases\/[^/]+\.squinch$/.test(f)).sort();
  for (const file of cases) {
    if (!existsSync(join(root, file))) continue; // added and since removed
    const name = file.slice("lookbook/cases/".length, -".squinch".length);
    for (const path of lightIn("lookbook/out", `${name}.`))
      shots.push({ title: titleize(name), alt: caption(join(root, file)), path, source: file });
  }
  const examples = [...new Set(files.map((f) => /^examples\/([^/]+)\/[^/]+\.squinch$/.exec(f)?.[1]).filter(Boolean))].sort();
  for (const dir of examples) {
    if (!existsSync(join(root, "examples", dir))) continue;
    const source = readdirSync(join(root, "examples", dir)).find((f) => f.endsWith(".squinch"));
    for (const path of lightIn(`examples/${dir}`, ""))
      shots.push({
        title: `The ${titleize(dir)} example`, alt: source ? caption(join(root, "examples", dir, source)) : titleize(dir), path,
        source: files.find((f) => f.startsWith(`examples/${dir}/`) && f.endsWith(".squinch")),
      });
  }
  return shots;
}

/** One picture as the notes carry it: the SVG, embedded as an image. */
export const shotMarkdown = (repo, version, s) => `![${s.alt}](${repo}/blob/v${version}/${s.path}?raw=true)`;

/** What is wrong with the pictures in one version's notes: each must point at
 *  that version's tag and at a file the tree has. */
export function shotProblems(root, version, notes) {
  const problems = [];
  for (const [, ref, path] of notes.matchAll(/\/blob\/([^/\s)]+)\/([^?\s)]+)\?raw=true/g)) {
    if (ref !== `v${version}`) problems.push(`${path} is linked at ${ref}, not v${version}`);
    if (!existsSync(join(root, path))) problems.push(`${path} does not exist`);
  }
  return problems;
}
