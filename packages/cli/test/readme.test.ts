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
  it("quotes examples/orders verbatim under `From source to diagram`", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const block = /## From source to diagram[\s\S]*?```squinch\n([\s\S]*?)```/.exec(readme);
    expect(block, "the section or its squinch block is missing").not.toBeNull();

    const source = readFileSync(join(root, "examples", "orders", "orders.squinch"), "utf8");
    // the in-repo spec cross-reference is the one line the README omits
    const expected =
      source
        .split("\n")
        .filter((l) => !l.startsWith("// The canonical example"))
        .join("\n")
        .trim() + "\n";

    expect(block![1]).toBe(expected);
  });

  it("points that section at the render of the same view", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const after = readme.slice(readme.indexOf("## From source to diagram"));
    expect(after).toContain("examples/orders/orders.orders.light.svg");
    expect(after).toContain("examples/orders/orders.orders.dark.svg");
  });
});
