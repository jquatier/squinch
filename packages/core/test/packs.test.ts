import { describe, it, expect } from "vitest";

describe("searchIcons", () => {
  it("never lists an alias next to its canonical id", () => {
    const gateway = searchIcons("gateway");
    expect(gateway).toContain("aws/api-gateway");
    expect(gateway).not.toContain("aws/apigateway"); // alias collapses onto canonical
  });

  it("alias-only matches stay reachable by their famous short names", () => {
    expect(searchIcons("sqs")).toContain("aws/sqs");
    expect(searchIcons("s3")).toContain("aws/s3");
  });
});
import { sanitizeIcon } from "../src/packs/sanitize.js";
import { iconAsset, hasIcon, iconTitle, packInfo, symbolId } from "../src/packs/registry.js";
import { searchIcons, render, validateSVG } from "../src/index.js";

describe("pack sanitizer", () => {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${inner}</svg>`;

  it("keeps geometry and colour verbatim", () => {
    const { body, viewBox } = sanitizeIcon(
      wrap(`<g fill="none"><rect x="0" y="0" width="80" height="80" fill="#8C4FFF"/></g>`),
      "t",
    );
    expect(viewBox).toBe("0 0 80 80");
    expect(body).toContain(`fill="#8C4FFF"`);
    expect(body).toContain(`width="80"`);
  });

  it("strips scripts, event handlers and foreignObject", () => {
    const { body } = sanitizeIcon(
      wrap(
        `<script>alert(1)</script>` +
          `<foreignObject><div>hi</div></foreignObject>` +
          `<rect width="10" height="10" onload="alert(2)" onclick="x()" fill="#111"/>`,
      ),
      "t",
    );
    expect(body).not.toContain("script");
    expect(body).not.toContain("foreignObject");
    expect(body).not.toContain("onload");
    expect(body).not.toContain("onclick");
    expect(body).toContain(`fill="#111"`); // the safe part survives
  });

  it("drops external references and raw style/class", () => {
    const { body } = sanitizeIcon(
      wrap(`<image href="http://evil.test/x.png" width="10" height="10"/>` +
        `<rect width="5" height="5" style="behavior:url(#x)" class="c" fill="#222"/>`),
      "t",
    );
    expect(body).not.toContain("evil.test");
    expect(body).not.toContain("<image");
    expect(body).not.toContain("style=");
    expect(body).not.toContain("class=");
  });

  it("namespaces internal ids so icons can share a document", () => {
    const a = sanitizeIcon(wrap(`<clipPath id="c"><rect width="1" height="1"/></clipPath><rect clip-path="url(#c)" width="2" height="2"/>`), "one");
    const b = sanitizeIcon(wrap(`<clipPath id="c"><rect width="1" height="1"/></clipPath><rect clip-path="url(#c)" width="2" height="2"/>`), "two");
    expect(a.body).toContain(`id="one-c"`);
    expect(a.body).toContain(`url(#one-c)`);
    expect(b.body).toContain(`url(#two-c)`);
  });
});

describe("aws pack", () => {
  it("is installed with a manifest and licence metadata", () => {
    const info = packInfo("aws")!;
    expect(info.license).toBe("CC-BY-ND-2.0");
    expect(info.attribution).toContain("Amazon Web Services");
    expect(Object.keys(info.icons).length).toBeGreaterThan(250);
  });

  it("resolves ids and common aliases", () => {
    expect(hasIcon("aws", "lambda")).toBe(true);
    expect(hasIcon("aws", "s3")).toBe(true); // alias
    expect(hasIcon("aws", "sqs")).toBe(true);
    expect(hasIcon("aws", "nope-not-real")).toBe(false);
    expect(iconTitle("aws", "s3")).toContain("Simple Storage Service");
    // aliases share the canonical symbol, so one <symbol> serves both
    expect(symbolId("aws", "s3")).toBe(symbolId("aws", "simple-storage-service"));
  });

  it("loads real artwork through the sanitizer", () => {
    const asset = iconAsset("aws", "lambda")!;
    expect(asset.viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(asset.body).toContain("<path");
    expect(asset.body).not.toContain("<script");
  });

  it("search finds services by substring", () => {
    expect(searchIcons("dynamo")).toContain("aws/dynamodb");
    expect(searchIcons("lambda", "aws")).toContain("aws/lambda");
  });
});

describe("icon rendering", () => {
  const SRC = `pack aws
system s "S" {
  a = aws/lambda "One"
  b = aws/lambda "Two"
  c = aws/s3 "Bucket"
  a -> b
  b -> c
}`;

  it("emits one symbol per distinct icon and reuses it", async () => {
    const r = await render(SRC, { theme: "light" });
    expect(r.ok).toBe(true);
    const symbols = r.svg!.match(/<symbol /g) ?? [];
    const uses = r.svg!.match(/<use /g) ?? [];
    expect(symbols.length).toBe(2); // lambda + s3, deduplicated
    expect(uses.length).toBe(3); // three nodes
    expect(validateSVG(r.svg!).ok).toBe(true);
  });

  it("never puts clip-path on <use> (it blocks instantiation)", async () => {
    const r = await render(SRC, { theme: "light" });
    expect(r.svg).not.toMatch(/<use[^>]*clip-path/);
  });

  it("box nodes render the first-party cube glyph on their plate", async () => {
    const r = await render(`system s "S" {\n a = box "Plain"\n}`, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).toContain(`href="#sq-builtin-box"`);
    expect(r.svg).toContain('stroke="currentColor"');
  });
});
