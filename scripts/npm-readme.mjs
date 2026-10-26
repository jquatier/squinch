// Give the npm package the repository's README.
//
// npm shows the README inside the package directory, and `packages/cli` had
// none, so npmjs.com showed nothing. A second, hand-written README would be a
// second description of the same product to keep in step, so the package
// ships the root one instead — copied at pack time, never committed (it is
// gitignored).
//
// The copy cannot be verbatim: the root README's links and images are
// relative to the repo root, and on npmjs.com they would resolve against
// nothing. Every relative target becomes an absolute GitHub URL pinned to
// this version's tag, so a version's page shows that version's pictures and
// documents — images through raw.githubusercontent.com, which serves SVG and
// GIF with their real types; documents and directories through blob/ and
// tree/. Anchors (`#install`) and absolute URLs are left alone.
//
//   node scripts/npm-readme.mjs     (packages/cli's `prepack` runs it)
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A relative target: not a URL with a scheme, not an anchor, not root-absolute. */
const isRelative = (t) => t !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("#") && !t.startsWith("/");

/**
 * Rewrite every relative link and image in `markdown` to an absolute URL at
 * `ref` in `repo` (e.g. https://github.com/owner/name). Markdown links and
 * images, and `src` / `srcset` / `href` attributes in inline HTML, are the
 * shapes the README uses. `targets` collects each repo path rewritten, so a
 * caller can check they exist.
 */
export function absolutize(markdown, { repo, ref, targets = [] }) {
  const slug = new URL(repo).pathname.replace(/^\/|\.git$/g, "");
  const url = (path, image) => {
    const [file, hash = ""] = path.replace(/^\.\//, "").split(/(?=#)/);
    targets.push(file);
    if (image) return `https://raw.githubusercontent.com/${slug}/${ref}/${file}`;
    const dir = file.endsWith("/") || (existsSync(join(root, file)) && statSync(join(root, file)).isDirectory());
    return `${repo}/${dir ? "tree" : "blob"}/${ref}/${file.replace(/\/$/, "")}${hash}`;
  };
  return markdown
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang, text, t) =>
      isRelative(t) ? `${bang}[${text}](${url(t, bang === "!")})` : m)
    .replace(/\b(src|srcset|href)="([^"]+)"/g, (m, attr, t) =>
      isRelative(t) ? `${attr}="${url(t, attr !== "href")}"` : m);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8"));
  const repo = pkg.repository.url.replace(/\.git$/, "");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  writeFileSync(join(root, "packages", "cli", "README.md"), absolutize(readme, { repo, ref: `v${pkg.version}` }));
}
