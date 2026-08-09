// LF is an input invariant, not only an output one.
//
// A `.squinch` file checked out on Windows arrives CRLF. The grammar skips
// `\r`, so it parses fine — which is why the original bug was invisible: the
// sketch theme seeded its jitter from `hash(source)`, so CRLF source rendered
// the same diagram with *different wobble*. The determinism contract says same
// (source, packs, theme, tool version) → byte-identical SVG, and that was
// quietly false across platforms. That theme is gone; the invariant is not,
// because source text still reaches the SVG verbatim through every label,
// description and titleblock value.
//
// These tests are the only coverage for a *user's* CRLF repo. Windows CI cannot
// provide it: this repo's own .gitattributes gives that runner an LF tree.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { render, renderProject, buildModel, normalizeSource } from "../src/index.js";
import { corpus } from "./helpers/corpus.js";
import { sanitizeIcon } from "../src/packs/sanitize.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const lf = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");
const crlf = lf.replace(/\n/g, "\r\n");

describe("CRLF source is the same source", () => {
  it("converts CRLF and lone CR, and leaves clean text identical", () => {
    expect(normalizeSource(crlf)).toBe(lf);
    expect(normalizeSource("a\rb")).toBe("a\nb");
    // identity, not just equality: the common path must not copy
    expect(normalizeSource(lf)).toBe(lf);
  });

  it.each(["light", "dark"])("renders byte-identically in %s", async (theme) => {
    const a = await render(lf, { theme });
    const b = await render(crlf, { theme });
    expect(a.ok && b.ok).toBe(true);
    expect(b.svg).toBe(a.svg);
  });

  it("reports diagnostics at the same place", () => {
    const broken = `system s "S" {\n  a = box "A"\n  a -> nope\n}\nview v { include * }\n`;
    const one = buildModel(broken).diagnostics;
    const two = buildModel(broken.replace(/\n/g, "\r\n")).diagnostics;
    expect(one.length).toBeGreaterThan(0);
    expect(two.map((d) => [d.loc.line, d.loc.col, d.message]))
      .toEqual(one.map((d) => [d.loc.line, d.loc.col, d.message]));
  });

  it("never lets a CR reach the output", async () => {
    const r = await render(crlf, { theme: "dark" });
    expect(r.svg!.includes("\r")).toBe(false);
  });
});

describe("the renderer's output alphabet has no CR", () => {
  // This is the premise `render --check` leans on: it compares committed SVG
  // against a fresh render with line endings normalized, which can only ever
  // mask a difference the renderer could not have produced. Eight goldens
  // assert it; the corpus makes it universal.
  it("holds across every corpus file", async () => {
    const files = corpus();
    expect(files.length, "empty corpus — the loader is broken, not the claim").toBeGreaterThan(40);
    const dirty: string[] = [];
    for (const f of files) {
      const r = await renderProject([f], { theme: "light" });
      if (r.ok && r.svg!.includes("\r")) dirty.push(f.name);
    }
    expect(dirty, "CR in rendered output").toEqual([]);
  }, 120_000);
});

describe("CRLF icon artwork", () => {
  // The pack loader reads icons as text with no normalization of its own. Today
  // fast-xml-parser normalizes line endings in both text nodes and attribute
  // values, so nothing leaks — but nothing said so, and a CR inside a wrapped
  // `d="…"` would land in every rendered SVG on Windows only.
  it("cannot leak a CR into the rendered body", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\r\n` +
      `<path d="M0 0\r\nL10 10" fill="#222"/>\r\n<desc>one\r\ntwo</desc>\r\n</svg>`;
    const { body, viewBox } = sanitizeIcon(svg, "crlf-probe");
    expect(viewBox).toBe("0 0 10 10");
    expect(body.includes("\r")).toBe(false);
  });
});
