// The playground's logic, tested without a browser.
//
// ~1,000 non-presentational lines shipped with no test of any kind — `pnpm -r
// test` skipped the package entirely, and CI's only assertion was that it
// compiles. The four modules under src/lib/ are the parts where being wrong is
// invisible until someone notices the animation feels off or a share link does
// not open, so they were pulled out of the components to be reachable.
import { describe, it, expect } from "vitest";
import { encodeShare, decodeShare } from "../src/lib/share";
// the scope arithmetic and the dive geometry live in core now — one
// implementation, because the interactive HTML export performs the same
// motion. Their tests moved with them (packages/core/test/navigate.test.ts).
import { isolateIds } from "../src/lib/isolate";

describe("isolateIds — keeping two layers apart", () => {
  it("prefixes definitions and every kind of reference", () => {
    const out = isolateIds(
      `<symbol id="i-lambda"/><use href="#i-lambda"/><g clip-path="url(#c1)"/>`,
    );
    expect(out).toContain('id="ghost-i-lambda"');
    expect(out).toContain('href="#ghost-i-lambda"');
    expect(out).toContain("url(#ghost-c1)");
  });

  it("is idempotent — the ghost is re-isolated whenever the source changes", () => {
    // The original prefixed unconditionally, so a second pass produced
    // `ghost-ghost-i-lambda` and the layer lost its artwork. Nothing caught it
    // because it only happens mid-transition.
    const once = isolateIds(`<symbol id="a"/><use href="#a"/>`);
    expect(isolateIds(once)).toBe(once);
  });

  it("leaves everything else alone", () => {
    const svg = `<rect x="1" y="2" fill="#fff"/><text>id="not-an-attribute"</text>`;
    expect(isolateIds(svg)).toContain('fill="#fff"');
  });

  it("survives what the renderer actually emits", () => {
    // core namespaces pack ids as `sq-<pack>-<id>`; this is the coupling that
    // breaks silently if that scheme ever changes.
    const real = `<defs><symbol id="sq-aws-lambda" viewBox="0 0 80 80"></symbol></defs>` +
      `<use href="#sq-aws-lambda" width="40" height="40"/>`;
    const out = isolateIds(real);
    expect(out.match(/ghost-/g)?.length).toBe(2);
  });
});

describe("share links", () => {
  const round = (s: string) => decodeShare(encodeShare(s));

  it("round-trips ordinary source", () => {
    const src = `system s "S" {\n  a = aws/lambda "A"\n}\n`;
    expect(round(src)).toBe(src);
  });

  it("round-trips non-ASCII — labels are prose, and prose has accents", () => {
    for (const s of ["café — naïve", "日本語のラベル", "emoji 🎯 in a label", "→ ← ↔"])
      expect(round(s)).toBe(s);
  });

  it("emits nothing that needs escaping in a URL fragment", () => {
    const enc = encodeShare("a".repeat(100) + "?&#=/+");
    expect(enc).not.toMatch(/[+/=]/);
    expect(enc).toBe(encodeURIComponent(enc));
  });

  it("handles a diagram big enough to be worth sharing", () => {
    // The original spread every byte as a separate argument to fromCharCode,
    // which is a RangeError somewhere past ~64k — and a big diagram is exactly
    // the one you send to someone.
    const big = `// a large diagram\n`.repeat(20_000); // ~380 KB
    expect(big.length).toBeGreaterThan(300_000);
    expect(round(big)).toBe(big);
  });

  it("returns undefined rather than throwing on a mangled fragment", () => {
    expect(decodeShare("!!!not base64!!!")).toBeUndefined();
  });

  it("round-trips the empty document", () => {
    expect(round("")).toBe("");
  });
});
