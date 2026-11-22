// Print one version's section of the root CHANGELOG.md, verbatim.
//
//   node scripts/release-notes.mjs 0.1.0
//
// The release workflow uses this as the GitHub Release notes, and fails the
// release when the section is missing — cutting a release *requires* writing
// what changed, which is the point of keeping a changelog at all. It fails too
// when a screenshot in the section (scripts/release-shots.mjs) is linked at
// another version or names a file the tree does not have: a broken image on
// the release page is a release that does not show what it shipped.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shotProblems } from "./release-shots.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}

const log = readFileSync(join(root, "CHANGELOG.md"), "utf8");
// A section runs from its `## <version>` heading (any suffix, e.g. a date)
// to the next `## ` heading or the end of the file.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const m = new RegExp(`^## ${escaped}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(log);
if (!m) {
  console.error(
    `CHANGELOG.md has no \`## ${version}\` section — run \`pnpm release\`, ` +
      `which writes it, rather than tagging by hand`,
  );
  process.exit(1);
}
const notes = m[1].trim();
const broken = shotProblems(root, version, notes);
if (broken.length) {
  console.error(`the ${version} notes link pictures that will not show:\n  ${broken.join("\n  ")}`);
  process.exit(1);
}
process.stdout.write(notes + "\n");
