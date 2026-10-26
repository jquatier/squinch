// The README's "From source to diagram" block claims to be the whole file, and
// sits directly above that file's committed render. It drifted once — the block
// had been trimmed to four nodes while the picture showed nine — which is a
// worse kind of wrong than a stale diagram, because the reader's first
// impression of the language is a file that would not produce what they see.
//
// CI already asserts the committed SVGs match their source; this asserts the
// README matches it too.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("README", () => {
  it("quotes examples/products-api verbatim under `From source to diagram`", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    // The fence says `kotlin`, not `squinch`: Linguist has no Squinch grammar,
    // and Kotlin's tokeniser happens to colour this DSL correctly on GitHub (see
    // the comment above the block in README.md). Accept either, so swapping the
    // fence back when Linguist ships a grammar does not break this test.
    const block = /## From source to diagram[\s\S]*?```(?:squinch|kotlin)\n([\s\S]*?)```/.exec(readme);
    expect(block, "the section or its fenced source block is missing").not.toBeNull();

    const source = readFileSync(
      join(root, "examples", "products-api", "products-api.squinch"),
      "utf8",
    );
    expect(block![1]).toBe(source.trim() + "\n");
  });

  // npm shows the package's own README, so `prepack` copies the root one in
  // with its relative links made absolute (scripts/npm-readme.mjs). A link to
  // a path that does not exist would ship as a GitHub 404 on npmjs.com, and
  // nothing else would notice — GitHub's own rendering of a broken relative
  // link is just as quiet.
  it("ships to npm with every relative link absolute and resolving", async () => {
    // @ts-expect-error — a plain .mjs script, no declarations
    const { absolutize } = await import("../../../scripts/npm-readme.mjs");
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const opts = { repo: "https://github.com/jquatier/squinch", ref: "v0.0.0" };

    const targets: string[] = [];
    const out: string = absolutize(readme, { ...opts, targets });
    expect(targets.length, "no relative links found — has the README's shape changed?").toBeGreaterThan(0);
    const missing = targets.filter((t) => !existsSync(join(root, t)));
    expect(missing, "README links to paths that do not exist").toEqual([]);

    const left: string[] = [];
    absolutize(out, { ...opts, targets: left });
    expect(left, "relative links survived the rewrite").toEqual([]);
    expect(out).toContain('src="https://raw.githubusercontent.com/jquatier/squinch/v0.0.0/docs/assets/prompt-light.gif"');
    expect(out).toContain("](https://github.com/jquatier/squinch/tree/v0.0.0/packages/skill)");
    expect(out).toContain("](https://github.com/jquatier/squinch/blob/v0.0.0/docs/SPEC.md)");

    const pkg = JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8"));
    expect(pkg.scripts.prepack).toBe("node ../../scripts/npm-readme.mjs");
  });

  it("points that section at the render of the same view", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const after = readme.slice(readme.indexOf("## From source to diagram"));
    expect(after).toContain("examples/products-api/products-api.products.light.svg");
    expect(after).toContain("examples/products-api/products-api.products.dark.svg");
  });
});
