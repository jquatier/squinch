// The README's "From source to diagram" block claims to be the whole file, and
// sits directly above that file's committed render. It drifted once — the block
// had been trimmed to four nodes while the picture showed nine — which is a
// worse kind of wrong than a stale diagram, because the reader's first
// impression of the language is a file that would not produce what they see.
//
// CI already asserts the committed SVGs match their source; this asserts the
// README matches it too.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("README", () => {
  it("quotes examples/products-api verbatim under `From source to diagram`", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const block = /## From source to diagram[\s\S]*?```squinch\n([\s\S]*?)```/.exec(readme);
    expect(block, "the section or its squinch block is missing").not.toBeNull();

    const source = readFileSync(
      join(root, "examples", "products-api", "products-api.squinch"),
      "utf8",
    );
    expect(block![1]).toBe(source.trim() + "\n");
  });

  it("points that section at the render of the same view", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const after = readme.slice(readme.indexOf("## From source to diagram"));
    expect(after).toContain("examples/products-api/products-api.products.light.svg");
    expect(after).toContain("examples/products-api/products-api.products.dark.svg");
  });
});
